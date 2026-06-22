import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslate, useSpeaker, useT10nClient } from '@jaesin/t10n-client/react'
import { addToHistory, starHistoryItem, getHistory, addToTripDeck, removeFromTripDeck } from '../data/store.js'
import { awardEvent } from '../data/progress.js'
import { itemsByUnit } from '../content/index.js'
import { NavIco } from '../design/primitives.jsx'

const PHRASEBOOK = itemsByUnit['u1-survival'] || []

const VOICES = [
  { id: 'ja-JP-NanamiNeural', label: 'Nanami (Female)', gender: 'female' },
  { id: 'ja-JP-KeitaNeural', label: 'Keita (Male)', gender: 'male' },
]

export default function Travel() {
  const [input, setInput] = useState('')
  const [japanese, setJapanese] = useState('')
  const [romaji, setRomaji] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [autoPlay, setAutoPlay] = useState(() => {
    const saved = localStorage.getItem('jerno-autoplay')
    return saved !== null ? saved === 'true' : true
  })
  const [voice, setVoice] = useState(() => {
    return localStorage.getItem('jerno-voice') || 'ja-JP-NanamiNeural'
  })
  const [history, setHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [currentHistoryId, setCurrentHistoryId] = useState(null)
  const [showCard, setShowCard] = useState(false)
  const [phrasebookOpen, setPhrasebookOpen] = useState(false)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)

  // t10n-client: English→Japanese translation + the shared speech engine
  // (cloud TTS with a web-speech fallback, browser audio cache). `speaking`
  // reflects the single "now playing"; `engineFor` says which engine a tap
  // will use right now ('cloud' once a clip is cached, else 'device').
  const translateText = useTranslate({ from: 'en', to: 'ja', register: 'polite' })
  const client = useT10nClient()
  const { speak, engineFor, capabilities, speaking } = useSpeaker()
  const [cachedCount, setCachedCount] = useState(0)

  // Fetch + cache the high-quality cloud clip for `text` (no-op if already
  // cached or offline). Returns true once a cloud clip is available locally.
  // Writing to the shared client cache flips the speaker's engineFor to
  // 'cloud', so a following speak() plays the MP3 instead of device speech.
  // This is why autoplay waits on it: otherwise a fresh phrase would speak via
  // the robotic web-speech voice (and, after the translate round-trip, the
  // stale user-gesture can leave that blocked entirely on iOS).
  const warmCloud = useCallback(async (text) => {
    if (!text || !capabilities.cloud) return false
    if (client.cache.has(text, voice)) return true
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    try {
      const res = await client.fetchSpeech({ text, voice })
      if (res?.audio?.base64) await client.cache.set(text, voice, res.audio)
    } catch {
      // offline / 4xx — device speech still covers it
    }
    return client.cache.has(text, voice)
  }, [client, voice, capabilities.cloud])

  // Persist preferences
  useEffect(() => { localStorage.setItem('jerno-autoplay', autoPlay) }, [autoPlay])
  useEffect(() => { localStorage.setItem('jerno-voice', voice) }, [voice])

  // Load translation history on mount
  useEffect(() => { getHistory('local').then(setHistory) }, [])

  // Warm the survival phrasebook's cloud clips for offline use — one pass on
  // mount, re-run on voice change or when the network returns. Sequential so we
  // don't fire a dozen TTS requests at once; counts up live for the indicator.
  const phraseTotal = PHRASEBOOK.filter(p => p.ja).length
  useEffect(() => {
    if (!capabilities.cloud || phraseTotal === 0) return undefined
    let cancelled = false
    const texts = PHRASEBOOK.filter(p => p.ja).map(p => p.ja)
    const recount = () => { if (!cancelled) setCachedCount(texts.filter(t => client.cache.has(t, voice)).length) }
    const run = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      for (const t of texts) {
        if (cancelled) return
        await warmCloud(t)
        recount()
      }
    }
    recount() // reflect already-cached clips immediately
    run()
    const onOnline = () => { run() }
    window.addEventListener('online', onOnline)
    return () => { cancelled = true; window.removeEventListener('online', onOnline) }
  }, [voice, warmCloud, client, capabilities.cloud, phraseTotal])

  const caching = capabilities.cloud && phraseTotal > 0 && cachedCount < phraseTotal

  // Speak the current Japanese via the shared speaker (cloud if cached, else
  // web-speech — which also warms the cloud clip for next time).
  const handlePlay = useCallback(() => {
    if (japanese) speak(japanese, { voice })
  }, [japanese, voice, speak])

  // Switching voice while a result is on screen: the new voice has its own
  // cloud clip (cache is keyed by text+voice), so fetch it and re-play —
  // mirroring a fresh translate — instead of leaving stale/last-voice audio
  // until a manual replay. Gated on an actual voice change so it doesn't
  // double-fire alongside doTranslate's own warm+speak.
  const prevVoiceRef = useRef(voice)
  useEffect(() => {
    if (prevVoiceRef.current === voice) return
    prevVoiceRef.current = voice
    if (!japanese) return
    let cancelled = false
    ;(async () => {
      await warmCloud(japanese)
      if (!cancelled && autoPlay) speak(japanese, { voice })
    })()
    return () => { cancelled = true }
  }, [voice, japanese, warmCloud, autoPlay, speak])

  // Phase 1: translate → show result. Phase 2: speak/warm cloud audio.
  const doTranslate = useCallback(async (text) => {
    setLoading(true)
    setError('')
    setJapanese('')
    setRomaji('')
    setCurrentHistoryId(null)

    let result
    try {
      result = await translateText(text)
    } catch (err) {
      setError(err?.message || 'Translation failed')
      setLoading(false)
      return
    }

    const ja = result.text
    const rm = result.romanization || ''
    setJapanese(ja)
    setRomaji(rm)

    try {
      const saved = await addToHistory({ uid: 'local', en: text, japanese: ja, reading: result.reading || '', romaji: rm, segments: result.segments || [], voice })
      setCurrentHistoryId(saved.id)
      setHistory(await getHistory('local'))
    } catch {
      // history is best-effort — never block the translation on storage errors
    }
    setLoading(false)

    // Autoplay: fetch the cloud clip first, then speak so it plays the
    // high-quality MP3 (matching the pre-port "wait for real audio" behavior).
    // If warming fails (offline / not a member), speak() falls back to device.
    if (autoPlay) {
      await warmCloud(ja)
      speak(ja, { voice })
    } else {
      void warmCloud(ja) // warm so a manual tap is high-quality
    }
  }, [voice, autoPlay, speak, warmCloud, translateText])

  const handleTranslate = useCallback(() => {
    const text = input.trim()
    if (!text) return
    doTranslate(text)
  }, [input, doTranslate])

  // Phrasebook tap: show the phrase immediately (no translate round-trip — the
  // Japanese is already authored) and play/warm audio cache-first so it works
  // in airplane mode once prefetched.
  const handlePhrasebookTap = useCallback((phrase) => {
    setPhrasebookOpen(false)
    setInput(phrase.en)
    setJapanese(phrase.ja)
    setRomaji(phrase.romaji || '')
    setError('')
    setCurrentHistoryId(null)
    // In-gesture tap: speak() plays the cloud clip if it's already cached (the
    // phrasebook is pre-warmed on mount), otherwise device speech right away.
    if (autoPlay) speak(phrase.ja, { voice })
    else void warmCloud(phrase.ja)
  }, [autoPlay, speak, warmCloud, voice])

  // Handle Enter key
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleTranslate()
    }
  }

  // Auto-play when the show-card opens
  useEffect(() => {
    if (showCard) handlePlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCard])

  // Dictation (Web Speech API)
  const handleDictate = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser. Try Chrome or Safari.')
      return
    }

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    recognition.onstart = () => setListening(true)
    recognition.onerror = () => {
      setListening(false)
      setError('Microphone error. Check permissions.')
    }
    recognition.onend = () => setListening(false)
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      setInput(transcript)
      doTranslate(transcript)
    }

    recognition.start()
  }, [listening, doTranslate])

  const currentStarred = !!history.find(h => h.id === currentHistoryId)?.starred

  // Which engine a tap on the current phrase will use — drives the "browser
  // speech" hint until the high-quality cloud clip is cached.
  const cloudReady = !!japanese && engineFor(japanese, { voice }) === 'cloud'
  const browserHint = cloudReady ? undefined : 'Browser speech — high-quality audio loading…'

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="jn-eyebrow" style={{ color: 'var(--sky)' }}>Translate</div>
        <h1>JER<span>NO</span></h1>
        <p className="subtitle">Japanese Travel Companion</p>
        <Link to="/settings" className="settings-gear" aria-label="Settings">⚙</Link>
      </header>

      {/* Output Card */}
      <div className={`output-card ${japanese ? 'has-result' : ''}`}>
        {loading ? (
          <div className="spinner" />
        ) : japanese ? (
          <>
            <div
              className="japanese"
              lang="ja"
              onClick={() => setShowCard(true)}
              style={{ cursor: 'pointer' }}
            >{japanese}</div>
            {romaji && <div className="romaji" lang="ja-Latn">{romaji}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                className={`play-btn ${speaking ? 'playing' : ''} ${cloudReady ? '' : 'browser-audio'}`}
                onClick={handlePlay}
                title={browserHint}
                aria-label="Play Japanese pronunciation"
              >
                {speaking ? '◉' : '▶'}
              </button>
              {currentHistoryId && (
                <button
                  className={`star-btn ${currentStarred ? 'starred' : ''}`}
                  onClick={async () => {
                    const newStarred = !currentStarred
                    await starHistoryItem(currentHistoryId, newStarred)
                    const item = history.find(h => h.id === currentHistoryId)
                    if (item) {
                      if (newStarred) {
                        await addToTripDeck({ ...item, starred: true })
                        awardEvent('trip-deck-add', {}).catch(() => { /* never block */ })
                      } else {
                        await removeFromTripDeck(currentHistoryId)
                      }
                    }
                    setHistory(await getHistory('local'))
                  }}
                  aria-label="Star this phrase"
                >
                  {currentStarred ? '★' : '☆'}
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="placeholder">
            翻訳がここに表示されます<br />
            <span style={{ fontSize: 13, opacity: 0.6 }}>Translation will appear here</span>
          </p>
        )}
      </div>

      {/* Phrasebook */}
      <button className="phrasebook-chip" onClick={() => setPhrasebookOpen(true)}>
        <NavIco name="learn" size={16} /> Phrasebook
      </button>
      {caching && (
        <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }} aria-live="polite">
          Caching phrases for offline… {cachedCount}/{phraseTotal}
        </div>
      )}

      {/* Error */}
      {error && <div className="error-msg">{error}</div>}

      {/* Input */}
      <div className="input-area">
        <textarea
          ref={inputRef}
          className="text-input"
          placeholder="Type or paste English..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={loading}
        />

        <div className="button-row">
          <button
            className="jn-btn jn-btn--sky"
            style={{ flex: 1, opacity: loading || !input.trim() ? 0.45 : 1 }}
            onClick={handleTranslate}
            disabled={loading || !input.trim()}
          >
            {loading ? '…' : 'Translate & Speak'}
          </button>
          <button
            className={`btn-icon ${listening ? 'listening' : ''}`}
            onClick={handleDictate}
            aria-label={listening ? 'Stop dictation' : 'Dictate in English'}
            title={listening ? 'Tap to stop' : 'Tap to dictate'}
          >
            <NavIco name="mic" size={22} />
          </button>
        </div>

        {/* Options */}
        <div className="options-row">
          <div className="voice-selector">
            <label htmlFor="voice">Voice:</label>
            <select
              id="voice"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            >
              {VOICES.map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Auto-play</span>
            <div
              className={`toggle ${autoPlay ? 'active' : ''}`}
              onClick={() => setAutoPlay(!autoPlay)}
              role="switch"
              aria-checked={autoPlay}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setAutoPlay(!autoPlay) }}
            />
          </div>
        </div>
      </div>

      {/* History */}
      <div style={{ width: '100%' }}>
        <button className="history-toggle" onClick={() => setHistoryOpen(o => !o)}>
          {historyOpen ? '▾' : '▸'} Recent ({history.length})
        </button>
        {historyOpen && (
          <div className="history-list">
            {history.slice(0, 10).map(item => (
              <div key={item.id} className="history-row">
                <div className="history-row-text">
                  <div className="ja" lang="ja">{item.japanese}</div>
                  <div className="rm">{item.romaji}</div>
                </div>
                <button className="replay-btn" onClick={() => {
                  speak(item.japanese, { voice: item.voice || 'ja-JP-NanamiNeural' })
                }}>▶</button>
                <button className={`star-btn ${item.starred ? 'starred' : ''}`}
                  onClick={async () => {
                    const newStarred = !item.starred
                    await starHistoryItem(item.id, newStarred)
                    if (newStarred) {
                      await addToTripDeck({ ...item, starred: true })
                      awardEvent('trip-deck-add', {}).catch(() => { /* never block */ })
                    } else {
                      await removeFromTripDeck(item.id)
                    }
                    setHistory(await getHistory('local'))
                  }}>
                  {item.starred ? '★' : '☆'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="footer">
        Built for our trip to Japan ✈️
      </footer>

      {/* Show-card overlay */}
      {showCard && (
        <div className="show-card-overlay" onClick={() => setShowCard(false)}>
          <div className="show-card-content" onClick={e => e.stopPropagation()}>
            <div className="show-card-ja" lang="ja">{japanese}</div>
            {romaji && <div className="show-card-romaji">{romaji}</div>}
            <button
              className={`show-card-play ${speaking ? 'playing' : ''} ${cloudReady ? '' : 'browser-audio'}`}
              onClick={handlePlay}
              title={browserHint}
              aria-label="Play"
            >{speaking ? '◉' : '▶'}</button>
            <button className="show-card-close" onClick={() => setShowCard(false)}>✕ tap to close</button>
          </div>
        </div>
      )}

      {/* Phrasebook modal */}
      {phrasebookOpen && (
        <div className="phrasebook-overlay" onClick={() => setPhrasebookOpen(false)}>
          <div className="phrasebook-modal" onClick={e => e.stopPropagation()}>
            <div className="phrasebook-header">
              <h2>Survival Phrases</h2>
              <button className="phrasebook-close" onClick={() => setPhrasebookOpen(false)}>✕</button>
            </div>
            {caching && (
              <div style={{ fontSize: 12, opacity: 0.55, padding: '0 16px 8px' }} aria-live="polite">
                Caching phrases for offline… {cachedCount}/{phraseTotal}
              </div>
            )}
            <div className="phrasebook-list">
              {PHRASEBOOK.map(phrase => (
                <div key={phrase.id} className="phrasebook-row" onClick={() => handlePhrasebookTap(phrase)}>
                  <div className="phrasebook-ja" lang="ja">{phrase.ja}</div>
                  <div className="phrasebook-en">{phrase.en}</div>
                  <div className="phrasebook-rm">{phrase.romaji}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
