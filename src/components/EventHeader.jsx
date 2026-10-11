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
 * The poster, rebuilt in CSS: big retro wordmark, the facts people need, the
 * vibe and the lineup. `compact` keeps just the wordmark and the three facts
 * for the staff views and the confirmation screen.
 */
export default function EventHeader({ compact = false }) {
  return (
    <header className="@container rounded-3xl border-[3px] border-brand-black bg-brand-white p-5 shadow-brutal sm:p-6">
      <h1
        className="text-center font-display text-[clamp(2rem,13.5cqi,4.5rem)] font-black uppercase
          leading-[0.85] tracking-tight text-brand-black"
        style={{ textShadow: '4px 4px 0 var(--color-brand-lime)' }}
        dir="ltr"
      >
        {EVENT.title}
        {!compact && <span className="ms-2 inline-block [text-shadow:none]">{EVENT.emoji}</span>}
      </h1>

      {compact ? (
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
      ) : (
        <>
          <p className="mt-4 text-center text-base font-extrabold leading-snug sm:text-lg">{EVENT.tagline}</p>
          <EventFacts />
          <Vibe />
          <Lineup />
        </>
      )}
    </header>
  )
}

function EventFacts() {
  return (
    <div className="mt-5 grid gap-2.5">
      <div
        className="flex items-center justify-center gap-2 rounded-2xl border-2 border-brand-black bg-brand-lime
          px-4 py-3 text-lg font-black shadow-brutal-sm sm:text-xl"
      >
        <span aria-hidden="true">🍺</span>
        אלכוהול חופשי
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <FactChip emoji="🍃" title={EVENT.venue} note={EVENT.venueNote} />
        <FactChip
          emoji="🗓️"
          title={`${EVENT.day}, ${EVENT.date}`}
          note={<span dir="ltr">{EVENT.time}</span>}
          className="bg-brand-yellow"
        />
      </div>
    </div>
  )
}

function FactChip({ emoji, title, note, className = 'bg-brand-white' }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border-2 border-brand-black px-3 py-2.5 shadow-brutal-xs ${className}`}
    >
      <span className="text-2xl" aria-hidden="true">
        {emoji}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-black leading-tight sm:text-base">{title}</div>
        <div className="text-xs font-bold text-brand-black/70">{note}</div>
      </div>
    </div>
  )
}

function Vibe() {
  return (
    <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm font-extrabold">
      {EVENT.vibe.map((genre, i) => (
        <span key={genre} className="flex items-center gap-2">
          {i > 0 && (
            <span className="text-brand-coral" aria-hidden="true">
              •
            </span>
          )}
          {genre}
        </span>
      ))}
    </p>
  )
}

function Lineup() {
  return (
    <div className="mt-4 rounded-2xl border-2 border-brand-black bg-brand-black p-2.5 shadow-brutal-xs">
      <p className="mb-2 text-center text-[0.65rem] font-extrabold tracking-[0.3em] text-brand-lime" dir="ltr">
        LINEUP
      </p>
      {/* One compact chip per act so names wrap as whole units, never mid-name. */}
      <ul dir="ltr" className="flex flex-wrap justify-center gap-1.5">
        {EVENT.lineup.map((act, i) => (
          <li
            key={act.names.join('-')}
            className={`rounded-lg border-2 border-brand-black px-2.5 py-1 text-center leading-tight
              ${LINEUP_TONES[i % LINEUP_TONES.length]}`}
          >
            <div className="whitespace-nowrap text-sm font-black">
              {act.names.join(' B2B ')}
            </div>
            <div className="text-[0.65rem] font-bold opacity-70">{act.genres.join(' • ')}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
