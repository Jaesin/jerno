/* Family.jsx — the family view (Spec 24), local-first edition.
   Shows this device's own stats in the family layout, with ghost slots for
   the rest of the family. Real multi-member data needs Spec 01 auth + sync;
   until then the "family flame" is lit by the only member we know about. */

import { useState, useEffect } from 'react'
import { getProgressData, buildQuests, rankFor } from '../data/progress.js'
import { getProfile, getSRSMap } from '../data/store.js'
import { Flame, Rank } from '../design/primitives.jsx'
import { Card, Chip, StreakPill, Quest } from '../design/ui.jsx'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// ISO date string for `back` days before today (back = 0 → today).
function isoDaysAgo(back) {
  const d = new Date()
  d.setDate(d.getDate() - back)
  return d.toISOString().slice(0, 10)
}

/* Last-7-days activity row. We don't keep per-day history yet, so we
   approximate from the streak window: lastActive and the `current` days
   leading up to it count as practiced. */
function StreakWeekRow({ streak }) {
  const days = []
  for (let back = 6; back >= 0; back--) {
    const iso = isoDaysAgo(back)
    let active = false
    if (streak?.lastActive) {
      const last = new Date(streak.lastActive + 'T12:00:00Z')
      const day = new Date(iso + 'T12:00:00Z')
      const diff = Math.round((last - day) / 86400000) // days before lastActive
      active = diff >= 0 && diff < Math.max(streak.current || 0, streak.lastActive === iso ? 1 : 0)
    }
    days.push({ iso, active, isToday: back === 0 })
  }
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
      {days.map(d => {
        const dow = DOW[new Date(d.iso + 'T12:00:00Z').getUTCDay()]
        return (
          <div key={d.iso} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 999,
              background: d.active ? 'var(--green)' : 'var(--sunk)',
              border: d.isToday ? '2px solid var(--line-2)' : '2px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {d.active && (
                <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--on-green)' }} />
              )}
            </span>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, color: d.isToday ? 'var(--text)' : 'var(--faint)' }}>
              {dow}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* Ghost slot for a not-yet-synced family member. */
function GhostMemberCard({ onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      width: '100%', minHeight: 56, cursor: 'pointer', font: 'inherit',
      background: 'var(--surface)', border: '1px dashed var(--line-2)',
      borderRadius: 'var(--r3)', color: 'var(--muted)', fontWeight: 700, fontSize: 13.5,
    }}>
      ＋ Invite
    </button>
  )
}

/* "Sync coming soon" sheet shown when tapping a ghost slot. */
function InviteSheet({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'var(--scrim)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: 'var(--surface)',
        borderRadius: 'var(--r4) var(--r4) 0 0', padding: '24px 22px 30px',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div className="jn-eyebrow" style={{ marginBottom: 8 }}>Invite family</div>
        <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 19, color: 'var(--text)' }}>
          Family sync is coming soon
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', fontWeight: 600, lineHeight: 1.5, margin: '8px 0 18px' }}>
          Share the app link to get started. Once family accounts land, everyone&rsquo;s
          progress will show up here and light the flame together.
        </p>
        <button type="button" className="jn-btn jn-btn--ghost jn-btn--block" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function StatChip({ label, value, color, soft }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, background: soft, borderRadius: 'var(--r2)',
      padding: '10px 8px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 20, lineHeight: 1, color }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 5 }}>
        {label}
      </div>
    </div>
  )
}

export default function Family() {
  const [prog, setProg] = useState(null)
  const [profile, setProfile] = useState({})
  const [blossomed, setBlossomed] = useState(0)
  const [showInvite, setShowInvite] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([getProgressData(), getProfile(), getSRSMap()])
      .then(([p, prof, srs]) => {
        if (!alive) return
        setProg(p)
        setProfile(prof || {})
        setBlossomed([...srs.values()].filter(s => s.stage === 'blossom').length)
      })
      .catch(() => { if (alive) setProg(null) })
    return () => { alive = false }
  }, [])

  if (prog === null) {
    return (
      <div className="jn jn-screen" style={{ minHeight: 'calc(100vh - 72px)', height: 'auto', overflow: 'visible' }}>
        <div className="learn-loading"><div className="spinner" /></div>
      </div>
    )
  }

  const today = todayISO()
  const flameLit = prog.streak?.lastActive === today
  const rank = rankFor(prog.xp ?? 0)
  const memberName = prog.name || profile.name || 'You'

  // This-week stats. We only track weekly XP today; sessions aren't logged
  // per-day yet, so that one stays a 0 placeholder until history lands.
  const week = prog.weekXp || {}
  const weekXp = week.xp || 0
  const sessions = 0

  // Quests — same source as the Today view (shared family quests)
  const q = prog.quests?.date === today ? prog.quests : buildQuests(today, prog)
  const quests = [
    { key: 'q1', icon: 'cards',  label: q.q1label || 'Clear your review pile',  done: !!q.q1 },
    { key: 'q2', icon: 'bolt',   label: q.q2label || 'Practice today',          done: !!q.q2 },
    { key: 'q3', icon: 'family', label: q.q3label || 'Help a family member',    done: !!q.q3 },
  ]

  return (
    <div className="jn jn-screen" style={{ minHeight: 'calc(100vh - 72px)', height: 'auto', overflow: 'visible' }}>
      <div className="jn-pad" style={{ paddingTop: 18, paddingBottom: 24, display: 'flex', flexDirection: 'column',
        gap: 16, flex: 1, width: '100%', maxWidth: 480, margin: '0 auto' }}>

        {/* 1 · header */}
        <div>
          <div className="jn-eyebrow">Family</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 4 }}>
            <span className="jn-jp" style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 30, lineHeight: 1 }}>家族</span>
            <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 700 }}>Family</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, marginTop: 5 }}>
            Learning together for Japan 2026
          </div>
        </div>

        {/* 2 · family flame */}
        <Card style={{
          padding: '16px 18px',
          border: '1px solid color-mix(in srgb, var(--primary) 35%, var(--line))',
          background: 'color-mix(in srgb, var(--primary-soft) 55%, var(--surface))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Flame size={30} on={flameLit} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>Family Flame</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2,
                color: flameLit ? 'var(--red)' : 'var(--muted)' }}>
                {flameLit ? 'Everyone practiced today! 🔥' : 'Practice today to light the family flame'}
              </div>
            </div>
          </div>
          <StreakWeekRow streak={prog.streak} />
        </Card>

        {/* 3 · members */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="jn-eyebrow">Members</div>
          <Card style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--text)', marginBottom: 6 }}>{memberName}</div>
              <Rank jp={rank.name} en={rank.en} compact />
            </div>
            <Chip style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
              {prog.xp ?? 0} XP
            </Chip>
            <StreakPill count={prog.streak?.current ?? 0} />
          </Card>
          <GhostMemberCard onClick={() => setShowInvite(true)} />
          <GhostMemberCard onClick={() => setShowInvite(true)} />
        </div>

        {/* 4 · this week */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="jn-eyebrow">This week</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatChip label="XP this week" value={weekXp} color="var(--gold)" soft="var(--gold-soft)" />
            <StatChip label="Sessions" value={sessions} color="var(--green)" soft="var(--green-soft)" />
            <StatChip label="Blossomed" value={blossomed} color="var(--pink)" soft="var(--pink-soft)" />
          </div>
        </div>

        {/* 5 · shared quests — same data the Today view shows */}
        <Card style={{ padding: '15px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
            <span className="jn-eyebrow">Today&rsquo;s quests · shared</span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--green)' }}>
              {quests.filter(x => x.done).length} / {quests.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {quests.map(x => <Quest key={x.key} icon={x.icon} label={x.label} done={x.done} />)}
          </div>
        </Card>
      </div>

      {showInvite && <InviteSheet onClose={() => setShowInvite(false)} />}
    </div>
  )
}
