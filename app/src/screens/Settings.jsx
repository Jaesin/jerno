import { useState, useEffect } from 'react'
import { getTheme, setTheme } from '../design/theme.js'
import { getProgressData, rankFor } from '../data/progress.js'
import { Rank } from '../design/primitives.jsx'
import { StreakPill, Chip } from '../design/ui.jsx'

const VOICES = [
  { id: 'ja-JP-NanamiNeural', label: 'Nanami (Female)' },
  { id: 'ja-JP-KeitaNeural',  label: 'Keita (Male)' },
]

const THEME_OPTIONS = [
  ['auto',  'Match device'],
  ['light', 'Daylight Garden'],
  ['dark',  'Lantern Night'],
  ['hero',  'Crimson Hour'],
]

export default function Settings() {
  const [voice, setVoice]     = useState(() => localStorage.getItem('jerno-voice') || 'ja-JP-NanamiNeural')
  const [rate, setRate]       = useState(() => localStorage.getItem('jerno-speech-rate') || '1.0')
  const [autoPlay, setAutoPlay] = useState(() => (localStorage.getItem('jerno-autoplay') || 'true') === 'true')
  const [goal, setGoal]       = useState(() => localStorage.getItem('jerno-daily-goal') || 'regular')
  const [kidMode, setKidMode] = useState(() => localStorage.getItem('jerno-kid-mode') === 'true')
  const [theme, setThemeChoice] = useState(() => getTheme())
  const [prog, setProg] = useState(null)

  useEffect(() => {
    getProgressData().then(setProg).catch(() => { /* identity header is best-effort */ })
  }, [])

  function pickTheme(val) {
    setTheme(val)
    setThemeChoice(val)
  }

  function set(key, val, setter) { localStorage.setItem(key, val); setter(val) }

  const rank = rankFor(prog?.xp ?? 0)

  return (
    <div className="settings-screen">
      {/* identity header — who you are on the torii path */}
      <div className="you-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="jn-eyebrow" style={{ marginBottom: 7 }}>You</div>
          <Rank jp={rank.name} en={rank.en} />
        </div>
        <Chip style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
          {prog?.xp ?? 0} XP
        </Chip>
        <StreakPill count={prog?.streak?.current ?? 0} />
      </div>

      <div className="settings-section">
        <h2>Appearance</h2>
        {THEME_OPTIONS.map(([val, lbl]) => (
          <div key={val} className="settings-row" style={{ cursor: 'pointer' }} onClick={() => pickTheme(val)}>
            <label style={{ cursor: 'pointer' }}>{lbl}</label>
            <span className={'settings-radio' + (theme === val ? ' on' : '')}>{theme === val ? '●' : '○'}</span>
          </div>
        ))}
      </div>

      <div className="settings-section">
        <h2>Speech</h2>
        <div className="settings-row">
          <label>Voice</label>
          <select value={voice} onChange={e => set('jerno-voice', e.target.value, setVoice)}>
            {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <label>Speed</label>
          <select value={rate} onChange={e => set('jerno-speech-rate', e.target.value, setRate)}>
            <option value="0.75">Slow (0.75×)</option>
            <option value="1.0">Normal (1.0×)</option>
            <option value="1.25">Fast (1.25×)</option>
          </select>
        </div>
        <div className="settings-row">
          <label>Auto-play audio</label>
          <div className={`toggle ${autoPlay ? 'active' : ''}`}
            onClick={() => set('jerno-autoplay', String(!autoPlay), v => setAutoPlay(v === 'true'))}
            role="switch" aria-checked={autoPlay} tabIndex={0} style={{ cursor: 'pointer' }} />
        </div>
      </div>

      <div className="settings-section">
        <h2>Learning</h2>
        {[['chill','Chill (5 min/day)'],['regular','Regular (10 min/day)'],['serious','Serious (20 min/day)']].map(([val, lbl]) => (
          <div key={val} className="settings-row" style={{ cursor: 'pointer' }} onClick={() => set('jerno-daily-goal', val, setGoal)}>
            <label style={{ cursor: 'pointer' }}>{lbl}</label>
            <span className={'settings-radio' + (goal === val ? ' on' : '')}>{goal === val ? '●' : '○'}</span>
          </div>
        ))}
      </div>

      <div className="settings-section">
        <h2>Profiles</h2>
        <div className="settings-row">
          <div>
            <label style={{ display: 'block' }}>Kid Mode</label>
            <span className="settings-hint">3 choices, no timers, bigger tiles</span>
          </div>
          <div
            className={`toggle ${kidMode ? 'active' : ''}`}
            onClick={() => set('jerno-kid-mode', String(!kidMode), v => setKidMode(v === 'true'))}
            role="switch" aria-checked={kidMode} tabIndex={0} style={{ cursor: 'pointer' }}
          />
        </div>
      </div>

      <div className="settings-section">
        <h2>About</h2>
        <div className="settings-row"><label>Version</label><span className="settings-hint">0.2.0</span></div>
      </div>
    </div>
  )
}
