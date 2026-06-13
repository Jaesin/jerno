import { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, deleteDoc, setDoc } from 'firebase/firestore'
import { getTheme, setTheme } from '../design/theme.js'
import { getProgressData, rankFor, BADGES } from '../data/progress.js'
import { Rank } from '../design/primitives.jsx'
import { StreakPill, Chip, Button } from '../design/ui.jsx'
import { db } from '../firebase.js'
import { useMember } from '../auth/useMember.js'

/* ---- Family (invite/revoke) helpers --------------------------------------- */

// Firestore Timestamp | Date | millis → "Jun 12, 2026" ("—" while the server
// timestamp is still pending in the local cache).
function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// 28-char [A-Za-z0-9] capability token via crypto.getRandomValues.
// Rejection-sampled (bytes ≥ 248 discarded) so all 62 chars are equally likely.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function mintToken() {
  const out = []
  while (out.length < 28) {
    const buf = new Uint8Array(40)
    crypto.getRandomValues(buf)
    for (const b of buf) {
      if (out.length < 28 && b < 248) out.push(ALPHABET[b % 62])
    }
  }
  return out.join('')
}

// Join URL derived from the current location — works on localhost and prod.
// Device invites carry the person's name as a display hint only (the stored
// name comes from the invite itself, never the URL).
const joinUrl = (token, name) =>
  `${location.origin}${location.pathname}#/join?key=${token}` +
  (name ? `&name=${encodeURIComponent(name)}` : '')

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Bottom sheet for minting invites. kind 'device' → { label, memberName }
// (auto-joins as that person); kind 'invite' → { label } only (recipient
// picks their own name). The label is optional in both.
function InviteSheet({ kind, memberName, onClose, onToast }) {
  const device = kind === 'device'
  const [label, setLabel] = useState('')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null) // { token, label }

  async function create() {
    if (saving) return
    setSaving(true)
    setErr(null)
    try {
      const trimmed = label.trim() || (device ? 'New device' : 'Invite link')
      const token = mintToken()
      await setDoc(doc(db, 'invites', token),
        device ? { label: trimmed, memberName } : { label: trimmed })
      setDone({ token, label: trimmed })
    } catch {
      setErr("Couldn't create the link — check your connection.")
    } finally {
      setSaving(false)
    }
  }

  const url = done ? joinUrl(done.token, device ? memberName : null) : null

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 480, background: 'var(--surface)',
          borderRadius: '20px 20px 0 0', padding: 'var(--s5) var(--s4)',
          paddingBottom: 'calc(var(--s5) + env(safe-area-inset-bottom, 0px))',
          display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>
            {done ? 'Link ready' : device ? 'Add a device' : 'Invite someone'}
          </h3>
          <button onClick={onClose} aria-label="Close"
            style={{ font: 'inherit', fontSize: 14, fontWeight: 700, color: 'var(--muted)',
              background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            ✕
          </button>
        </div>

        {done ? (
          <>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--muted)', lineHeight: 1.5 }}>
              {device
                ? <>Open this on your other device — it joins as <b style={{ color: 'var(--text)' }}>{memberName}</b>, no questions asked.</>
                : <>Send this to <b style={{ color: 'var(--text)' }}>{done.label}</b> — they pick their own name when they open it.</>}
            </p>
            <div style={{ padding: 'var(--s3)', background: 'var(--sunk)', borderRadius: 12,
              fontSize: 12, color: 'var(--text)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {url}
            </div>
            <Button block style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
              onClick={async () => onToast((await copyText(url)) ? 'Link copied' : "Couldn't copy — copy it manually")}>
              Copy link
            </Button>
            <Button block variant="ghost" onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              <span className="jn-eyebrow">Label (optional)</span>
              <input
                className="text-input"
                type="text"
                value={label}
                autoFocus
                placeholder={device ? 'New device — e.g. "iPad"' : 'Who is this for — e.g. "Mai"'}
                onChange={e => { setLabel(e.target.value); setErr(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create() } }}
                style={{ minHeight: 'var(--tap)' }}
              />
            </label>
            {err && <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--red)' }}>{err}</span>}
            <Button block disabled={saving} onClick={create}
              style={{ background: 'var(--primary)', color: 'var(--on-primary)', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Creating…' : 'Create link'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// Members grouped by name, each expanding to its devices (revoke / add
// device), plus the "Invite someone" CTA — japan-2026 spec 04, Firestore-backed.
function FamilySection({ onToast }) {
  const { uid: myUid, member } = useMember()
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(() => new Set()) // expanded person names
  const [sheet, setSheet] = useState(null) // null | { kind: 'invite' | 'device' }

  // Live members list (also clears the error if access recovers).
  useEffect(() => onSnapshot(
    collection(db, 'members'),
    (snap) => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setError(null)
      setLoading(false)
    },
    () => { setError("Couldn't load the family — check your connection."); setLoading(false) },
  ), [])

  // Live invites — labels for the device rows ("revoked link" when deleted).
  useEffect(() => onSnapshot(
    collection(db, 'invites'),
    (snap) => setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    () => {}, // labels are cosmetic; the members list carries its own error
  ), [])

  const inviteById = new Map(invites.map(i => [i.id, i]))
  const deviceLabel = (m) => inviteById.get(m.inviteToken)?.label || 'revoked link'

  // Your name: from your live member doc, else recovered from the members list.
  const myName = member?.name
    || members.find(m => m.id === myUid)?.name
    || null

  // Person identity = members grouped by name; people and their devices both
  // ordered by earliest join.
  const people = []
  const byName = new Map()
  const sorted = [...members].sort(
    (a, b) => (a.joinedAt?.toMillis?.() ?? Infinity) - (b.joinedAt?.toMillis?.() ?? Infinity),
  )
  for (const m of sorted) {
    let person = byName.get(m.name)
    if (!person) {
      person = { name: m.name, devices: [] }
      byName.set(m.name, person)
      people.push(person)
    }
    person.devices.push(m)
  }

  const toggle = (personName) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(personName)) next.delete(personName); else next.add(personName)
    return next
  })

  async function revoke(m) {
    const self = m.id === myUid
    const msg = self
      ? `Careful — this is THE DEVICE YOU'RE USING RIGHT NOW. Revoke it and you (${m.name}) lose access here immediately; you'll need a fresh invite to get back in.`
      : `Revoke ${m.name}'s ${deviceLabel(m)}? It loses access immediately.`
    if (!window.confirm(msg)) return
    try {
      await deleteDoc(doc(db, 'members', m.id))
      onToast('Device revoked')
    } catch {
      onToast("Couldn't revoke — check your connection")
    }
  }

  const revokeBtn = {
    font: 'inherit', fontSize: 12, fontWeight: 800, color: 'var(--red)',
    background: 'var(--red-soft)', border: 'none', borderRadius: 999,
    padding: '6px 12px', cursor: 'pointer', flex: '0 0 auto',
  }

  return (
    <div className="settings-section">
      <h2>Family</h2>

      {loading && (
        <div className="settings-row"><span className="settings-hint">Loading members…</span></div>
      )}
      {error && (
        <div className="settings-row"><span className="settings-hint">{error}</span></div>
      )}
      {!loading && !error && people.length === 0 && (
        <div className="settings-row">
          <span className="settings-hint">No members yet — invite someone below to let the family in.</span>
        </div>
      )}

      {people.map(person => {
        const expanded = open.has(person.name)
        const mine = myName != null && person.name === myName
        const n = person.devices.length
        return (
          <div key={person.name}>
            <div className="settings-row" style={{ cursor: 'pointer' }}
              role="button" tabIndex={0} aria-expanded={expanded}
              onClick={() => toggle(person.name)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(person.name) } }}>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden="true" style={{ display: 'inline-block', fontSize: 11, color: 'var(--faint)',
                  transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▶</span>
                {person.name}{mine ? ' · you' : ''}
              </label>
              <span className="settings-hint">{n} device{n === 1 ? '' : 's'}</span>
            </div>
            {expanded && (
              <>
                {person.devices.map(m => (
                  <div className="settings-row" key={m.id} style={{ paddingLeft: 22 }}>
                    <div style={{ minWidth: 0 }}>
                      <label style={{ display: 'block' }}>
                        {deviceLabel(m)}{m.id === myUid ? ' · this device' : ''}
                      </label>
                      <span className="settings-hint">Joined {fmtDate(m.joinedAt)}</span>
                    </div>
                    <button style={revokeBtn} onClick={() => revoke(m)}>Revoke</button>
                  </div>
                ))}
                {mine && (
                  <div className="settings-row" style={{ cursor: 'pointer', paddingLeft: 22 }}
                    role="button" tabIndex={0}
                    onClick={() => setSheet({ kind: 'device' })}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet({ kind: 'device' }) } }}>
                    <label style={{ cursor: 'pointer', color: 'var(--primary)' }}>+ Add device</label>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
        <Button block style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
          onClick={() => setSheet({ kind: 'invite' })}>
          Invite someone
        </Button>
        {myName && (
          <Button block variant="ghost" onClick={() => setSheet({ kind: 'device' })}>
            Add another device
          </Button>
        )}
      </div>

      {sheet && (
        <InviteSheet kind={sheet.kind} memberName={myName}
          onClose={() => setSheet(null)} onToast={onToast} />
      )}
    </div>
  )
}

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
  const [toast, setToast] = useState(null)

  function showToast(msg) {
    setToast(msg)
    window.clearTimeout(showToast.t)
    showToast.t = window.setTimeout(() => setToast(null), 2400)
  }

  useEffect(() => {
    getProgressData().then(setProg).catch(() => { /* identity header is best-effort */ })
  }, [])

  function pickTheme(val) {
    setTheme(val)
    setThemeChoice(val)
  }

  function set(key, val, setter) { localStorage.setItem(key, val); setter(val) }

  const rank = rankFor(prog?.xp ?? 0)
  const earnedBadges = BADGES.filter(b => prog?.badges?.[b.id])

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

      {/* earned badges — hidden entirely until the first one unlocks */}
      {earnedBadges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 0 14px' }}>
          {earnedBadges.map(b => (
            <Chip key={b.id} title={b.desc}
              style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
              {b.icon} {b.label}
            </Chip>
          ))}
        </div>
      )}

      <FamilySection onToast={showToast} />

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

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 96, transform: 'translateX(-50%)',
          background: 'var(--text)', color: 'var(--bg)', padding: '10px 18px', borderRadius: 999,
          fontSize: 13.5, fontWeight: 700, zIndex: 300, whiteSpace: 'nowrap',
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
