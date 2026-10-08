import type { Locator } from '@playwright/test'

/**
 * The Store home repeats some cards in its Essentials and Top rated shelves on purpose,
 * so "Details for X" is only unique inside the results grid.
 */
export const storeResults = (store: Locator): Locator => store.locator('.os-store-grid')
