// Offline TTS audio cache backed by the Cache API (available without a
// service worker in all modern browsers). Stores the JSON audio payload
// ({ base64, format }) returned by the /tts function, keyed by text+voice,
// so the survival phrasebook keeps working in airplane mode.
//
// Design rules:
// - Every operation degrades gracefully: if the Cache API is unavailable
//   (e.g. Safari private mode) or any call throws, we return null / no-op.
// - prefetchPhrasepack is fire-and-forget safe: it never throws.

import { tts } from '../api.js'

const CACHE_NAME = 'jerno-audio-v1'

// Voices worth prefetching up front (default voice only — other voices are
// cached lazily on first play via ttsWithCache).
export const PREFETCH_VOICES = ['ja-JP-NanamiNeural']

function cacheAvailable() {
  return typeof caches !== 'undefined' && typeof caches.open === 'function'
}

// Cache API keys must be http(s) URLs, so build a deterministic synthetic
// URL from text+voice. The host never gets hit — it's just a lookup key.
function cacheKey(text, voice) {
  return `https://audio-cache.jerno.local/tts?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`
}

/** Returns the cached { base64, format } payload, or null. Never throws. */
export async function getCachedAudio(text, voice) {
  if (!cacheAvailable()) return null
  try {
    const cache = await caches.open(CACHE_NAME)
    const res = await cache.match(cacheKey(text, voice))
    if (!res) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Stores an audio payload ({ base64, format }). Fire-and-forget; never throws. */
export async function setCachedAudio(text, voice, audioData) {
  if (!cacheAvailable() || !audioData?.base64) return
  try {
    const cache = await caches.open(CACHE_NAME)
    const body = JSON.stringify({
      base64: audioData.base64,
      format: audioData.format || 'mp3',
    })
    await cache.put(
      cacheKey(text, voice),
      new Response(body, { headers: { 'Content-Type': 'application/json' } })
    )
  } catch {
    // Quota exceeded, private mode, etc. — skip caching, carry on.
  }
}

/** Cheap existence check that avoids deserializing the base64 body. */
async function hasCachedAudio(cache, text, voice) {
  try {
    const res = await cache.match(cacheKey(text, voice))
    return !!res
  } catch {
    return false
  }
}

/**
 * Prefetches TTS audio for a phrase pack. For each phrase: checks the cache
 * first, fetches over the network only if missing. Calls onProgress(done,
 * total) after each item. Skips network fetches while offline. Never throws.
 */
export async function prefetchPhrasepack(phrases, voice, onProgress) {
  const total = phrases.length
  let done = 0
  const report = () => {
    try { onProgress?.(done, total) } catch { /* ignore */ }
  }
  for (const phrase of phrases) {
    try {
      const text = phrase.ja
      const cached = text ? await getCachedAudio(text, voice) : null
      if (text && !cached) {
        // navigator.onLine === false is a reliable "definitely offline" signal.
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          const result = await tts(text, voice)
          if (result?.audio?.base64) {
            await setCachedAudio(text, voice, result.audio)
          }
        }
      }
    } catch {
      // Per-item failure (network blip, quota) — move on to the next phrase.
    }
    done++
    report()
  }
}

/** Returns { cached, total } for a phrase pack + voice. Never throws. */
export async function getPrefetchStatus(phrases, voice) {
  const total = phrases.length
  if (!cacheAvailable()) return { cached: 0, total }
  try {
    const cache = await caches.open(CACHE_NAME)
    let cached = 0
    for (const phrase of phrases) {
      if (phrase.ja && await hasCachedAudio(cache, phrase.ja, voice)) cached++
    }
    return { cached, total }
  } catch {
    return { cached: 0, total }
  }
}
