import { getCachedAudio, setCachedAudio } from './data/audioCache.js'

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:5001'
  : 'https://jerno-functions.jaesinner.workers.dev'

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
