import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button, ErrorBanner, inputClass } from './ui'

export default function PinGate({ title, subtitle, checking, error, onSubmit }) {
  const [pin, setPin] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!pin.trim()) return
    const ok = await onSubmit(pin)
    if (!ok) setPin('')
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/15">
            <KeyRound className="h-6 w-6 text-sky-400" />
          </div>
          <h1 className="text-xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>

        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="••••"
          className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
        />

        <ErrorBanner error={error} />

        <Button type="submit" busy={checking} className="w-full">
          כניסה
        </Button>
      </form>
    </div>
  )
}
