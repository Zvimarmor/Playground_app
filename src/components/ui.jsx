import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'

export function Spinner({ className = 'h-6 w-6' }) {
  return <Loader2 className={`animate-spin ${className}`} />
}

export function FullPageSpinner() {
  return (
    <Sky>
      <div className="grid min-h-screen place-items-center">
        <div className="grid h-20 w-20 place-items-center rounded-3xl border-[3px] border-brand-black bg-brand-white shadow-brutal">
          <Spinner className="h-9 w-9 text-brand-black" />
        </div>
      </div>
    </Sky>
  )
}

/* -------------------------------------------------------------------
   Decorative sky. Pure inline SVG - no image files, no network calls.
   The clouds sit behind everything and never swallow a tap.
   ------------------------------------------------------------------- */

function Cloud({ className = '', opacity = 1 }) {
  return (
    <svg
      viewBox="0 0 200 110"
      aria-hidden="true"
      className={`absolute text-brand-white ${className}`}
      style={{ opacity }}
    >
      <path
        d="M44 96c-19 0-34-13-34-30 0-15 12-27 28-29C41 20 57 8 76 8c15 0 28 7 35 19 5-3 11-5 17-5 16 0 29 12 30 27 15 2 26 13 26 27 0 11-9 20-21 20H44Z"
        fill="currentColor"
        stroke="#000"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Sun({ className = '' }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={`absolute ${className}`}>
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          x="57"
          y="2"
          width="6"
          height="18"
          rx="3"
          fill="#FFE57F"
          stroke="#000"
          strokeWidth="3"
          transform={`rotate(${i * 30} 60 60)`}
        />
      ))}
      <circle cx="60" cy="60" r="30" fill="#FFE57F" stroke="#000" strokeWidth="5" />
    </svg>
  )
}

/** Full-bleed daytime backdrop used by every route. */
export function Sky({ children, className = '' }) {
  return (
    <div className={`relative min-h-screen overflow-hidden bg-brand-sky ${className}`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
        <Sun className="-left-6 top-6 h-32 w-32 sm:left-6" />
        <Cloud className="right-[-3rem] top-24 h-24 w-44" opacity={0.95} />
        <Cloud className="left-[-2rem] top-[38%] h-20 w-36" opacity={0.75} />
        <Cloud className="right-4 top-[62%] h-16 w-28" opacity={0.6} />
        <Cloud className="left-8 bottom-10 h-20 w-36" opacity={0.5} />
      </div>
      <div className="relative">{children}</div>
    </div>
  )
}

/* ------------------------------ surfaces --------------------------- */

export function Card({ className = '', children, ...props }) {
  return (
    <div
      {...props}
      className={`rounded-3xl border-[3px] border-brand-black bg-brand-white p-5 shadow-brutal ${className}`}
    >
      {children}
    </div>
  )
}

/** Small hard-edged label chip. */
export function Badge({ tone = 'lime', className = '', children }) {
  const tones = {
    lime: 'bg-brand-lime text-brand-black',
    yellow: 'bg-brand-yellow text-brand-black',
    coral: 'bg-brand-coral text-brand-white',
    white: 'bg-brand-white text-brand-black',
    black: 'bg-brand-black text-brand-white',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-xl border-2 border-brand-black px-3 py-1
        text-xs font-extrabold shadow-brutal-xs sm:text-sm ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-extrabold text-brand-black">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs font-semibold text-brand-black/60">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-2xl border-[3px] border-brand-black bg-brand-white px-4 py-3.5 text-base font-bold ' +
  'text-brand-black shadow-brutal-xs outline-none transition placeholder:font-semibold ' +
  'placeholder:text-brand-black/35 focus:bg-brand-yellow focus:shadow-brutal-sm'

/* ------------------------------ actions ---------------------------- */

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-brand-black px-4 py-3 ' +
  'text-sm font-extrabold shadow-brutal-sm transition-all active:translate-x-[2px] ' +
  'active:translate-y-[2px] active:shadow-brutal-xs disabled:cursor-not-allowed ' +
  'disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0 ' +
  'disabled:active:shadow-brutal-sm'

export function Button({ variant = 'primary', className = '', busy = false, children, ...props }) {
  const variants = {
    primary: 'bg-brand-coral text-brand-white',
    success: 'bg-brand-lime text-brand-black',
    warning: 'bg-brand-yellow text-brand-black',
    danger: 'bg-brand-black text-brand-white',
    ghost: 'bg-brand-white text-brand-black',
  }
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`${BUTTON_BASE} ${variants[variant]} ${className}`}
    >
      {busy && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  )
}

/**
 * Modal yes/no for destructive actions. Focus starts on the safe choice, and
 * Escape or a tap on the backdrop backs out - except while `busy`, so the
 * dialog stays up until the action it started has finished.
 */
export function ConfirmDialog({
  open, title, children, confirmLabel, cancelLabel = 'חזרה', busy = false, onConfirm, onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-brand-black/60 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-3xl border-[3px] border-brand-black bg-brand-white p-6 shadow-brutal-lg"
      >
        <h2 id="confirm-dialog-title" className="text-xl font-black">
          {title}
        </h2>
        <div className="text-sm font-bold leading-relaxed text-brand-black/70">{children}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" busy={busy} onClick={onConfirm} className="flex-1">
            {confirmLabel}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel} className="flex-1" autoFocus>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ErrorBanner({ error, onDismiss }) {
  if (!error) return null
  return (
    <div
      role="alert"
      onClick={onDismiss}
      className="rounded-2xl border-[3px] border-brand-black bg-brand-coral px-4 py-3
        text-sm font-extrabold text-brand-white shadow-brutal-sm"
    >
      {typeof error === 'string' ? error : error.message}
    </div>
  )
}

export function StatusPill({ status }) {
  const tones = { pending: 'yellow', paid: 'lime', cancelled: 'white' }
  const labels = { pending: 'ממתין', paid: 'שולם', cancelled: 'בוטל' }
  return <Badge tone={tones[status] ?? 'white'}>{labels[status] ?? status}</Badge>
}
