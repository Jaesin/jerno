import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeaker } from '@jaesin/t10n-client/react'
import { allItems, itemsByUnit, UNITS_ORDER } from '../content/index.js'
import { grade as gradeSRS, isDue } from '../data/srs.js'
import { buildSession } from '../data/session.js'
import { getSRSMap, saveSRSState, getProfile, getTripDeckItems } from '../data/store.js'
import { awardEvent, getProgressData, buildQuests, rankFor } from '../data/progress.js'
import { Inu, Plant, NavIco, Rank } from '../design/primitives.jsx'
import { Card, Chip, StreakPill, PileRing, Quest, DoorTile, TripDeckRow } from '../design/ui.jsx'

// SRS stage name → Plant growth-stage index (seed → sprout → bamboo → blossom)
const STAGE_IDX = { seed: 0, sprout: 1, bamboo: 2, blossom: 3 }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function spokenText(item) {
  return item.ja || item.glyph || ''
}

// Forgiving answer comparison: trim, lowercase, collapse whitespace, and
// strip leading/trailing sentence punctuation (incl. Japanese 。？！) so
// "Sumimasen?" matches "sumimasen" (spec 22 typo tolerance, first pass).
function normAnswer(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[?.!？。！]+|[?.!？。！]+$/g, '')
    .trim()
}

// Daily goal setting → number of new items introduced per session.
const GOAL_NEW_PER_DAY = { chill: 3, regular: 5, serious: 8 }

// Exercise types actually implemented in this screen.
// Anything else falls back to flashcard / kana-pop.
const IMPLEMENTED = new Set(['intro', 'flashcard', 'kana-pop', 'audio-pick', 'tile-builder', 'cloze', 'match-five'])
function resolveExerciseType(exerciseType, item) {
  if (IMPLEMENTED.has(exerciseType)) return exerciseType
  return item.type === 'kana' ? 'kana-pop' : 'flashcard'
}

// ---------------------------------------------------------------------------
// TTS audio hook — cloud TTS with web-speech fallback via the shared t10n
// speaker (cloud clips are cached + reused; a tap warms the cloud clip for next
// time). Keeps the { play, playing } shape the exercises expect.
// ---------------------------------------------------------------------------

function useTTSAudio() {
  const { speak, speaking } = useSpeaker()
  const play = useCallback((text) => {
    if (text) speak(text, { lang: 'ja' })
  }, [speak])
  return { play, playing: speaking }
}

function AudioButton({ onClick, playing, big = false }) {
  return (
    <button
      type="button"
      className={`audio-btn${big ? ' big' : ''}${playing ? ' playing' : ''}`}
      onClick={onClick}
      aria-label="Play audio"
    >
      🔊
    </button>
  )
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

function IntroExercise({ item, onGotIt, onRepeat, audio }) {
  const [countdown, setCountdown] = useState(3)
  const [paused, setPaused] = useState(false)
  const onGotItRef = useRef(onGotIt)
  onGotItRef.current = onGotIt

  useEffect(() => {
    if (paused || countdown <= 0) return undefined
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown, paused])

  useEffect(() => {
    if (countdown === 0 && !paused) onGotItRef.current()
  }, [countdown, paused])

  const handlePlay = () => {
    setPaused(true)
    audio.play(spokenText(item))
  }

  return (
    <div className="exercise-card">
      <div className="exercise-prompt" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        New {item.type === 'kana' ? 'kana' : 'phrase'} <Plant stage={0} size={15} />
      </div>
      {item.type === 'kana'
        ? <div className="kana-display">{item.glyph}</div>
        : <div className="exercise-ja">{item.ja}</div>}
      <div className="exercise-reading">
        {item.romaji}{item.reading && item.reading !== item.ja ? ` · ${item.reading}` : ''}
      </div>
      {item.en && <div className="exercise-en">{item.en}</div>}
      {item.notes && <p className="exercise-notes">{item.notes}</p>}
      <AudioButton onClick={handlePlay} playing={audio.playing} />
      {!paused && countdown > 0 && (
        <div className="intro-countdown">auto-continue in {countdown}…</div>
      )}
      <div className="grade-buttons">
        <button type="button" className="btn-secondary" onClick={() => { setPaused(true); onRepeat() }}>
          Study more (repeat)
        </button>
        <button type="button" className="btn-primary" onClick={() => { setPaused(true); onGotIt() }}>
          Got it, next →
        </button>
      </div>
    </div>
  )
}

function FlashcardExercise({ item, onGrade, audio }) {
  const [revealed, setRevealed] = useState(false)
  const playRef = useRef(audio.play)
  playRef.current = audio.play

  useEffect(() => {
    playRef.current(spokenText(item))
  }, [item])

  return (
    <div className="exercise-card">
      <div className="exercise-prompt">Do you remember this?</div>
      {item.type === 'kana'
        ? <div className="kana-display">{item.glyph}</div>
        : <div className="exercise-ja">{item.ja}</div>}
      <AudioButton onClick={() => audio.play(spokenText(item))} playing={audio.playing} />
      {!revealed ? (
        <button type="button" className="btn-primary reveal-btn" onClick={() => setRevealed(true)}>
          Reveal
        </button>
      ) : (
        <>
          <div className="exercise-en">{item.en || item.romaji}</div>
          <div className="exercise-reading">
            {item.romaji}{item.reading && item.reading !== item.ja ? ` · ${item.reading}` : ''}
          </div>
          <div className="grade-buttons">
            <button type="button" className="btn-secondary" onClick={() => onGrade('not-yet')}>
              Not yet ✗
            </button>
            <button type="button" className="btn-primary" onClick={() => onGrade('got-it')}>
              Got it ✓
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function KanaPopExercise({ item, onGrade }) {
  const [picked, setPicked] = useState(null)

  const choices = useMemo(() => {
    const pool = (itemsByUnit['u0-kana-hira'] || []).filter(k => k.id !== item.id)
    const sameRow = shuffle(pool.filter(k => k.row === item.row))
    const others = shuffle(pool.filter(k => k.row !== item.row))
    const distractors = [...sameRow, ...others].slice(0, 3).map(k => k.romaji)
    return shuffle([item.romaji, ...distractors])
  }, [item])

  const handlePick = (romaji) => {
    if (picked !== null) return
    setPicked(romaji)
    const correct = romaji === item.romaji
    setTimeout(() => onGrade(correct ? 'got-it' : 'not-yet'), 1000)
  }

  return (
    <div className="exercise-card">
      <div className="exercise-prompt">Which sound is this?</div>
      <div className="kana-display">{item.glyph}</div>
      <div className="exercise-choices">
        {choices.map(romaji => {
          let cls = 'choice-btn'
          if (picked !== null) {
            if (romaji === item.romaji) cls += ' correct'
            else if (romaji === picked) cls += ' wrong'
          }
          return (
            <button key={romaji} type="button" className={cls} disabled={picked !== null}
              onClick={() => handlePick(romaji)}>
              {romaji}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AudioPickExercise({ item, onGrade, audio }) {
  const [picked, setPicked] = useState(null)
  const playRef = useRef(audio.play)
  playRef.current = audio.play

  useEffect(() => {
    playRef.current(spokenText(item))
  }, [item])

  const choices = useMemo(() => {
    const pool = allItems.filter(i => i.id !== item.id && i.en)
    const sameType = pool.filter(i => i.type === item.type)
    const source = sameType.length >= 3 ? sameType : pool
    const distractors = shuffle(source).slice(0, 3).map(i => i.en)
    return shuffle([item.en, ...distractors])
  }, [item])

  const handlePick = (en) => {
    if (picked !== null) return
    setPicked(en)
    const correct = en === item.en
    setTimeout(() => onGrade(correct ? 'got-it' : 'not-yet'), 1000)
  }

  return (
    <div className="exercise-card">
      <div className="exercise-prompt">What does this mean?</div>
      <AudioButton big onClick={() => audio.play(spokenText(item))} playing={audio.playing} />
      <div className="exercise-choices">
        {choices.map(en => {
          let cls = 'choice-btn'
          if (picked !== null) {
            if (en === item.en) cls += ' correct'
            else if (en === picked) cls += ' wrong'
          }
          return (
            <button key={en} type="button" className={cls} disabled={picked !== null}
              onClick={() => handlePick(en)}>
              {en}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div className="exercise-reading">{item.ja} · {item.romaji}</div>
      )}
    </div>
  )
}

function TileBuilderExercise({ item, onGrade, audio }) {
  const segments = item.segments
  const hasSegments = Array.isArray(segments) && segments.length >= 2

  // Pool entries keep the original segment index so order can be checked.
  const pool = useMemo(
    () => (hasSegments ? shuffle(segments.map((seg, idx) => ({ seg, idx }))) : []),
    [item] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [placed, setPlaced] = useState([])
  const [result, setResult] = useState(null) // null | 'correct' | 'wrong'

  if (!hasSegments) {
    return <FlashcardExercise item={item} onGrade={onGrade} audio={audio} />
  }

  const handlePlace = (entry) => {
    if (result !== null || placed.includes(entry)) return
    const next = [...placed, entry]
    setPlaced(next)
    if (next.length === segments.length) {
      const correct = next.every((e, i) => e.idx === i)
      setResult(correct ? 'correct' : 'wrong')
      if (correct) {
        audio.play(spokenText(item))
        setTimeout(() => onGrade('got-it'), 1000)
      } else {
        setTimeout(() => onGrade('not-yet'), 1500)
      }
    }
  }

  const handleUnplace = (entry) => {
    if (result !== null) return
    setPlaced(p => p.filter(e => e !== entry))
  }

  return (
    <div className="exercise-card">
      <div className="exercise-prompt">Build the phrase</div>
      <div className="exercise-en">{item.en}</div>
      <div className="tile-builder">
        <div className="tile-answer-row">
          {placed.map((entry, i) => {
            let cls = 'segment-tile placed'
            if (result === 'correct') cls = 'segment-tile correct'
            else if (result === 'wrong') cls = entry.idx === i ? 'segment-tile correct' : 'segment-tile wrong'
            return (
              <button key={entry.idx} type="button" className={cls} disabled={result !== null}
                onClick={() => handleUnplace(entry)}>
                {entry.seg.reading}
              </button>
            )
          })}
        </div>
        <div className="tile-pool">
          {pool.filter(e => !placed.includes(e)).map(entry => (
            <button key={entry.idx} type="button" className="segment-tile" disabled={result !== null}
              onClick={() => handlePlace(entry)}>
              {entry.seg.reading}
            </button>
          ))}
        </div>
        {result === 'wrong' && (
          <div className="exercise-reading">
            {segments.map(s => s.reading).join(' ')}
          </div>
        )}
      </div>
    </div>
  )
}

function ClozeExercise({ item, onGrade, audio }) {
  const segments = item.segments
  const hasSegments = Array.isArray(segments) && segments.length > 0
  const blankIdx = hasSegments && segments.length > 1 ? 1 : 0
  const [picked, setPicked] = useState(null)
  const playRef = useRef(audio.play)
  playRef.current = audio.play

  useEffect(() => {
    if (hasSegments) playRef.current(spokenText(item))
  }, [item, hasSegments])

  const choices = useMemo(() => {
    if (!hasSegments) return []
    const correct = segments[blankIdx].reading
    const own = new Set(segments.map(s => normAnswer(s.reading)))
    const seen = new Set()
    const readings = []
    for (const other of allItems) {
      if (other.id === item.id || !Array.isArray(other.segments)) continue
      for (const s of other.segments) {
        const norm = normAnswer(s.reading)
        if (!own.has(norm) && !seen.has(norm)) {
          seen.add(norm)
          readings.push(s.reading)
        }
      }
    }
    const distractors = shuffle(readings).slice(0, 3)
    return shuffle([correct, ...distractors])
  }, [item, blankIdx, hasSegments]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasSegments) {
    return <FlashcardExercise item={item} onGrade={onGrade} audio={audio} />
  }

  const correctReading = segments[blankIdx].reading

  const handlePick = (reading) => {
    if (picked !== null) return
    setPicked(reading)
    const correct = normAnswer(reading) === normAnswer(correctReading)
    setTimeout(() => onGrade(correct ? 'got-it' : 'not-yet'), 1000)
  }

  return (
    <div className="exercise-card">
      <div className="exercise-prompt">Fill in the blank</div>
      <div className="cloze-phrase">
        {segments.map((seg, i) => (
          i === blankIdx
            ? <span key={i} className="cloze-blank">{picked === null ? '___' : seg.ja}</span>
            : <span key={i}>{seg.ja}</span>
        ))}
      </div>
      <div className="exercise-en">{item.en}</div>
      <AudioButton onClick={() => audio.play(spokenText(item))} playing={audio.playing} />
      <div className="cloze-choices">
        {choices.map(reading => {
          let cls = 'cloze-choice'
          if (picked !== null) {
            if (normAnswer(reading) === normAnswer(correctReading)) cls += ' correct'
            else if (reading === picked) cls += ' wrong'
          }
          return (
            <button key={reading} type="button" className={cls} disabled={picked !== null}
              onClick={() => handlePick(reading)}>
              {reading}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MatchFiveExercise({ item, onGrade, audio, session, sessionIndex }) {
  // Untimed warm-up: pair the current item with up to 4 session neighbours,
  // padded with same-unit items if the session is short.
  const pairs = useMemo(() => {
    const seen = new Set()
    const picked = []
    const push = (it) => {
      if (!it || seen.has(it.id)) return
      seen.add(it.id)
      picked.push(it)
    }
    push(item)
    for (const ex of session.slice(sessionIndex + 1, sessionIndex + 5)) push(ex.item)
    if (picked.length < 5) {
      for (const it of shuffle(allItems.filter(i => i.unit === item.unit && !seen.has(i.id)))) {
        if (picked.length >= 5) break
        push(it)
      }
    }
    if (picked.length < 5) {
      for (const it of shuffle(allItems.filter(i => !seen.has(i.id)))) {
        if (picked.length >= 5) break
        push(it)
      }
    }
    return picked
  }, [item, session, sessionIndex])

  const left = useMemo(() => shuffle(pairs), [pairs])
  const right = useMemo(() => shuffle(pairs), [pairs])
  const [selectedLeft, setSelectedLeft] = useState(null)
  const [matched, setMatched] = useState(() => new Set())
  const [wrong, setWrong] = useState(() => new Set())
  const doneRef = useRef(false)

  const handleLeft = (id) => {
    if (matched.has(id) || wrong.size > 0) return
    setSelectedLeft(prev => (prev === id ? null : id))
  }

  const handleRight = (id) => {
    if (matched.has(id) || selectedLeft === null || wrong.size > 0) return
    if (id === selectedLeft) {
      const next = new Set(matched)
      next.add(id)
      setMatched(next)
      setSelectedLeft(null)
      if (next.size === pairs.length && !doneRef.current) {
        doneRef.current = true
        audio.play(spokenText(item))
        setTimeout(() => onGrade('got-it'), 500)
      }
    } else {
      setWrong(new Set([`L:${selectedLeft}`, `R:${id}`]))
      setTimeout(() => {
        setWrong(new Set())
        setSelectedLeft(null)
      }, 400)
    }
  }

  return (
    <div className="exercise-card">
      <div className="exercise-prompt">Match the pairs</div>
      <div className="match-five">
        <div className="match-col">
          {left.map(it => {
            let cls = 'match-tile'
            if (matched.has(it.id)) cls += ' matched'
            else if (selectedLeft === it.id) cls += ' selected'
            if (wrong.has(`L:${it.id}`)) cls += ' wrong-flash'
            return (
              <button key={it.id} type="button" className={cls} onClick={() => handleLeft(it.id)}>
                {it.ja || it.glyph}
              </button>
            )
          })}
        </div>
        <div className="match-col">
          {right.map(it => {
            let cls = 'match-tile'
            if (matched.has(it.id)) cls += ' matched'
            if (wrong.has(`R:${it.id}`)) cls += ' wrong-flash'
            return (
              <button key={it.id} type="button" className={cls} onClick={() => handleRight(it.id)}>
                {it.en || it.romaji}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Learn screen — Today view + session runner
// ---------------------------------------------------------------------------

export default function Learn() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('idle') // 'idle' | 'session' | 'done'
  const [srsMap, setSrsMap] = useState(null) // Map<itemId, state> | null while loading
  const [profile, setProfile] = useState({})
  const [session, setSession] = useState([])
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState([])
  const [progState, setProgState] = useState(null)
  const [tripItems, setTripItems] = useState([])
  const [lastEarnedXp, setLastEarnedXp] = useState(0)
  const [newBadges, setNewBadges] = useState([])
  const srsMapRef = useRef(new Map())
  const resultsRef = useRef([])
  const requeuedRef = useRef(new Set()) // item IDs already re-queued this session
  const audio = useTTSAudio()

  const reload = useCallback(async () => {
    try {
      const [map, prof, prog, tripItems] = await Promise.all([getSRSMap(), getProfile(), getProgressData(), getTripDeckItems()])
      srsMapRef.current = map
      setSrsMap(map)
      setProfile(prof)
      setProgState(prog)
      setTripItems(tripItems)
    } catch {
      srsMapRef.current = new Map()
      setSrsMap(new Map())
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  // --- derived stats for Today view ---
  const now = Date.now()
  const states = srsMap ? [...srsMap.values()] : []
  const started = states.filter(s => s.stage !== 'seed')
  const dueStates = started.filter(s => isDue(s, now))
  const dueNow = dueStates.length
  const dueTomorrow = started.filter(
    s => !isDue(s, now) && s.due <= now + 24 * 60 * 60 * 1000
  ).length

  const activeUnit = useMemo(() => {
    if (profile.activeUnit && itemsByUnit[profile.activeUnit]) return profile.activeUnit
    for (const u of UNITS_ORDER) {
      const items = itemsByUnit[u]
      const hasNew = items.some(it => {
        const s = srsMap?.get(it.id)
        return !s || s.stage === 'seed'
      })
      if (hasNew) return u
    }
    return UNITS_ORDER[UNITS_ORDER.length - 1]
  }, [profile, srsMap])

  const unitItems = itemsByUnit[activeUnit] || []

  // --- session control ---
  const startSession = useCallback((kind) => {
    const goalKey = localStorage.getItem('jerno-daily-goal') || 'regular'
    const prof = { ...profile, activeUnit, newPerDay: GOAL_NEW_PER_DAY[goalKey] ?? 5 }
    if (kind === 'review') prof.newPerDay = 0
    const exercises = buildSession(srsMapRef.current, prof, Date.now(), tripItems)
    if (exercises.length === 0) return
    setSession(exercises)
    setIndex(0)
    resultsRef.current = []
    requeuedRef.current = new Set()
    setResults([])
    setLastEarnedXp(0)
    setNewBadges([])
    setMode('session')
  }, [profile, activeUnit, tripItems])

  const finishSession = useCallback(() => {
    setSrsMap(new Map(srsMapRef.current))
    setMode('done')
    const stageUps = resultsRef.current
      .filter(r => r.after.stage !== r.before?.stage && r.after.step > (r.before?.step ?? 0))
      .map(r => ({ from: r.before?.stage ?? 'seed', to: r.after.stage }))
    awardEvent('session', {
      exerciseCount: resultsRef.current.length,
      stageUps,
    }).then(({ earnedXp, next, newBadges }) => {
      setProgState(next)
      setLastEarnedXp(earnedXp)
      setNewBadges(newBadges || [])
    }).catch(() => { /* never block */ })
  }, [])

  const advance = useCallback(() => {
    setIndex(i => i + 1)
  }, [])

  useEffect(() => {
    if (mode === 'session' && session.length > 0 && index >= session.length) {
      finishSession()
    }
  }, [mode, index, session, finishSession])

  const handleGrade = useCallback(async (gradeValue) => {
    const ex = session[index]
    if (!ex) return
    if (ex.requeued) {
      // Second-chance attempt: SRS was already graded (as a miss) on the first
      // encounter, and the result was already recorded for XP/stage-ups.
      // This pass is practice only — just move on.
      advance()
      return
    }
    const before = srsMapRef.current.get(ex.item.id) || ex.srsState
    const after = gradeSRS(before, gradeValue)
    srsMapRef.current.set(after.id, after)
    const newResults = [...resultsRef.current, { item: ex.item, before, after }]
    resultsRef.current = newResults
    setResults(newResults)
    // Missed it? Re-queue the same exercise at the end of the session for
    // another attempt — but only once per item, to avoid endless loops.
    if (gradeValue === 'not-yet' && !requeuedRef.current.has(ex.item.id)) {
      requeuedRef.current.add(ex.item.id)
      setSession(s => [...s, { ...ex, requeued: true }])
    }
    advance()
    try {
      await saveSRSState(after)
    } catch {
      // IndexedDB failure shouldn't break the session flow
    }
  }, [session, index, advance])

  const handleRepeat = useCallback(() => {
    const ex = session[index]
    if (!ex) return
    setSession(s => [...s, ex]) // re-queue at end, ungraded
    advance()
  }, [session, index, advance])

  const exitSession = useCallback(() => {
    setSrsMap(new Map(srsMapRef.current))
    setMode('idle')
  }, [])

  // --- render ---

  if (srsMap === null) {
    return (
      <div className="learn-today">
        <div className="learn-loading"><div className="spinner" /></div>
      </div>
    )
  }

  if (mode === 'session') {
    const ex = session[index]
    if (!ex) return null // transient frame before the done-effect fires
    const type = resolveExerciseType(ex.exerciseType, ex.item)
    const key = `${index}-${ex.item.id}`
    return (
      <div className="session-screen">
        <div className="session-header">
          <button type="button" className="session-exit" onClick={exitSession} aria-label="Exit session">✕</button>
          <div className="session-progress">
            <div className="session-progress-fill" style={{ width: `${(index / session.length) * 100}%` }} />
          </div>
          <span className="session-count">{Math.min(index + 1, session.length)} / {session.length}</span>
        </div>
        {type === 'intro' && (
          <IntroExercise key={key} item={ex.item} audio={audio}
            onGotIt={() => handleGrade('got-it')} onRepeat={handleRepeat} />
        )}
        {type === 'flashcard' && (
          <FlashcardExercise key={key} item={ex.item} audio={audio} onGrade={handleGrade} />
        )}
        {type === 'kana-pop' && (
          <KanaPopExercise key={key} item={ex.item} onGrade={handleGrade} />
        )}
        {type === 'audio-pick' && (
          <AudioPickExercise key={key} item={ex.item} audio={audio} onGrade={handleGrade} />
        )}
        {type === 'tile-builder' && (
          <TileBuilderExercise key={key} item={ex.item} audio={audio} onGrade={handleGrade} />
        )}
        {type === 'cloze' && (
          <ClozeExercise key={key} item={ex.item} audio={audio} onGrade={handleGrade} />
        )}
        {type === 'match-five' && (
          <MatchFiveExercise key={key} item={ex.item} audio={audio} onGrade={handleGrade}
            session={session} sessionIndex={index} />
        )}
      </div>
    )
  }

  if (mode === 'done') {
    const stageUps = results.filter(r => r.after.stage !== r.before.stage && r.after.step > r.before.step)
    const gotIt = results.filter(r => r.after.lastGrade === 'got-it').length
    const rank = progState ? rankFor(progState.xp) : null
    return (
      <div className="session-end">
        <Plant stage={3} size={64} />
        <h2>Session complete!</h2>
        <p className="today-card-sub">
          {results.length} item{results.length === 1 ? '' : 's'} reviewed · {gotIt} correct
        </p>
        {lastEarnedXp > 0 && (
          <div className="session-xp">+{lastEarnedXp} XP</div>
        )}
        {rank && <Rank jp={rank.name} en={rank.en} />}
        {stageUps.length > 0 && (
          <div className="stageups">
            {stageUps.map((r, i) => (
              <div className="stageup-row" key={`${r.item.id}-${i}`}>
                <span className="ja">{r.item.glyph || r.item.ja}</span>
                <span className="stage-shift">
                  <Plant stage={STAGE_IDX[r.before.stage] ?? 0} size={22} />
                  <NavIco name="arrowR" size={14} />
                  <Plant stage={STAGE_IDX[r.after.stage] ?? 0} size={22} />
                </span>
              </div>
            ))}
          </div>
        )}
        {newBadges.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {newBadges.map(b => (
              <Chip key={b.id} title={b.desc}
                style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                {b.icon} {b.label}
              </Chip>
            ))}
          </div>
        )}
        <button type="button" className="jn-btn jn-btn--green" onClick={() => setMode('idle')}>
          Back to Today
        </button>
      </div>
    )
  }

  // idle — the "One Thing" home (per the design handoff's HomeOneThing)

  // Greeting + date (real, time-aware)
  const nowDate = new Date()
  const hour = nowDate.getHours()
  const greeting = hour < 12 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'こんばんは'
  const dateLabel = `${nowDate.toLocaleDateString('en-US', { weekday: 'long' })} · ${nowDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
  const learnerName = profile.name || 'everyone'

  // Session estimate — mirror how buildSession assembles the pile:
  // due reviews (cap 20) + the day's new-item ration, clipped to the session limit.
  const goalKey = localStorage.getItem('jerno-daily-goal') || 'regular'
  const newPerDay = GOAL_NEW_PER_DAY[goalKey] ?? 5
  const kidMode = localStorage.getItem('jerno-kid-mode') === 'true'
  const sessionLimit = kidMode ? 10 : 14
  const countNew = (items) => items.filter(it => {
    const s = srsMap.get(it.id)
    return !s || s.stage === 'seed'
  }).length
  const tripIds = new Set(tripItems.map(i => i.id))
  const newAvailable = countNew(unitItems.filter(it => !tripIds.has(it.id))) + countNew(tripItems)
  const sessReviews = Math.min(dueNow, 20, sessionLimit)
  const sessFresh = Math.min(newPerDay, newAvailable, sessionLimit - sessReviews)
  const sessionSize = sessReviews + sessFresh
  const etaMin = Math.max(1, Math.ceil((sessionSize * 25) / 60))
  const pileFrac = Math.min(1, dueNow / 30)
  const caughtUp = dueNow === 0 && newAvailable === 0

  // Growth-stage glyph row — one Plant per item in today's pile (cap 8):
  // the day's new words as seeds + the due reviews at their real stages.
  const plantStages = [
    ...Array(Math.max(0, sessFresh)).fill(0),
    ...dueStates.map(s => STAGE_IDX[s.stage] ?? 0).sort((a, b) => a - b),
  ].slice(0, 8)

  // Quests — saved quests if they're today's, else build today's set
  const todayISO = new Date().toISOString().slice(0, 10)
  const q = progState
    ? (progState.quests?.date === todayISO ? progState.quests : buildQuests(todayISO, progState))
    : null
  const quests = q ? [
    { key: 'q1', icon: 'cards',  label: q.q1label || 'Clear your review pile',  done: !!q.q1 },
    { key: 'q2', icon: 'bolt',   label: q.q2label || 'Practice today',          done: !!q.q2 },
    { key: 'q3', icon: 'family', label: q.q3label || 'Help a family member',    done: !!q.q3 },
  ] : []

  // Trip deck — items whose SRS stage is bamboo are "about to blossom"
  const tripBlooming = tripItems.filter(it => srsMap.get(it.id)?.stage === 'bamboo').length

  return (
    <div className="jn jn-screen" style={{ minHeight: 'calc(100vh - 72px)', height: 'auto', overflow: 'visible' }}>
      <div className="jn-pad" style={{ paddingTop: 16, paddingBottom: 20, display: 'flex', flexDirection: 'column',
        gap: 16, flex: 1, width: '100%', maxWidth: 480, margin: '0 auto' }}>

        {/* 1 · header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <Inu size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="jn-eyebrow" style={{ fontSize: 10.5 }}>{dateLabel}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="jn-jp" style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 23 }}>{greeting}</span>
              <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 600 }}>{learnerName}</span>
            </div>
          </div>
          <StreakPill count={progState?.streak?.current ?? 0} />
        </div>

        {/* 2 · the one thing */}
        <div style={{ background: 'var(--primary)', borderRadius: 26, padding: '22px 22px 20px', color: 'var(--on-primary)',
          boxShadow: '0 14px 30px color-mix(in srgb, var(--primary) 34%, transparent)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, textTransform: 'uppercase', opacity: 0.85 }}>Today’s session</span>
            {!caughtUp && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, opacity: 0.9 }}>
                <NavIco name="clock" size={15} /> ~{etaMin} min
              </span>
            )}
          </div>
          {caughtUp ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
              <Plant stage={3} size={56} color="var(--on-primary)" bloom="#fff" />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 20, lineHeight: 1.1 }}>all caught up</div>
                <div style={{ fontSize: 13, opacity: 0.9, marginTop: 5, fontWeight: 600 }}>
                  {dueTomorrow > 0
                    ? `${dueTomorrow} review${dueTomorrow === 1 ? '' : 's'} ready tomorrow`
                    : 'your garden is resting — see you tomorrow'}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
                <PileRing count={sessionSize} frac={pileFrac} ink="var(--on-primary)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 20, lineHeight: 1.1 }}>ready to review</div>
                  <div style={{ fontSize: 13, opacity: 0.9, marginTop: 5, fontWeight: 600 }}>
                    {sessReviews > 0 && `${sessReviews} due review${sessReviews === 1 ? '' : 's'}`}
                    {sessReviews > 0 && sessFresh > 0 && ' + '}
                    {sessFresh > 0 && `${sessFresh} new word${sessFresh === 1 ? '' : 's'}`}
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 9 }}>
                    {plantStages.map((st, i) =>
                      <Plant key={i} stage={st} size={17} color="var(--on-primary)" bloom="#fff" />)}
                  </div>
                </div>
              </div>
              <button type="button" className="jn-btn jn-btn--block"
                onClick={() => startSession(sessFresh > 0 ? 'continue' : 'review')}
                style={{ marginTop: 16, background: 'var(--on-primary)', color: 'var(--primary)', fontSize: 16.5 }}>
                <NavIco name="play" size={19} /> Start session
              </button>
            </>
          )}
        </div>

        {/* 3 · quests */}
        {quests.length > 0 && (
          <Card style={{ padding: '15px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
              <span className="jn-eyebrow">Today’s quests · everyone</span>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--green)' }}>
                {quests.filter(x => x.done).length} / {quests.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {quests.map(x => <Quest key={x.key} icon={x.icon} label={x.label} done={x.done} />)}
            </div>
          </Card>
        )}

        {/* 4 · two quiet doors */}
        <div style={{ display: 'flex', gap: 12 }}>
          <DoorTile color="var(--sky)" soft="var(--sky-soft)" icon="translate"
            title="Translate" sub="& show a card" onClick={() => navigate('/translate')} />
          <DoorTile color="var(--pink)" soft="var(--pink-soft)" icon="arcade"
            title="Kana Arcade" sub="4 games" onClick={() => navigate('/arcade')} />
        </div>

        {/* Speaking Lab + Family shortcuts (kept from the old Today view) */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          <Chip
            onClick={() => {
              // q3 family-action proxy: visiting the Speaking Lab counts
              awardEvent('speaking', {}).catch(() => { /* never block */ })
              navigate('/speaking')
            }}
            role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
            <NavIco name="mic" size={15} /> Speaking Lab
          </Chip>
          <Chip onClick={() => navigate('/family')} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
            <NavIco name="family" size={15} /> <span className="jn-jp">家族</span> Family
          </Chip>
        </div>

        {/* 5 · trip-deck whisper */}
        {tripItems.length > 0 && (
          <div style={{ marginTop: 'auto' }}>
            {/* TODO: a dedicated trip-deck screen is future work — for now this
                starts a review session, where trip items are prioritized first. */}
            <TripDeckRow deck={tripItems.length} blooming={tripBlooming}
              onClick={() => startSession('review')} />
          </div>
        )}
      </div>
    </div>
  )
}
