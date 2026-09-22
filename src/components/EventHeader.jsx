import { CalendarDays, Clock, MapPin } from 'lucide-react'
import { EVENT } from '../lib/event'
import { Badge } from './ui'

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
        <div className="mt-4 flex justify-center">
          <div
            dir="ltr"
            className="rounded-2xl border-2 border-brand-black bg-brand-black px-4 py-2 text-center
              text-sm font-extrabold tracking-widest text-brand-lime shadow-brutal-xs sm:text-base"
          >
            {EVENT.lineup.join(' • ')}
          </div>
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
