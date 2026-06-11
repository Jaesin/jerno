import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import Travel from './screens/Travel.jsx'
import Learn from './screens/Learn.jsx'
import Settings from './screens/Settings.jsx'
import Join from './screens/Join.jsx'
import KanaArcade from './screens/KanaArcade.jsx'
import SpeakingLab from './screens/SpeakingLab.jsx'
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

function RedirectToLastMode() {
  const stored = localStorage.getItem('jerno-last-mode')
  // Map legacy mode names (travel/learn) onto the new tabs.
  const MAP = { travel: 'translate', learn: 'today', today: 'today', translate: 'translate', you: 'you' }
  const last = MAP[stored] || 'today'
  return <Navigate to={`/${last}`} replace />
}

export default function Shell() {
  return (
    <HashRouter>
      <div className="shell-content">
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
        </Routes>
      </div>
      <Routes>
        <Route path="/join" element={null} />
        <Route path="/arcade" element={null} />
        <Route path="/speaking" element={null} />
        <Route path="*" element={<BottomTabs />} />
      </Routes>
    </HashRouter>
  )
}
