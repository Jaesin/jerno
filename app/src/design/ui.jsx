/* ui.jsx — Jerno UI kit: reusable pieces built on the components.css classes +
   semantic tokens. Theme-agnostic (every color is a var). ESM port of the
   design handoff's components/ui/ui.jsx.

   Contents: Button · Chip · Card · Track · StreakPill · PileRing · Quest ·
   DoorTile · TripDeckRow */

import { Flame, NavIco, Plant } from './primitives.jsx'

/* ---- Button — wraps .jn-btn ----------------------------------------------- */
export function Button({ variant = 'green', block, children, style, ...rest }) {
  const cls = 'jn-btn jn-btn--' + variant + (block ? ' jn-btn--block' : '')
  return <button className={cls} style={style} {...rest}>{children}</button>
}

/* ---- Chip — wraps .jn-chip ------------------------------------------------ */
export function Chip({ children, style, ...rest }) {
  return <span className="jn-chip" style={style} {...rest}>{children}</span>
}

/* ---- Card — wraps .jn-card ------------------------------------------------ */
export function Card({ children, style, flat, ...rest }) {
  return <div className={flat ? 'jn-card-flat' : 'jn-card'} style={style} {...rest}>{children}</div>
}

/* ---- Track — progress bar (.jn-track) ------------------------------------- */
export function Track({ frac = 0, color = 'var(--green)' }) {
  return <div className="jn-track"><i style={{ width: Math.round(frac * 100) + '%', background: color }} /></div>
}

/* ---- StreakPill — flame + day count -------------------------------------- */
export function StreakPill({ count }) {
  const n = count != null ? count : 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 11px 0 8px',
      borderRadius: 999, background: 'var(--red-soft)', color: 'var(--red)', fontWeight: 800, fontSize: 14 }}>
      <Flame size={17} /> {n}
    </span>
  )
}

/* ---- PileRing — the session hero's count ring ----------------------------- *
   `count` in the centre, `frac` (0–1) of the ring filled. Colors come from the
   hero card it sits in (stroke = on-fill), so pass `ink` accordingly. */
export function PileRing({ count, frac = 0, size = 84, ink = 'var(--on-primary)' }) {
  const r = size * 0.405, c = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: size * 0.36, lineHeight: 1, color: ink }}>{count}</span>
      </div>
    </div>
  )
}

/* ---- Quest — a daily-quest checklist row --------------------------------- */
export function Quest({ icon, label, done, color = 'var(--green)' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <span style={{ flex: '0 0 auto', width: 26, height: 26, borderRadius: 999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? color : 'var(--sunk)', color: done ? 'var(--on-green)' : 'var(--faint)' }}>
        {done ? <NavIco name="check" size={16} /> : <NavIco name={icon} size={15} />}
      </span>
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600,
        color: done ? 'var(--muted)' : 'var(--text)', textDecoration: done ? 'line-through' : 'none' }}>{label}</span>
    </div>
  )
}

/* ---- DoorTile — a secondary entry point ---------------------------------- */
export function DoorTile({ color, soft, icon, title, sub, onClick }) {
  return (
    <button onClick={onClick} style={{ flex: 1, textAlign: 'left', cursor: 'pointer', font: 'inherit',
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 20, padding: '14px 14px 13px' }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, background: soft, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <NavIco name={icon} size={22} />
      </span>
      <div style={{ fontWeight: 800, fontSize: 15, marginTop: 11, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>{sub}</div>
    </button>
  )
}

/* ---- TripDeckRow — the identity-loop "whisper" --------------------------- */
export function TripDeckRow({ deck, blooming, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '2px 4px',
      background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
      <Plant stage={3} size={26} />
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>
        <b style={{ color: 'var(--text)' }}>{deck} phrases</b> in your trip deck{blooming > 0 ? <> · {blooming} about to blossom</> : null}
      </span>
      <span style={{ color: 'var(--faint)' }}><NavIco name="arrowR" size={18} /></span>
    </button>
  )
}
