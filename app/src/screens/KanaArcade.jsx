import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { grade, initialState, STAGE_EMOJI } from '../data/srs.js'
import { getSRSState, saveSRSState, getSRSMap } from '../data/store.js'
import { itemsByUnit } from '../content/index.js'
import { tts } from '../api.js'

// ---------------------------------------------------------------------------
// Shared constants + helpers
// ---------------------------------------------------------------------------

const KANA_POOL = itemsByUnit['u0-kana-hira']
const STAGE_ORDER = ['seed', 'sprout', 'bamboo', 'blossom']

// Hard-coded confusable pairs (romaji → romaji)
const CONFUSABLES = {
  shi: 'chi', chi: 'shi', tsu: 'su', su: 'tsu',
  n: 'mu', mu: 'n', fu: 'hu', re: 'ne', me: 'ne',
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
  const confRomaji = CONFUSABLES[target.romaji]
  if (confRomaji) {
    const c = others.find(i => i.romaji === confRomaji)
    if (c) chosen.push(c)
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
    <div className="arcade-streak">
      🔥 streak {streak} · ×{multFor(streak)}
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

function EndCard({ heading = 'Round over!', lines = [], stageUps = [], onReplay, replayLabel = 'Play again', onExit, exitLabel = 'Back' }) {
  return (
    <div className="arcade-end-card">
      <h2>{heading}</h2>
      {lines.map((l, i) => <p key={i} style={{ margin: '4px 0', color: 'var(--text-muted)', fontSize: 14 }}>{l}</p>)}
      {stageUps.length > 0 && (
        <div className="arcade-stage-ups">
          {stageUps.map((s, i) => (
            <div key={i} className="arcade-stage-up-row">
              <span style={{ fontFamily: "'Noto Sans JP', sans-serif", fontWeight: 700 }}>{s.glyph}</span>
              {' '}({s.romaji}) {STAGE_EMOJI[s.from]} → {STAGE_EMOJI[s.to]}
            </div>
          ))}
        </div>
      )}
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '12px 0' }}>✨ XP coming soon</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {onReplay && <button className="btn-primary" onClick={onReplay}>{replayLabel}</button>}
        <button className="kana-choice-btn" onClick={onExit}>{exitLabel}</button>
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
  }, [onRoundEnd])

  const left = useCountdown(effectiveDuration, phase === 'play' && q != null, endRound)

  function answer(idx) {
    if (locked || !q) return
    setLocked(true)
    setPicked(idx)
    const isCorrect = q.options[idx].id === q.target.id
    setAnswered(a => a + 1)
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
      setPicked(null)
      setLocked(false)
      setQ(makeQuestion(prevTargetId))
    }, isCorrect ? 1000 : 1500)
  }

  if (phase === 'end') {
    return (
      <div className="arcade-screen">
        <EndCard
          heading="Round over!"
          lines={[
            `Score: ${score}`,
            `${correct} / ${answered} correct`,
            stageUpsRef.current.length > 0
              ? `${stageUpsRef.current.length} kana advanced`
              : 'No stage-ups this round — keep at it!',
          ]}
          stageUps={stageUpsRef.current}
          onExit={onExit}
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

function PairsGame({ onExit }) {
  const [cards, setCards] = useState(null)   // [{ key, item, kind, label }]
  const [flipped, setFlipped] = useState([]) // card keys, max 2
  const [matched, setMatched] = useState(() => new Set()) // item ids
  const [done, setDone] = useState(false)
  const [elapsed, setElapsed] = useState(0)

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
      const introduced = shuffle(introducedItems(srsMap))
      let chosen
      if (introduced.length >= 8) {
        chosen = introduced.slice(0, 8)
      } else {
        const fill = KANA_POOL.filter(i => !introduced.includes(i)).slice(0, 8 - introduced.length)
        chosen = [...introduced, ...fill]
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
        />
      </div>
    )
  }

  return (
    <div className="arcade-screen">
      <GameHeader title="Pairs" onExit={onExit} />
      <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
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

function EchoTilesGame({ onExit }) {
  const kidMode = isKidMode()
  const effectiveDuration = kidMode ? null : 60
  const tileCount = kidMode ? 4 : 6

  const [phase, setPhase] = useState('play')
  const [q, setQ] = useState(null)
  const [picked, setPicked] = useState(null)
  const [locked, setLocked] = useState(false)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [celebrate, setCelebrate] = useState(false)

  const srsMapRef = useRef(null)
  const poolRef = useRef(KANA_POOL)
  const stageUpsRef = useRef([])
  const endedRef = useRef(false)

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
    if (q && phase === 'play') playKana(q.target.glyph)
  }, [q, phase])

  const endRound = useCallback(() => {
    if (endedRef.current) return
    endedRef.current = true
    setPhase('end')
  }, [])

  const left = useCountdown(effectiveDuration, phase === 'play' && q != null, endRound)

  function answer(idx) {
    if (locked || !q) return
    setLocked(true)
    setPicked(idx)
    const isCorrect = q.options[idx].id === q.target.id
    setAnswered(a => a + 1)
    if (isCorrect) {
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
      setPicked(null)
      setLocked(false)
      setQ(makeQuestion(prevTargetId))
    }, isCorrect ? 1000 : 1500)
  }

  if (phase === 'end') {
    return (
      <div className="arcade-screen">
        <EndCard
          heading="Round over!"
          lines={[`Score: ${score}`, `${correct} / ${answered} correct`]}
          stageUps={stageUpsRef.current}
          onExit={onExit}
        />
      </div>
    )
  }

  if (!q) return <div className="arcade-screen" />

  return (
    <div className="arcade-screen">
      <GameHeader
        title="Echo Tiles"
        onExit={onExit}
        right={effectiveDuration == null
          ? <button className="arcade-back" onClick={endRound}>Finish ✓</button>
          : null}
      />
      <TimerBar left={left} total={effectiveDuration} />
      <StreakDisplay streak={streak} />
      <CelebrateBanner show={celebrate} streak={streak} />
      <div style={{ textAlign: 'center', margin: '24px 0' }}>
        <button className="kana-choice-btn" style={{ fontSize: 32, padding: '20px 36px' }}
          onClick={() => playKana(q.target.glyph)}>
          🔊
        </button>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>Tap to replay</p>
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
            <button key={opt.id} className={cls} onClick={() => answer(idx)}>
              {opt.glyph}
              {picked != null && isTarget && (
                <span style={{ display: 'block', fontSize: 12 }}>✓ {opt.romaji}</span>
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

function KanaLadderGame({ onExit }) {
  const [srsMap, setSrsMap] = useState(null)
  const [mode, setMode] = useState({ name: 'map' }) // map | intro | gauntlet
  const [introIdx, setIntroIdx] = useState(0)

  const reloadMap = useCallback(async () => {
    try { setSrsMap(await getSRSMap()) } catch (e) { setSrsMap(new Map()) }
  }, [])

  useEffect(() => { reloadMap() }, [reloadMap])

  const rowItems = useCallback(
    (row) => KANA_POOL.filter(i => i.row === row),
    [],
  )

  const rowCleared = useCallback((row) => {
    if (!srsMap) return false
    return rowItems(row).every(i => {
      const s = srsMap.get(i.id)
      return s && s.stage !== 'seed'
    })
  }, [srsMap, rowItems])

  const rowUnlocked = useCallback((idx) => {
    if (idx === 0) return true
    return rowCleared(ROWS_ORDER[idx - 1])
  }, [rowCleared])

  function startRung(row) {
    setIntroIdx(0)
    setMode({ name: 'intro', row })
  }

  // Build the gauntlet pool once, when the gauntlet starts: the new row's kana
  // mixed with 2 random already-learned kana from other rows.
  function startGauntlet(row) {
    const items = rowItems(row)
    const learned = shuffle(
      introducedItems(srsMap).filter(i => i.row !== row)
    ).slice(0, 2)
    setMode({ name: 'gauntlet', row, pool: [...items, ...learned], mustCover: items.map(i => i.id) })
  }

  // After a gauntlet round ends, make sure every row item is marked introduced
  // (it will have a non-seed SRS state), so the next rung unlocks.
  const finalizeRung = useCallback(async (row) => {
    for (const item of rowItems(row)) {
      try {
        const existing = await getSRSState(item.id)
        if (!existing || existing.stage === 'seed') {
          const base = existing || initialState(item.id)
          await saveSRSState({
            ...base,
            stage: 'sprout', step: 1, interval: 1,
            seenCount: Math.max(1, base.seenCount),
            due: Date.now() + 24 * 60 * 60 * 1000,
          })
        }
      } catch (e) { /* best effort */ }
    }
    reloadMap()
  }, [rowItems, reloadMap])

  // --- Intro phase: show each new kana one at a time ---
  if (mode.name === 'intro') {
    const items = rowItems(mode.row)
    const item = items[introIdx]
    return (
      <div className="arcade-screen">
        <GameHeader title={`${ROW_LABELS[mode.row]} · ${introIdx + 1}/${items.length}`}
          onExit={() => setMode({ name: 'map' })} />
        <IntroCard key={item.id} item={item} />
        <button className="btn-primary" style={{ width: '100%', marginTop: 16 }}
          onClick={() => {
            if (introIdx + 1 < items.length) setIntroIdx(introIdx + 1)
            else startGauntlet(mode.row)
          }}>
          {introIdx + 1 < items.length ? 'Next →' : 'Start the gauntlet! ⚔️'}
        </button>
      </div>
    )
  }

  // --- Gauntlet phase: Kana Pop on the new row + 2 learned kana, 90s ---
  if (mode.name === 'gauntlet') {
    return (
      <KanaPopGame
        pool={mode.pool}
        duration={90}
        title={`${ROW_LABELS[mode.row]} gauntlet`}
        allowReverse={false}
        mustCover={mode.mustCover}
        onRoundEnd={() => finalizeRung(mode.row)}
        onExit={() => { reloadMap(); setMode({ name: 'map' }) }}
      />
    )
  }

  // --- Map (ladder of rungs) ---
  return (
    <div className="ladder-screen">
      <GameHeader title="Kana Ladder" onExit={onExit} />
      {ROWS_ORDER.map((row, idx) => {
        const items = rowItems(row)
        const unlocked = rowUnlocked(idx)
        const cleared = rowCleared(row)
        return (
          <div key={row} className={'ladder-rung' + (unlocked ? '' : ' locked')}>
            <span className="ladder-rung-status">{cleared ? '✓' : unlocked ? '🔓' : '🔒'}</span>
            <div className="ladder-rung-preview">
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                {ROW_LABELS[row]}
              </div>
              {items.map(i => i.glyph).join('・')}
            </div>
            {unlocked && (
              <button className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}
                onClick={() => startRung(row)}>
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
      <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5, padding: '0 8px' }}>
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
  { id: 'ladder', name: 'Kana Ladder 🪜', desc: 'Climb row by row — learn new kana, then survive the gauntlet.' },
  { id: 'pop', name: 'Kana Pop 🎈', desc: 'See the kana, tap the right reading. Fast and furious.' },
  { id: 'pairs', name: 'Pairs 🎴', desc: 'Memory match: flip cards to pair kana with their readings.' },
  { id: 'echo', name: 'Echo Tiles 🔊', desc: 'Listen first, then pick the kana you heard. Ear training.' },
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
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>Kana Arcade 🕹</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
        Four ways to make hiragana stick.
      </p>
      <div className="arcade-lobby">
        {GAMES.map(g => (
          <div key={g.id} className="arcade-game-card">
            <h3>{g.name}</h3>
            <p>{g.desc}</p>
            <button className="btn-primary" style={{ marginTop: 'auto' }}
              onClick={() => setGame(g.id)}>
              Play
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
