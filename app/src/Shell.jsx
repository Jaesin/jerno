import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { T10nProvider } from '@jaesin/t10n-client/react'
import { auth, ensureSignedIn } from './firebase.js'
import Travel from './screens/Travel.jsx'
import Learn from './screens/Learn.jsx'
import Settings from './screens/Settings.jsx'
import Join from './screens/Join.jsx'
import KanaArcade from './screens/KanaArcade.jsx'
import SpeakingLab from './screens/SpeakingLab.jsx'
import Family from './screens/Family.jsx'
import { TabBar } from './design/nav.jsx'

// The 3-slot "One Thing" bottom bar: Today · Translate · You.
function BottomTabs() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = pathname.startsWith('/translate') ? 'translate'
    : pathname.startsWith('/you') ? 'you'
    : 'today'
  const onNav = (id) => {
    localStorage.setItem('jerno-last-mode', id)
    navigate('/' + id)
  }
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100 }}>
      <TabBar active={active} onNav={onNav} />
    </div>
  )
}

// The app is gated behind the invite join flow. A device has "joined" once
// useMember persisted its { key, name } credentials (or, pre-migration, the
// old shared family token).
function hasJoined() {
  try {
    const raw = localStorage.getItem('jerno.join')
    if (raw && JSON.parse(raw)?.key) return true
  } catch { /* fall through to the legacy key */ }
  return !!localStorage.getItem('jerno-join-token')
}

// Dev escape hatch: local dev never requires a token.
const GATE_ENABLED = !import.meta.env.DEV

function JoinGate({ children }) {
  const { pathname } = useLocation()
  if (GATE_ENABLED && !hasJoined() && pathname !== '/join') {
    return <Navigate to="/join" replace />
  }
  return children
}

function RedirectToLastMode() {
  if (GATE_ENABLED && !hasJoined()) return <Navigate to="/join" replace />
  const stored = localStorage.getItem('jerno-last-mode')
  // Map legacy mode names (travel/learn) onto the new tabs.
  const MAP = { travel: 'translate', learn: 'today', today: 'today', translate: 'translate', you: 'you' }
  const last = MAP[stored] || 'today'
  return <Navigate to={`/${last}`} replace />
}

// Forward the caller's Firebase ID token to the t10n worker. Module-level so its
// identity is stable across renders (T10nProvider recreates its client when
// getToken changes). Anonymous sign-in is enough — membership lives elsewhere.
async function getToken() {
  try {
    const user = auth.currentUser ?? (await ensureSignedIn())
    return user ? await user.getIdToken() : null
  } catch {
    return null
  }
}

export default function Shell() {
  return (
    <T10nProvider getToken={getToken}>
    <HashRouter>
      <div className="shell-content">
        <JoinGate>
        <Routes>
          <Route path="/" element={<RedirectToLastMode />} />
          <Route path="/today" element={<Learn />} />
          <Route path="/translate" element={<Travel />} />
          <Route path="/you" element={<Settings />} />
          {/* legacy paths — keep deep links working */}
          <Route path="/learn" element={<Navigate to="/today" replace />} />
          <Route path="/travel" element={<Navigate to="/translate" replace />} />
          <Route path="/settings" element={<Navigate to="/you" replace />} />
          <Route path="/join" element={<Join />} />
          <Route path="/arcade" element={<KanaArcade />} />
          <Route path="/speaking" element={<SpeakingLab />} />
          <Route path="/family" element={<Family />} />
        </Routes>
        </JoinGate>
      </div>
      <Routes>
        <Route path="/join" element={null} />
        <Route path="/arcade" element={null} />
        <Route path="/speaking" element={null} />
        <Route path="*" element={<BottomTabs />} />
      </Routes>
    </HashRouter>
    </T10nProvider>
  )
}
