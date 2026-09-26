/**
 * Poster details. These are printed on the artwork rather than stored per-row
 * in Supabase, so they live here as plain constants; the event *name* still
 * comes from events_config so the admin can rename the event.
 */
export const EVENT = {
  title: 'PLAYGROUND',
  date: '23.10.26',
  time: '11:00-16:30',
  venue: 'מוסללה רופטופ',
  venueEn: 'Muslala Rooftop',
  lineup: ['KIMIDA', 'HUNA', 'SURPRISE GUEST', 'GUYJI'],
}
