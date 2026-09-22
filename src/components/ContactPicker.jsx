import { useState } from 'react'
import { BookUser } from 'lucide-react'
import { Button } from './ui'

const supported =
  typeof navigator !== 'undefined' &&
  'contacts' in navigator &&
  typeof navigator.contacts?.select === 'function'

/**
 * Contact Picker API - Chrome on Android only, and only on a secure origin.
 * Everywhere else the button simply isn't rendered and people type the
 * details in by hand.
 */
export default function ContactPicker({ onPick }) {
  const [error, setError] = useState(null)

  if (!supported) return null

  const pick = async () => {
    setError(null)
    try {
      const [contact] = await navigator.contacts.select(['name', 'tel'], { multiple: false })
      if (!contact) return
      onPick({
        name: contact.name?.[0] ?? '',
        phone: contact.tel?.[0] ?? '',
      })
    } catch (err) {
      // A cancelled picker throws too - only surface real problems.
      if (err?.name !== 'AbortError') setError('לא ניתן לפתוח את אנשי הקשר, מלאו ידנית')
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="ghost" onClick={pick} className="w-full">
        <BookUser className="h-4 w-4" />
        בחר מאנשי קשר
      </Button>
      {error && <p className="text-xs text-amber-400">{error}</p>}
    </div>
  )
}
