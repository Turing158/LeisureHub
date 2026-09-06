/**
 * The current browser localStorage namespace.
 */
export const STORAGE_NAMESPACE = 'leisure-hub'

/**
 * The namespace used by versions released before the project rename.
 */
export const LEGACY_STORAGE_NAMESPACE = 'starfall-hub'

const LEGACY_PREFIX = `${LEGACY_STORAGE_NAMESPACE}:`
const CURRENT_PREFIX = `${STORAGE_NAMESPACE}:`

let migrationAttempted = false

/**
 * Copy legacy keys into the current namespace once per page load.
 *
 * Keys are migrated as raw strings because each store owns its own schema. A
 * key is removed only after the new value has been written and read back, so
 * a disabled or full localStorage leaves the legacy data available for retry.
 */
export function ensureStorageMigrated(): void {
  if (migrationAttempted) return
  migrationAttempted = true

  try {
    const entries: Array<{ oldKey: string; newKey: string; value: string }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const oldKey = localStorage.key(i)
      if (!oldKey?.startsWith(LEGACY_PREFIX)) continue
      const value = localStorage.getItem(oldKey)
      if (value === null) continue
      try {
        JSON.parse(value)
      } catch {
        // Keep malformed legacy data untouched for manual recovery.
        continue
      }
      entries.push({
        oldKey,
        newKey: `${CURRENT_PREFIX}${oldKey.slice(LEGACY_PREFIX.length)}`,
        value,
      })
    }

    for (const { oldKey, newKey, value } of entries) {
      // Do not overwrite a key that already exists: it may contain newer data.
      // Keeping the legacy copy in this rare case preserves a fallback if the
      // current value is malformed or was written by another tab.
      if (localStorage.getItem(newKey) !== null) continue

      try {
        localStorage.setItem(newKey, value)
        if (localStorage.getItem(newKey) !== value) continue
      } catch {
        continue
      }

      try {
        localStorage.removeItem(oldKey)
      } catch {
        // A later page load can retry removing the legacy key.
      }
    }
  } catch {
    // localStorage may be unavailable in private browsing or restricted contexts.
  }
}

export function namespacedStorageKey(base: string): string {
  return `${CURRENT_PREFIX}${base}`
}
