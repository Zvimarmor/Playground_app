import { CalendarDays, Clock, MapPin } from 'lucide-react'
import { EVENT } from '../lib/event'
import { Badge } from './ui'

const LINEUP_TONES = [
  'bg-brand-lime text-brand-black',
  'bg-brand-yellow text-brand-black',
  'bg-brand-coral text-brand-white',
  'bg-brand-white text-brand-black',
]

/**
 * The poster, rebuilt in CSS: big retro wordmark, the three facts people need,
 * and the lineup teaser. `compact` drops the lineup for the staff views.
 */
export default function EventHeader({ compact = false }) {
  return (
    <header className="@container rounded-3xl border-[3px] border-brand-black bg-brand-white p-5 shadow-brutal sm:p-6">
      <h1
        className="text-center font-display text-[clamp(2rem,13.5cqi,4.5rem)] font-black uppercase
          leading-[0.85] tracking-tight text-brand-black"
        style={{ WebkitTextStroke: '0px', textShadow: '4px 4px 0 var(--color-brand-lime)' }}
        dir="ltr"
      >
        {EVENT.title}
      </h1>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Badge tone="coral">
          <CalendarDays className="h-4 w-4" />
          <span dir="ltr">{EVENT.date}</span>
        </Badge>
        <Badge tone="yellow">
          <Clock className="h-4 w-4" />
          <span dir="ltr">{EVENT.time}</span>
        </Badge>
        <Badge tone="lime">
          <MapPin className="h-4 w-4" />
          {EVENT.venue}
        </Badge>
      </div>

      {!compact && (
        <div className="mt-4 rounded-2xl border-2 border-brand-black bg-brand-black p-3 shadow-brutal-xs">
          <p className="mb-2 text-center text-[0.65rem] font-extrabold tracking-[0.3em] text-brand-lime" dir="ltr">
            LINEUP
          </p>
          {/* One pill per artist so names wrap as whole units, never mid-name. */}
          <ul dir="ltr" className="flex flex-wrap justify-center gap-2">
            {EVENT.lineup.map((artist, i) => (
              <li
                key={artist}
                className={`whitespace-nowrap rounded-xl border-2 border-brand-black px-3 py-1 text-xs
                  font-black tracking-wider shadow-[2px_2px_0_var(--color-brand-lime)] sm:text-sm
                  ${LINEUP_TONES[i % LINEUP_TONES.length]}`}
              >
                {artist}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <p className="mt-3 text-center text-xs font-bold text-brand-black/60">
          {EVENT.venueEn}
        </p>
      )}
    </header>
  )
}
