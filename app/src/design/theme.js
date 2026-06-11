/* theme.js — Jerno theme management.
   Themes (see tokens.css): 'light' (Daylight Garden) · 'dark' (Lantern Night)
   · 'hero' (Crimson Hour) · 'auto' (default — follow the device).
   The chosen theme persists on-device in localStorage and wins over
   prefers-color-scheme; 'auto' resolves via matchMedia and tracks changes. */

const KEY = 'jerno-theme'
const THEMES = ['light', 'dark', 'hero', 'auto']

const media = window.matchMedia('(prefers-color-scheme: dark)')
let listening = false

export function getTheme() {
  const v = localStorage.getItem(KEY)
  return THEMES.includes(v) ? v : 'auto'
}

function resolve(value) {
  if (value === 'auto') return media.matches ? 'dark' : 'light'
  return value
}

function onSchemeChange() {
  if (getTheme() === 'auto') {
    document.documentElement.setAttribute('data-theme', resolve('auto'))
  }
}

export function applyTheme() {
  document.documentElement.setAttribute('data-theme', resolve(getTheme()))
  if (!listening) {
    media.addEventListener('change', onSchemeChange)
    listening = true
  }
}

export function setTheme(value) {
  localStorage.setItem(KEY, THEMES.includes(value) ? value : 'auto')
  applyTheme()
}
