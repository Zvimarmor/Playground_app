import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Images, Share2, X } from 'lucide-react'
import { photoUrl } from '../lib/api'
import {
  SHARE_BATCH, blobDownloadWorks, canShareFiles, downloadFiles, fetchPhotoFile, prefersShare, savePhoto, shareFiles,
} from '../lib/savePhotos'
import { Button, ErrorBanner, Spinner } from './ui'

const OPEN_IN_BROWSER = 'הדפדפן הזה לא מאפשר לשמור קבצים. פתחו את הדף בספארי או בכרום כדי לשמור את כל התמונות.'

/**
 * Grid of matched album photos with a full-screen viewer and save buttons.
 *
 * @param {{ photos: import('../lib/api').MatchedPhoto[] }} props
 */
export default function MatchedGallery({ photos }) {
  const [openIndex, setOpenIndex] = useState(null)

  return (
    <div className="space-y-4">
      <SaveAll photos={photos} />

      <ul className="grid grid-cols-3 gap-2 sm:gap-3">
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              aria-label={`תמונה ${index + 1}`}
              className="block aspect-square w-full overflow-hidden rounded-xl border-[3px] border-brand-black bg-brand-white
                shadow-brutal-xs transition-all hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-brutal-sm"
            >
              <img src={photoUrl(photo.thumb_path)} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>

      {openIndex !== null && (
        <Lightbox photos={photos} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
      )}
    </div>
  )
}

/**
 * "Download All". On a phone the photos go through the share sheet in groups
 * of SHARE_BATCH - each sheet needs its own tap - and the group the next tap
 * will share is fetched ahead, so the sheet opens while the tap still counts.
 * Elsewhere every photo is downloaded in turn.
 */
function SaveAll({ photos }) {
  const share = useMemo(prefersShare, [])
  const batches = useMemo(() => {
    const groups = []
    for (let i = 0; i < photos.length; i += SHARE_BATCH) groups.push(photos.slice(i, i + SHARE_BATCH))
    return groups
  }, [photos])
  const [next, setNext] = useState(0) // the group the next tap shares
  const [ready, setReady] = useState(null) // that group's files, once fetched
  const [needsTap, setNeedsTap] = useState(false)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!share) return undefined
    let current = true
    setReady(null)
    Promise.all(batches[next].map(fetchPhotoFile)).then(
      (files) => current && setReady(files),
      () => {} // the tap will fetch again and report the error
    )
    return () => {
      current = false
    }
  }, [share, batches, next])

  const saveAll = async () => {
    setError(null)
    setNeedsTap(false)
    setDone(false)
    setBusy(true)
    try {
      if (!share) {
        if (!blobDownloadWorks()) throw new Error(OPEN_IN_BROWSER)
        await downloadFiles(await Promise.all(photos.map(fetchPhotoFile)))
        setDone(true)
        return
      }
      const files = ready ?? (await Promise.all(batches[next].map(fetchPhotoFile)))
      let result = canShareFiles(files) ? await shareFiles(files) : 'unsupported'
      if (result === 'unsupported') {
        if (!blobDownloadWorks()) throw new Error(OPEN_IN_BROWSER)
        await downloadFiles(files)
        result = 'shared'
      }
      if (result === 'needs-tap') {
        setReady(files)
        setNeedsTap(true)
      } else if (result === 'shared') {
        const last = next + 1 >= batches.length
        setNext(last ? 0 : next + 1)
        setDone(last)
      }
      // 'cancelled': the guest closed the sheet - stay on this group.
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const from = next * SHARE_BATCH + 1
  const to = Math.min(photos.length, from + SHARE_BATCH - 1)
  let label = `הורדת כל התמונות (${photos.length})`
  if (needsTap) label = 'התמונות מוכנות - לחצו לשמירה'
  else if (done) label = 'כל התמונות נשמרו ✓ · לשמור שוב'
  else if (share && batches.length > 1) label = `שמירת תמונות ${from}-${to} מתוך ${photos.length}`

  return (
    <div className="space-y-2">
      <Button
        variant={needsTap || done ? 'success' : 'primary'}
        busy={busy}
        onClick={saveAll}
        className="w-full py-4 text-base"
      >
        {!busy && (needsTap ? <Share2 className="h-5 w-5" /> : done ? <CheckCircle2 className="h-5 w-5" /> : <Download className="h-5 w-5" />)}
        {label}
      </Button>
      {share && batches.length > 1 && !done && (
        <p className="text-center text-xs font-bold text-brand-black/60">
          בטלפון התמונות נשמרות בקבוצות של {SHARE_BATCH}. אחרי כל שמירה לחצו שוב לקבוצה הבאה.
        </p>
      )}
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
    </div>
  )
}

const LIGHTBOX_NOTICES = {
  'long-press': 'לחצו לחיצה ארוכה על התמונה ובחרו "שמירה בתמונות"',
}

/** Full-screen viewer: arrows, keyboard and swipe to move, Escape to close. */
function Lightbox({ photos, index, onIndexChange, onClose }) {
  const photo = photos[index]
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null) // 'needs-tap' | 'long-press' | an error message
  const touchStart = useRef(null)

  // The page reads right to left, so "next" sits on the left.
  const go = useCallback(
    (step) => onIndexChange((index + step + photos.length) % photos.length),
    [index, photos.length, onIndexChange]
  )

  // Fetch the photo as soon as it is shown, so tapping "download" can open
  // the share sheet at once - iOS refuses it once the tap is a few seconds old.
  useEffect(() => {
    setLoaded(false)
    setNotice(null)
    fetchPhotoFile(photo).catch(() => {})
  }, [photo])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') go(1)
      if (event.key === 'ArrowRight') go(-1)
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [go, onClose])

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      const result = await savePhoto(photo)
      if (result === 'needs-tap' || result === 'long-press') setNotice(result)
    } catch (err) {
      setNotice(err.message)
    } finally {
      setSaving(false)
    }
  }

  const onTouchEnd = (event) => {
    if (touchStart.current === null) return
    const dx = event.changedTouches[0].clientX - touchStart.current
    touchStart.current = null
    if (Math.abs(dx) > 50) go(dx > 0 ? 1 : -1)
  }

  const navButton =
    'absolute top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-2xl border-2 border-brand-black ' +
    'bg-brand-white shadow-brutal-sm transition hover:bg-brand-yellow active:translate-x-[2px] active:shadow-brutal-xs'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`תמונה ${index + 1} מתוך ${photos.length}`}
      className="fixed inset-0 z-50 flex flex-col bg-brand-black/95"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2 p-3" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          autoFocus
          className="grid h-11 w-11 place-items-center rounded-2xl border-2 border-brand-black bg-brand-white shadow-brutal-xs"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="text-sm font-extrabold text-brand-white" dir="ltr">
          {index + 1} / {photos.length}
        </span>
        <Button variant="success" busy={saving} onClick={save}>
          {!saving && <Download className="h-4 w-4" />}
          {notice === 'needs-tap' ? 'לחצו שוב לשמירה' : 'הורדת התמונה'}
        </Button>
      </div>
      {notice && notice !== 'needs-tap' && (
        <p
          role="status"
          onClick={(event) => event.stopPropagation()}
          className="mx-3 rounded-2xl border-2 border-brand-black bg-brand-yellow px-4 py-2 text-center text-sm font-extrabold"
        >
          {LIGHTBOX_NOTICES[notice] ?? notice}
        </p>
      )}

      <div
        className="relative min-h-0 flex-1"
        onTouchStart={(event) => (touchStart.current = event.touches[0].clientX)}
        onTouchEnd={onTouchEnd}
      >
        {!loaded && (
          <div className="absolute inset-0 grid place-items-center text-brand-white">
            <Spinner className="h-9 w-9" />
          </div>
        )}
        <img
          key={photo.id}
          src={photoUrl(photo.path)}
          alt={`תמונה ${index + 1}`}
          onLoad={() => setLoaded(true)}
          onClick={(event) => event.stopPropagation()}
          className={`mx-auto h-full w-full object-contain p-2 transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="התמונה הקודמת"
              onClick={(event) => {
                event.stopPropagation()
                go(-1)
              }}
              className={`${navButton} right-3 hidden sm:grid`}
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <button
              type="button"
              aria-label="התמונה הבאה"
              onClick={(event) => {
                event.stopPropagation()
                go(1)
              }}
              className={`${navButton} left-3 hidden sm:grid`}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
      <p className="flex items-center justify-center gap-1.5 p-3 text-xs font-bold text-brand-white/60 sm:hidden">
        <Images className="h-4 w-4" />
        החליקו לצדדים למעבר בין התמונות
      </p>
    </div>
  )
}
