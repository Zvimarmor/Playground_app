import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, ExternalLink, Ticket, Users } from 'lucide-react'
import { fetchConfig, fetchSoldCount, fetchTiers, createOrder } from '../lib/api'
import { TICKET_TYPE_LIST, TICKET_TYPES, formatDateTime, formatMoney, isValidPhone } from '../lib/format'
import { priceFor, resolveActiveTier } from '../lib/tiers'
import { Button, Card, ErrorBanner, Field, FullPageSpinner, inputClass } from '../components/ui'

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
    <div className="min-h-screen grid place-items-center p-6">
      <Card className="max-w-md text-center">
        <Icon className="mx-auto mb-3 h-10 w-10 text-sky-400" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="mt-2 text-sm leading-relaxed text-slate-300">{children}</div>
      </Card>
    </div>
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

  const { config, tiers, sold, loading, error } = state
  const { tier, remainingInTier, totalCapacity } = useMemo(
    () => resolveActiveTier(tiers, sold),
    [tiers, sold]
  )
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
    return <Confirmation confirmation={confirmation} payboxUrl={config.paybox_url} />
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

  const meta = TICKET_TYPES[ticketType]
  const extraGuests = meta.count - 1
  const pricing = priceFor(tier, ticketType)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError(null)

    if (buyerName.trim().length < 2) return setFormError('נא למלא שם מלא')
    if (!isValidPhone(buyerPhone)) return setFormError('נא למלא מספר טלפון תקין')
    const names = guests.slice(0, extraGuests).map((name) => name.trim())
    if (names.some((name) => name.length < 2)) return setFormError('נא למלא את שמות כל המשתתפים')

    setSubmitting(true)
    try {
      const attendees = [
        { name: buyerName, phone: buyerPhone },
        ...names.map((name) => ({ name, phone: buyerPhone })),
      ]
      const result = await createOrder({ buyerName, buyerPhone, ticketType, attendees })
      setConfirmation({ ...result, buyerName })
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 p-4 pb-16 sm:p-6">
      <header className="pt-4 text-center">
        <h1 className="text-3xl font-black">{config.event_name}</h1>
        <p className="mt-2 text-sm text-slate-400">
          מכירה פתוחה עד {formatDateTime(config.sales_end_at)}
        </p>
        <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 font-bold text-sky-300">
            {tier.name}
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
            נותרו {remainingInTier} מקומות במחיר הזה
          </span>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-slate-300">
            {remainingOverall} מתוך {totalCapacity} כרטיסים פנויים
          </span>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-400">בחירת כרטיס</h2>
        {TICKET_TYPE_LIST.map((option) => {
          const optionPricing = priceFor(tier, option.key)
          const selected = option.key === ticketType
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setTicketType(option.key)}
              className={`w-full rounded-2xl border p-4 text-right transition ${
                selected
                  ? 'border-sky-500 bg-sky-500/10 ring-2 ring-sky-500/30'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-bold">
                    <Users className="h-4 w-4 text-slate-400" />
                    {option.label}
                    <span className="text-xs font-normal text-slate-500">
                      {option.count} {option.count === 1 ? 'כרטיס' : 'כרטיסים'}
                    </span>
                  </div>
                  {optionPricing.discount > 0 && (
                    <div className="mt-1 text-xs text-emerald-400">
                      במקום {formatMoney(optionPricing.fullPrice)} · חיסכון של{' '}
                      {formatMoney(optionPricing.discount)}
                    </div>
                  )}
                  {option.count > 1 && (
                    <div className="mt-0.5 text-xs text-slate-500">
                      {formatMoney(optionPricing.perPerson)} לאדם
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-2xl font-black">{formatMoney(optionPricing.total)}</div>
              </div>
            </button>
          )
        })}
      </section>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="space-y-4">
          <h2 className="text-sm font-bold text-slate-400">פרטי הרוכש</h2>
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
            <h2 className="text-sm font-bold text-slate-400">
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
            <p className="text-xs text-slate-500">
              מספר הטלפון של הרוכש ישויך לכל המשתתפים בהזמנה.
            </p>
          </Card>
        )}

        <ErrorBanner error={formError} />

        <div className="sticky bottom-0 -mx-4 border-t border-slate-800 bg-slate-950/95 p-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-slate-400">
              {meta.label} · {meta.count} {meta.count === 1 ? 'כרטיס' : 'כרטיסים'}
            </span>
            <span className="text-xl font-black">{formatMoney(pricing.total)}</span>
          </div>
          <Button type="submit" busy={submitting} className="w-full py-4 text-base">
            <Ticket className="h-5 w-5" />
            המשך לתשלום
          </Button>
        </div>
      </form>
    </div>
  )
}

function Confirmation({ confirmation, payboxUrl }) {
  const { order, tier } = confirmation
  return (
    <div className="mx-auto max-w-lg space-y-5 p-4 sm:p-6">
      <Card className="mt-8 space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-400" />
        <h1 className="text-2xl font-black">ההרשמה נקלטה!</h1>
        <p className="text-sm leading-relaxed text-slate-300">
          לחץ על הכפתור כדי להעביר את התשלום בפייבוקס. הקפד לרשום את שמך המלא בהערת ההעברה.
          הכרטיסים יאושרו סופית לאחר קליטת התשלום.
        </p>

        <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm">
          <Row label="שם">{order.buyer_name}</Row>
          <Row label="סוג כרטיס">{TICKET_TYPES[order.ticket_type].label}</Row>
          <Row label="מספר כרטיסים">{order.tickets_count}</Row>
          <Row label="מחיר">{tier.name}</Row>
          <Row label="סכום להעברה">
            <strong className="text-lg">{formatMoney(order.total_amount)}</strong>
          </Row>
        </div>

        <a href={payboxUrl} target="_blank" rel="noopener noreferrer" className="block">
          <Button variant="success" className="w-full py-4 text-base" type="button">
            <ExternalLink className="h-5 w-5" />
            לתשלום בפייבוקס
          </Button>
        </a>

        <p className="text-xs text-slate-500">
          שמרו את המסך הזה. אם התשלום כבר בוצע - הכרטיסים יופיעו ברשימת הכניסה תוך זמן קצר.
        </p>
      </Card>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span>{children}</span>
    </div>
  )
}
