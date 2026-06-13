// useMember — membership state + join flow (ported from japan-2026).
//
//   const { status, member, join, error, loading, uid } = useMember();
//
//   status  'public' | 'joining' | 'member'
//   member  { id: uid, name, inviteToken, joinedAt } | null
//   join(inviteToken, name) → Promise — ensureSignedIn, write members/{uid},
//           persist { key, name } to localStorage. Rejects (and sets `error`)
//           on failure; err.code === 'permission-denied' means the invite link
//           is invalid/revoked (there's no pre-validation read — the denied
//           write IS the check).
//   loading true while the initial auth + membership check (or a silent
//           re-join) is still resolving — gate UIs should wait on it instead
//           of flashing the "needs a family link" page.
//
// On load: a live snapshot of members/{uid} decides 'member'. If there's no
// member doc (or no Firebase user — e.g. Safari evicted IndexedDB) but
// localStorage still holds { key, name }, we silently re-join once with a
// fresh uid. A device that was a member this session and loses its doc was
// revoked — it goes 'public' rather than silently re-admitting itself.

import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth, db, ensureSignedIn } from '../firebase.js'

const STORAGE_KEY = 'jerno.join'

function readSavedJoin() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeSavedJoin(creds) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds))
  } catch {
    /* storage unavailable — re-join from the link still works */
  }
}

export function useMember() {
  const [uid, setUid] = useState(undefined) // undefined = auth not resolved yet
  const [member, setMember] = useState(null)
  const [checking, setChecking] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState(null)
  const [epoch, setEpoch] = useState(0) // bumped after a join to resubscribe
  const rejoinTried = useRef(false) // silent re-join: once per session
  const wasMember = useRef(false) // distinguishes "revoked" from "never joined"

  // Track auth without forcing a sign-in (visitors stay signed out; anonymous
  // sign-in happens inside join via ensureSignedIn).
  useEffect(() => onAuthStateChanged(auth, (user) => setUid(user ? user.uid : null)), [])

  // The validated write (rules check name 1–40 + invite token exists).
  const writeJoin = useCallback(async (inviteToken, name) => {
    const trimmed = String(name ?? '').trim()
    if (trimmed.length < 1 || trimmed.length > 40) {
      const err = new Error('Please enter a name (up to 40 characters).')
      err.code = 'invalid-name'
      throw err
    }
    if (!inviteToken) {
      const err = new Error('This link is missing its key.')
      err.code = 'permission-denied'
      throw err
    }
    const user = await ensureSignedIn()
    await setDoc(doc(db, 'members', user.uid), {
      name: trimmed,
      inviteToken,
      joinedAt: serverTimestamp(),
    })
    writeSavedJoin({ key: inviteToken, name: trimmed })
    wasMember.current = true
    setMember({ id: user.uid, name: trimmed, inviteToken })
    setEpoch((e) => e + 1) // the pre-join snapshot listener died on permission-denied
  }, [])

  // Membership check: live members/{uid} subscription + silent re-join path.
  useEffect(() => {
    if (uid === undefined) return undefined // auth still resolving

    const goPublicOrRejoin = () => {
      const saved = readSavedJoin()
      if (saved?.key && saved?.name && !rejoinTried.current && !wasMember.current) {
        rejoinTried.current = true
        writeJoin(saved.key, saved.name)
          .catch(() => {}) // invalid/revoked link → quietly public
          .finally(() => setChecking(false))
      } else {
        setMember(null)
        setChecking(false)
      }
    }

    if (uid === null) {
      // No Firebase user on this device (fresh browser or evicted storage).
      goPublicOrRejoin()
      return undefined
    }

    setChecking(true)
    return onSnapshot(
      doc(db, 'members', uid),
      (snap) => {
        if (snap.exists()) {
          wasMember.current = true
          setMember({ id: snap.id, ...snap.data() })
          setChecking(false)
        } else {
          goPublicOrRejoin()
        }
      },
      // permission-denied: not (or no longer) a member.
      () => goPublicOrRejoin(),
    )
  }, [uid, epoch, writeJoin])

  const join = useCallback(
    async (inviteToken, name) => {
      setJoining(true)
      setError(null)
      try {
        await writeJoin(inviteToken, name)
      } catch (err) {
        setError(err)
        throw err
      } finally {
        setJoining(false)
      }
    },
    [writeJoin],
  )

  const status = member ? 'member' : joining ? 'joining' : 'public'
  return {
    status,
    member,
    join,
    error,
    loading: uid === undefined || checking,
    uid: uid ?? null,
  }
}
