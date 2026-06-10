import { HashRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import Travel from './screens/Travel.jsx'
import Learn from './screens/Learn.jsx'
import Settings from './screens/Settings.jsx'
import Join from './screens/Join.jsx'
import KanaArcade from './screens/KanaArcade.jsx'

function BottomNav() {
  const navigate = useNavigate()
  const tabs = [
    { path: '/travel', kanji: '旅', label: 'Travel' },
    { path: '/learn',  kanji: '学', label: 'Learn' },
  ]
  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <NavLink key={t.path} to={t.path} className={({ isActive }) => 'bottom-nav-tab' + (isActive ? ' active' : '')}
          onClick={() => localStorage.setItem('jerno-last-mode', t.path.slice(1))}>
          <span className="tab-kanji">{t.kanji}</span>
          <span className="tab-label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

function RedirectToLastMode() {
  const last = localStorage.getItem('jerno-last-mode') || 'travel'
  return <Navigate to={`/${last}`} replace />
}

export default function Shell() {
  return (
    <HashRouter>
      <div className="shell-content">
        <Routes>
          <Route path="/" element={<RedirectToLastMode />} />
          <Route path="/travel" element={<Travel />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/join" element={<Join />} />
          <Route path="/arcade" element={<KanaArcade />} />
        </Routes>
      </div>
      <Routes>
        <Route path="/settings" element={null} />
        <Route path="/join" element={null} />
        <Route path="/arcade" element={null} />
        <Route path="*" element={<BottomNav />} />
      </Routes>
    </HashRouter>
  )
}
