import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { Button, ErrorBanner, Sky, inputClass } from './ui'

export default function PinGate({ title, subtitle, checking, error, onSubmit }) {
  const [pin, setPin] = useState('')
  const [revealed, setRevealed] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!pin.trim()) return
    const ok = await onSubmit(pin)
    if (!ok) setPin('')
  }

  return (
    <Sky>
      <div className="grid min-h-screen place-items-center p-6">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm space-y-4 rounded-3xl border-[3px] border-brand-black bg-brand-white p-6 shadow-brutal-lg"
        >
          <div className="text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border-2 border-brand-black bg-brand-lime shadow-brutal-xs">
              <KeyRound className="h-7 w-7 text-brand-black" />
            </div>
            <h1 className="text-2xl font-black">{title}</h1>
            {subtitle && <p className="mt-1 text-sm font-bold text-brand-black/60">{subtitle}</p>}
          </div>

          <div className="relative">
            <input
              type={revealed ? 'text' : 'password'}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              dir="ltr"
              autoFocus
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="קוד גישה"
              aria-label="קוד גישה"
              className={`${inputClass} px-12 text-center text-xl tracking-wider`}
            />
            <button
              type="button"
              onClick={() => setRevealed((value) => !value)}
              aria-label={revealed ? 'הסתרת הקוד' : 'הצגת הקוד'}
              className="absolute inset-y-0 right-3 grid place-items-center px-1 text-brand-black/60 hover:text-brand-black"
            >
              {revealed ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          <ErrorBanner error={error} />

          <Button type="submit" busy={checking} className="w-full py-4 text-base">
            כניסה
          </Button>
        </form>
      </div>
    </Sky>
  )
}
