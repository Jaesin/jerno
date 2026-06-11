import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { translateAndSpeak, tts } from '../api.js'
import { addToHistory, starHistoryItem, getHistory, addToTripDeck, removeFromTripDeck } from '../data/store.js'
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
  const [audioData, setAudioData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
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
  const audioRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)

  // Persist preferences
  useEffect(() => { localStorage.setItem('jerno-autoplay', autoPlay) }, [autoPlay])
  useEffect(() => { localStorage.setItem('jerno-voice', voice) }, [voice])

  // Load translation history on mount
  useEffect(() => { getHistory('local').then(setHistory) }, [])

  // Play audio helper
  // Track last blob URL so we can revoke it
  const lastBlobUrlRef = useRef(null)

  const playAudio = useCallback((audioData) => {
    if (!audioData) return
    try {
      let url
      // If the data has a URL (cached), use it directly
      if (audioData.url) {
        url = audioData.url
      } else if (audioData.base64) {
        const binary = atob(audioData.base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'audio/mp3' })
        url = URL.createObjectURL(blob)
      } else {
        return
      }

      // Revoke previous blob URL
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current)
        lastBlobUrlRef.current = null
      }

      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
      const audio = new Audio(url)
      // Track blob URLs for later revocation
      if (!url.startsWith('http')) {
        lastBlobUrlRef.current = url
      }
      audioRef.current = audio
      audio.onended = () => {
        setPlaying(false)
      }
      audio.onplay = () => setPlaying(true)
      audio.onerror = () => {
        setPlaying(false)
      }
      audio.play().catch(() => {
        setPlaying(false)
      })
    } catch {
      setPlaying(false)
    }
  }, [])

  // Handle translate + speak
  const handleTranslate = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setLoading(true)
    setError('')
    setJapanese('')
    setRomaji('')
    setAudioData(null)
    setCurrentHistoryId(null)
    try {
      const result = await translateAndSpeak(text, voice)
      setJapanese(result.japanese)
      setRomaji(result.romaji || '')
      const audio = result.audio
      if (audio && (audio.base64 || audio.url)) {
        setAudioData(audio)
        if (autoPlay) playAudio(audio)
      }
      const saved = await addToHistory({ uid: 'local', en: text, japanese: result.japanese, reading: result.reading || '', romaji: result.romaji || '', segments: result.segments || [], voice })
      setCurrentHistoryId(saved.id)
      setHistory(await getHistory('local'))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [input, voice, autoPlay, playAudio])

  // Handle Enter key
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleTranslate()
    }
  }

  // Replay audio
  const handlePlay = useCallback(() => {
    if (audioData) playAudio(audioData)
  }, [audioData, playAudio])

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
      // Auto-translate after dictation
      setLoading(true)
      setError('')
      setJapanese('')
      setRomaji('')
      setAudioData(null)
      translateAndSpeak(transcript, voice)
        .then(result => {
          setJapanese(result.japanese)
          setRomaji(result.romaji || '')
          const audio = result.audio
          if (audio && (audio.base64 || audio.url)) {
            setAudioData(audio)
            if (autoPlay) playAudio(audio)
          }
        })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false))
    }

    recognition.start()
  }, [listening, voice, autoPlay, playAudio])

  const currentStarred = !!history.find(h => h.id === currentHistoryId)?.starred

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
                className={`play-btn ${playing ? 'playing' : ''}`}
                onClick={handlePlay}
                aria-label="Play Japanese pronunciation"
              >
                {playing ? '◉' : '▶'}
              </button>
              {currentHistoryId && (
                <button
                  className={`star-btn ${currentStarred ? 'starred' : ''}`}
                  onClick={async () => {
                    const newStarred = !currentStarred
                    await starHistoryItem(currentHistoryId, newStarred)
                    const item = history.find(h => h.id === currentHistoryId)
                    if (item) {
                      if (newStarred) await addToTripDeck({ ...item, starred: true })
                      else await removeFromTripDeck(currentHistoryId)
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
                  tts(item.japanese, item.voice || 'ja-JP-NanamiNeural').then(r => {
                    if (r.audio) playAudio(r.audio)
                  }).catch(() => {})
                }}>▶</button>
                <button className={`star-btn ${item.starred ? 'starred' : ''}`}
                  onClick={async () => {
                    const newStarred = !item.starred
                    await starHistoryItem(item.id, newStarred)
                    if (newStarred) await addToTripDeck({ ...item, starred: true })
                    else await removeFromTripDeck(item.id)
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
              className={`show-card-play ${playing ? 'playing' : ''}`}
              onClick={handlePlay}
              aria-label="Play"
            >{playing ? '◉' : '▶'}</button>
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
            <div className="phrasebook-list">
              {PHRASEBOOK.map(phrase => (
                <div key={phrase.id} className="phrasebook-row" onClick={() => {
                  setInput(phrase.en)
                  setPhrasebookOpen(false)
                }}>
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
