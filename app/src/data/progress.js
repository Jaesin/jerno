import { getProgress, saveProgress } from './store.js'

// XP values
export const XP = {
  EXERCISE: 2,          // per completed exercise
  STAGE_SPROUT: 5,      // 🌱→🌿
  STAGE_BAMBOO: 10,     // 🌿→🎋
  STAGE_BLOSSOM: 25,    // 🎋→🌸
  ARCADE_ROUND: 8,      // completing any arcade round
  ARCADE_STREAK_MULT: 1 // +1 XP per streak point above 1
}

// Torii path ranks
export const RANKS = [
  { minXp: 0,    name: '旅人',  en: 'Traveler' },
  { minXp: 150,  name: '学生',  en: 'Student' },
  { minXp: 300,  name: '先輩',  en: 'Senpai' },
  { minXp: 600,  name: '達人',  en: 'Master' },
  { minXp: 1000, name: '鳥居守', en: 'Gatekeeper' },
]

export function rankFor(totalXp) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (totalXp >= RANKS[i].minXp) return RANKS[i]
  }
  return RANKS[0]
}

export function xpToNextRank(totalXp) {
  const current = rankFor(totalXp)
  const idx = RANKS.indexOf(current)
  const next = RANKS[idx + 1]
  if (!next) return 0
  return next.minXp - totalXp
}

// Badge definitions — unlock conditions live in awardEvent
export const BADGES = [
  { id: 'first_session',   icon: '🌱', label: 'First Steps',      desc: 'Complete your first practice session' },
  { id: 'streak_7',        icon: '🔥', label: 'Week Warrior',     desc: 'Reach a 7-day streak' },
  { id: 'first_blossom',   icon: '🌸', label: 'First Blossom',    desc: 'Bring an item to blossom stage' },
  { id: 'trip_deck_5',     icon: '✈️',  label: 'Trip Packer',      desc: 'Add 5 phrases to your trip deck' },
  { id: 'arcade_10',       icon: '🎮', label: 'Arcade Regular',   desc: 'Complete 10 arcade rounds' },
  { id: 'rank_student',    icon: '⛩️',  label: 'Student',          desc: 'Reach 学生 (Student) rank' },
]

// Default progress shape
function defaultProgress() {
  return {
    id: 'local',
    xp: 0,
    streak: { current: 0, best: 0, restTokens: 0, lastActive: null },
    quests: { date: null, q1: false, q2: false, q3: false },
    badges: {},
    weekXp: { isoWeek: null, xp: 0 },
    totalSessions: 0,
    totalArcadeRounds: 0,
    tripDeckAdds: 0,
  }
}

export async function getProgressData() {
  const saved = await getProgress('local')
  if (!saved) return defaultProgress()
  // backfill missing fields
  return { ...defaultProgress(), ...saved }
}

// isoWeek helper
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Main entry point: call after every session/round
// type: 'session' | 'arcade-round' | 'speaking' | 'trip-deck-add'
// payload: { exerciseCount, stageUps: [{ from, to }], arcadeStreak? }
// Returns { earnedXp, next, newBadges } — newBadges is an array of badge
// definitions unlocked by this call (empty if none).
export async function awardEvent(type, payload = {}) {
  const prog = await getProgressData()
  const today = todayISO()
  const week = isoWeek()

  let earnedXp = 0

  if (type === 'session') {
    earnedXp += (payload.exerciseCount || 0) * XP.EXERCISE
    for (const su of (payload.stageUps || [])) {
      if (su.to === 'sprout') earnedXp += XP.STAGE_SPROUT
      else if (su.to === 'bamboo') earnedXp += XP.STAGE_BAMBOO
      else if (su.to === 'blossom') earnedXp += XP.STAGE_BLOSSOM
    }
  } else if (type === 'arcade-round') {
    earnedXp += XP.ARCADE_ROUND
    const s = payload.arcadeStreak || 0
    if (s > 1) earnedXp += Math.min(s - 1, 8) * XP.ARCADE_STREAK_MULT
  }

  // XP totals
  const newXp = (prog.xp || 0) + earnedXp

  // Week XP
  const weekXp = prog.weekXp?.isoWeek === week
    ? (prog.weekXp.xp || 0) + earnedXp
    : earnedXp

  // Streak
  const streak = { ...prog.streak }
  if (streak.lastActive === today) {
    // already counted today — no streak change
  } else if (streak.lastActive === prevDay(today)) {
    // continuing streak
    streak.current = (streak.current || 0) + 1
    streak.best = Math.max(streak.best || 0, streak.current)
    streak.lastActive = today
    // earn a rest token every 7 days
    if (streak.current % 7 === 0) streak.restTokens = (streak.restTokens || 0) + 1
  } else if (streak.lastActive !== null && streak.lastActive < prevDay(today)) {
    // missed a day — spend rest token or reset
    if ((streak.restTokens || 0) > 0) {
      streak.restTokens -= 1
      streak.current = (streak.current || 0) + 1
      streak.best = Math.max(streak.best || 0, streak.current)
    } else {
      streak.current = 1
    }
    streak.lastActive = today
  } else {
    // first ever
    streak.current = 1
    streak.best = Math.max(streak.best || 0, 1)
    streak.lastActive = today
  }

  // Quests — reset if new day
  let quests = { ...prog.quests }
  if (quests.date !== today) {
    quests = buildQuests(today, prog)
  }
  // mark q1 done if exerciseCount > 0 (session) — "clear your review pile"
  if (type === 'session' && (payload.exerciseCount || 0) > 0) {
    quests.q1 = true
  }
  // mark q2 done on any completed arcade round — daily arcade quest
  if (type === 'arcade-round' && !quests.q2) {
    quests.q2 = true
  }
  // mark q3 done on any speaking signal — family-action quest proxy
  // (Speaking Lab visit or Echo Booth grade) until the family screen exists
  if (type === 'speaking' && !quests.q3) {
    quests.q3 = true
  }

  // Lifetime counters (used by badge conditions)
  const totalSessions = (prog.totalSessions || 0) + (type === 'session' ? 1 : 0)
  const totalArcadeRounds = (prog.totalArcadeRounds || 0) + (type === 'arcade-round' ? 1 : 0)
  const tripDeckAdds = (prog.tripDeckAdds || 0) + (type === 'trip-deck-add' ? 1 : 0)

  const next = {
    ...prog,
    xp: newXp,
    weekXp: { isoWeek: week, xp: weekXp },
    streak,
    quests,
    badges: { ...prog.badges },
    totalSessions,
    totalArcadeRounds,
    tripDeckAdds,
  }

  // Badge unlocks — check conditions, collect anything newly unlocked
  const newBadges = []
  const unlock = (id) => {
    if (next.badges[id]) return
    next.badges[id] = { unlockedAt: Date.now() }
    const def = BADGES.find(b => b.id === id)
    if (def) newBadges.push(def)
  }
  if (type === 'session' && totalSessions === 1) unlock('first_session')
  if ((streak.current || 0) >= 7) unlock('streak_7')
  if (type === 'session' && (payload.stageUps || []).some(su => su.to === 'blossom')) unlock('first_blossom')
  if (tripDeckAdds >= 5) unlock('trip_deck_5')
  if (totalArcadeRounds >= 10) unlock('arcade_10')
  if (RANKS.indexOf(rankFor(newXp)) >= 1) unlock('rank_student')

  await saveProgress(next)
  return { earnedXp, next, newBadges }
}

function prevDay(isoDate) {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Build 3 daily quests, seeded by date (same for all profiles = shared family topic)
const ROTATING_QUESTS = [
  'Answer 20 Kana Pop questions',
  'Get 5 Audio Picks right',
  'Complete 2 Pairs games',
  'Beat a Kana Ladder rung',
  'Review 10 phrases',
  'Study for 5 minutes',
  'Unlock a new kana row',
]

export function buildQuests(dateStr, prog) {
  const seed = dateStr.split('-').join('') | 0
  const idx = seed % ROTATING_QUESTS.length
  return {
    date: dateStr,
    q1: false,
    q2: false,
    q3: false,
    q1label: 'Clear your review pile',
    q2label: ROTATING_QUESTS[idx],
    q3label: 'Help a family member learn',
  }
}
