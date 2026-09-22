import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogOut, RefreshCw, Search, Undo2, UserCheck } from 'lucide-react'
import { fetchPaidTickets, setCheckIn } from '../lib/api'
import { supabase } from '../lib/supabase'
import { digitsOnly, formatTime } from '../lib/format'
import { usePinGate } from '../hooks/usePinGate'
import PinGate from '../components/PinGate'
import { Button, ErrorBanner, FullPageSpinner, inputClass } from '../components/ui'

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
  return <DoorList onLock={gate.lock} />
}

function DoorList({ onLock }) {
  const [tickets, setTickets] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      setTickets(await fetchPaidTickets())
      setError(null)
    } catch (err) {
      setError(err)
    }
  }, [])

  useEffect(() => {
    load()
    // Another helper marking someone in should show up here immediately.
    const channel = supabase
      .channel('door-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
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
      const updated = await setCheckIn(ticket.id, next)
      setTickets((prev) => prev.map((item) => (item.id === ticket.id ? { ...item, ...updated } : item)))
    } catch (err) {
      setError(err)
      load()
    } finally {
      setBusyId(null)
    }
  }

  if (!tickets) return <FullPageSpinner />

  const checkedIn = tickets.filter((ticket) => ticket.is_checked_in).length

  return (
    <div className="mx-auto max-w-xl p-4 pb-20 sm:p-6">
      <header className="sticky top-0 -mx-4 space-y-3 border-b border-slate-800 bg-slate-950/95 px-4 pb-3 pt-4 backdrop-blur sm:mx-0 sm:px-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black">רשימת כניסה</h1>
            <p className="text-sm text-slate-400">
              נכנסו {checkedIn} מתוך {tickets.length}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={load} aria-label="רענון" className="px-3">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={onLock} aria-label="יציאה" className="px-3">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className={`${inputClass} pr-10`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש לפי שם או טלפון"
            autoComplete="off"
          />
        </div>
      </header>

      <div className="mt-4 space-y-3">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            {tickets.length === 0 ? 'אין עדיין הזמנות מאושרות.' : 'לא נמצאו תוצאות לחיפוש.'}
          </p>
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
  )
}

function AttendeeCard({ ticket, busy, onToggle }) {
  const isIn = ticket.is_checked_in
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl border p-4 transition ${
        isIn
          ? 'border-rose-500/40 bg-rose-500/5'
          : 'border-emerald-500/40 bg-emerald-500/5'
      }`}
    >
      <div className="min-w-0">
        <div className={`truncate text-lg font-bold ${isIn ? 'text-slate-400 line-through' : ''}`}>
          {ticket.attendee_name}
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-500">
          {ticket.phone}
          {ticket.order?.buyer_name && ticket.order.buyer_name !== ticket.attendee_name && (
            <> · הזמנה של {ticket.order.buyer_name}</>
          )}
        </div>
        {isIn && (
          <span className="mt-2 inline-block rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-300">
            נכנס ב-{formatTime(ticket.checked_in_at)}
          </span>
        )}
      </div>

      <Button
        variant={isIn ? 'ghost' : 'success'}
        busy={busy}
        onClick={onToggle}
        className="shrink-0 px-4 py-3"
      >
        {isIn ? (
          <>
            <Undo2 className="h-4 w-4" />
            בטל כניסה
          </>
        ) : (
          <>
            <UserCheck className="h-5 w-5" />
            סמן כניסה
          </>
        )}
      </Button>
    </div>
  )
}
