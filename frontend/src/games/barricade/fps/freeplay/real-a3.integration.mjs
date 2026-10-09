/** Opt-in assembly against exact A3 Git sources; no shared files copied into the repository. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
const commit = '2bb27005173d9fb2b1a92f19769d11a78c4465f8'
const here = dirname(fileURLToPath(import.meta.url)), frontend = resolve(here, '../../../../..')
const temporary = await mkdtemp(join(tmpdir(), 'fps-real-a3-'))
try {
    for (const file of ['lib/arcadeFreePlay.ts', 'games/arcade/freeplay/snapshot.ts', 'games/arcade/freeplay/session.ts', 'games/arcade/freeplay/FreePlayResult.tsx', 'games/arcade/freeplay/useFreePlayResult.ts', 'games/arcade/freeplay/FreePlayRuntimeContext.ts', 'games/arcade/freeplay/FreePlayRuntimeProvider.tsx']) {
        const path = join(temporary, 'src', file)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, execFileSync('git', ['show', `${commit}:frontend/src/${file}`], { cwd: frontend }))
    }
    await symlink(join(frontend, 'node_modules'), join(temporary, 'node_modules'), 'dir')
    const staged = (await readFile(join(here, 'runtime.tsx.integration-source'), 'utf8'))
        .replaceAll("'../../../../lib/", "'./src/lib/")
        .replaceAll("'../../../arcade/", "'./src/games/arcade/")
        .replace("'./bridge'", JSON.stringify(join(here, 'bridge')))
        .replace("'./LocalResult'", JSON.stringify(join(here, 'LocalResult')))
        .replace("'./RecoveryBoundary'", JSON.stringify(join(here, 'RecoveryBoundary')))
    await writeFile(join(temporary, 'runtime.tsx'), staged)
    if (process.env.FPS_A3_TYPES === '1') execFileSync(process.execPath, [join(frontend, 'node_modules/typescript/bin/tsc'), '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--jsx', 'react-jsx', '--lib', 'ES2022,DOM', join(temporary, 'runtime.tsx')], { cwd: temporary, stdio: 'inherit' })
    const source = `
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeFpsRuntimeBridge, useFpsRuntime } from './runtime'
import { FreePlayRuntimeProvider } from './src/games/arcade/freeplay/FreePlayRuntimeProvider'
import { createFreePlayClient, FREE_PLAY_REALM, hashFreePlayFields, freePlayRunID } from './src/lib/arcadeFreePlay'
import { createFreePlaySnapshot, saveFreePlaySnapshot, loadFreePlaySnapshot, listFreePlaySnapshots } from './src/games/arcade/freeplay/snapshot'
import { createFreePlaySession } from './src/games/arcade/freeplay/session'
import { FreePlayResult } from './src/games/arcade/freeplay/FreePlayResult'
import { createFpsFreePlayBridge } from ${JSON.stringify(join(here, 'bridge.ts'))}
import { createFpsRunConsumer } from ${JSON.stringify(join(here, 'consumer.ts'))}
import vectors from ${JSON.stringify(join(here, 'fixtures/terminal-vectors.json'))}
import wonReplay from ${JSON.stringify(join(here, 'fixtures/won-repair.json'))}
const entries = new Map(), storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
const input = createFreePlaySnapshot(vectors[0]).input
assert.ok(input, 'fixture input exists')
const target = { chainId: 'dev', realm: FREE_PLAY_REALM }, player = 'g1' + 'a'.repeat(38), binding = { player, target }
const runID = await freePlayRunID(binding, input), stateHash = vectors[0].stateHash
const replayHash = await hashFreePlayFields('memba:free-replay:v1', input.game, input.rules, String(input.simVersion), input.seed, input.replayCodec, input.replay)
const entry = { game: input.game, player, rules: input.rules, simVersion: input.simVersion, runID, seed: input.seed, score: input.claimedScore, stateHash, replayHash }
const payloadHash = await hashFreePlayFields('memba:free-anchor:v1', target.chainId, target.realm, runID, player, input.game, input.rules, String(input.simVersion), input.seed, String(input.claimedScore), stateHash, replayHash)
const run = { target, entry, clientRunId: input.clientRunId, payloadHash, replayCodec: input.replayCodec, replay: input.replay, status: 'confirmed', receipt: { target, entry, height: 42, attester: player, schemaVersion: 2 } }
let requests = 0, tokens = 0, subscriptions = 0, hashes = 0, allocations = 0
const identity = { player, chainId: target.chainId, revision: '1' }
const client = createFreePlayClient({ origin: 'https://fps-test.invalid', target, auth: { identity: () => identity, subscribe: () => { subscriptions++; return () => { subscriptions-- } }, token: async () => { tokens++; return { token: 'fixture-only', identity } } }, fetch: async (url, init) => { requests++; assert.equal(init.method, 'GET'); assert.ok(String(url).includes('/runs/')); return new Response(JSON.stringify(run)) } })
saveFreePlaySnapshot(storage, { ...createFreePlaySnapshot(input), binding, result: run })
const config = { rules: input.rules, simVersion: input.simVersion, storage, client }
let mapped
function Probe({ explicit = {} }) { mapped = useFpsRuntime(explicit); return null }
const recovery = { game: 'barricade', clientRunId: input.clientRunId, onClose() {} }
renderToStaticMarkup(<FreePlayRuntimeProvider value={{games:{barricade:config},recovery}}><Probe /></FreePlayRuntimeProvider>)
assert.equal(mapped.recovery, undefined); assert.ok(mapped.fpsFreePlay)
const providerHandle = mapped.fpsFreePlay.saved.open(input.clientRunId)
assert.match(renderToStaticMarkup(providerHandle.render()), /Saved receipt/); providerHandle.dispose()
const repeated = await mapped.fpsFreePlay.prepare(input.clientRunId, wonReplay)
assert.match(renderToStaticMarkup(repeated.render()), /Saved receipt/); repeated.dispose()
renderToStaticMarkup(<FreePlayRuntimeProvider value={{games:{barricade:config},recovery}}><Probe explicit={{fpsFreePlay:null,recovery:null}} /></FreePlayRuntimeProvider>)
assert.equal(mapped.fpsFreePlay, null); assert.equal(mapped.recovery, null)
renderToStaticMarkup(<FreePlayRuntimeProvider value={{games:{barricade:config}}}><Probe explicit={{recovery}} /></FreePlayRuntimeProvider>)
assert.equal(mapped.recovery, recovery)
renderToStaticMarkup(<FreePlayRuntimeProvider value={{games:{barricade:config},recovery:{...recovery,game:'space-invaders'}}}><Probe /></FreePlayRuntimeProvider>)
assert.equal(mapped.recovery, undefined)
assert.equal(makeFpsRuntimeBridge({...config,rules:'barricade-classic'}), undefined)
const localBridge = makeFpsRuntimeBridge({...config,client:undefined}), localHandle = localBridge.saved.open(input.clientRunId)
assert.match(renderToStaticMarkup(localHandle.render()), /Saved receipt/)
assert.doesNotMatch(renderToStaticMarkup(localHandle.render()), /Score confirmed/)
localHandle.dispose()
const repeatedLocal = await localBridge.prepare(input.clientRunId, wonReplay)
assert.match(renderToStaticMarkup(repeatedLocal.render()), /Saved receipt/); repeatedLocal.dispose()
assert.equal(requests, 0); assert.equal(tokens, 0); assert.equal(subscriptions, 0)

let shared
const bridge = createFpsFreePlayBridge({ hashFields: async (...fields) => { hashes++; return hashFreePlayFields(...fields) }, createSnapshot: createFreePlaySnapshot, createSession: snapshot => (shared = createFreePlaySession({ snapshot, client, storage })), renderSession: session => <FreePlayResult session={session} />, savedSnapshots: { list: () => listFreePlaySnapshots(storage, { game: 'barricade', offset: 0, limit: 20 }), load: id => loadFreePlaySnapshot(storage, id) } })
const owner = createFpsRunConsumer({ seed: 'recovery-test', storage, uuid: () => { allocations++; return '22222222-2222-4222-8222-222222222222' }, bridge })
const detach = owner.mount(), game = owner.getSnapshot(), journal = JSON.stringify(game.session.log())
assert.equal(bridge.saved.list().runs[0].clientRunId, input.clientRunId)
const handle = bridge.saved.open(input.clientRunId)
assert.equal(shared.getSnapshot().phase, 'saved')
assert.match(renderToStaticMarkup(handle.render()), /Saved receipt/)
assert.doesNotMatch(renderToStaticMarkup(handle.render()), /Score confirmed/)
assert.equal(requests, 0); assert.equal(tokens, 0); assert.equal(hashes, 0)
assert.equal(owner.getSnapshot().clientRunId, game.clientRunId); assert.equal(allocations, 1)
assert.equal(JSON.stringify(game.session.log()), journal)
await shared.refresh()
assert.equal(requests, 1); assert.equal(tokens, 1); assert.equal(shared.getSnapshot().phase, 'confirmed')
assert.match(renderToStaticMarkup(handle.render()), /Score confirmed on dev, block 42/)
handle.dispose(); assert.equal(subscriptions, 0)
assert.throws(() => bridge.saved.open('33333333-3333-4333-8333-333333333333'), /missing_fps_result/)
const classic = { ...input, clientRunId: '44444444-4444-4444-8444-444444444444', rules: 'barricade-classic' }
saveFreePlaySnapshot(storage, createFreePlaySnapshot(classic))
assert.equal(bridge.saved.list().runs.length, 1)
assert.throws(() => bridge.saved.open(classic.clientRunId), /wrong_fps_result/)
entries.set('memba:arcade:freeplay:v1:' + input.clientRunId, '{broken')
assert.equal(bridge.saved.list().unavailable, 1)
assert.throws(() => bridge.saved.open(input.clientRunId), /invalid_snapshot/)
entries.set('memba:arcade:freeplay:index:v1', '{broken')
assert.throws(() => bridge.saved.list(), /invalid_snapshot_index/)
assert.equal(requests, 1); assert.equal(hashes, 0); assert.equal(JSON.stringify(game.session.log()), journal)
detach()
console.log('PASS real A3 ${commit}: staged provider adapter, global recovery ignored, explicit-local/null priority, game/version filtering, local-only storage;  saved receipt -> explicit refresh -> confirmed; zero recovery replay/hash/API; existing run preserved; missing/corrupt/wrong-version handling; disposal')
`
    const entry = join(temporary, 'assembly.tsx'), output = join(temporary, 'assembly.mjs')
    await writeFile(entry, source)
    await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external' })
    await import(pathToFileURL(output).href)
} finally { await rm(temporary, { recursive: true, force: true }) }
