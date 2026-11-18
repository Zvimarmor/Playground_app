/*
 * Backs up every order and ticket to a local CSV before a reset.
 *
 *   node --env-file=.env scripts/export-orders.mjs [out.csv]
 *
 * Reads through admin_orders(), so it needs VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY and SEED_ADMIN_PIN (the admin PIN) in .env. One row
 * per ticket, cancelled orders included; an order with no tickets still gets
 * a row. The file holds names and phone numbers - backups/ and *.csv are in
 * .gitignore, keep it that way.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, SEED_ADMIN_PIN: pin } = process.env
if (!url || !key || !pin) {
  console.error('Missing VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY or SEED_ADMIN_PIN - run with --env-file=.env')
  process.exit(1)
}
const out = process.argv[2] ?? `backups/orders-${new Date().toISOString().slice(0, 10)}.csv`

const { data: orders, error } = await createClient(url, key).rpc('admin_orders', { p_pin: pin })
if (error) {
  console.error('admin_orders failed:', error.message)
  process.exit(1)
}

const ORDER_COLUMNS = ['id', 'created_at', 'buyer_name', 'buyer_phone', 'ticket_type', 'tickets_count',
  'total_amount', 'payment_status', 'tier_name', 'source', 'is_manual']
const TICKET_COLUMNS = ['id', 'created_at', 'attendee_name', 'phone', 'is_checked_in', 'checked_in_at']

const cell = (value) => {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const header = [...ORDER_COLUMNS.map((c) => `order_${c}`), ...TICKET_COLUMNS.map((c) => `ticket_${c}`)]
const rows = orders.flatMap((order) => {
  const tickets = order.tickets?.length ? order.tickets : [{}]
  return tickets.map((ticket) => [...ORDER_COLUMNS.map((c) => order[c]), ...TICKET_COLUMNS.map((c) => ticket[c])])
})

mkdirSync(dirname(out), { recursive: true })
// BOM so Excel shows the Hebrew names correctly.
writeFileSync(out, '﻿' + [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n', { mode: 0o600 })

const tickets = orders.reduce((sum, order) => sum + (order.tickets?.length ?? 0), 0)
console.log(`${orders.length} orders, ${tickets} tickets -> ${out}`)
