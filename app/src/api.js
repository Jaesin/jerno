const API_BASE = import.meta.env.DEV
  ? 'http://localhost:5001/jerno/us-central1'
  : 'https://us-central1-jerno.cloudfunctions.net'

export async function translate(text, formality = 'polite') {
  const res = await fetch(`${API_BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, formality }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || 'Translation failed')
  }
  return res.json()
}

export async function tts(text, voice = 'ja-JP-NanamiNeural') {
  const res = await fetch(`${API_BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || 'TTS failed')
  }
  return res.json()
}

export async function translateAndSpeak(text, voice = 'ja-JP-NanamiNeural', formality = 'polite') {
  const res = await fetch(`${API_BASE}/translateAndSpeak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, formality }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || 'Translation failed')
  }
  return res.json()
}
