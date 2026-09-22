import { supabase } from './supabase'
import { GROUP_SOLD_OUT_NOTE, TICKET_TYPES } from './format'
import { isTypeAvailable, priceFor, resolveActiveTier } from './tiers'

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message)
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
export const fetchSoldCount = async () => {
  const orders = unwrap(
    await supabase.from('orders').select('tickets_count').neq('payment_status', 'cancelled')
  )
  return orders.reduce((sum, order) => sum + (order.tickets_count || 0), 0)
}

export const verifyPin = async (pin) => {
  const { data, error } = await supabase.rpc('verify_pin', { p_pin: pin })
  if (error) throw new Error(error.message)
  return data // 'admin' | 'helper' | null
}

export const fetchOrdersWithTickets = async () =>
  unwrap(
    await supabase
      .from('orders')
      .select('*, tickets(*)')
      .order('created_at', { ascending: false })
  )

export const fetchPaidTickets = async () =>
  unwrap(
    await supabase
      .from('tickets')
      .select('*, order:orders!inner(id, buyer_name, ticket_type, payment_status)')
      .eq('orders.payment_status', 'paid')
      .order('attendee_name', { ascending: true })
  )

export const setOrderStatus = async (orderId, status) =>
  unwrap(await supabase.from('orders').update({ payment_status: status }).eq('id', orderId).select())

export const setCheckIn = async (ticketId, checkedIn) =>
  unwrap(
    await supabase
      .from('tickets')
      .update({
        is_checked_in: checkedIn,
        checked_in_at: checkedIn ? new Date().toISOString() : null,
      })
      .eq('id', ticketId)
      .select()
      .single()
  )

/**
 * Creates an order plus one ticket row per attendee.
 * Pricing is resolved server-side-ish: we re-read the live sold count right
 * before writing so two buyers racing each other cannot both grab the last
 * cheap spot by sitting on a stale page.
 */
export async function createOrder({ buyerName, buyerPhone, ticketType, attendees, status = 'pending' }) {
  const meta = TICKET_TYPES[ticketType]
  if (!meta) throw new Error('סוג כרטיס לא תקין')

  const [tiers, soldCount] = await Promise.all([fetchTiers(), fetchSoldCount()])
  const { tier } = resolveActiveTier(tiers, soldCount)
  if (!tier) throw new Error('הכרטיסים אזלו')
  if (!isTypeAvailable(tier, ticketType)) throw new Error(GROUP_SOLD_OUT_NOTE)

  const { total } = priceFor(tier, ticketType)

  const order = unwrap(
    await supabase
      .from('orders')
      .insert({
        buyer_name: buyerName.trim(),
        buyer_phone: buyerPhone.trim(),
        ticket_type: ticketType,
        tickets_count: meta.count,
        total_amount: total,
        payment_status: status,
        tier_name: tier.name,
        source: status === 'paid' ? 'manual' : 'public',
      })
      .select()
      .single()
  )

  const rows = attendees.slice(0, meta.count).map((attendee) => ({
    order_id: order.id,
    attendee_name: (attendee.name || buyerName).trim(),
    phone: (attendee.phone || buyerPhone).trim(),
  }))

  try {
    unwrap(await supabase.from('tickets').insert(rows))
  } catch (error) {
    // Don't leave a paid-looking order with no attendees behind.
    await supabase.from('orders').delete().eq('id', order.id)
    throw error
  }

  return { order, tier, total }
}
