import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  console.error(
    'Supabase is not configured. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  auth: { persistSession: false },
})

const photoUploaders = new Map()

/**
 * A client whose requests carry the admin PIN in `x-admin-pin`. Storage has
 * no RPC to wrap, so the 'event-photos' upload policy reads the PIN from this
 * header instead (see migration_photos.sql). One client per PIN.
 */
export function photoUploader(pin) {
  if (!photoUploaders.has(pin)) {
    photoUploaders.set(
      pin,
      createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'event-app-photo-uploader' },
        global: { headers: { 'x-admin-pin': pin } },
      })
    )
  }
  return photoUploaders.get(pin)
}
