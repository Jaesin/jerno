// firebase.js — SDK initialization for the Jerno app (modeled on japan-2026).
// Offline-first: persistent multi-tab cache so reads (and queued writes)
// survive spotty data. These config values are public identifiers, not
// secrets — security lives in firestore.rules.

import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

const firebaseConfig = {
  projectId: 'jerno-app',
  appId: '1:71842884075:web:b90ef73dfdc071ccc3d1ae',
  storageBucket: 'jerno-app.firebasestorage.app',
  apiKey: 'AIzaSyCAVaSG6bH2f0QzMCi097ZB-l8MK-CYMH8',
  authDomain: 'jerno-app.firebaseapp.com',
  messagingSenderId: '71842884075',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

/**
 * Resolve the current Firebase user, signing in anonymously if there isn't one.
 * Anonymous uids persist per browser; membership (members/{uid}) is what
 * actually grants write access — see firestore.rules.
 */
export function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          stop()
          resolve(user)
        } else {
          signInAnonymously(auth).catch((err) => {
            stop()
            reject(err)
          })
        }
      },
      reject,
    )
  })
}
