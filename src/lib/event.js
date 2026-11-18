/**
 * Poster details. These are printed on the artwork rather than stored per-row
 * in Supabase, so they live here as plain constants; the event *name* still
 * comes from events_config so the admin can rename the event.
 */
export const EVENT = {
  title: 'PLAYGROUND',
  // Shown under the wordmark; null for none.
  edition: 'סילבסטר',
  emoji: '🎆',
  day: 'חמישי',
  date: '31.12.2026',
  // null shows "יפורסם בקרוב".
  time: null,
  venue: 'המרפסת של מוסללה',
  vibe: ['בייס', 'אלקטרוני', 'טראנס', 'עולם'],
  // Flip to true after the party: / then shows the thank-you page instead of sales.
  isOver: false,
  whatsappUrl: 'https://chat.whatsapp.com/DH741rXpzd1Fccjbw7v6p5?s=cl&p=i&mlu=4',
  // `names` holds more than one artist for a back-to-back set, e.g.
  // { names: ['KIMIDA'], genres: ['Dub', 'DownTempo'] }. Empty shows "ליינאפ יפורסם בקרוב".
  lineup: [],
}
