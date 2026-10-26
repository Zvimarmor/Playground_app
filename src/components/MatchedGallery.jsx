import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Images, Share2, X } from 'lucide-react'
import { photoUrl } from '../lib/api'
import {
  canShareFiles, downloadPhotos, fetchPhotoFiles, prefersShare, savePhoto, shareFiles,
} from '../lib/savePhotos'
import { Button, ErrorBanner, Spinner } from './ui'

/**
 * Grid of matched album photos with a full-screen viewer and save buttons.
 *
 * @param {{ photos: import('../lib/api').MatchedPhoto[] }} props
 */
export default function MatchedGallery({ photos }) {
  const [openIndex, setOpenIndex] = useState(null)
  const [saving, setSaving] = useState(false)
  const [prepared, setPrepared] = useState(null) // files fetched, waiting for a fresh tap to share
  const [error, setError] = useState(null)

  const saveAll = async () => {
    setError(null)
    setSaving(true)
    try {
      if (prepared) {
        if ((await shareFiles(prepared)) !== 'needs-tap') setPrepared(null)
        return
      }
      if (!prefersShare()) {
        await downloadPhotos(photos)
        return
      }
      const files = await fetchPhotoFiles(photos)
      if (!canShareFiles(files)) {
        await downloadPhotos(photos)
        return
      }
      if ((await shareFiles(files)) === 'needs-tap') setPrepared(files)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Button variant={prepared ? 'success' : 'primary'} busy={saving} onClick={saveAll} className="w-full py-4 text-base">
        {prepared ? <Share2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        {prepared ? 'התמונות מוכנות - לחצו לשמירה' : `הורדת כל התמונות (${photos.length})`}
      </Button>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

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

/** Full-screen viewer: arrows, keyboard and swipe to move, Escape to close. */
function Lightbox({ photos, index, onIndexChange, onClose }) {
  const photo = photos[index]
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const touchStart = useRef(null)

  // The page reads right to left, so "next" sits on the left.
  const go = useCallback(
    (step) => onIndexChange((index + step + photos.length) % photos.length),
    [index, photos.length, onIndexChange]
  )

  useEffect(() => setLoaded(false), [photo.id])

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
    try {
      await savePhoto(photo)
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
          הורדת התמונה
        </Button>
      </div>

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
