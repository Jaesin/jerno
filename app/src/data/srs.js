// SRS engine — pure functions only (no side effects, no DB calls).
// SM-2 variant per spec 20: fixed interval ladder, ease reserved for future tuning.

// Stages
export const STAGES = {
  SEED: 'seed',      // 🌱 new
  SPROUT: 'sprout',  // 🌿 learning
  BAMBOO: 'bamboo',  // 🎋 reviewing
  BLOSSOM: 'blossom' // 🌸 mastered
}

export const STAGE_EMOJI = {
  seed: '🌱', sprout: '🌿', bamboo: '🎋', blossom: '🌸'
}

// Interval schedule in days (index = step)
const INTERVALS = [0, 1, 3, 7, 16, 35, 75]
// 0 = same session (10 min), handled specially

export function initialState(itemId, now = Date.now()) {
  return {
    id: itemId,
    stage: STAGES.SEED,
    step: 0,
    interval: 0,
    ease: 2.5,
    lapses: 0,
    seenCount: 0,
    lastGrade: null,
    introducedAt: now,
    due: now, // due immediately
  }
}

// grade: 'got-it' | 'not-yet'
export function grade(state, gradeValue, now = Date.now()) {
  const next = { ...state, seenCount: state.seenCount + 1, lastGrade: gradeValue }

  if (gradeValue === 'got-it') {
    const newStep = Math.min(state.step + 1, INTERVALS.length - 1)
    next.step = newStep
    const days = INTERVALS[newStep]
    next.interval = days
    next.due = days === 0
      ? now + 10 * 60 * 1000  // 10 minutes for same-session
      : now + days * 24 * 60 * 60 * 1000
    next.stage = stepToStage(newStep)
  } else {
    // Miss: drop two steps, never below step 1 (1-day interval)
    const newStep = Math.max(1, state.step - 2)
    next.step = newStep
    next.lapses = state.lapses + 1
    next.interval = INTERVALS[newStep]
    next.due = now + INTERVALS[newStep] * 24 * 60 * 60 * 1000
    next.stage = stepToStage(newStep)
  }

  return next
}

function stepToStage(step) {
  if (step === 0) return STAGES.SEED
  if (step <= 2) return STAGES.SPROUT
  if (step <= 4) return STAGES.BAMBOO
  return STAGES.BLOSSOM
}

export function isDue(state, now = Date.now()) {
  return state.due <= now
}

export function dueCount(states, now = Date.now()) {
  return states.filter(s => isDue(s, now)).length
}
