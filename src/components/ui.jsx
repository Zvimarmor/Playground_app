import { Loader2 } from 'lucide-react'

export function Spinner({ className = 'h-6 w-6' }) {
  return <Loader2 className={`animate-spin text-slate-400 ${className}`} />
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen grid place-items-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

export function Card({ className = '', children }) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/60 p-5 ${className}`}>
      {children}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 ' +
  'placeholder:text-slate-600 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30'

export function Button({ variant = 'primary', className = '', busy = false, children, ...props }) {
  const variants = {
    primary: 'bg-sky-500 text-slate-950 hover:bg-sky-400',
    success: 'bg-emerald-500 text-slate-950 hover:bg-emerald-400',
    danger: 'bg-rose-500/90 text-white hover:bg-rose-500',
    ghost: 'border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800',
  }
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold
        transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
}

export function ErrorBanner({ error, onDismiss }) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
      onClick={onDismiss}
    >
      {typeof error === 'string' ? error : error.message}
    </div>
  )
}

export function StatusPill({ status }) {
  const styles = {
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  }
  const labels = { pending: 'ממתין', paid: 'שולם', cancelled: 'בוטל' }
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}
