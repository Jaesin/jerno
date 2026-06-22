import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpeaker } from '@jaesin/t10n-client/react'
import { allItems } from '../content/index.js'
import { grade as gradeSRS, initialState, isDue } from '../data/srs.js'
import { getSRSMap, saveSRSState } from '../data/store.js'
import { awardEvent } from '../data/progress.js'
import { Plant, NavIco } from '../design/primitives.jsx'

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

const SESSION_SIZE = 5
const DOJO_ROUND_SIZE = 10
const MAX_RECORD_MS = 10 * 1000

function focusPrompt(item) {
  const reading = item.reading || ''
  if (reading.includes('っ')) return 'Mind the short stop in the middle'
  if (/(おう|おお|うう|ええ)/.test(reading)) return 'Stretch that long vowel'
  if (item.notes) {
    const first = item.notes.split(/(?<=[.!?。])\s*/)[0]
    if (first) return first
  }
  return 'Listen: does the pitch rise or fall?'
}

// TTS audio hook — cloud TTS with web-speech fallback via the shared t10n
// speaker. The speaker owns its own cloud-clip cache, so `prefetch` warms the
// next question's clip and `play` reuses it. `play` returns a resolved promise
// so callers can chain (the dojo awaits it to advance its phase). `loading` is
// retained for the dojo's spinner but is effectively unused now: device speech
// starts instantly and a warmed cloud clip plays without a fetch.
function useTTSAudio() {
  const { speak, prefetch: warm, speaking } = useSpeaker()

  const play = useCallback((text) => {
    if (text) speak(text, { lang: 'ja' })
    return Promise.resolve()
  }, [speak])

  // Warm the cloud clip without playing — used to pre-fetch the next question.
  // `warm` is only present on newer t10n-client builds; guard for older pins.
  const prefetch = useCallback((text) => {
    if (text && typeof warm === 'function') void warm([{ text, lang: 'ja' }])
  }, [warm])

  return { play, prefetch, playing: speaking, loading: false }
}

// ---------------------------------------------------------------------------
// Echo Booth — listen, record yourself, A/B compare, self-grade
// ---------------------------------------------------------------------------

function EchoBooth() {
  const navigate = useNavigate()
  const audio = useTTSAudio()
  const [items, setItems] = useState(null) // null while loading
  const [index, setIndex] = useState(0)
  const [recordingUrl, setRecordingUrl] = useState(null)
  const [recording, setRecording] = useState(false)
  const [micError, setMicError] = useState(false)
  const [done, setDone] = useState(false)
  const [results, setResults] = useState([])

  const srsMapRef = useRef(new Map())
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const stopTimerRef = useRef(null)
  const recordingUrlRef = useRef(null)
  const playbackRef = useRef(null)
  const awardedRef = useRef(false)

  // Build the session pool: due phrases first, then unit order.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let map = new Map()
      try {
        map = await getSRSMap()
      } catch {
        // store failure — fall back to unit order
      }
      if (cancelled) return
      srsMapRef.current = map
      const now = Date.now()
      const phrases = allItems.filter(it => it.type === 'phrase')
      const due = []
      const rest = []
      for (const it of phrases) {
        const s = map.get(it.id)
        if (s && isDue(s, now)) due.push(it)
        else rest.push(it)
      }
      setItems([...due, ...rest].slice(0, SESSION_SIZE))
    })()
    return () => { cancelled = true }
  }, [])

  const stopRecorder = useCallback(() => {
    clearTimeout(stopTimerRef.current)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    setRecording(false)
  }, [])

  const clearRecording = useCallback(() => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current)
      recordingUrlRef.current = null
    }
    if (playbackRef.current) playbackRef.current.pause()
    setRecordingUrl(null)
  }, [])

  // Cleanup on unmount: stop recorder, release mic, revoke blob URL
  useEffect(() => {
    return () => {
      clearTimeout(stopTimerRef.current)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current)
      if (playbackRef.current) playbackRef.current.pause()
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (recording) return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicError(true)
      return
    }
    try {
      clearRecording()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      const chunks = []
      recorder.ondataavailable = e => chunks.push(e.data)
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        recordingUrlRef.current = url
        setRecordingUrl(url)
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      stopTimerRef.current = setTimeout(stopRecorder, MAX_RECORD_MS)
    } catch {
      setMicError(true)
      setRecording(false)
    }
  }, [recording, clearRecording, stopRecorder])

  const playRecording = useCallback(() => {
    if (!recordingUrlRef.current) return
    if (playbackRef.current) playbackRef.current.pause()
    const a = new Audio(recordingUrlRef.current)
    playbackRef.current = a
    a.play().catch(() => { /* best-effort */ })
  }, [])

  const handleGrade = useCallback(async (gradeValue) => {
    const item = items?.[index]
    if (!item) return
    const before = srsMapRef.current.get(item.id) || initialState(item.id)
    const after = gradeSRS(before, gradeValue)
    srsMapRef.current.set(after.id, after)
    const newResults = [...results, { item, before, after }]
    setResults(newResults)
    clearRecording()
    if (index + 1 >= items.length) {
      setDone(true)
      if (!awardedRef.current) {
        awardedRef.current = true
        const stageUps = newResults
          .filter(r => r.after.stage !== r.before.stage && r.after.step > r.before.step)
          .map(r => ({ from: r.before.stage, to: r.after.stage }))
        awardEvent('session', { exerciseCount: newResults.length, stageUps })
          // chained so the two progress saves don't race; 'speaking' marks
          // quest q3 (family-action proxy) — see progress.js
          .then(() => awardEvent('speaking', {}))
          .catch(() => { /* never block */ })
      }
    } else {
      setIndex(index + 1)
    }
    try {
      await saveSRSState(after)
    } catch {
      // store failure shouldn't break the session flow
    }
  }, [items, index, results, clearRecording])

  if (micError) {
    return (
      <div className="echo-card">
        <p className="exercise-notes">
          Enable microphone access in your browser settings to use Echo Booth.
        </p>
        <div className="echo-controls">
          <button type="button" className="btn-primary" onClick={() => navigate('/learn')}>
            Use Flashcards instead
          </button>
        </div>
      </div>
    )
  }

  if (items === null) {
    return <div className="learn-loading"><div className="spinner" /></div>
  }

  if (items.length === 0) {
    return (
      <div className="speaking-end">
        <p className="today-card-sub">No phrases available yet. Learn some phrases first!</p>
      </div>
    )
  }

  if (done) {
    const stageUps = results.filter(r => r.after.stage !== r.before.stage && r.after.step > r.before.step)
    return (
      <div className="speaking-end">
        <Plant stage={3} size={56} />
        <h2>Echo session done!</h2>
        <p className="today-card-sub">
          {results.length} phrase{results.length === 1 ? '' : 's'} practiced
        </p>
        {stageUps.length > 0 && (
          <div className="stageups">
            {stageUps.map((r, i) => (
              <div className="stageup-row" key={`${r.item.id}-${i}`}>
                <span className="ja">{r.item.ja}</span>
                <span className="stage-shift">
                  <Plant stage={STAGE_IDX[r.before.stage] ?? 0} size={22} />
                  <NavIco name="arrowR" size={14} />
                  <Plant stage={STAGE_IDX[r.after.stage] ?? 0} size={22} />
                </span>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="jn-btn jn-btn--green" onClick={() => navigate('/learn')}>
          Back to Learn
        </button>
      </div>
    )
  }

  const item = items[index]

  return (
    <div className="echo-card" key={item.id}>
      <div className="exercise-prompt">{index + 1} / {items.length}</div>
      <div className="echo-ja">{item.ja}</div>
      <div className="echo-romaji">{item.romaji}</div>
      <div className="echo-focus">{focusPrompt(item)}</div>
      <div className="echo-controls">
        <button type="button" className="echo-ref-btn" onClick={() => audio.play(item.ja)}>
          🔊 Hear reference
        </button>
        <button
          type="button"
          className={`record-btn${recording ? ' recording' : ''}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecorder}
          onMouseLeave={() => { if (recording) stopRecorder() }}
          onTouchStart={(e) => { e.preventDefault(); startRecording() }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecorder() }}
          aria-label="Hold to record"
        >
          <NavIco name="mic" size={32} />
        </button>
        <div className="today-card-sub" style={{ fontSize: 12, color: 'var(--muted)' }}>
          {recording ? 'Recording… release to stop' : 'Hold to record'}
        </div>
        {recordingUrl && (
          <div className="ab-buttons">
            <button type="button" className="ab-btn" onClick={() => audio.play(item.ja)}>
              ▶ Reference
            </button>
            <button type="button" className="ab-btn" onClick={playRecording}>
              ▶ Me
            </button>
          </div>
        )}
        <div className="grade-buttons">
          <button type="button" className="btn-secondary" onClick={() => handleGrade('not-yet')}>
            Not yet ✗
          </button>
          <button type="button" className="btn-primary" onClick={() => handleGrade('got-it')}>
            Got it ✓
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Minimal Pair Dojo — hear it, pick what you heard
// ---------------------------------------------------------------------------

const MINIMAL_PAIRS = [
  { audio: 'おばさん',   choices: ['おばさん (aunt)', 'おばあさん (grandmother)'],            correct: 'おばさん (aunt)',           hint: "short 'a'" },
  { audio: 'おばあさん', choices: ['おばさん (aunt)', 'おばあさん (grandmother)'],            correct: 'おばあさん (grandmother)',  hint: "long 'aa'" },
  { audio: 'きって',     choices: ['きて (come)', 'きって (stamp)'],                          correct: 'きって (stamp)',            hint: 'double consonant' },
  { audio: 'きて',       choices: ['きて (come)', 'きって (stamp)'],                          correct: 'きて (come)',               hint: "single 't'" },
  { audio: 'びょういん', choices: ['びょういん (hospital)', 'びよういん (beauty salon)'],     correct: 'びょういん (hospital)',     hint: 'small ょ' },
  { audio: 'びよういん', choices: ['びょういん (hospital)', 'びよういん (beauty salon)'],     correct: 'びよういん (beauty salon)', hint: 'big よ' },
  { audio: 'ここ',       choices: ['ここ (here)', 'こうこう (high school)'],                  correct: 'ここ (here)',               hint: 'short' },
  { audio: 'さくら',     choices: ['さくら (cherry blossom)', 'さっか (writer)'],             correct: 'さくら (cherry blossom)',   hint: 'no stop' },
  { audio: 'いしゃ',     choices: ['いしゃ (doctor)', 'いすや (chair shop)'],                 correct: 'いしゃ (doctor)',           hint: 'sha sound' },
  { audio: 'すみません', choices: ['すみません (excuse me)', 'しみません (doesn’t stain)'], correct: 'すみません (excuse me)',  hint: 'su not shi' },
]

// Shuffle the question order, and shuffle each question's choice order so the
// correct answer isn't always in the same position.
function buildDojoRound() {
  return shuffle(MINIMAL_PAIRS).slice(0, DOJO_ROUND_SIZE).map(pair => ({
    ...pair,
    choices: shuffle(pair.choices),
  }))
}

// Choices read "おばさん (aunt)" — split into JP headline + EN gloss for the tile
function splitChoice(choice) {
  const m = choice.match(/^(.*?)\s*\((.*)\)$/)
  return m ? { ja: m[1], en: m[2] } : { ja: choice, en: '' }
}

// Plant growth stage for the end screen: <5 seed, 5-7 sprout, 8-9 bamboo, 10 blossom
function dojoPlantStage(score) {
  if (score >= 10) return 3
  if (score >= 8) return 2
  if (score >= 5) return 1
  return 0
}

function MinimalPairDojo() {
  const audio = useTTSAudio()
  const [round, setRound] = useState(() => buildDojoRound())
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('idle') // 'idle' | 'playing' | 'result' | 'done'
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const advanceTimerRef = useRef(null)
  const audioRef = useRef(audio)
  audioRef.current = audio

  const question = phase === 'done' ? null : round[index]

  // Auto-play this question's audio, and pre-fetch the next question's
  useEffect(() => {
    if (!question) return
    let cancelled = false
    setPhase('idle')
    audioRef.current.play(question.audio).finally(() => {
      if (!cancelled) setPhase(p => (p === 'idle' ? 'playing' : p))
    })
    const next = round[index + 1]
    if (next) audioRef.current.prefetch(next.audio)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, index])

  useEffect(() => () => clearTimeout(advanceTimerRef.current), [])

  const handlePick = (choice) => {
    if (phase === 'result' || phase === 'done') return
    const correct = choice === question.correct
    const newScore = score + (correct ? 1 : 0)
    setPicked(choice)
    setScore(newScore)
    setPhase('result')
    clearTimeout(advanceTimerRef.current)
    advanceTimerRef.current = setTimeout(() => {
      setPicked(null)
      if (index + 1 >= round.length) {
        setPhase('done')
        // 1 XP per correct answer — best-effort, never block the end screen
        awardEvent('speaking', { score: newScore }).catch(() => {})
      } else {
        setIndex(index + 1)
      }
    }, correct ? 800 : 1500)
  }

  const restart = () => {
    clearTimeout(advanceTimerRef.current)
    setRound(buildDojoRound())
    setIndex(0)
    setPicked(null)
    setScore(0)
    setPhase('idle')
  }

  if (phase === 'done') {
    const message = score === round.length
      ? 'Perfect ears!'
      : score >= 8
        ? 'Sharp listening — almost there'
        : score >= 5
          ? 'Good ear — keep training'
          : 'Tricky sounds — they get easier with reps'
    return (
      <div className="speaking-end">
        <Plant stage={dojoPlantStage(score)} size={56} />
        <h2>{score} / {round.length}</h2>
        <p className="today-card-sub">{message}</p>
        <button type="button" className="jn-btn jn-btn--pink" onClick={restart}>
          Play again
        </button>
      </div>
    )
  }

  return (
    <div className="mp-pair">
      <div className="mp-header">
        <div className="jn-eyebrow" style={{ color: 'var(--pink)' }}>What did you hear?</div>
        <div className="mp-counter">{index + 1} / {round.length}</div>
      </div>
      <div className="mp-hint">Listen for: {question.hint}</div>
      <div className="mp-audio-prompt">
        <button
          type="button"
          className={`mp-audio-btn${audio.playing ? ' playing' : ''}`}
          onClick={() => audio.play(question.audio)}
          disabled={audio.loading}
          aria-label={audio.loading ? 'Loading audio' : 'Play audio'}
        >
          {audio.loading ? <span className="spinner" /> : '♪'}
        </button>
        <div className="mp-ja-hint">{audio.loading ? 'Loading audio…' : 'Tap to replay'}</div>
      </div>
      <div className="mp-choices">
        {question.choices.map(choice => {
          const { ja, en } = splitChoice(choice)
          let cls = 'mp-choice'
          if (phase === 'result') {
            if (choice === question.correct) cls += ' correct'
            else if (choice === picked) cls += ' wrong'
          }
          return (
            <button key={choice} type="button" className={cls} disabled={phase === 'result'}
              onClick={() => handlePick(choice)}>
              <div className="mp-choice-ja">{ja}</div>
              {en && <div className="mp-choice-en">{en}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speaking Lab shell — tab bar over the two sub-features
// ---------------------------------------------------------------------------

export default function SpeakingLab() {
  const [tab, setTab] = useState('echo') // 'echo' | 'dojo'
  const navigate = useNavigate()

  return (
    <div className="speaking-screen">
      <div className="speaking-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="arcade-back" style={{ marginBottom: 0 }}
            onClick={() => navigate('/learn')} aria-label="Back">←</button>
          <div>
            <div className="jn-eyebrow" style={{ color: 'var(--red)' }}>Speak</div>
            <div className="jn-display" style={{ fontSize: 21, marginTop: 2 }}>Speaking Lab</div>
          </div>
        </div>
        <div className="speaking-tabs">
          <button type="button" className={`speaking-tab ${tab === 'echo' ? 'active' : ''}`}
            onClick={() => setTab('echo')}>
            Echo Booth
          </button>
          <button type="button" className={`speaking-tab ${tab === 'dojo' ? 'active' : ''}`}
            onClick={() => setTab('dojo')}>
            Minimal Pair
          </button>
        </div>
      </div>
      {tab === 'echo' ? <EchoBooth /> : <MinimalPairDojo />}
    </div>
  )
}
