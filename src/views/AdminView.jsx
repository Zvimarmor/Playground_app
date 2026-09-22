import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, Banknote, Download, Hourglass, LogOut, RefreshCw, Ticket, UserPlus, XCircle,
} from 'lucide-react'
import {
  createOrder, fetchConfig, fetchOrdersWithTickets, fetchTiers, setOrderStatus,
} from '../lib/api'
import { supabase } from '../lib/supabase'
import {
  GROUP_SOLD_OUT_NOTE, STATUS_LABELS, TICKET_TYPE_LIST, TICKET_TYPES,
  formatDateTime, formatMoney, isValidPhone,
} from '../lib/format'
import { isTypeAvailable, priceFor, resolveActiveTier, totalCapacity } from '../lib/tiers'
import { downloadCsv } from '../lib/csv'
import { usePinGate } from '../hooks/usePinGate'
import PinGate from '../components/PinGate'
import ContactPicker from '../components/ContactPicker'
import EventHeader from '../components/EventHeader'
import {
  Badge, Button, Card, ErrorBanner, Field, FullPageSpinner, Sky, StatusPill, inputClass,
} from '../components/ui'

export default function AdminView() {
  const gate = usePinGate('admin')

  if (!gate.unlocked) {
    return (
      <PinGate
        title="ניהול האירוע"
        subtitle="הזינו את קוד המנהל"
        checking={gate.checking}
        error={gate.error}
        onSubmit={gate.submit}
      />
    )
  }
  return <Dashboard onLock={gate.lock} />
}

function Dashboard({ onLock }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busyOrderId, setBusyOrderId] = useState(null)

  const load = useCallback(async () => {
    try {
      const [config, tiers, orders] = await Promise.all([
        fetchConfig(),
        fetchTiers(),
        fetchOrdersWithTickets(),
      ])
      setData({ config, tiers, orders })
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('admin-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const metrics = useMemo(() => {
    if (!data) return null
    const live = data.orders.filter((order) => order.payment_status !== 'cancelled')
    const paid = data.orders.filter((order) => order.payment_status === 'paid')
    const pending = data.orders.filter((order) => order.payment_status === 'pending')
    const paidTickets = paid.flatMap((order) => order.tickets ?? [])
    return {
      sold: live.reduce((sum, order) => sum + order.tickets_count, 0),
      capacity: totalCapacity(data.tiers),
      paidRevenue: paid.reduce((sum, order) => sum + Number(order.total_amount), 0),
      pendingRevenue: pending.reduce((sum, order) => sum + Number(order.total_amount), 0),
      eligible: paidTickets.length,
      checkedIn: paidTickets.filter((ticket) => ticket.is_checked_in).length,
      pendingOrders: pending,
    }
  }, [data])

  if (!data || !metrics) {
    return error ? (
      <Sky>
        <div className="p-6">
          <ErrorBanner error={error} />
        </div>
      </Sky>
    ) : (
      <FullPageSpinner />
    )
  }

  const { tier: activeTier } = resolveActiveTier(data.tiers, metrics.sold)

  const updateStatus = async (orderId, status) => {
    setBusyOrderId(orderId)
    try {
      await setOrderStatus(orderId, status)
      await load()
    } catch (err) {
      setError(err)
    } finally {
      setBusyOrderId(null)
    }
  }

  const exportCsv = () => {
    const rows = data.orders.flatMap((order) =>
      (order.tickets ?? []).map((ticket) => [
        ticket.attendee_name,
        ticket.phone ?? '',
        TICKET_TYPES[order.ticket_type]?.label ?? order.ticket_type,
        STATUS_LABELS[order.payment_status],
        ticket.is_checked_in ? `נכנס ב-${formatDateTime(ticket.checked_in_at)}` : 'לא נכנס',
      ])
    )
    downloadCsv(
      `attendees-${new Date().toISOString().slice(0, 10)}.csv`,
      ['שם', 'טלפון', 'סוג כרטיס', 'סטטוס תשלום', 'כניסה'],
      rows
    )
  }

  return (
    <Sky>
      <div className="mx-auto max-w-4xl space-y-6 p-4 pb-16 sm:p-6">
        <div className="pt-2">
          <EventHeader compact />
        </div>

        <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-[3px] border-brand-black bg-brand-white p-4 shadow-brutal">
          <div>
            <h1 className="text-xl font-black">{data.config?.event_name ?? 'ניהול האירוע'}</h1>
            <div className="mt-1">
              <Badge tone={activeTier ? 'lime' : 'coral'}>
                {activeTier ? `סבב פעיל: ${activeTier.name}` : 'כל הכרטיסים נמכרו'}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={load} aria-label="רענון" className="px-3">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={exportCsv}>
              <Download className="h-4 w-4" />
              ייצוא CSV
            </Button>
            <Button variant="ghost" onClick={onLock} aria-label="יציאה" className="px-3">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric
            tone="lime"
            icon={Ticket}
            label="כרטיסים שנמכרו"
            value={<span dir="ltr">{metrics.sold} / {metrics.capacity}</span>}
            hint={`${Math.max(metrics.capacity - metrics.sold, 0)} מקומות פנויים`}
          />
          <Metric
            tone="yellow"
            icon={Banknote}
            label='סה"כ הכנסות מאושרות'
            value={formatMoney(metrics.paidRevenue)}
            hint={`${metrics.checkedIn} מתוך ${metrics.eligible} כבר נכנסו לאירוע`}
          />
          <Metric
            tone="coral"
            icon={Hourglass}
            label="ממתינים לאישור תשלום"
            value={metrics.pendingOrders.length}
            hint={`${formatMoney(metrics.pendingRevenue)} ממתינים לאישור`}
          />
        </section>

        <PendingApprovals
          orders={metrics.pendingOrders}
          busyOrderId={busyOrderId}
          onApprove={(id) => updateStatus(id, 'paid')}
          onCancel={(id) => updateStatus(id, 'cancelled')}
        />

        <ManualEntry tiers={data.tiers} sold={metrics.sold} onCreated={load} />

        <AllOrders orders={data.orders} />
      </div>
    </Sky>
  )
}

function Metric({ icon: Icon, label, value, hint, tone }) {
  const tones = {
    lime: 'bg-brand-lime text-brand-black',
    yellow: 'bg-brand-yellow text-brand-black',
    coral: 'bg-brand-coral text-brand-white',
  }
  return (
    <div className={`rounded-3xl border-[3px] border-brand-black p-5 shadow-brutal ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-sm font-extrabold">
        <Icon className="h-5 w-5" />
        {label}
      </div>
      <div className="mt-2 text-3xl font-black">{value}</div>
      {hint && <div className="mt-1 text-xs font-bold opacity-75">{hint}</div>}
    </div>
  )
}

function SectionTitle({ children }) {
  return <h2 className="text-lg font-black text-brand-white drop-shadow-[2px_2px_0_#000]">{children}</h2>
}

function PendingApprovals({ orders, busyOrderId, onApprove, onCancel }) {
  return (
    <section className="space-y-3">
      <SectionTitle>ממתינים לאישור תשלום ({orders.length})</SectionTitle>
      {orders.length === 0 ? (
        <Card className="text-center text-sm font-extrabold text-brand-black/60">
          אין הזמנות שממתינות לאישור.
        </Card>
      ) : (
        orders.map((order) => (
          <Card key={order.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-black">{order.buyer_name}</div>
              <div className="text-sm font-bold text-brand-black/60" dir="ltr">
                {order.buyer_phone}
              </div>
              <div className="mt-1 text-xs font-bold text-brand-black/60">
                {TICKET_TYPES[order.ticket_type]?.label} · {order.tickets_count} כרטיסים ·{' '}
                {formatDateTime(order.created_at)}
                {order.tier_name && ` · ${order.tier_name}`}
              </div>
              <div className="mt-1 text-xs font-bold text-brand-black/70">
                משתתפים: {(order.tickets ?? []).map((ticket) => ticket.attendee_name).join(', ')}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-2xl font-black">{formatMoney(order.total_amount)}</div>
              <Button
                variant="success"
                busy={busyOrderId === order.id}
                onClick={() => onApprove(order.id)}
              >
                <BadgeCheck className="h-4 w-4" />
                אשר תשלום
              </Button>
              <Button
                variant="danger"
                busy={busyOrderId === order.id}
                onClick={() => onCancel(order.id)}
              >
                <XCircle className="h-4 w-4" />
                בטל הזמנה
              </Button>
            </div>
          </Card>
        ))
      )}
    </section>
  )
}

function ManualEntry({ tiers, sold, onCreated }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ticketType, setTicketType] = useState('single')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const { tier } = resolveActiveTier(tiers, sold)
  // Same rule as the storefront: a tier without a group price cannot sell one.
  const selectedType = isTypeAvailable(tier, ticketType) ? ticketType : 'single'
  const pricing = tier ? priceFor(tier, selectedType) : null

  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    setDone(null)
    if (name.trim().length < 2) return setError('נא למלא שם מלא')
    if (!isValidPhone(phone)) return setError('נא למלא מספר טלפון תקין')

    setBusy(true)
    try {
      const count = TICKET_TYPES[selectedType].count
      const attendees = Array.from({ length: count }, (_, index) => ({
        name: index === 0 ? name : `${name} (${index + 1})`,
        phone,
      }))
      await createOrder({
        buyerName: name,
        buyerPhone: phone,
        ticketType: selectedType,
        attendees,
        status: 'paid',
      })
      setDone(`${name} נוסף/ה לרשימה`)
      setName('')
      setPhone('')
      setTicketType('single')
      await onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <SectionTitle>הוספת משתתף ידנית (משולם)</SectionTitle>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <ContactPicker
            onPick={({ name: pickedName, phone: pickedPhone }) => {
              if (pickedName) setName(pickedName)
              if (pickedPhone) setPhone(pickedPhone)
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="שם מלא">
              <input
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ישראל ישראלי"
              />
            </Field>
            <Field label="טלפון">
              <input
                className={inputClass}
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="050-0000000"
              />
            </Field>
          </div>

          <Field label="סוג כרטיס">
            <div className="flex flex-wrap gap-2">
              {TICKET_TYPE_LIST.map((option) => {
                const available = isTypeAvailable(tier, option.key)
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={!available}
                    onClick={() => setTicketType(option.key)}
                    className={`rounded-2xl border-2 border-brand-black px-4 py-2.5 text-sm font-extrabold
                      shadow-brutal-xs transition-all active:translate-x-[2px] active:translate-y-[2px]
                      disabled:cursor-not-allowed disabled:opacity-40 ${
                        selectedType === option.key ? 'bg-brand-yellow' : 'bg-brand-white'
                      }`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {tier && !isTypeAvailable(tier, 'quad') && (
              <p className="mt-2 text-xs font-extrabold text-brand-coral">{GROUP_SOLD_OUT_NOTE}</p>
            )}
          </Field>

          {pricing && (
            <p className="text-xs font-bold text-brand-black/60">
              ייווצרו {TICKET_TYPES[selectedType].count} כרטיסים בסכום {formatMoney(pricing.total)} לפי{' '}
              {tier.name}, בסטטוס "שולם".
            </p>
          )}

          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          {done && (
            <p className="rounded-2xl border-[3px] border-brand-black bg-brand-lime px-4 py-3 text-sm font-extrabold shadow-brutal-xs">
              {done}
            </p>
          )}

          <Button type="submit" busy={busy} disabled={!tier}>
            <UserPlus className="h-4 w-4" />
            הוסף לרשימה
          </Button>
        </form>
      </Card>
    </section>
  )
}

function AllOrders({ orders }) {
  return (
    <section className="space-y-3">
      <SectionTitle>כל ההזמנות ({orders.length})</SectionTitle>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-right text-sm">
          <thead className="border-b-[3px] border-brand-black bg-brand-yellow text-xs font-black">
            <tr>
              <th className="p-3">שם</th>
              <th className="p-3">טלפון</th>
              <th className="p-3">כרטיס</th>
              <th className="p-3">סכום</th>
              <th className="p-3">סטטוס</th>
              <th className="p-3">נכנסו</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const tickets = order.tickets ?? []
              return (
                <tr key={order.id} className="border-b-2 border-brand-black/15 last:border-0">
                  <td className="p-3 font-extrabold">{order.buyer_name}</td>
                  <td className="p-3 font-bold text-brand-black/60" dir="ltr">
                    {order.buyer_phone}
                  </td>
                  <td className="p-3 font-bold text-brand-black/70">
                    {TICKET_TYPES[order.ticket_type]?.short ?? order.ticket_type} ({order.tickets_count})
                  </td>
                  <td className="p-3 font-black">{formatMoney(order.total_amount)}</td>
                  <td className="p-3">
                    <StatusPill status={order.payment_status} />
                  </td>
                  <td className="p-3 font-bold text-brand-black/70" dir="ltr">
                    {tickets.filter((ticket) => ticket.is_checked_in).length} / {tickets.length}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </section>
  )
}
