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
