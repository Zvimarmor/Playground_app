/**
 * Poster details. These are printed on the artwork rather than stored per-row
 * in Supabase, so they live here as plain constants; the event *name* still
 * comes from events_config so the admin can rename the event.
 */
export const EVENT = {
  title: 'PLAYGROUND',
  emoji: '🛝',
  day: 'שישי',
  date: '23.10',
  time: '11:00 - 16:30',
  venue: 'המרפסת של מוסללה',
  vibe: ['בייס', 'אלקטרוני', 'טראנס', 'עולם'],
  whatsappUrl: 'https://chat.whatsapp.com/DH741rXpzd1Fccjbw7v6p5?s=cl&p=i&mlu=4',
  // `names` holds more than one artist for a back-to-back set.
  lineup: [
    { names: ['KIMIDA'], genres: ['Dub', 'DownTempo'] },
    { names: ['HUNA'], genres: ['DnB', 'Global', 'Bass'] },
    { names: ['SHA NI', 'TY DE LA LUNA'], genres: ['PsyBass', 'Dubstep'] },
    { names: ['GUYJI'], genres: ['Trance'] },
  ],
}
