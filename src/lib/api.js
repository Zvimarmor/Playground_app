import { supabase } from './supabase'

/** errcode the staff functions raise for a wrong or changed PIN. */
export const WRONG_PIN = '28000'

const unwrap = ({ data, error }) => {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data
}

export const fetchConfig = async () =>
  unwrap(
    await supabase
      .from('events_config_public')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
  )

export const fetchTiers = async () =>
  unwrap(await supabase.from('tiers').select('*').order('sort_order', { ascending: true }))

/** Tickets already committed - everything except cancelled orders. */
export const fetchSoldCount = async () => unwrap(await supabase.rpc('sold_count'))

export const verifyPin = async (pin) => unwrap(await supabase.rpc('verify_pin', { p_pin: pin })) // 'admin' | 'helper' | null

/*
 * orders and tickets are not readable or writable with the anon key. Every
 * call below goes through a SECURITY DEFINER function in schema.sql, and the
 * staff ones take the PIN, which the database checks on every call.
 */

export const fetchOrdersWithTickets = async (pin) =>
  unwrap(await supabase.rpc('admin_orders', { p_pin: pin }))

export const fetchPaidTickets = async (pin) =>
  unwrap(await supabase.rpc('door_tickets', { p_pin: pin }))

export const setOrderStatus = async (pin, orderId, status) =>
  unwrap(await supabase.rpc('set_order_status', { p_pin: pin, p_order_id: orderId, p_status: status }))

export const setCheckIn = async (pin, ticketId, checkedIn) =>
  unwrap(
    await supabase.rpc('set_check_in', { p_pin: pin, p_ticket_id: ticketId, p_checked_in: checkedIn })
  )

/**
 * Creates an order plus one ticket row per attendee (the buyer first, then
 * `guestNames`). The database picks the tier and the price under a row lock,
 * so the page's own price is only a preview - the returned order is what was
 * actually charged.
 *
 * With `pin` it is the admin's manual entry, created as already paid.
 */
export async function createOrder({ buyerName, buyerPhone, ticketType, guestNames = [], pin }) {
  const args = {
    p_buyer_name: buyerName,
    p_buyer_phone: buyerPhone,
    p_ticket_type: ticketType,
    p_guest_names: guestNames,
  }
  const { order, tier_name: tierName } = pin
    ? unwrap(await supabase.rpc('admin_create_order', { p_pin: pin, ...args }))
    : unwrap(await supabase.rpc('create_order', args))
  return { order, tierName }
}

/**
 * The database sends a content-free "changed" ping on this broadcast topic
 * after every write to orders/tickets. Polling covers a missed ping or a
 * project where Realtime is off.
 */
export function subscribeToChanges(onChange, pollMs = 20000) {
  const channel = supabase
    .channel('event-updates')
    .on('broadcast', { event: 'changed' }, onChange)
    .subscribe()
  const timer = setInterval(onChange, pollMs)
  return () => {
    clearInterval(timer)
    supabase.removeChannel(channel)
  }
}
