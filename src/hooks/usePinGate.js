import { useCallback, useState } from 'react'
import { verifyPin } from '../lib/api'

const storageKey = (role) => `event-app:${role}-unlocked`

const readSession = (role) => {
  try {
    return sessionStorage.getItem(storageKey(role)) === 'yes'
  } catch {
    return false
  }
}

/**
 * Shared-PIN gate. The PIN itself is never sent to the client - it is checked
 * by the `verify_pin` RPC, and only the resulting role is kept in
 * sessionStorage for the tab's lifetime.
 *
 * `role` is 'admin' or 'helper'. An admin PIN also opens the helper view.
 */
export function usePinGate(role) {
  const [unlocked, setUnlocked] = useState(() => readSession(role))
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(
    async (pin) => {
      setChecking(true)
      setError(null)
      try {
        const granted = await verifyPin(pin.trim())
        const allowed = role === 'admin' ? granted === 'admin' : granted === 'admin' || granted === 'helper'
        if (!allowed) {
          setError('קוד שגוי, נסו שוב')
          return false
        }
        try {
          sessionStorage.setItem(storageKey(role), 'yes')
        } catch {
          /* private mode - the gate simply won't be remembered */
        }
        setUnlocked(true)
        return true
      } catch (err) {
        setError(err.message)
        return false
      } finally {
        setChecking(false)
      }
    },
    [role]
  )

  const lock = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey(role))
    } catch {
      /* ignore */
    }
    setUnlocked(false)
  }, [role])

  return { unlocked, checking, error, submit, lock }
}
