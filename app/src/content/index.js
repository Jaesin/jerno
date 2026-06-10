import kanaHira from './kana-hiragana.json'
import phrasesU1 from './phrases-u1.json'

export const allItems = [...kanaHira, ...phrasesU1]

export const itemsByUnit = {
  'u0-kana-hira': kanaHira,
  'u1-survival': phrasesU1,
}

export const UNITS_ORDER = ['u0-kana-hira', 'u1-survival']

export const UNIT_NAMES = {
  'u0-kana-hira': 'Hiragana Basics',
  'u1-survival': 'Survival Phrases',
}

export function getItem(id) {
  return allItems.find(i => i.id === id)
}
