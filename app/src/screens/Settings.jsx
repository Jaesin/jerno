import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const VOICES = [
  { id: 'ja-JP-NanamiNeural', label: 'Nanami (Female)' },
  { id: 'ja-JP-KeitaNeural',  label: 'Keita (Male)' },
]

export default function Settings() {
  const navigate = useNavigate()
  const [voice, setVoice]     = useState(() => localStorage.getItem('jerno-voice') || 'ja-JP-NanamiNeural')
  const [rate, setRate]       = useState(() => localStorage.getItem('jerno-speech-rate') || '1.0')
  const [autoPlay, setAutoPlay] = useState(() => (localStorage.getItem('jerno-autoplay') || 'true') === 'true')
  const [goal, setGoal]       = useState(() => localStorage.getItem('jerno-daily-goal') || 'regular')

  function set(key, val, setter) { localStorage.setItem(key, val); setter(val) }

  return (
    <div className="settings-screen">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 20, cursor: 'pointer' }}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Settings</h1>
      </div>

      <div className="settings-section">
        <h2>Speech</h2>
        <div className="settings-row">
          <label>Voice</label>
          <select value={voice} onChange={e => set('jerno-voice', e.target.value, setVoice)}
            style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 8px' }}>
            {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <label>Speed</label>
          <select value={rate} onChange={e => set('jerno-speech-rate', e.target.value, setRate)}
            style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 8px' }}>
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
            <span style={{ color: goal === val ? 'var(--accent)' : 'var(--text-muted)' }}>{goal === val ? '●' : '○'}</span>
          </div>
        ))}
      </div>

      <div className="settings-section">
        <h2>About</h2>
        <div className="settings-row"><label>Version</label><span style={{ color: 'var(--text-muted)' }}>0.2.0</span></div>
      </div>
    </div>
  )
}
