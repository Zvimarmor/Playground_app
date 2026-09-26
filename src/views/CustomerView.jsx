import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock, CheckCircle2, DoorOpen, ExternalLink, Lock, ShieldCheck, Ticket, User, Users, X,
} from 'lucide-react'
import { fetchConfig, fetchSoldCount, fetchTiers, createOrder } from '../lib/api'
import {
  GROUP_SOLD_OUT_NOTE, TICKET_TYPE_LIST, TICKET_TYPES, formatDateTime, formatMoney, isValidPhone,
} from '../lib/format'
import { isTypeAvailable, priceFor, resolveActiveTier } from '../lib/tiers'
import { BackButton, Badge, Button, Card, ErrorBanner, Field, FullPageSpinner, Sky, inputClass } from '../components/ui'
import EventHeader from '../components/EventHeader'

/** 'before' | 'after' | 'closed' | 'open' */
function salesState(config) {
  if (!config || !config.is_active) return 'closed'
  const now = Date.now()
  if (now < new Date(config.sales_start_at).getTime()) return 'before'
  if (now > new Date(config.sales_end_at).getTime()) return 'after'
  return 'open'
}

function Notice({ icon: Icon, title, children }) {
  return (
    <Sky>
      <div className="flex min-h-screen flex-col p-4 sm:p-6">
        <div className="grid flex-1 place-items-center">
          <Card className="max-w-md text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border-2 border-brand-black bg-brand-yellow shadow-brutal-xs">
              <Icon className="h-8 w-8 text-brand-black" />
            </div>
            <h1 className="text-2xl font-black">{title}</h1>
            <div className="mt-2 text-sm font-bold leading-relaxed text-brand-black/70">{children}</div>
          </Card>
        </div>
        <StaffFooter />
      </div>
    </Sky>
  )
}

/**
 * A quiet way in for the door team and the admin, kept faint so buyers read
 * past it. The staff pages still ask for their PIN - this only saves typing
 * the address.
 */
function StaffFooter() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <footer className="pt-10 text-center">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-brand-black/30
          transition hover:text-brand-black/60 focus-visible:text-brand-black/60"
      >
        <Lock className="h-3 w-3" />
        צוות
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-brand-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-dialog-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xs space-y-4 rounded-3xl border-[3px] border-brand-black bg-brand-white p-5 text-right shadow-brutal-lg"
          >
            <div className="flex items-center justify-between">
              <h2 id="staff-dialog-title" className="text-lg font-black">
                כניסת צוות
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="p-1" autoFocus>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-2">
              <StaffLink to="/door" icon={DoorOpen}>
                הלפרים
              </StaffLink>
              <StaffLink to="/admin" icon={ShieldCheck}>
                מנהלים
              </StaffLink>
            </div>
          </div>
        </div>
      )}
    </footer>
  )
}

function StaffLink({ to, icon: Icon, children }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-2xl border-2 border-brand-black bg-brand-white px-4 py-3
        text-sm font-extrabold shadow-brutal-sm transition-all hover:bg-brand-yellow
        active:translate-x-[2px] active:translate-y-[2px] active:shadow-brutal-xs"
    >
      <Icon className="h-5 w-5" />
      {children}
    </Link>
  )
}

export default function CustomerView() {
  const [state, setState] = useState({ loading: true, error: null, config: null, tiers: [], sold: 0 })
  const [ticketType, setTicketType] = useState('single')
  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [guests, setGuests] = useState(['', '', ''])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [confirmation, setConfirmation] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchConfig(), fetchTiers(), fetchSoldCount()])
      .then(([config, tiers, sold]) => {
        if (!cancelled) setState({ loading: false, error: null, config, tiers, sold })
      })
      .catch((error) => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error }))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Back from the confirmation to a blank form, with the sold count refreshed
  // so the round and price reflect the order that was just placed.
  const startOver = () => {
    setConfirmation(null)
    setTicketType('single')
    setBuyerName('')
    setBuyerPhone('')
    setGuests(['', '', ''])
    window.scrollTo(0, 0)
    fetchSoldCount()
      .then((latest) => setState((prev) => ({ ...prev, sold: latest })))
      .catch(() => {})
  }

  const { config, tiers, sold, loading, error } = state
  const { tier, totalCapacity } = useMemo(
    () => resolveActiveTier(tiers, sold),
    [tiers, sold]
  )
  // The last round sells singles only, so a stale "quad" selection falls back
  // to a single rather than rendering a price the tier does not offer.
  const selectedType = isTypeAvailable(tier, ticketType) ? ticketType : 'single'

  const remainingOverall = Math.max(totalCapacity - sold, 0)

  if (loading) return <FullPageSpinner />
  if (error) {
    return (
      <Notice icon={CalendarClock} title="שגיאה בטעינה">
        {error.message}
      </Notice>
    )
  }

  if (confirmation) {
    return <Confirmation confirmation={confirmation} payboxUrl={config.paybox_url} onBack={startOver} />
  }

  const status = salesState(config)
  if (status === 'closed') {
    return <Notice icon={CalendarClock} title="המכירה סגורה">המכירה אינה פעילה כרגע. נתראה בפעם הבאה!</Notice>
  }
  if (status === 'before') {
    return (
      <Notice icon={CalendarClock} title="המכירה עוד לא נפתחה">
        המכירה תיפתח בתאריך <strong>{formatDateTime(config.sales_start_at)}</strong>. שווה לחזור לכאן בזמן.
      </Notice>
    )
  }
  if (status === 'after') {
    return (
      <Notice icon={CalendarClock} title="המכירה נסגרה">
        המכירה נסגרה בתאריך <strong>{formatDateTime(config.sales_end_at)}</strong>.
      </Notice>
    )
  }
  if (!tier) {
    return <Notice icon={Ticket} title="הכרטיסים אזלו">כל הכרטיסים נמכרו. תודה על ההיענות!</Notice>
  }

  const meta = TICKET_TYPES[selectedType]
  const extraGuests = meta.count - 1
  const pricing = priceFor(tier, selectedType)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError(null)

    if (buyerName.trim().length < 2) return setFormError('נא למלא שם מלא')
    if (!isValidPhone(buyerPhone)) return setFormError('נא למלא מספר טלפון תקין')
    const names = guests.slice(0, extraGuests).map((name) => name.trim())
    if (names.some((name) => name.length < 2)) return setFormError('נא למלא את שמות כל המשתתפים')

    setSubmitting(true)
    try {
      const result = await createOrder({ buyerName, buyerPhone, ticketType: selectedType, guestNames: names })
      setConfirmation(result)
    } catch (err) {
      setFormError(err.message)
      // Most failures mean the page is stale (tier moved on, seats ran out),
      // so bring the round and price shown here up to date.
      fetchSoldCount()
        .then((latest) => setState((prev) => ({ ...prev, sold: latest })))
        .catch(() => {})
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sky>
      <div className="mx-auto max-w-lg space-y-5 p-4 pb-16 sm:p-6">
        <div className="pt-2">
          <EventHeader />
        </div>

        <section className="rounded-3xl border-[3px] border-brand-black bg-brand-lime p-4 shadow-brutal">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold uppercase tracking-widest text-brand-black/70">
                הסבב שנמכר עכשיו
              </div>
              <div className="text-2xl font-black leading-tight">{tier.name}</div>
            </div>
            <Badge tone="black">מכירה עד {formatDateTime(config.sales_end_at)}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="white">{remainingOverall} מתוך {totalCapacity} כרטיסים פנויים</Badge>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-black">בחירת כרטיס</h2>
          {TICKET_TYPE_LIST.map((option) => (
            <TicketOption
              key={option.key}
              option={option}
              pricing={priceFor(tier, option.key)}
              selected={option.key === selectedType}
              disabled={!isTypeAvailable(tier, option.key)}
              onSelect={() => setTicketType(option.key)}
            />
          ))}
        </section>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Card className="space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-black">
              <User className="h-5 w-5" />
              פרטי הרוכש
            </h2>
            <Field label="שם מלא">
              <input
                className={inputClass}
                value={buyerName}
                onChange={(event) => setBuyerName(event.target.value)}
                placeholder="ישראל ישראלי"
                autoComplete="name"
              />
            </Field>
            <Field label="טלפון" hint="לצורך זיהוי בכניסה ועדכונים על האירוע">
              <input
                className={inputClass}
                type="tel"
                value={buyerPhone}
                onChange={(event) => setBuyerPhone(event.target.value)}
                placeholder="050-0000000"
                autoComplete="tel"
              />
            </Field>
          </Card>

          {extraGuests > 0 && (
            <Card className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-black">
                <Users className="h-5 w-5" />
                שמות המשתתפים הנוספים ({extraGuests})
              </h2>
              {Array.from({ length: extraGuests }, (_, index) => (
                <Field key={index} label={`משתתף ${index + 2}`}>
                  <input
                    className={inputClass}
                    value={guests[index]}
                    onChange={(event) => {
                      const next = [...guests]
                      next[index] = event.target.value
                      setGuests(next)
                    }}
                    placeholder="שם מלא"
                  />
                </Field>
              ))}
              <p className="text-xs font-bold text-brand-black/60">
                מספר הטלפון של הרוכש ישויך לכל המשתתפים בהזמנה.
              </p>
            </Card>
          )}

          <ErrorBanner error={formError} />

          <div className="sticky bottom-0 -mx-4 border-t-[3px] border-brand-black bg-brand-white p-4 sm:mx-0 sm:rounded-3xl sm:border-[3px] sm:shadow-brutal">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-extrabold text-brand-black/70">
                {meta.label} · {meta.count} {meta.count === 1 ? 'כרטיס' : 'כרטיסים'}
              </span>
              <span className="text-2xl font-black">{formatMoney(pricing.total)}</span>
            </div>
            <Button type="submit" busy={submitting} className="w-full py-4 text-lg">
              <Ticket className="h-6 w-6" />
              המשך לתשלום בפייבוקס
            </Button>
          </div>
        </form>

        <StaffFooter />
      </div>
    </Sky>
  )
}

function TicketOption({ option, pricing, selected, disabled, onSelect }) {
  const isGroup = option.count > 1
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`w-full rounded-3xl border-[3px] border-brand-black p-4 text-right shadow-brutal
        transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-brutal-xs
        disabled:cursor-not-allowed disabled:active:translate-x-0 disabled:active:translate-y-0
        disabled:active:shadow-brutal ${
          disabled ? 'bg-brand-white/60' : selected ? 'bg-brand-yellow' : 'bg-brand-white'
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {isGroup ? <Users className="h-5 w-5" /> : <User className="h-5 w-5" />}
            <span className="text-lg font-black">{option.label}</span>
            <span className="text-sm font-bold text-brand-black/60">
              {option.count} {option.count === 1 ? 'כרטיס' : 'כרטיסים'}
            </span>
          </div>

          {disabled ? (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-xl border-2 border-brand-black bg-brand-coral px-3 py-1 text-xs font-extrabold text-brand-white">
              <Lock className="h-3.5 w-3.5" />
              {GROUP_SOLD_OUT_NOTE}
            </div>
          ) : (
            <>
              {pricing.discount > 0 && (
                <div className="mt-2">
                  <Badge tone="lime">חיסכון של {formatMoney(pricing.discount)}!</Badge>
                </div>
              )}
              {isGroup && (
                <div className="mt-2 text-sm font-bold text-brand-black/60">
                  {formatMoney(pricing.perPerson)} לאדם · במקום {formatMoney(pricing.fullPrice)}
                </div>
              )}
            </>
          )}
        </div>

        {!disabled && (
          <div className="shrink-0 text-3xl font-black">{formatMoney(pricing.total)}</div>
        )}
      </div>
    </button>
  )
}

function Confirmation({ confirmation, payboxUrl, onBack }) {
  const { order, tierName } = confirmation
  return (
    <Sky>
      <div className="mx-auto max-w-lg space-y-5 p-4 pb-16 sm:p-6">
        <BackButton onClick={onBack} />
        <div>
          <EventHeader compact />
        </div>

        <Card className="space-y-4 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border-2 border-brand-black bg-brand-lime shadow-brutal-xs">
            <CheckCircle2 className="h-9 w-9 text-brand-black" />
          </div>
          <h1 className="text-3xl font-black">ההרשמה נקלטה!</h1>
          <p className="text-sm font-bold leading-relaxed text-brand-black/70">
            לחצו על הכפתור כדי להעביר את התשלום בפייבוקס. הקפידו לרשום את השם המלא בהערת ההעברה.
            הכרטיסים יאושרו סופית לאחר קליטת התשלום.
          </p>

          <div className="space-y-1 rounded-2xl border-[3px] border-brand-black bg-brand-yellow p-4 text-sm font-bold">
            <Row label="שם">{order.buyer_name}</Row>
            <Row label="סוג כרטיס">{TICKET_TYPES[order.ticket_type]?.label}</Row>
            <Row label="מספר כרטיסים">{order.tickets_count}</Row>
            <Row label="סבב">{tierName}</Row>
            <Row label="סכום להעברה">
              <strong className="text-xl font-black">{formatMoney(order.total_amount)}</strong>
            </Row>
          </div>

          <p className="rounded-xl border-2 border-black bg-brand-yellow p-3 text-center text-sm font-bold text-black shadow-[3px_3px_0px_#000]">
            שימו לב: כדי שהכרטיס יאושר, חשוב להעביר בדיוק את הסכום שמופיע למעלה. העברות בסכום שונה לא
            יאושרו וההזמנה תבוטל אוטומטית (וחבל לפספס את המקום ברחבה&nbsp;💃🕺).
          </p>

          <a href={payboxUrl} target="_blank" rel="noopener noreferrer" className="block">
            <Button className="w-full py-4 text-lg" type="button">
              <ExternalLink className="h-5 w-5" />
              לתשלום בפייבוקס
            </Button>
          </a>

          <p className="text-xs font-bold text-brand-black/60">
            שמרו את המסך הזה. אם התשלום כבר בוצע - הכרטיסים יופיעו ברשימת הכניסה תוך זמן קצר.
          </p>
        </Card>
      </div>
    </Sky>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-brand-black/70">{label}</span>
      <span>{children}</span>
    </div>
  )
}
