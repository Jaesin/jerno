import { getCachedAudio, setCachedAudio } from './data/audioCache.js'
import { getCachedTranslation, setCachedTranslation } from './data/translationCache.js'
import { auth, ensureSignedIn } from './firebase.js'

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:5001'
  : 'https://jerno-functions.jaesinner.workers.dev'

// Build request headers with the caller's Firebase ID token attached. The SDK
// refreshes the token automatically; we just ask for the current one. If auth
// can't be resolved (offline first paint, etc.) we send the request without a
// token and let the Worker decide — local dev skips verification entirely.
async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  try {
    const user = auth.currentUser ?? (await ensureSignedIn())
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`
  } catch {
    /* leave Authorization off — the request may still succeed in dev */
  }
  return headers
}

export async function translate(text, formality = 'polite') {
  const cached = getCachedTranslation(text, formality)
  if (cached) return { ...cached, cached: true }

  const res = await fetch(`${API_BASE}/translate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ text, formality }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || 'Translation failed')
  }
  const result = await res.json()
  setCachedTranslation(text, formality, result)
  return result
}

export async function tts(text, voice = 'ja-JP-NanamiNeural') {
  const res = await fetch(`${API_BASE}/tts`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ text, voice }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(err.error?.message || 'TTS failed')
  }
  return res.json()
}

export async function ttsWithCache(text, voice = 'ja-JP-NanamiNeural') {
  const cached = await getCachedAudio(text, voice)
  if (cached?.base64) return { audio: cached, cached: true }
  const result = await tts(text, voice)
  if (result?.audio?.base64) setCachedAudio(text, voice, result.audio)
  return result
}

export async function translateAndSpeak(text, voice = 'ja-JP-NanamiNeural', formality = 'polite') {
  const translation = await translate(text, formality)
  const ttsData = await ttsWithCache(translation.japanese, voice)

  return {
    japanese:           translation.japanese,
    reading:            translation.reading,
    romaji:             translation.romaji,
    segments:           translation.segments,
    audio:              ttsData.audio,
    translation_cached: translation.cached,
    tts_cached:         ttsData.cached,
  }
}
