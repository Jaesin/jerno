import { openDB } from 'idb'
import { nanoid } from 'nanoid'

const DB_NAME = 'jerno-v1'
const DB_VERSION = 1

let _db = null
async function getDB() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      for (const name of ['history', 'decks', 'srs', 'progress', 'profile']) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
    },
  })
  return _db
}

export const store = {
  async get(collection, id) { return (await getDB()).get(collection, id) },
  async list(collection)    { return (await getDB()).getAll(collection) },
  async put(collection, item) {
    const record = { ...item, id: item.id || nanoid(), updatedAt: new Date().toISOString() }
    await (await getDB()).put(collection, record)
    return record
  },
  async remove(collection, id) { return (await getDB()).delete(collection, id) },
}

export async function addToHistory(entry) {
  return store.put('history', { ...entry, starred: false, at: new Date().toISOString() })
}

export async function starHistoryItem(id, starred) {
  const item = await store.get('history', id)
  if (item) return store.put('history', { ...item, starred })
}

export async function getHistory(uid, limit = 50) {
  const all = await store.list('history')
  return all
    .filter(i => i.uid === uid)
    .sort((a, b) => (b.at || b.updatedAt || '').localeCompare(a.at || a.updatedAt || ''))
    .slice(0, limit)
}

// --- Trip deck helpers ---

export async function addToTripDeck(historyItem) {
  return store.put('decks', {
    id: historyItem.id,
    unit: 'trip',
    deckId: 'trip',
    type: 'phrase',
    ja: historyItem.japanese,
    reading: historyItem.reading || '',
    romaji: historyItem.romaji || '',
    en: historyItem.en,
    segments: historyItem.segments || [],
    starred: true,
    addedAt: new Date().toISOString(),
  })
}

export async function removeFromTripDeck(id) {
  return store.remove('decks', id)
}

export async function getTripDeckItems() {
  const all = await store.list('decks')
  return all.filter(i => i.unit === 'trip' || i.deckId === 'trip')
}

// --- SRS helpers ---

export async function getSRSState(itemId) {
  return store.get('srs', itemId)
}

export async function getAllSRSStates() {
  return store.list('srs')
}

export async function saveSRSState(state) {
  return store.put('srs', state)
}

export async function getSRSMap() {
  const all = await store.list('srs')
  const map = new Map()
  for (const s of all) map.set(s.id, s)
  return map
}

export async function getProgress(key) {
  return store.get('progress', key)
}

export async function saveProgress(record) {
  return store.put('progress', record)
}

export async function getProfile() {
  const profile = await store.get('profile', 'local')
  return profile || {}
}

export async function saveProfile(patch) {
  const existing = (await store.get('profile', 'local')) || {}
  return store.put('profile', { ...existing, ...patch, id: 'local' })
}
