import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, Banknote, Download, LogOut, RefreshCw, Ticket, UserPlus, XCircle,
} from 'lucide-react'
import {
  createOrder, fetchConfig, fetchOrdersWithTickets, fetchTiers, setOrderStatus,
} from '../lib/api'
import { supabase } from '../lib/supabase'
import {
  STATUS_LABELS, TICKET_TYPE_LIST, TICKET_TYPES, formatDateTime, formatMoney, isValidPhone,
} from '../lib/format'
import { priceFor, resolveActiveTier, totalCapacity } from '../lib/tiers'
import { downloadCsv } from '../lib/csv'
import { usePinGate } from '../hooks/usePinGate'
import PinGate from '../components/PinGate'
import ContactPicker from '../components/ContactPicker'
import { Button, Card, ErrorBanner, Field, FullPageSpinner, StatusPill, inputClass } from '../components/ui'

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
      <div className="p-6">
        <ErrorBanner error={error} />
      </div>
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
    <div className="mx-auto max-w-4xl space-y-6 p-4 pb-16 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <div>
          <h1 className="text-2xl font-black">{data.config?.event_name ?? 'ניהול האירוע'}</h1>
          <p className="text-sm text-slate-400">
            {activeTier ? `סבב פעיל: ${activeTier.name}` : 'כל הכרטיסים נמכרו'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={load} className="px-3">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            ייצוא CSV
          </Button>
          <Button variant="ghost" onClick={onLock} className="px-3">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric
          icon={Ticket}
          label="כרטיסים שנמכרו"
          value={`${metrics.sold} / ${metrics.capacity}`}
          hint={`${Math.max(metrics.capacity - metrics.sold, 0)} מקומות פנויים`}
        />
        <Metric
          icon={Banknote}
          label="הכנסות שאושרו"
          value={formatMoney(metrics.paidRevenue)}
          hint={`${formatMoney(metrics.pendingRevenue)} ממתינים לאישור`}
        />
        <Metric
          icon={BadgeCheck}
          label="נכנסו לאירוע"
          value={`${metrics.checkedIn} / ${metrics.eligible}`}
          hint="מתוך בעלי כרטיס מאושר"
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
  )
}

function Metric({ icon: Icon, label, value, hint }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-black">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  )
}

function PendingApprovals({ orders, busyOrderId, onApprove, onCancel }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-slate-400">
        ממתינים לאישור תשלום ({orders.length})
      </h2>
      {orders.length === 0 ? (
        <Card className="text-center text-sm text-slate-500">אין הזמנות שממתינות לאישור.</Card>
      ) : (
        orders.map((order) => (
          <Card key={order.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold">{order.buyer_name}</div>
              <div className="text-xs text-slate-400" dir="ltr">
                {order.buyer_phone}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {TICKET_TYPES[order.ticket_type]?.label} · {order.tickets_count} כרטיסים ·{' '}
                {formatDateTime(order.created_at)}
                {order.tier_name && ` · ${order.tier_name}`}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                משתתפים: {(order.tickets ?? []).map((ticket) => ticket.attendee_name).join(', ')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-lg font-black">{formatMoney(order.total_amount)}</div>
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
  const pricing = tier ? priceFor(tier, ticketType) : null

  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    setDone(null)
    if (name.trim().length < 2) return setError('נא למלא שם מלא')
    if (!isValidPhone(phone)) return setError('נא למלא מספר טלפון תקין')

    setBusy(true)
    try {
      const count = TICKET_TYPES[ticketType].count
      const attendees = Array.from({ length: count }, (_, index) => ({
        name: index === 0 ? name : `${name} (${index + 1})`,
        phone,
      }))
      await createOrder({
        buyerName: name,
        buyerPhone: phone,
        ticketType,
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
      <h2 className="text-sm font-bold text-slate-400">הוספת משתתף ידנית (משולם)</h2>
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
              {TICKET_TYPE_LIST.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTicketType(option.key)}
                  className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                    ticketType === option.key
                      ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          {pricing && (
            <p className="text-xs text-slate-500">
              ייווצרו {TICKET_TYPES[ticketType].count} כרטיסים בסכום {formatMoney(pricing.total)} לפי{' '}
              {tier.name}, בסטטוס "שולם".
            </p>
          )}

          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          {done && (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
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
      <h2 className="text-sm font-bold text-slate-400">כל ההזמנות ({orders.length})</h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-slate-800 text-xs text-slate-400">
            <tr>
              <th className="p-3 font-medium">שם</th>
              <th className="p-3 font-medium">טלפון</th>
              <th className="p-3 font-medium">כרטיס</th>
              <th className="p-3 font-medium">סכום</th>
              <th className="p-3 font-medium">סטטוס</th>
              <th className="p-3 font-medium">נכנסו</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const tickets = order.tickets ?? []
              return (
                <tr key={order.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="p-3 font-medium">{order.buyer_name}</td>
                  <td className="p-3 text-slate-400" dir="ltr">
                    {order.buyer_phone}
                  </td>
                  <td className="p-3 text-slate-400">
                    {TICKET_TYPES[order.ticket_type]?.label} ({order.tickets_count})
                  </td>
                  <td className="p-3">{formatMoney(order.total_amount)}</td>
                  <td className="p-3">
                    <StatusPill status={order.payment_status} />
                  </td>
                  <td className="p-3 text-slate-400">
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
