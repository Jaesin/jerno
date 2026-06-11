import kanaHira from './kana-hiragana.json'
import phrasesU1 from './phrases-u1.json'
import phrasesU2 from './phrases-u2.json'
import phrasesU3 from './phrases-u3.json'
import phrasesU4 from './phrases-u4.json'
import phrasesU5 from './phrases-u5.json'
import phrasesU6 from './phrases-u6.json'

export const allItems = [...kanaHira, ...phrasesU1, ...phrasesU2, ...phrasesU3, ...phrasesU4, ...phrasesU5, ...phrasesU6]

export const itemsByUnit = {
  'u0-kana-hira': kanaHira,
  'u1-survival': phrasesU1,
  'u2-numbers': phrasesU2,
  'u3-food': phrasesU3,
  'u4-transit': phrasesU4,
  'u5-politeness': phrasesU5,
  'u6-shopping': phrasesU6,
}

export const UNITS_ORDER = ['u0-kana-hira', 'u1-survival', 'u2-numbers', 'u3-food', 'u4-transit', 'u5-politeness', 'u6-shopping']

export const UNIT_NAMES = {
  'u0-kana-hira': 'Hiragana Basics',
  'u1-survival': 'Survival Phrases',
  'u2-numbers': 'Numbers & Money',
  'u3-food': 'Food & Restaurants',
  'u4-transit': 'Getting Around',
  'u5-politeness': 'Politeness & People',
  'u6-shopping': 'Shopping',
}

export function getItem(id) {
  return allItems.find(i => i.id === id)
}
