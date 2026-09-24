import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogOut, RefreshCw, Search, Undo2, UserCheck } from 'lucide-react'
import { fetchPaidTickets, setCheckIn, subscribeToChanges } from '../lib/api'
import { digitsOnly, formatTime } from '../lib/format'
import { usePinGate } from '../hooks/usePinGate'
import PinGate from '../components/PinGate'
import { Badge, Button, ErrorBanner, FullPageSpinner, Sky, inputClass } from '../components/ui'

export default function DoorView() {
  const gate = usePinGate('helper')

  if (!gate.unlocked) {
    return (
      <PinGate
        title="כניסת סדרנים"
        subtitle="הזינו את קוד הכניסה כדי לפתוח את רשימת המוזמנים"
        checking={gate.checking}
        error={gate.error}
        onSubmit={gate.submit}
      />
    )
  }
  return <DoorList pin={gate.pin} onLock={gate.lock} onPinError={gate.handleError} />
}

function DoorList({ pin, onLock, onPinError }) {
  const [tickets, setTickets] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      setTickets(await fetchPaidTickets(pin))
      setError(null)
    } catch (err) {
      if (!onPinError(err)) setError(err)
    }
  }, [pin, onPinError])

  useEffect(() => {
    load()
    // Another helper marking someone in should show up here immediately.
    return subscribeToChanges(load)
  }, [load])

  const filtered = useMemo(() => {
    if (!tickets) return []
    const text = query.trim()
    const digits = digitsOnly(text)
    const matches = tickets.filter((ticket) => {
      if (!text) return true
      const byName = ticket.attendee_name?.includes(text)
      const byBuyer = ticket.order?.buyer_name?.includes(text)
      const byPhone = digits.length >= 3 && digitsOnly(ticket.phone).includes(digits)
      return byName || byBuyer || byPhone
    })
    // Not-yet-arrived first, then the ones already inside.
    return matches.sort((a, b) => {
      if (a.is_checked_in !== b.is_checked_in) return a.is_checked_in ? 1 : -1
      return a.attendee_name.localeCompare(b.attendee_name, 'he')
    })
  }, [tickets, query])

  const toggle = async (ticket) => {
    setBusyId(ticket.id)
    const next = !ticket.is_checked_in
    // Optimistic - the realtime event will reconcile it anyway.
    setTickets((prev) =>
      prev.map((item) =>
        item.id === ticket.id
          ? { ...item, is_checked_in: next, checked_in_at: next ? new Date().toISOString() : null }
          : item
      )
    )
    try {
      const updated = await setCheckIn(pin, ticket.id, next)
      setTickets((prev) => prev.map((item) => (item.id === ticket.id ? { ...item, ...updated } : item)))
    } catch (err) {
      if (onPinError(err)) return
      setError(err)
      load()
    } finally {
      setBusyId(null)
    }
  }

  if (!tickets) return <FullPageSpinner />

  const checkedIn = tickets.filter((ticket) => ticket.is_checked_in).length

  return (
    <Sky>
      <div className="mx-auto max-w-xl p-4 pb-20 sm:p-6">
        {/* Sunlight-legible: solid white bar, thick black rules, no translucency. */}
        <header className="sticky top-0 z-10 -mx-4 space-y-3 border-b-[3px] border-brand-black bg-brand-white px-4 pb-4 pt-4 sm:mx-0 sm:rounded-3xl sm:border-[3px] sm:px-5 sm:shadow-brutal">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black">רשימת כניסה</h1>
              <div className="mt-1">
                <Badge tone="lime">
                  נכנסו {checkedIn} מתוך {tickets.length}
                </Badge>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={load} aria-label="רענון" className="px-3">
                <RefreshCw className="h-5 w-5" />
              </Button>
              <Button variant="ghost" onClick={onLock} aria-label="יציאה" className="px-3">
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-black/50" />
            <input
              className={`${inputClass} pr-12 text-lg`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חיפוש לפי שם או טלפון"
              autoComplete="off"
              autoFocus
            />
          </div>
        </header>

        <div className="mt-4 space-y-3">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          {filtered.length === 0 && (
            <div className="rounded-3xl border-[3px] border-brand-black bg-brand-white py-10 text-center text-base font-extrabold shadow-brutal">
              {tickets.length === 0 ? 'אין עדיין הזמנות מאושרות.' : 'לא נמצאו תוצאות לחיפוש.'}
            </div>
          )}

          {filtered.map((ticket) => (
            <AttendeeCard
              key={ticket.id}
              ticket={ticket}
              busy={busyId === ticket.id}
              onToggle={() => toggle(ticket)}
            />
          ))}
        </div>
      </div>
    </Sky>
  )
}

function AttendeeCard({ ticket, busy, onToggle }) {
  const isIn = ticket.is_checked_in
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-3xl border-[3px] border-brand-black p-4 ${
        isIn ? 'bg-brand-white/70 shadow-brutal-xs' : 'bg-brand-white shadow-brutal'
      }`}
    >
      <div className="min-w-0">
        <div className={`truncate text-xl font-black ${isIn ? 'text-brand-black/50' : 'text-brand-black'}`}>
          {ticket.attendee_name}
        </div>
        <div className="mt-0.5 truncate text-sm font-bold text-brand-black/60">
          <span dir="ltr">{ticket.phone}</span>
          {ticket.order?.buyer_name && ticket.order.buyer_name !== ticket.attendee_name && (
            <> · הזמנה של {ticket.order.buyer_name}</>
          )}
        </div>
        {isIn && (
          <div className="mt-2">
            <Badge tone="yellow">נכנס ב-{formatTime(ticket.checked_in_at)}</Badge>
          </div>
        )}
      </div>

      <Button
        variant={isIn ? 'ghost' : 'success'}
        busy={busy}
        onClick={onToggle}
        className={`shrink-0 ${isIn ? 'px-4 py-3 text-sm' : 'px-5 py-4 text-base'}`}
      >
        {isIn ? (
          <>
            <Undo2 className="h-4 w-4" />
            בטל כניסה
          </>
        ) : (
          <>
            <UserCheck className="h-6 w-6" />
            סמן כניסה
          </>
        )}
      </Button>
    </div>
  )
}
