import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { tts } from '../api.js'
import { allItems, itemsByUnit, UNITS_ORDER, UNIT_NAMES } from '../content/index.js'
import { grade as gradeSRS, isDue, STAGE_EMOJI } from '../data/srs.js'
import { buildSession } from '../data/session.js'
import { getSRSMap, saveSRSState, getProfile } from '../data/store.js'
import { awardEvent, getProgressData, rankFor } from '../data/progress.js'

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

// Exercise types actually implemented in this screen.
// Anything else falls back to flashcard / kana-pop.
const IMPLEMENTED = new Set(['intro', 'flashcard', 'kana-pop', 'audio-pick', 'tile-builder', 'cloze', 'match-five'])
function resolveExerciseType(exerciseType, item) {
  if (IMPLEMENTED.has(exerciseType)) return exerciseType
  return item.type === 'kana' ? 'kana-pop' : 'flashcard'
}

// ---------------------------------------------------------------------------
// TTS audio hook — fetch base64 audio, cache blob URLs per text
// ---------------------------------------------------------------------------

function useTTSAudio() {
  const cacheRef = useRef(new Map())
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)

  const play = useCallback(async (text) => {
    if (!text) return
    try {
      let url = cacheRef.current.get(text)
      if (!url) {
        const result = await tts(text)
        const b64 = result?.audio?.base64
        if (!b64) return
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
        cacheRef.current.set(text, url)
      }
      if (audioRef.current) audioRef.current.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onplay = () => setPlaying(true)
      audio.onended = () => setPlaying(false)
      audio.onerror = () => setPlaying(false)
      await audio.play()
    } catch {
      // Audio is best-effort: never block the exercise on TTS failures
      setPlaying(false)
    }
  }, [])

  useEffect(() => {
    const cache = cacheRef.current
    return () => {
      if (audioRef.current) audioRef.current.pause()
      for (const url of cache.values()) URL.revokeObjectURL(url)
      cache.clear()
    }
  }, [])

  return { play, playing }
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
      <div className="exercise-prompt">New {item.type === 'kana' ? 'kana' : 'phrase'} 🌱</div>
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
    const own = new Set(segments.map(s => s.reading))
    const readings = []
    for (const other of allItems) {
      if (other.id === item.id || !Array.isArray(other.segments)) continue
      for (const s of other.segments) {
        if (!own.has(s.reading) && !readings.includes(s.reading)) readings.push(s.reading)
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
    setTimeout(() => onGrade(reading === correctReading ? 'got-it' : 'not-yet'), 1000)
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
            if (reading === correctReading) cls += ' correct'
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
  const [mode, setMode] = useState('idle') // 'idle' | 'session' | 'done'
  const [srsMap, setSrsMap] = useState(null) // Map<itemId, state> | null while loading
  const [profile, setProfile] = useState({})
  const [session, setSession] = useState([])
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState([])
  const [progState, setProgState] = useState(null)
  const srsMapRef = useRef(new Map())
  const resultsRef = useRef([])
  const prevXpRef = useRef(0)
  const audio = useTTSAudio()

  const reload = useCallback(async () => {
    try {
      const [map, prof, prog] = await Promise.all([getSRSMap(), getProfile(), getProgressData()])
      srsMapRef.current = map
      setSrsMap(map)
      setProfile(prof)
      setProgState(prog)
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
  const dueNow = started.filter(s => isDue(s, now)).length
  const dueTomorrow = started.filter(
    s => !isDue(s, now) && s.due <= now + 24 * 60 * 60 * 1000
  ).length
  const learnedCount = started.length

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
  const unitStarted = unitItems.filter(it => {
    const s = srsMap?.get(it.id)
    return s && s.stage !== 'seed'
  }).length
  const unitPct = unitItems.length
    ? Math.round((unitStarted / unitItems.length) * 100)
    : 0

  // --- session control ---
  const startSession = useCallback((kind) => {
    const prof = { ...profile, activeUnit }
    if (kind === 'review') prof.newPerDay = 0
    const exercises = buildSession(srsMapRef.current, prof)
    if (exercises.length === 0) return
    setSession(exercises)
    setIndex(0)
    resultsRef.current = []
    setResults([])
    prevXpRef.current = progState?.xp ?? 0
    setMode('session')
  }, [profile, activeUnit, progState])

  const finishSession = useCallback(() => {
    setSrsMap(new Map(srsMapRef.current))
    setMode('done')
    const stageUps = resultsRef.current
      .filter(r => r.after.stage !== r.before.stage && r.after.step > r.before.step)
      .map(r => ({ from: r.before.stage, to: r.after.stage }))
    awardEvent('session', {
      exerciseCount: resultsRef.current.length,
      stageUps,
    }).then(({ next }) => setProgState(next)).catch(() => {})
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
    const before = srsMapRef.current.get(ex.item.id) || ex.srsState
    const after = gradeSRS(before, gradeValue)
    srsMapRef.current.set(after.id, after)
    const newResults = [...resultsRef.current, { item: ex.item, before, after }]
    resultsRef.current = newResults
    setResults(newResults)
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
    return (
      <div className="session-end">
        <div className="session-end-emoji">🌸</div>
        <h2>Session complete!</h2>
        <p className="today-card-sub">
          {results.length} item{results.length === 1 ? '' : 's'} reviewed · {gotIt} correct
        </p>
        {progState && (
          <div className="session-xp">
            +{Math.max(0, (progState.xp ?? 0) - (prevXpRef.current ?? 0))} XP · {rankFor(progState.xp).name} {rankFor(progState.xp).en}
          </div>
        )}
        {stageUps.length > 0 && (
          <div className="stageups">
            {stageUps.map((r, i) => (
              <div className="stageup-row" key={`${r.item.id}-${i}`}>
                <span className="ja">{r.item.glyph || r.item.ja}</span>
                <span>{STAGE_EMOJI[r.before.stage]} → {STAGE_EMOJI[r.after.stage]}</span>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn-primary" onClick={() => setMode('idle')}>
          Back to Today
        </button>
      </div>
    )
  }

  // idle — Today view
  return (
    <div className="learn-today">
      <Link to="/settings" className="settings-gear" aria-label="Settings">⚙</Link>
      <h1 className="learn-title">Today</h1>

      <div className="today-card">
        {dueNow > 0 ? (
          <>
            <div className="today-card-big">🔔 {dueNow} to review</div>
            <button type="button" className="btn-primary" onClick={() => startSession('review')}>
              Start Review
            </button>
          </>
        ) : (
          <>
            <div className="today-card-big">All caught up! 🌸</div>
            <p className="today-card-sub">
              {dueTomorrow > 0
                ? `${dueTomorrow} review${dueTomorrow === 1 ? '' : 's'} due tomorrow`
                : 'Nothing due tomorrow yet'}
            </p>
          </>
        )}
      </div>

      <div className="today-card">
        <div className="today-card-row">
          <span className="unit-name">{UNIT_NAMES[activeUnit] || activeUnit}</span>
          <span className="unit-pct">{unitStarted} / {unitItems.length}</span>
        </div>
        <div className="unit-progress-bar">
          <div className="unit-progress-fill" style={{ width: `${unitPct}%` }} />
        </div>
        <button type="button" className="btn-primary" onClick={() => startSession('continue')}>
          Continue
        </button>
      </div>

      <div className="learn-stats">
        <div className="stat">
          <div className="stat-num">{learnedCount}</div>
          <div className="stat-label">Learned</div>
        </div>
        <div className="stat">
          <div className="stat-num">{progState?.streak?.current ?? 0}</div>
          <div className="stat-label">Day streak</div>
        </div>
        <div className="stat">
          <div className="stat-num">{progState?.xp ?? 0}</div>
          <div className="stat-label">XP</div>
        </div>
      </div>
    </div>
  )
}
