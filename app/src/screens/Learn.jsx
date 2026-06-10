import { Link } from 'react-router-dom'

export default function Learn() {
  return (
    <div className="screen-stub">
      <Link to="/settings" className="settings-gear" aria-label="Settings">⚙</Link>
      <div className="stub-kanji">学ぶ</div>
      <p>Learning mode — coming soon</p>
    </div>
  )
}
