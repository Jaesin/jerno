// Translation cache backed by localStorage.
// Key: normalised English text + formality. Value: full translation result.
// Degrades silently if localStorage is unavailable (private mode, storage full).

const STORAGE_KEY = 'jerno-translation-cache-v1'
const MAX_ENTRIES = 500

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function save(cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Storage full or unavailable — fail silently
  }
}

function makeKey(text, formality) {
  return `${text.trim()}|${formality}`
}

/** Returns the cached translation result or null. Never throws. */
export function getCachedTranslation(text, formality = 'polite') {
  if (!text?.trim()) return null
  try {
    const entry = load()[makeKey(text, formality)]
    return entry?.result ?? null
  } catch {
    return null
  }
}

/** Stores a translation result. Evicts oldest entries when over MAX_ENTRIES. Never throws. */
export function setCachedTranslation(text, formality = 'polite', result) {
  if (!text?.trim() || !result) return
  try {
    const cache = load()
    cache[makeKey(text, formality)] = { result, ts: Date.now() }
    const keys = Object.keys(cache)
    if (keys.length > MAX_ENTRIES) {
      const oldest = keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0))
      oldest.slice(0, keys.length - MAX_ENTRIES).forEach(k => delete cache[k])
    }
    save(cache)
  } catch {
    // Never throw
  }
}
