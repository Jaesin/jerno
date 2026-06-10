import { allItems, itemsByUnit, UNITS_ORDER } from '../content/index.js'
import { isDue, initialState } from './srs.js'

// exerciseTypeForItem: maps item + stage to an exercise type string
// Exercise types: 'intro', 'flashcard', 'audio-pick', 'tile-builder', 'match-five', 'kana-pop'
export function exerciseTypeForItem(item, stage, opts = {}) {
  const { kidMode = false } = opts
  if (stage === 'seed') return 'intro'
  if (item.type === 'kana') return 'kana-pop'
  // variety by stage
  const pools = {
    sprout: ['flashcard', 'audio-pick', 'match-five'],
    bamboo: ['audio-pick', 'tile-builder', 'flashcard'],
    blossom: ['tile-builder', 'flashcard'],
  }
  const pool = pools[stage] || ['flashcard']
  return pool[Math.floor(Math.random() * pool.length)]
}

// buildSession: main entry point
// srsStates: Map<itemId, srsState> (all known states for this learner)
// profile: { newPerDay, activeUnit, kidMode }
// returns: array of { item, exerciseType, srsState }
export function buildSession(srsStates, profile = {}, now = Date.now()) {
  const {
    newPerDay = 5,
    activeUnit = UNITS_ORDER[0],
    kidMode = false,
  } = profile

  const items = allItems
  const exercises = []
  const seen = new Set()

  // 1. Due reviews (cap 20), trip items first
  const due = items
    .filter(item => {
      const s = srsStates.get(item.id)
      return s && isDue(s, now) && s.stage !== 'seed'
    })
    .sort((a, b) => {
      const sa = srsStates.get(a.id)
      const sb = srsStates.get(b.id)
      const aTrip = a.unit === 'trip' ? 0 : 1
      const bTrip = b.unit === 'trip' ? 0 : 1
      if (aTrip !== bTrip) return aTrip - bTrip
      return sa.due - sb.due
    })
    .slice(0, 20)

  for (const item of due) {
    const s = srsStates.get(item.id)
    exercises.push({ item, exerciseType: exerciseTypeForItem(item, s.stage, { kidMode }), srsState: s })
    seen.add(item.id)
  }

  // 2. New items up to newPerDay cap
  const unitItems = itemsByUnit[activeUnit] || []
  let newCount = 0
  for (const item of unitItems) {
    if (newCount >= newPerDay) break
    if (seen.has(item.id)) continue
    const s = srsStates.get(item.id)
    if (!s || s.stage === 'seed') {
      const state = s || initialState(item.id, now)
      exercises.push({ item, exerciseType: 'intro', srsState: state })
      seen.add(item.id)
      newCount++
    }
  }

  // 3. Weak-item top-up: lapses >= 2
  if (exercises.length < 10) {
    const weak = items.filter(item => {
      if (seen.has(item.id)) return false
      const s = srsStates.get(item.id)
      return s && s.lapses >= 2
    }).slice(0, 10 - exercises.length)
    for (const item of weak) {
      const s = srsStates.get(item.id)
      exercises.push({ item, exerciseType: exerciseTypeForItem(item, s.stage, { kidMode }), srsState: s })
      seen.add(item.id)
    }
  }

  // If session is empty (fresh learner), seed first 5 new items from first unit
  if (exercises.length === 0) {
    const firstUnit = itemsByUnit[UNITS_ORDER[0]] || []
    for (const item of firstUnit.slice(0, 5)) {
      exercises.push({ item, exerciseType: 'intro', srsState: initialState(item.id, now) })
    }
  }

  // Limit session length for kid mode
  const limit = kidMode ? 10 : 14
  return exercises.slice(0, limit)
}
