/* nav.jsx — TabBar for the "One Thing" direction: a deliberately small,
   three-slot bottom bar. The bet is that the daily return is one tap, so there
   is little to navigate. Translate is a peer here (not a raised FAB) — see the
   handoff README for how this differs from nav model C.

   ESM port of the design handoff's components/ui/nav.jsx. */

import { NavIco } from './primitives.jsx'

export const ONE_THING_TABS = [
  { id: 'today',     icon: 'today',     label: 'Today' },
  { id: 'translate', icon: 'translate', label: 'Translate' },
  { id: 'you',       icon: 'family',    label: 'You' },     // profile / settings / family
]

export function TabBar({ active = 'today', onNav, tabs = ONE_THING_TABS }) {
  return (
    <div className="jn-nav">
      {tabs.map((t) => (
        <button key={t.id} className={'jn-tab' + (t.id === active ? ' is-active' : '')}
          onClick={onNav ? () => onNav(t.id) : undefined}>
          <NavIco name={t.icon} size={23} />
          <span className="lbl">{t.label}</span>
        </button>
      ))}
    </div>
  )
}
