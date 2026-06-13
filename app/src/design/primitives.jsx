/* primitives.jsx — Jerno motifs, mascot, growth-stage plants, icons.
   ESM port of the design handoff's components/ui/primitives.jsx.
   The Phone/StatusBar reviewer harness was intentionally NOT ported — the app
   body IS the screen. No emoji — the brief's stage plants / torii / mascot are
   drawn as flat geometric SVG so they sit inside the same craft world as the
   trip system. */

/* ---------- Growth-stage plants -------------------------------------------
   🌱 seed → 🌿 sprout → 🎋 bamboo → 🌸 blossom, exercise-agnostic SRS stage.
   stage: 0..3. Drawn flat; stem = green, flower = pink. */
export function Plant({ stage = 0, size = 30, color = 'var(--green)', bloom = 'var(--pink)' }) {
  const s = size
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      {/* soil mound */}
      <path d="M5 27 Q16 23 27 27 L27 29 Q16 31 5 29 Z" fill="currentColor" opacity="0.18" />
      {stage === 0 && (
        <>
          <ellipse cx="16" cy="25" rx="4.6" ry="3" fill={color} opacity="0.5" />
          <path d="M16 25 q0 -3 2.4 -4.4" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="18.8" cy="20.2" r="1.7" fill={color} />
        </>
      )}
      {stage === 1 && (
        <>
          <path d="M16 27 V16" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M16 19 q-6 -1 -7 -6 q5 0 7 5" fill={color} />
          <path d="M16 16 q6 -1.5 7.5 -6.5 q-5.5 0.5 -7.5 6" fill={color} opacity="0.85" />
        </>
      )}
      {stage === 2 && (
        <>
          <path d="M13 28 V8" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M19 28 V12" stroke={color} strokeWidth="2.2" strokeLinecap="round" opacity="0.8" />
          {[20, 15.5, 11].map((y, i) => (
            <line key={i} x1="11.7" y1={y} x2="14.3" y2={y} stroke="var(--bg)" strokeWidth="1.4" />
          ))}
          <path d="M13 12 q7 -1 8.5 -7 q-6 0.5 -8.5 6" fill={color} />
          <path d="M13 17 q-6 -1 -7.5 -6 q5.5 0.5 7.5 5.5" fill={color} opacity="0.85" />
        </>
      )}
      {stage === 3 && (
        <>
          <path d="M16 28 V13" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M16 20 q-6 -1 -7 -6 q5 0 7 5" fill={color} opacity="0.9" />
          <g>
            {[0, 1, 2, 3, 4].map((i) => (
              <ellipse key={i} cx="16" cy="6.4" rx="2.5" ry="4.2" fill={bloom}
                transform={`rotate(${i * 72} 16 11)`} />
            ))}
            <circle cx="16" cy="11" r="2.1" fill="var(--gold)" />
          </g>
        </>
      )}
    </svg>
  )
}
export const STAGE_NAME = ['Seed', 'Sprout', 'Bamboo', 'Blossom']

/* ---------- Torii (rank marker) -------------------------------------------- */
export function Torii({ size = 22, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: 'block' }} aria-hidden="true">
      <path d="M3 5 Q12 2.6 21 5 L21 7.6 Q12 5.4 3 7.6 Z" />
      <rect x="4.2" y="8.8" width="15.6" height="2.2" rx="0.6" />
      <rect x="6" y="7.6" width="2.4" height="13" rx="0.6" />
      <rect x="15.6" y="7.6" width="2.4" height="13" rx="0.6" />
    </svg>
  )
}

/* ---------- Jerno-inu (shiba mascot) --------------------------------------- */
export function Inu({ size = 40 }) {
  return (
    <img src="/inu.svg" width={size} height={size} alt="" aria-hidden="true" style={{ display: 'block', objectFit: 'contain' }} />
  )
}

/* ---------- Streak flame --------------------------------------------------- */
export function Flame({ size = 18, on = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }} aria-hidden="true">
      <path d="M12 2.5 C13 7 17.5 8 17.5 13.5 A5.5 5.5 0 0 1 6.5 13.5 C6.5 10.5 8.5 9.5 8.5 9.5 C8 12 10 12.5 10 12.5 C9.5 9 12 7.5 12 2.5 Z"
        fill={on ? 'var(--red)' : 'var(--faint)'} />
      <path d="M12 16.5 C13.4 16.5 14.4 15.4 14.4 14 C14.4 12 12 10.6 12 10.6 C12 10.6 9.6 12 9.6 14 C9.6 15.4 10.6 16.5 12 16.5 Z"
        fill={on ? 'var(--gold)' : 'var(--bg)'} />
    </svg>
  )
}

/* ---------- Functional icons (rounded geometric strokes) ------------------- */
export function Ico({ children, size = 24, sw = 1.9, fill = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }} aria-hidden="true">{children}</svg>
  )
}
export const ICONS = {
  today: (p) => <Ico {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6" /></Ico>,
  learn: (p) => <Ico {...p}><path d="M12 6.5C10 4.8 7.4 4.4 4.5 4.8A1 1 0 0 0 3.7 5.8v11.4a1 1 0 0 0 1.1 1c2.6-.3 5.1.1 7.2 1.8 2.1-1.7 4.6-2.1 7.2-1.8a1 1 0 0 0 1.1-1V5.8a1 1 0 0 0-.8-1c-2.9-.4-5.5 0-7.5 1.7Z" /><path d="M12 6.5v12" /></Ico>,
  translate: (p) => <Ico {...p}><path d="M4 7h7M7.5 5v2c0 3.2-1.6 5.6-4 7M6 10.5c.8 2 2.6 3.4 4.5 4" /><path d="M13 20l3.4-8a.6.6 0 0 1 1.1 0L21 20M14.3 16.6h5.4" /></Ico>,
  arcade: (p) => <Ico {...p}><rect x="2.6" y="7.5" width="18.8" height="10" rx="4" /><path d="M7 11v3M5.5 12.5h3" /><circle cx="16" cy="11.6" r="1.1" fill="currentColor" stroke="none" /><circle cx="18.2" cy="14" r="1.1" fill="currentColor" stroke="none" /></Ico>,
  family: (p) => <Ico {...p}><circle cx="8.5" cy="8" r="2.6" /><circle cx="16" cy="9" r="2.1" /><path d="M3.5 18.5c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6M14.5 18.5c0-2.2 1.4-3.8 3.6-3.8s3.4 1.4 3.4 3.4" /></Ico>,
  star: (p) => <Ico {...p}><path d="M12 3.6l2.5 5.1 5.6.8-4 4 .9 5.6L12 16.4l-5 2.7.9-5.6-4-4 5.6-.8Z" /></Ico>,
  mic: (p) => <Ico {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></Ico>,
  check: (p) => <Ico {...p}><path d="M5 12.5l4.2 4.2L19 7" /></Ico>,
  arrowR: (p) => <Ico {...p}><path d="M5 12h13M13 6.5l5.5 5.5L13 17.5" /></Ico>,
  play: (p) => <Ico {...p} fill><path d="M8 5.5v13l11-6.5Z" stroke="none" /></Ico>,
  clock: (p) => <Ico {...p}><circle cx="12" cy="12" r="8.4" /><path d="M12 7.4V12l3 2" /></Ico>,
  bolt: (p) => <Ico {...p}><path d="M13 2.5 4.5 13.2h6L11 21.5 19.5 10.8h-6Z" /></Ico>,
  cards: (p) => <Ico {...p}><rect x="3.2" y="6.6" width="13" height="13" rx="2.4" /><path d="M7.4 6.6 8.6 4a2 2 0 0 1 2.5-1.2l7 2.6A2 2 0 0 1 20.3 6l-3.1 8.6" /></Ico>,
  globe: (p) => <Ico {...p}><circle cx="12" cy="12" r="8.4" /><path d="M3.6 12h16.8M12 3.6c2.4 2.3 3.6 5.2 3.6 8.4S14.4 18.1 12 20.4C9.6 18.1 8.4 15.2 8.4 12S9.6 5.9 12 3.6Z" /></Ico>,
}
export function NavIco({ name, size = 24 }) { const F = ICONS[name]; return F ? F({ size }) : null }

/* ---------- Rank badge ----------------------------------------------------- */
export function Rank({ jp, en, compact }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ color: 'var(--red)', display: 'flex' }}><Torii size={compact ? 16 : 19} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span className="jn-jp" style={{ fontSize: compact ? 13 : 15, fontWeight: 700 }}>{jp}</span>
        {!compact && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 2 }}>{en}</span>}
      </span>
    </span>
  )
}
