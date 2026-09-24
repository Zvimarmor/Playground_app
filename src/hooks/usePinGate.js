import { useCallback, useState } from 'react'
import { WRONG_PIN, verifyPin } from '../lib/api'

const storageKey = (role) => `event-app:${role}-pin`

const readSession = (role) => {
  try {
    return sessionStorage.getItem(storageKey(role))
  } catch {
    return null
  }
}

/**
 * Shared-PIN gate. The PINs themselves live only in the database. Once the
 * `verify_pin` RPC accepts the typed PIN, it is kept in sessionStorage for the
 * tab's lifetime, because every staff RPC re-checks it server side.
 *
 * `role` is 'admin' or 'helper'. An admin PIN also opens the helper view.
 */
export function usePinGate(role) {
  const [pin, setPin] = useState(() => readSession(role))
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(
    async (typed) => {
      const candidate = typed.trim()
      setChecking(true)
      setError(null)
      try {
        const granted = await verifyPin(candidate)
        const allowed = role === 'admin' ? granted === 'admin' : granted === 'admin' || granted === 'helper'
        if (!allowed) {
          setError('קוד שגוי, נסו שוב')
          return false
        }
        try {
          sessionStorage.setItem(storageKey(role), candidate)
        } catch {
          /* private mode - the gate simply won't be remembered */
        }
        setPin(candidate)
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
    setPin(null)
  }, [role])

  /** For staff RPC errors: a PIN changed mid-event sends the user back to the gate. */
  const handleError = useCallback(
    (err) => {
      if (err?.code !== WRONG_PIN) return false
      lock()
      setError('הקוד הוחלף, נא להזין את הקוד החדש')
      return true
    },
    [lock]
  )

  return { unlocked: Boolean(pin), pin, checking, error, submit, lock, handleError }
}
