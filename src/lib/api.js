import { photoUploader, supabase } from './supabase'

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

/** Public tickets already committed - excludes cancelled orders and staff/helper tickets. */
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
 * `guestNames`). `guestPhones` lines up with `guestNames`; a blank entry gives
 * that guest the buyer's phone. The database picks the tier and the price under a row lock,
 * so the page's own price is only a preview - the returned order is what was
 * actually charged.
 *
 * With `pin` it is the admin's staff/helper entry: free, already paid, flagged
 * `is_manual`, and outside the public capacity.
 */
export async function createOrder({ buyerName, buyerPhone, ticketType, guestNames = [], guestPhones = [], pin }) {
  const args = {
    p_buyer_name: buyerName,
    p_buyer_phone: buyerPhone,
    p_ticket_type: ticketType,
    p_guest_names: guestNames,
    p_guest_phones: guestPhones,
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

/* ------------------------------ photo album ------------------------------ */

export const PHOTO_BUCKET = 'event-photos'

/**
 * @typedef {Object} MatchedPhoto
 * @property {string} id
 * @property {string} path        display copy (long side 2048px) in PHOTO_BUCKET
 * @property {string} thumb_path  grid thumbnail (long side 480px)
 * @property {number} width
 * @property {number} height
 * @property {number} similarity  best face match, always >= 0.42
 */

/**
 * Album photos with a face matching `embedding` (unit length, 512-d). The
 * 0.42 cosine threshold is applied inside the database.
 *
 * @param {Float32Array} embedding
 * @returns {Promise<MatchedPhoto[]>}
 */
export const findMyPhotos = async (embedding) =>
  unwrap(
    await supabase.rpc('find_my_photos', {
      // pgvector reads a JSON number array as a vector; 6 decimals is plenty.
      p_embedding: Array.from(embedding, (value) => Number(value.toFixed(6))),
    })
  )

/** @returns {Promise<{ source_keys: string[], faces: number }>} */
export const fetchAlbumIndex = async (pin) => unwrap(await supabase.rpc('admin_photos', { p_pin: pin }))

/** Uploads one JPEG to PHOTO_BUCKET. The storage policy checks the admin PIN. */
export async function uploadPhotoFile(pin, path, blob) {
  unwrap(
    await photoUploader(pin)
      .storage.from(PHOTO_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
  )
}

/**
 * Records an uploaded photo and its faces. Re-adding the same `sourceKey`
 * replaces the earlier row and faces.
 *
 * @param {string} pin
 * @param {{ sourceKey: string, path: string, thumbPath: string, width: number, height: number,
 *           faces: { embedding: Float32Array, box: number[], score: number }[] }} photo
 */
export const addAlbumPhoto = async (pin, { sourceKey, path, thumbPath, width, height, faces }) =>
  unwrap(
    await supabase.rpc('admin_add_photo', {
      p_pin: pin,
      p_source_key: sourceKey,
      p_path: path,
      p_thumb_path: thumbPath,
      p_width: width,
      p_height: height,
      p_faces: faces.map((face) => ({
        embedding: Array.from(face.embedding, (value) => Number(value.toFixed(6))),
        box: face.box.map(Math.round),
        score: Number(face.score.toFixed(3)),
      })),
    })
  )

/** Public URL of a bucket file; with `downloadName` the browser saves it instead of showing it. */
export function photoUrl(path, downloadName) {
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path, downloadName ? { download: downloadName } : undefined)
    .data.publicUrl
}
