import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Shell from './Shell.jsx'
import './design/tokens.css'
import './design/components.css'
import './index.css'
import { applyTheme } from './design/theme.js'

applyTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
