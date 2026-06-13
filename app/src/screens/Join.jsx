import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { Inu } from '../design/primitives.jsx'
import { Button } from '../design/ui.jsx'
import { saveProfile } from '../data/store.js'
import { db, ensureSignedIn } from '../firebase.js'
import { useMember } from '../auth/useMember.js'

// Per-member invite flow (ported from japan-2026, Firestore-backed). The link is
//   https://<host>/#/join?key=<TOKEN>[&name=<hint>]
// After silent anonymous sign-in we READ the invite doc (invites are publicly
// readable — the token is the capability). The invite doc decides the flow:
//  - Device invite (memberName present): no name form — this device joins
//    automatically as that person. The ?name= param is display-only; the
//    stored name comes from the invite, preventing URL tampering.
//  - User invite (no memberName): show the name form (1-20 chars); ?name=
//    merely pre-fills it as a hint.
// States: loading → link-dead | device-joining → done | form → creating → done
//       | no-key

const GOALS = [
  { id: 'chill',   label: 'Chill',   sub: '5 min/day' },
  { id: 'regular', label: 'Regular', sub: '10 min/day' },
  { id: 'serious', label: 'Serious', sub: '20 min/day' },
]

function paramsFromHash() {
  const hash = window.location.hash || ''
  const params = new URLSearchParams(hash.split('?')[1] || '')
  return {
    // ?token= is the old shared-link param — keep old links working.
    key: params.get('key') || params.get('token') || '',
    nameHint: params.get('name') || '',
  }
}

function MascotNote({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s4)', textAlign: 'center' }}>
      <Inu size={72} />
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--muted)', lineHeight: 1.5 }}>{children}</p>
    </div>
  )
}

export default function Join() {
  const navigate = useNavigate()
  const [{ key, nameHint }] = useState(paramsFromHash)
  const { status, member, join, loading } = useMember()

  const [invite, setInvite] = useState(undefined) // undefined = not read yet
  const [linkDead, setLinkDead] = useState(false)
  const [name, setName] = useState(nameHint) // ?name= pre-fills as a hint only
  const [goal, setGoal] = useState(() => localStorage.getItem('jerno-daily-goal') || 'regular')
  const [submitting, setSubmitting] = useState(false)
  const [fieldError, setFieldError] = useState(null)
  const [autoErr, setAutoErr] = useState(null) // device-invite auto-join failure
  const [retryTick, setRetryTick] = useState(0)
  const autoJoined = useRef(false)
  const finished = useRef(false)

  // Silent anonymous sign-in, then read the invite doc to learn whether this
  // is a device invite (memberName present).
  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    ;(async () => {
      try {
        await ensureSignedIn()
        const snap = await getDoc(doc(db, 'invites', key))
        if (cancelled) return
        if (!snap.exists()) setLinkDead(true)
        else setInvite(snap.data())
      } catch {
        if (!cancelled) setLinkDead(true) // unreadable invite ≈ dead link
      }
    })()
    return () => { cancelled = true }
  }, [key])

  // Device invite — registration runs automatically, no name form.
  const inviteMemberName = invite?.memberName
  useEffect(() => {
    if (!inviteMemberName || autoJoined.current) return
    if (loading || status === 'member') return
    autoJoined.current = true
    join(key, inviteMemberName).catch((err) => {
      if (err?.code === 'permission-denied') setLinkDead(true)
      else setAutoErr(err?.message || 'Something went wrong — try again.')
    })
  }, [inviteMemberName, loading, status, key, join, retryTick])

  // status flips to 'member' (form join, device auto-join, or re-tapping a
  // link on an already-joined device) → persist the local profile and go in.
  useEffect(() => {
    if (status !== 'member' || finished.current) return
    finished.current = true
    const joinedName = member?.name || name.trim() || 'Friend'
    localStorage.setItem('jerno-daily-goal', goal)
    Promise.resolve(
      saveProfile({ name: joinedName, dailyGoal: goal, joinedAt: Date.now() }),
    ).catch(() => {}).finally(() => navigate('/today', { replace: true }))
  }, [status, member, name, goal, navigate])

  async function submit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 20 || submitting) return
    setFieldError(null)
    setSubmitting(true)
    try {
      await join(key, trimmed) // status flips to 'member' → finish effect runs
    } catch (err) {
      if (err?.code === 'permission-denied') setLinkDead(true)
      else setFieldError(err?.message || 'Something went wrong — try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const wrap = {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--s5)',
  }
  const inner = { width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }

  if (status === 'member') {
    return (
      <div style={wrap}>
        <div style={inner}>
          <MascotNote>Welcome! Taking you in…</MascotNote>
        </div>
      </div>
    )
  }

  if (!key) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <MascotNote>You need an invite link to join. Ask a family member to share one from their Settings.</MascotNote>
        </div>
      </div>
    )
  }

  if (linkDead) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <MascotNote>This link isn&apos;t active. Invites are personal and can be retired — ask for a fresh one.</MascotNote>
        </div>
      </div>
    )
  }

  if (loading || invite === undefined) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <MascotNote>Checking your invite…</MascotNote>
        </div>
      </div>
    )
  }

  if (inviteMemberName) {
    // Device invite — joining runs automatically.
    return (
      <div style={wrap}>
        <div style={inner}>
          <MascotNote>
            {autoErr || <>Welcome back, <b>{inviteMemberName}</b> — adding this device…</>}
          </MascotNote>
          {autoErr && (
            <Button
              block
              style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
              onClick={() => {
                setAutoErr(null)
                autoJoined.current = false
                setRetryTick(t => t + 1) // re-run the auto-join effect
              }}
            >
              Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  // User invite: pick a name + daily goal.
  return (
    <div style={wrap}>
      <form style={inner} onSubmit={submit}>
        <h1 className="jn-display" style={{ margin: 0, fontSize: 30, textAlign: 'center', color: 'var(--text)' }}>
          Welcome to Jerno 🎌
        </h1>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <span className="jn-eyebrow">What should we call you?</span>
          <input
            className="text-input"
            type="text"
            value={name}
            maxLength={20}
            placeholder="Your name"
            autoFocus
            onChange={e => { setName(e.target.value); setFieldError(null) }}
            style={{ minHeight: 'var(--tap)' }}
          />
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <span className="jn-eyebrow">Daily goal</span>
          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            {GOALS.map(g => {
              const selected = goal === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  className="jn-card"
                  onClick={() => setGoal(g.id)}
                  aria-pressed={selected}
                  style={{
                    flex: 1, padding: 'var(--s3) var(--s2)', cursor: 'pointer', font: 'inherit',
                    textAlign: 'center',
                    border: selected ? '1.5px solid var(--primary)' : '1px solid var(--line)',
                    background: selected ? 'var(--primary-soft)' : 'var(--surface)',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{g.label}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', marginTop: 2 }}>{g.sub}</div>
                </button>
              )
            })}
          </div>
        </div>

        {fieldError && (
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--red)' }}>{fieldError}</span>
        )}

        <Button
          type="submit"
          block
          disabled={!name.trim() || submitting}
          style={{
            background: 'var(--primary)', color: 'var(--on-primary)',
            opacity: !name.trim() || submitting ? 0.6 : 1,
          }}
        >
          {submitting ? 'Joining…' : 'Join the family'}
        </Button>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--s2)' }}>
          <Inu size={56} />
        </div>
      </form>
    </div>
  )
}
