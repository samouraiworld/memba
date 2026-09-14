import type { Breadcrumb, Event } from '@sentry/react'

function redactText(value: string): string {
    value = value.replace(/g1[a-z0-9]{38}/gi, '[REDACTED_ADDRESS]')
    // Same matches as eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+,
    // without quadratic retries on a long run of `eyJ` with no dots.
    const word = /[A-Za-z0-9_-]+/g
    const part = /[A-Za-z0-9_-]+/y
    const chunks: string[] = []
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = word.exec(value))) {
        const header = match[0].indexOf('eyJ')
        if (header < 0 || header + 3 === match[0].length || value[word.lastIndex] !== '.') continue
        part.lastIndex = word.lastIndex + 1
        if (!part.exec(value) || value[part.lastIndex] !== '.') continue
        part.lastIndex++
        if (!part.exec(value)) continue
        chunks.push(value.slice(cursor, match.index + header), '[REDACTED_JWT]')
        cursor = word.lastIndex = part.lastIndex
    }
    chunks.push(value.slice(cursor))
    return chunks.join('')
}

function propertyDescriptor(value: object, key: string): PropertyDescriptor | undefined {
    let current: object | null = value
    for (let i = 0; current && i < 5; i++, current = Object.getPrototypeOf(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key)
        if (descriptor) return descriptor
    }
    if (current) throw new Error('Breadcrumb prototype budget exceeded')
}

// V8 exposes an own stack accessor; Firefox inherits one from Error.prototype.
// Only this captured native getter is allowed, including on Error subclasses.
const nativeStackGetter = propertyDescriptor(new Error(), 'stack')?.get

/**
 * Snapshot breadcrumbs before Sentry stores them. Never retain application-owned
 * references, accessors, or serialization methods that can reintroduce raw data.
 * Uninspectable / oversized breadcrumbs are dropped, not returned unsanitized.
 */
export function redactSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
    let budget = 1000
    let characters = 32_768
    const ancestors = new WeakSet<object>()
    function text(value: string): string {
        characters -= value.length
        if (characters < 0) throw new Error('Breadcrumb character budget exceeded')
        return redactText(value)
    }
    function copy(value: unknown, depth: number): unknown {
        if (--budget < 0 || depth > 10) throw new Error('Breadcrumb budget exceeded')
        if (typeof value === 'string') return text(value)
        if (value === null || value === undefined || typeof value === 'boolean') return value
        if (typeof value === 'number') return Number.isFinite(value) ? value : '[Non-finite number]'
        if (typeof value === 'bigint') return text(String(value))
        if (typeof value !== 'object') return '[Unsupported value]'
        if (ancestors.has(value)) return '[Circular]'
        if (value instanceof Date) return text(Date.prototype.toISOString.call(value))
        ancestors.add(value)
        try {
            if (Array.isArray(value)) {
                if (value.length > budget) throw new Error('Breadcrumb budget exceeded')
                return Array.from({ length: value.length }, (_, index) => {
                    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
                    return descriptor && 'value' in descriptor ? copy(descriptor.value, depth + 1) : '[Accessor or empty]'
                })
            }
            const result: Record<string, unknown> = Object.create(null)
            const isError = value instanceof Error
            const safeErrorText = !isError || ['name', 'message'].every(field => {
                const descriptor = propertyDescriptor(value, field)
                return !descriptor || ('value' in descriptor && typeof descriptor.value === 'string')
            })
            // Error message/stack/cause are non-enumerable. Preserve the standard
            // inherited error name using descriptors, without invoking getters.
            if (isError) {
                const name = propertyDescriptor(value, 'name')
                if (name && 'value' in name && typeof name.value === 'string') result.name = text(name.value)
            }
            const keys = isError ? Object.getOwnPropertyNames(value) : Object.keys(value)
            if (isError && nativeStackGetter && !keys.includes('stack')) keys.push('stack')
            if (keys.length > budget) throw new Error('Breadcrumb budget exceeded')
            for (const key of keys) {
                // Older V8 may format a lazy native stack while obtaining its
                // descriptor. Guard BEFORE that lookup, not just before .get().
                if (isError && key === 'stack' && !safeErrorText) {
                    result.stack = '[Accessor]'
                    continue
                }
                const descriptor = isError && key === 'stack' ? propertyDescriptor(value, key) : Object.getOwnPropertyDescriptor(value, key)
                const maskedKey = text(key)
                let safeKey = maskedKey
                // Keep both diagnostics if distinct sensitive keys collapse to
                // the same replacement; null prototypes also make __proto__ safe.
                if (!(isError && key === 'name')) {
                    let suffix = 1
                    while (Object.hasOwn(result, safeKey)) safeKey = `${maskedKey} (${suffix++})`
                }
                if (descriptor && 'value' in descriptor) {
                    result[safeKey] = copy(descriptor.value, depth + 1)
                } else if (isError && key === 'stack' && nativeStackGetter && descriptor?.get === nativeStackGetter) {
                    result[safeKey] = copy(nativeStackGetter.call(value), depth + 1)
                } else {
                    result[safeKey] = '[Accessor]'
                }
            }
            return result
        } finally {
            ancestors.delete(value)
        }
    }
    try {
        return copy(breadcrumb, 0) as Breadcrumb
    } catch {
        // Logging here would recursively create another console breadcrumb.
        return null
    }
}

/** Defense in depth for breadcrumbs supplied directly on events or by processors. */
export function redactSentryEvent<T extends Event>(event: T): T {
    return {
        ...event,
        ...(typeof event.message === 'string' && { message: redactText(event.message) }),
        ...(event.exception && { exception: {
            ...event.exception,
            values: event.exception.values?.map(value => ({
                ...value, ...(typeof value.value === 'string' && { value: redactText(value.value) }),
            })),
        } }),
        ...(event.breadcrumbs && { breadcrumbs: event.breadcrumbs
            .map(redactSentryBreadcrumb).filter((value): value is Breadcrumb => value !== null) }),
    }
}
