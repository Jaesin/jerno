import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { grade, initialState } from '../data/srs.js'
import { getSRSState, saveSRSState, getSRSMap } from '../data/store.js'
import { itemsByUnit } from '../content/index.js'
import { tts } from '../api.js'
import { awardEvent } from '../data/progress.js'
import { Plant, Flame, NavIco, Ico } from '../design/primitives.jsx'

// SRS stage name → Plant growth-stage index (seed → sprout → bamboo → blossom)
const STAGE_IDX = { seed: 0, sprout: 1, bamboo: 2, blossom: 3 }

// Padlock (no lock glyph in the shared ICONS set)
function LockIco({ size = 20 }) {
  return (
    <Ico size={size}>
      <rect x="5" y="11" width="14" height="9" rx="2.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </Ico>
  )
}

// ---------------------------------------------------------------------------
// Shared constants + helpers
// ---------------------------------------------------------------------------

const KANA_POOL = itemsByUnit['u0-kana-hira']
const STAGE_ORDER = ['seed', 'sprout', 'bamboo', 'blossom']

// Hard-coded confusable pairs (romaji → romaji)
// Sound- and shape-confusable kana (romaji keys). All pairs are bidirectional.
const CONFUSABLES = {
  // Sound-similar
  shi: ['chi'], su: ['tsu'], mu: ['n'],
  fu: ['hu', 'ha'],
  // Shape-similar (and mixed)
  a: ['o'], o: ['a'],
  i: ['ri'], ri: ['i', 'n'],
  u: ['tsu'], tsu: ['su', 'u'],
  sa: ['chi', 'ki'], chi: ['shi', 'sa'], ki: ['sa'],
  nu: ['me', 'no'], me: ['ne', 'nu'], no: ['nu'],
  wa: ['ne', 're'], ne: ['re', 'me', 'wa'], re: ['ne', 'wa'],
  ha: ['ho', 'fu'], ho: ['ha'],
  ru: ['ro'], ro: ['ru'],
  ku: ['he'], he: ['ku'],
  ko: ['ni'], ni: ['ko'],
  so: ['n'], n: ['mu', 'so', 'ri'],
}

const ROWS_ORDER = [
  'a-row', 'ka-row', 'sa-row', 'ta-row', 'na-row', 'ha-row',
  'ma-row', 'ya-row', 'ra-row', 'wa-row', 'n-row',
]
const ROW_LABELS = {
  'a-row': 'あ-row', 'ka-row': 'か-row', 'sa-row': 'さ-row', 'ta-row': 'た-row',
  'na-row': 'な-row', 'ha-row': 'は-row', 'ma-row': 'ま-row', 'ya-row': 'や-row',
  'ra-row': 'ら-row', 'wa-row': 'わ-row', 'n-row': 'ん-row',
}

function isKidMode() {
  return localStorage.getItem('jerno-kid-mode') === 'true'
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Audio is best-effort: never block game flow on TTS failure.
async function playKana(text) {
  try {
    const result = await tts(text)
    const { base64, format } = result.audio
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: `audio/${format}` })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
    audio.onended = () => URL.revokeObjectURL(url)
  } catch (e) { /* audio is best-effort */ }
}

async function gradeItem(itemId, gradeValue) {
  const existing = await getSRSState(itemId)
  const state = existing || initialState(itemId)
  const next = grade(state, gradeValue)
  await saveSRSState(next)
  return { prev: existing, next }
}

// Grade an item and record a stage-up (🌱→🌿 etc.) into stageUpsRef if it advanced.
async function gradeAndTrack(item, gradeValue, stageUpsRef) {
  try {
    const { prev, next } = await gradeItem(item.id, gradeValue)
    const fromStage = prev?.stage ?? 'seed'
    if (STAGE_ORDER.indexOf(next.stage) > STAGE_ORDER.indexOf(fromStage)) {
      stageUpsRef.current.push({
        id: item.id, glyph: item.glyph, romaji: item.romaji,
        from: fromStage, to: next.stage,
      })
    }
  } catch (e) { /* never block game flow on storage errors */ }
}

// Streak → multiplier: 0-2 ×1, 3-5 ×2, 6-8 ×3, 9+ ×4
function multFor(streak) {
  return Math.min(4, Math.floor(streak / 3) + 1)
}

// Distractors: confusable pair first, then same-row, then fill from other rows.
function pickDistractors(target, pool, count) {
  const others = pool.filter(i => i.id !== target.id)
  const chosen = []
  const confRomaji = CONFUSABLES[target.romaji] || []
  for (const r of shuffle(confRomaji)) {
    if (chosen.length >= count) break
    const c = others.find(i => i.romaji === r)
    if (c && !chosen.includes(c)) chosen.push(c)
  }
  const sameRow = shuffle(others.filter(i => i.row === target.row && !chosen.includes(i)))
  for (const i of sameRow) {
    if (chosen.length >= count) break
    chosen.push(i)
  }
  const rest = shuffle(others.filter(i => !chosen.includes(i) && i.row !== target.row))
  for (const i of rest) {
    if (chosen.length >= count) break
    chosen.push(i)
  }
  return chosen.slice(0, count)
}

// Weighted random pick: lower step → heavier; due items doubled; unseen medium.
function weightedPick(pool, srsMap, excludeId) {
  const candidates = pool.filter(i => i.id !== excludeId)
  if (candidates.length === 0) return pool[0]
  const now = Date.now()
  const weights = candidates.map(i => {
    const s = srsMap?.get(i.id)
    if (!s) return 1.5
    let w = 1 / (s.step + 1)
    if (s.due <= now) w *= 2
    return w
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

// Items the user has actually been introduced to (seen at least once).
function introducedItems(srsMap) {
  return KANA_POOL.filter(i => (srsMap?.get(i.id)?.seenCount ?? 0) > 0)
}

// ---------------------------------------------------------------------------
// Shared round-engine pieces
// ---------------------------------------------------------------------------

// Countdown in seconds. total === null → untimed (Kid Mode), never fires onEnd.
function useCountdown(total, running, onEnd) {
  const [left, setLeft] = useState(total)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  useEffect(() => { setLeft(total) }, [total])
  useEffect(() => {
    if (!running || total == null) return
    const id = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000)
    return () => clearInterval(id)
  }, [running, total])
  useEffect(() => {
    if (running && total != null && left === 0) onEndRef.current?.()
  }, [left, running, total])
  return left
}

function TimerBar({ left, total }) {
  if (total == null) return null
  return (
    <div className="arcade-timer-bar">
      <div className="arcade-timer-fill" style={{ width: `${(left / total) * 100}%` }} />
    </div>
  )
}

function StreakDisplay({ streak }) {
  return (
    <div className={'arcade-streak' + (streak >= 3 ? ' hot' : '')}>
      <Flame size={16} on={streak > 0} /> streak {streak} · ×{multFor(streak)}
    </div>
  )
}

function GameHeader({ title, onExit, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <button className="arcade-back" onClick={onExit}>← <span style={{ fontSize: 14 }}>{title}</span></button>
      {right}
    </div>
  )
}

function CelebrateBanner({ show, streak }) {
  if (!show) return null
  return (
    <div className="arcade-celebrate">🎉 {streak} in a row! すごい!</div>
  )
}

function EndCard({ heading = 'Round over!', lines = [], stageUps = [], onReplay, replayLabel = 'Play again', onExit, exitLabel = 'Back', earnedXp = 0 }) {
  return (
    <div className="arcade-end-card">
      <Plant stage={3} size={56} />
      <h2>{heading}</h2>
      {lines.map((l, i) => <p key={i} className="arcade-end-lines">{l}</p>)}
      {stageUps.length > 0 && (
        <div className="arcade-stage-ups">
          {stageUps.map((s, i) => (
            <div key={i} className="arcade-stage-up-row">
              <span className="glyph">{s.glyph}</span>
              <span className="romaji">{s.romaji}</span>
              <span className="stage-shift">
                <Plant stage={STAGE_IDX[s.from] ?? 0} size={20} />
                <NavIco name="arrowR" size={13} />
                <Plant stage={STAGE_IDX[s.to] ?? 0} size={20} />
              </span>
            </div>
          ))}
        </div>
      )}
      {earnedXp > 0
        ? <p className="session-xp" style={{ fontSize: 24 }}>+{earnedXp} XP</p>
        : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, width: '100%' }}>
        {onReplay && <button className="jn-btn jn-btn--green jn-btn--block" onClick={onReplay}>{replayLabel}</button>}
        <button className="jn-btn jn-btn--ghost jn-btn--block" onClick={onExit}>{exitLabel}</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 1 — Kana Pop (also reused as the Ladder gauntlet)
// ---------------------------------------------------------------------------

function KanaPopGame({
  pool = KANA_POOL,
  duration = 60,            // seconds; null = untimed
  title = 'Kana Pop',
  allowReverse = true,
  mustCover = [],           // item ids that must each appear before random picks
  maxQuestions = null,      // end the round after this many answers (null = unlimited)
  endHeading = 'Round over!',
  onExit,
  onRoundEnd,               // called once when the round ends (before the end card)
}) {
  const kidMode = isKidMode()
  const effectiveDuration = kidMode ? null : duration
  const choiceCount = kidMode ? 3 : 4

  const [reverse, setReverse] = useState(false)
  const [phase, setPhase] = useState('play') // 'play' | 'end'
  const [q, setQ] = useState(null)
  const [picked, setPicked] = useState(null)
  const [locked, setLocked] = useState(false)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [celebrate, setCelebrate] = useState(false)
  const [earnedXp, setEarnedXp] = useState(0)

  const srsMapRef = useRef(null)
  const stageUpsRef = useRef([])
  const coverQueueRef = useRef(shuffle(mustCover))
  const endedRef = useRef(false)
  const reverseRef = useRef(false)
  reverseRef.current = reverse

  const makeQuestion = useCallback((excludeId) => {
    let target = null
    while (coverQueueRef.current.length > 0 && !target) {
      const id = coverQueueRef.current.shift()
      target = pool.find(i => i.id === id) || null
    }
    if (!target) target = weightedPick(pool, srsMapRef.current, excludeId)
    const distractors = pickDistractors(target, pool, choiceCount - 1)
    const options = shuffle([target, ...distractors])
    return { target, options, reverse: reverseRef.current }
  }, [pool, choiceCount])

  useEffect(() => {
    let alive = true
    getSRSMap()
      .then(m => { if (alive) srsMapRef.current = m })
      .catch(() => {})
      .finally(() => { if (alive) setQ(makeQuestion(null)) })
    return () => { alive = false }
  }, [makeQuestion])

  const endRound = useCallback(() => {
    if (endedRef.current) return
    endedRef.current = true
    setPhase('end')
    onRoundEnd?.()
    awardEvent('arcade-round', { arcadeStreak: streak })
      .then(r => setEarnedXp(r?.earnedXp ?? 0))
      .catch(() => {})
  }, [onRoundEnd, streak])
  const endRoundRef = useRef(endRound)
  endRoundRef.current = endRound

  const left = useCountdown(effectiveDuration, phase === 'play' && q != null, endRound)

  function answer(idx) {
    if (locked || !q) return
    setLocked(true)
    setPicked(idx)
    const isCorrect = q.options[idx].id === q.target.id
    const answeredNow = answered + 1
    setAnswered(answeredNow)
    if (isCorrect) {
      playKana(q.target.glyph)
      const ns = streak + 1
      setStreak(ns)
      setScore(s => s + 10 * multFor(ns))
      setCorrect(c => c + 1)
      if (kidMode && ns > 0 && ns % 5 === 0) {
        setCelebrate(true)
        setTimeout(() => setCelebrate(false), 1400)
      }
    } else {
      setStreak(0)
    }
    gradeAndTrack(q.target, isCorrect ? 'got-it' : 'not-yet', stageUpsRef)
    const prevTargetId = q.target.id
    setTimeout(() => {
      if (endedRef.current) return
      if (maxQuestions != null && answeredNow >= maxQuestions) {
        endRoundRef.current()
        return
      }
      setPicked(null)
      setLocked(false)
      setQ(makeQuestion(prevTargetId))
    }, isCorrect ? 1000 : 1500)
  }

  if (phase === 'end') {
    return (
      <div className="arcade-screen">
        <EndCard
          heading={endHeading}
          lines={[
            `Score: ${score}`,
            `${correct} / ${answered} correct`,
            stageUpsRef.current.length > 0
              ? `${stageUpsRef.current.length} kana advanced`
              : 'No stage-ups this round — keep at it!',
          ]}
          stageUps={stageUpsRef.current}
          onExit={onExit}
          earnedXp={earnedXp}
        />
      </div>
    )
  }

  if (!q) return <div className="arcade-screen" />

  const showGlyphTiles = q.reverse
  return (
    <div className="arcade-screen">
      <GameHeader
        title={title}
        onExit={onExit}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            {allowReverse && (
              <button className="arcade-back" title="Reverse mode"
                onClick={() => setReverse(r => !r)}>🔄</button>
            )}
            {effectiveDuration == null && (
              <button className="arcade-back" onClick={endRound}>Finish ✓</button>
            )}
          </div>
        }
      />
      <TimerBar left={left} total={effectiveDuration} />
      <StreakDisplay streak={streak} />
      <CelebrateBanner show={celebrate} streak={streak} />
      <div className="kana-display-large" style={q.reverse ? { fontSize: 64 } : undefined}>
        {q.reverse ? q.target.romaji : q.target.glyph}
      </div>
      <div className={'kana-choices' + (kidMode ? ' kid' : '')}>
        {q.options.map((opt, idx) => {
          let cls = 'kana-choice-btn'
          if (showGlyphTiles) cls += ' glyph'
          if (picked != null) {
            if (opt.id === q.target.id) cls += ' correct'
            else if (idx === picked) cls += ' wrong shake'
          }
          return (
            <button key={opt.id} className={cls} onClick={() => answer(idx)}>
              {q.reverse ? opt.glyph : opt.romaji}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 2 — Pairs (memory match, untimed by design)
// ---------------------------------------------------------------------------

const PAIRS_COUNT = 6 // 6 pairs → 12 cards

function PairsGame({ onExit }) {
  const [cards, setCards] = useState(null)   // [{ key, item, kind, label }]
  const [flipped, setFlipped] = useState([]) // card keys, max 2
  const [matched, setMatched] = useState(() => new Set()) // item ids
  const [done, setDone] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [earnedXp, setEarnedXp] = useState(0)

  const startRef = useRef(Date.now())
  const mismatchedRef = useRef(new Set())
  const gradedRef = useRef(new Set())
  const stageUpsRef = useRef([])
  const lockRef = useRef(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      let srsMap = null
      try { srsMap = await getSRSMap() } catch (e) { /* fresh start */ }
      // Draw 6 distinct pairs, weakness-weighted so shaky kana show up more.
      let remaining = [...KANA_POOL]
      const chosen = []
      while (chosen.length < PAIRS_COUNT && remaining.length > 0) {
        const pick = weightedPick(remaining, srsMap, null)
        chosen.push(pick)
        remaining = remaining.filter(i => i.id !== pick.id)
      }
      const deck = shuffle(chosen.flatMap(item => ([
        { key: item.id + ':g', item, kind: 'glyph', label: item.glyph },
        { key: item.id + ':r', item, kind: 'romaji', label: item.romaji },
      ])))
      if (alive) {
        startRef.current = Date.now()
        setCards(deck)
      }
    })()
    return () => { alive = false }
  }, [])

  async function tap(card) {
    if (lockRef.current || done) return
    if (matched.has(card.item.id) || flipped.includes(card.key)) return
    if (flipped.length === 0) {
      setFlipped([card.key])
      return
    }
    const firstKey = flipped[0]
    const first = cards.find(c => c.key === firstKey)
    setFlipped([firstKey, card.key])
    lockRef.current = true

    if (first.item.id === card.item.id) {
      // Match
      playKana(card.item.glyph)
      const nextMatched = new Set(matched)
      nextMatched.add(card.item.id)
      setMatched(nextMatched)
      setFlipped([])
      lockRef.current = false
      if (!gradedRef.current.has(card.item.id)) {
        gradedRef.current.add(card.item.id)
        const g = mismatchedRef.current.has(card.item.id) ? 'not-yet' : 'got-it'
        gradeAndTrack(card.item, g, stageUpsRef)
      }
      if (nextMatched.size === cards.length / 2) {
        setElapsed(Math.round((Date.now() - startRef.current) / 1000))
        awardEvent('arcade-round', { arcadeStreak: nextMatched.size })
          .then(r => setEarnedXp(r?.earnedXp ?? 0))
          .catch(() => {})
        setTimeout(() => setDone(true), 700)
      }
    } else {
      // Mismatch: remember both items, flip back after 1s
      mismatchedRef.current.add(first.item.id)
      mismatchedRef.current.add(card.item.id)
      setTimeout(() => {
        setFlipped([])
        lockRef.current = false
      }, 1000)
    }
  }

  if (done) {
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    return (
      <div className="arcade-screen">
        <EndCard
          heading="All pairs matched! 🎴"
          lines={[
            `${matched.size} pairs matched`,
            `Time: ${mins > 0 ? `${mins}m ` : ''}${secs}s`,
          ]}
          stageUps={stageUpsRef.current}
          onExit={onExit}
          earnedXp={earnedXp}
        />
      </div>
    )
  }

  return (
    <div className="arcade-screen">
      <GameHeader title="Pairs" onExit={onExit} />
      <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
        Match each kana with its reading
      </p>
      <div className="pairs-grid">
        {(cards || []).map(card => {
          const isMatched = matched.has(card.item.id)
          const isUp = isMatched || flipped.includes(card.key)
          let cls = 'pair-card'
          if (isMatched) cls += ' matched'
          else if (!isUp) cls += ' face-down'
          return (
            <div key={card.key} className={cls} onClick={() => tap(card)}>
              {isUp ? card.label : '?'}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 3 — Echo Tiles (listening first: hear it, pick the glyph)
// ---------------------------------------------------------------------------

const ECHO_QUESTIONS = 10

function EchoTilesGame({ onExit }) {
  const kidMode = isKidMode()
  const effectiveDuration = kidMode ? null : 45
  const tileCount = kidMode ? 3 : 4

  const [phase, setPhase] = useState('play')
  const [q, setQ] = useState(null)
  const [picked, setPicked] = useState(null)
  const [locked, setLocked] = useState(false)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [celebrate, setCelebrate] = useState(false)
  const [earnedXp, setEarnedXp] = useState(0)
  const [playing, setPlaying] = useState(false)

  const srsMapRef = useRef(null)
  const poolRef = useRef(KANA_POOL)
  const stageUpsRef = useRef([])
  const endedRef = useRef(false)
  const correctRef = useRef(0)

  // Audio playback state is approximate (playKana doesn't expose duration):
  // show ♪ for ~1s after triggering, then the replay affordance.
  const playTarget = useCallback((item) => {
    setPlaying(true)
    playKana(item.glyph)
    setTimeout(() => setPlaying(false), 1000)
  }, [])

  const makeQuestion = useCallback((excludeId) => {
    const pool = poolRef.current
    const target = weightedPick(pool, srsMapRef.current, excludeId)
    const distractors = pickDistractors(target, pool, tileCount - 1)
    return { target, options: shuffle([target, ...distractors]) }
  }, [tileCount])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const srsMap = await getSRSMap()
        srsMapRef.current = srsMap
        const introduced = introducedItems(srsMap)
        // Gate to introduced kana when enough exist; otherwise an easy starter pool.
        poolRef.current = introduced.length >= tileCount ? introduced : KANA_POOL.slice(0, 10)
      } catch (e) { /* fall back to full pool */ }
      if (alive) setQ(makeQuestion(null))
    })()
    return () => { alive = false }
  }, [makeQuestion, tileCount])

  // Auto-play audio on every new question
  useEffect(() => {
    if (q && phase === 'play') playTarget(q.target)
  }, [q, phase, playTarget])

  const endRound = useCallback(() => {
    if (endedRef.current) return
    endedRef.current = true
    setPhase('end')
    awardEvent('arcade-round', { arcadeStreak: correctRef.current })
      .then(r => setEarnedXp(r?.earnedXp ?? 0))
      .catch(() => {})
  }, [])

  const left = useCountdown(effectiveDuration, phase === 'play' && q != null, endRound)

  function answer(idx) {
    if (locked || !q) return
    setLocked(true)
    setPicked(idx)
    const isCorrect = q.options[idx].id === q.target.id
    const answeredNow = answered + 1
    setAnswered(answeredNow)
    if (isCorrect) {
      const ns = streak + 1
      setStreak(ns)
      setScore(s => s + 10 * multFor(ns))
      correctRef.current += 1
      setCorrect(correctRef.current)
      if (kidMode && ns > 0 && ns % 5 === 0) {
        setCelebrate(true)
        setTimeout(() => setCelebrate(false), 1400)
      }
    } else {
      setStreak(0)
    }
    gradeAndTrack(q.target, isCorrect ? 'got-it' : 'not-yet', stageUpsRef)
    const prevTargetId = q.target.id
    setTimeout(() => {
      if (endedRef.current) return
      if (answeredNow >= ECHO_QUESTIONS) {
        endRound()
        return
      }
      setPicked(null)
      setLocked(false)
      setQ(makeQuestion(prevTargetId))
    }, isCorrect ? 600 : 1200)
  }

  if (phase === 'end') {
    return (
      <div className="arcade-screen">
        <EndCard
          heading="Round over!"
          lines={[`Score: ${score}`, `${correct} / ${answered} correct`]}
          stageUps={stageUpsRef.current}
          onExit={onExit}
          earnedXp={earnedXp}
        />
      </div>
    )
  }

  if (!q) return <div className="arcade-screen" />

  return (
    <div className="arcade-screen">
      <GameHeader
        title={`Echo Tiles · ${Math.min(answered + 1, ECHO_QUESTIONS)}/${ECHO_QUESTIONS}`}
        onExit={onExit}
      />
      <TimerBar left={left} total={effectiveDuration} />
      <StreakDisplay streak={streak} />
      <CelebrateBanner show={celebrate} streak={streak} />
      <div style={{ textAlign: 'center', margin: '24px 0' }}>
        <button className="kana-choice-btn"
          style={{
            fontSize: 32, padding: '20px 36px', minWidth: 'var(--tap)', minHeight: 'var(--tap)',
            borderColor: 'var(--gold)', background: 'var(--gold-soft)',
          }}
          disabled={playing}
          onClick={() => playTarget(q.target)}>
          {playing ? '♪' : '🔊'}
        </button>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          {playing ? 'Listen…' : 'Tap to replay'}
        </p>
      </div>
      <div className={'kana-choices' + (kidMode ? ' kid' : '')} style={{ gridTemplateColumns: '1fr 1fr' }}>
        {q.options.map((opt, idx) => {
          const isTarget = opt.id === q.target.id
          let cls = 'kana-choice-btn glyph'
          if (picked != null) {
            if (isTarget) cls += ' correct'
            else if (idx === picked) cls += ' wrong shake'
          }
          return (
            <button key={opt.id} className={cls} style={{ fontSize: 64, lineHeight: 1.3 }}
              onClick={() => answer(idx)}>
              {opt.glyph}
              {picked != null && isTarget && !kidMode && (
                <span style={{ display: 'block', fontSize: 12, fontFamily: 'var(--f-body)' }}>✓ {opt.romaji}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Game 4 — Kana Ladder (progression wrapper around Kana Pop)
// ---------------------------------------------------------------------------

// Ladder rungs: the lone ん joins the わ rung so the last gauntlet is わ・を・ん.
const LADDER_RUNGS = [
  { key: 'a-row', rows: ['a-row'] },
  { key: 'ka-row', rows: ['ka-row'] },
  { key: 'sa-row', rows: ['sa-row'] },
  { key: 'ta-row', rows: ['ta-row'] },
  { key: 'na-row', rows: ['na-row'] },
  { key: 'ha-row', rows: ['ha-row'] },
  { key: 'ma-row', rows: ['ma-row'] },
  { key: 'ya-row', rows: ['ya-row'] },
  { key: 'ra-row', rows: ['ra-row'] },
  { key: 'wa-row', rows: ['wa-row', 'n-row'] },
]

function KanaLadderGame({ onExit }) {
  const [srsMap, setSrsMap] = useState(null)
  const [mode, setMode] = useState({ name: 'map' }) // map | intro | gauntlet
  const [introIdx, setIntroIdx] = useState(0)

  const reloadMap = useCallback(async () => {
    try { setSrsMap(await getSRSMap()) } catch (e) { setSrsMap(new Map()) }
  }, [])

  useEffect(() => { reloadMap() }, [reloadMap])

  const rungItems = useCallback(
    (rung) => KANA_POOL.filter(i => rung.rows.includes(i.row)),
    [],
  )

  const seen = useCallback((item) => (srsMap?.get(item.id)?.seenCount ?? 0) > 0, [srsMap])
  const rungSeen = useCallback((rung) => rungItems(rung).some(seen), [rungItems, seen])
  const rungCleared = useCallback((rung) => srsMap != null && rungItems(rung).every(seen), [srsMap, rungItems, seen])

  // Unlocked when any of its kana has been seen (e.g. via sessions or other
  // games); the first rung is always open, and clearing a rung opens the next.
  const rungUnlocked = useCallback((idx) => {
    if (idx === 0) return true
    return rungSeen(LADDER_RUNGS[idx]) || rungCleared(LADDER_RUNGS[idx - 1])
  }, [rungSeen, rungCleared])

  function startRung(rung) {
    setIntroIdx(0)
    setMode({ name: 'intro', rung })
  }

  // Gauntlet: a 5-question mini-Pop round using only this rung's kana.
  function startGauntlet(rung) {
    const items = rungItems(rung)
    setMode({ name: 'gauntlet', rung, pool: items, mustCover: items.map(i => i.id) })
  }

  // After a gauntlet round ends, mark every still-unseen rung item as seen
  // (grade 'got-it') so the rung counts as cleared and the next one unlocks.
  const finalizeRung = useCallback(async (rung) => {
    const ignoredStageUps = { current: [] }
    for (const item of rungItems(rung)) {
      try {
        const existing = await getSRSState(item.id)
        if (!existing || (existing.seenCount ?? 0) === 0) {
          await gradeAndTrack(item, 'got-it', ignoredStageUps)
        }
      } catch (e) { /* best effort */ }
    }
    reloadMap()
  }, [rungItems, reloadMap])

  // --- Intro phase: show each new kana one at a time ---
  if (mode.name === 'intro') {
    const items = rungItems(mode.rung)
    const item = items[introIdx]
    return (
      <div className="arcade-screen">
        <GameHeader title={`${ROW_LABELS[mode.rung.key]} · ${introIdx + 1}/${items.length}`}
          onExit={() => setMode({ name: 'map' })} />
        <IntroCard key={item.id} item={item} />
        <button className="btn-primary" style={{ width: '100%', marginTop: 16 }}
          onClick={() => {
            if (introIdx + 1 < items.length) setIntroIdx(introIdx + 1)
            else startGauntlet(mode.rung)
          }}>
          {introIdx + 1 < items.length ? 'Next →' : 'Start the gauntlet! ⚔️'}
        </button>
      </div>
    )
  }

  // --- Gauntlet phase: 5-question mini-Pop on this rung's kana only ---
  if (mode.name === 'gauntlet') {
    return (
      <KanaPopGame
        pool={mode.pool}
        duration={45}
        maxQuestions={5}
        title={`${ROW_LABELS[mode.rung.key]} gauntlet`}
        allowReverse={false}
        mustCover={mode.mustCover}
        endHeading="Row cleared! 🎉"
        onRoundEnd={() => finalizeRung(mode.rung)}
        onExit={() => { reloadMap(); setMode({ name: 'map' }) }}
      />
    )
  }

  // --- Map (ladder of rungs) ---
  return (
    <div className="ladder-screen">
      <GameHeader title="Kana Ladder" onExit={onExit} />
      {LADDER_RUNGS.map((rung, idx) => {
        const items = rungItems(rung)
        const unlocked = rungUnlocked(idx)
        const cleared = rungCleared(rung)
        return (
          <div key={rung.key} className={'ladder-rung' + (unlocked ? '' : ' locked')}>
            <span className={'ladder-rung-status' + (cleared ? ' cleared' : unlocked ? ' open' : '')}>
              {cleared ? <NavIco name="check" size={20} /> : unlocked ? <NavIco name="arrowR" size={20} /> : <LockIco size={20} />}
            </span>
            <div className="ladder-rung-preview">
              <div className="ladder-rung-label">{ROW_LABELS[rung.key]}</div>
              {items.map(i => i.glyph).join('・')}
            </div>
            {unlocked && (
              <button className="jn-btn" style={{ padding: '0 16px', fontSize: 13, background: 'var(--pink)', color: 'var(--on-pink)' }}
                onClick={() => startRung(rung)}>
                {cleared ? 'Replay' : 'Start'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function IntroCard({ item }) {
  useEffect(() => { playKana(item.glyph) }, [item])
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="kana-display-large">{item.glyph}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{item.romaji}</div>
      <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5, padding: '0 8px' }}>
        {item.notes}
      </p>
      <button className="arcade-back" style={{ margin: '8px auto 0' }}
        onClick={() => playKana(item.glyph)}>🔊 Hear it again</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lobby + screen shell
// ---------------------------------------------------------------------------

const GAMES = [
  { id: 'ladder', name: 'Kana Ladder', desc: 'Climb row by row — learn new kana, then survive the gauntlet.',
    icon: 'arcade', color: 'var(--pink)', soft: 'var(--pink-soft)', ink: 'var(--on-pink)' },
  { id: 'pop', name: 'Kana Pop', desc: 'See the kana, tap the right reading. Fast and furious.',
    icon: 'bolt', color: 'var(--green)', soft: 'var(--green-soft)', ink: 'var(--on-green)' },
  { id: 'pairs', name: 'Pairs', desc: 'Memory match: flip cards to pair kana with their readings.',
    icon: 'cards', color: 'var(--sky)', soft: 'var(--sky-soft)', ink: 'var(--on-dark)' },
  { id: 'echo', name: 'Echo Tiles', desc: 'Listen first, then pick the kana you heard. Ear training.',
    icon: 'mic', color: 'var(--gold)', soft: 'var(--gold-soft)', ink: 'var(--on-dark)' },
]

export default function KanaArcade() {
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const backToLobby = () => setGame(null)

  if (game === 'pop') return <KanaPopGame onExit={backToLobby} />
  if (game === 'pairs') return <PairsGame onExit={backToLobby} />
  if (game === 'echo') return <EchoTilesGame onExit={backToLobby} />
  if (game === 'ladder') return <KanaLadderGame onExit={backToLobby} />

  return (
    <div className="arcade-screen">
      <button className="arcade-back" onClick={() => navigate('/learn')}>← Back</button>
      <div className="jn-eyebrow" style={{ color: 'var(--pink)' }}>Arcade</div>
      <h2 className="jn-display" style={{ fontSize: 26, margin: '4px 0' }}>Kana Arcade</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        Four ways to make hiragana stick.
      </p>
      <div className="arcade-lobby">
        {GAMES.map(g => (
          <div key={g.id} className="arcade-game-card">
            <span className="arcade-game-icon" style={{ background: g.soft, color: g.color }}>
              <NavIco name={g.icon} size={22} />
            </span>
            <h3>{g.name}</h3>
            <p>{g.desc}</p>
            <button className="jn-btn jn-btn--block" style={{ marginTop: 'auto', background: g.color, color: g.ink }}
              onClick={() => setGame(g.id)}>
              Play
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
