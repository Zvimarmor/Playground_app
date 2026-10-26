import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import { Spinner } from './ui'

/**
 * @typedef {Object} SelfieSlot
 * @property {'empty' | 'checking' | 'ok' | 'error'} status
 * @property {string} [url]          object URL of the photo, for the thumbnail
 * @property {Float32Array} [embedding]  set once status is 'ok'
 * @property {string} [error]        Hebrew reason, when status is 'error'
 */

/**
 * The three selfie slots side by side: a thumbnail with its check result, and
 * a retake button on every slot that already has a photo.
 *
 * @param {{
 *   slots: SelfieSlot[],
 *   prompts: { title: string }[],
 *   activeIndex: number,
 *   onRetake: (index: number) => void,
 * }} props
 */
export default function SelfiePreview({ slots, prompts, activeIndex, onRetake }) {
  return (
    <ol className="grid grid-cols-3 gap-3">
      {slots.map((slot, index) => (
        <li key={index} className="space-y-1.5">
          <div
            className={`relative aspect-[3/4] overflow-hidden rounded-2xl border-[3px] border-brand-black shadow-brutal-xs
              ${index === activeIndex && slot.status === 'empty' ? 'bg-brand-yellow' : 'bg-brand-white'}`}
          >
            {slot.url ? (
              <img src={slot.url} alt={`סלפי ${index + 1}`} className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full place-items-center text-3xl font-black text-brand-black/25">{index + 1}</span>
            )}
            {slot.status === 'checking' && (
              <div className="absolute inset-0 grid place-items-center bg-brand-white/70">
                <Spinner className="h-7 w-7" />
              </div>
            )}
            {slot.status === 'ok' && (
              <CheckCircle2 className="absolute left-1.5 top-1.5 h-6 w-6 rounded-full bg-brand-lime" aria-label="התמונה תקינה" />
            )}
            {slot.status === 'error' && (
              <div className="absolute inset-0 grid place-items-center bg-brand-coral/80">
                <AlertTriangle className="h-8 w-8 text-brand-white" aria-label="התמונה לא תקינה" />
              </div>
            )}
          </div>
          <p className="truncate text-center text-xs font-extrabold">{prompts[index].title}</p>
          {slot.status !== 'empty' && slot.status !== 'checking' && (
            <button
              type="button"
              onClick={() => onRetake(index)}
              className="mx-auto flex items-center gap-1 whitespace-nowrap rounded-lg border-2 border-brand-black bg-brand-white px-1.5 py-1
                text-xs font-extrabold shadow-brutal-xs transition hover:bg-brand-yellow active:translate-x-[1px] active:translate-y-[1px]"
            >
              <RotateCcw className="h-3 w-3" />
              צילום מחדש
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}
