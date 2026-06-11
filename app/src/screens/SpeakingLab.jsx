import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { tts } from '../api.js'
import { allItems } from '../content/index.js'
import { grade as gradeSRS, initialState, isDue, STAGE_EMOJI } from '../data/srs.js'
import { getSRSMap, saveSRSState } from '../data/store.js'
import { awardEvent } from '../data/progress.js'

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

// TTS audio hook — fetch base64 audio, cache blob URLs per text
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
      // Audio is best-effort: never block the UI on TTS failures
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
        <div className="session-end-emoji">🎙️</div>
        <h2>Echo session done!</h2>
        <p className="today-card-sub">
          {results.length} phrase{results.length === 1 ? '' : 's'} practiced
        </p>
        {stageUps.length > 0 && (
          <div className="stageups">
            {stageUps.map((r, i) => (
              <div className="stageup-row" key={`${r.item.id}-${i}`}>
                <span className="ja">{r.item.ja}</span>
                <span>{STAGE_EMOJI[r.before.stage]} → {STAGE_EMOJI[r.after.stage]}</span>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn-primary" onClick={() => navigate('/learn')}>
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
          🎙
        </button>
        <div className="today-card-sub" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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
  { id: 'mp-byouin-biyouin', audio: 'びょういん', a: { ja: 'びょういん', en: 'hospital' }, b: { ja: 'びよういん', en: 'beauty salon' } },
  { id: 'mp-kite-kitte',     audio: 'きて',      a: { ja: 'きて', en: 'come here' },     b: { ja: 'きって', en: 'stamp / cut' } },
  { id: 'mp-obasan-obaasan', audio: 'おばさん',  a: { ja: 'おばさん', en: 'aunt / lady' }, b: { ja: 'おばあさん', en: 'grandmother' } },
  { id: 'mp-ojisan-ojiisan', audio: 'おじさん',  a: { ja: 'おじさん', en: 'uncle / man' }, b: { ja: 'おじいさん', en: 'grandfather' } },
  { id: 'mp-iku-iiku',       audio: 'いく',      a: { ja: 'いく', en: 'to go' },          b: { ja: 'いっく', en: '(exaggerated going)' } },
  { id: 'mp-suki-tsuki',     audio: 'すき',      a: { ja: 'すき', en: 'like / gap' },      b: { ja: 'つき', en: 'moon / month' } },
  { id: 'mp-hashi-hashi2',   audio: 'はし',      a: { ja: 'はし (箸)', en: 'chopsticks' }, b: { ja: 'はし (橋)', en: 'bridge' } },
  { id: 'mp-uchi-uchi2',     audio: 'うち',      a: { ja: 'うち (家)', en: 'home' },       b: { ja: 'うち (内)', en: 'inside / we' } },
  { id: 'mp-koko-kooko',     audio: 'ここ',      a: { ja: 'ここ', en: 'here' },            b: { ja: 'こうこう', en: 'high school' } },
  { id: 'mp-soko-sooko',     audio: 'そこ',      a: { ja: 'そこ', en: 'there' },           b: { ja: 'そうこ', en: 'warehouse' } },
]

function buildDojoRound() {
  // Shuffle the pairs, and shuffle the choice order per question so the
  // correct answer isn't always in the same position.
  return shuffle(MINIMAL_PAIRS).slice(0, DOJO_ROUND_SIZE).map(pair => ({
    pair,
    choices: shuffle([
      { key: 'a', ...pair.a },
      { key: 'b', ...pair.b },
    ]),
    correctKey: 'a', // pair.audio is always the "a" reading
  }))
}

function MinimalPairDojo() {
  const audio = useTTSAudio()
  const [round, setRound] = useState(() => buildDojoRound())
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)
  const playRef = useRef(audio.play)
  playRef.current = audio.play

  const question = round[index]

  // Auto-play the audio for each question
  useEffect(() => {
    if (!done && question) playRef.current(question.pair.audio)
  }, [index, done, question])

  const handlePick = (key) => {
    if (picked !== null) return
    setPicked(key)
    const correct = key === question.correctKey
    if (correct) setScore(s => s + 1)
    setTimeout(() => {
      setPicked(null)
      if (index + 1 >= round.length) setDone(true)
      else setIndex(index + 1)
    }, 1500)
  }

  const restart = () => {
    setRound(buildDojoRound())
    setIndex(0)
    setPicked(null)
    setScore(0)
    setDone(false)
  }

  if (done) {
    const message = score === round.length
      ? 'Perfect ears! 🏆'
      : score >= round.length * 0.7
        ? 'Sharp listening! Keep it up 👂'
        : 'Tricky sounds — they get easier with reps 💪'
    return (
      <div className="speaking-end">
        <div className="session-end-emoji">🥋</div>
        <h2>{score} / {round.length}</h2>
        <p className="today-card-sub">{message}</p>
        <button type="button" className="btn-primary" onClick={restart}>
          Another round
        </button>
      </div>
    )
  }

  return (
    <div className="mp-pair">
      <div className="exercise-prompt" style={{ textAlign: 'center' }}>
        {index + 1} / {round.length} · What did you hear?
      </div>
      <div className="mp-audio-prompt">
        <button
          type="button"
          className={`audio-btn big${audio.playing ? ' playing' : ''}`}
          onClick={() => audio.play(question.pair.audio)}
          aria-label="Play audio"
        >
          🔊
        </button>
        <div className="mp-ja-hint">Tap to replay</div>
      </div>
      <div className="mp-choices">
        {question.choices.map(choice => {
          let cls = 'mp-choice'
          if (picked !== null) {
            if (choice.key === question.correctKey) cls += ' correct'
            else if (choice.key === picked) cls += ' wrong'
          }
          return (
            <button key={choice.key} type="button" className={cls} disabled={picked !== null}
              onClick={() => handlePick(choice.key)}>
              <div className="mp-choice-ja">{choice.ja}</div>
              <div className="mp-choice-en">{choice.en}</div>
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
        <button type="button" className="arcade-back" onClick={() => navigate('/learn')}>
          ← Speaking Lab
        </button>
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
