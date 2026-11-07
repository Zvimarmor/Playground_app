import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageOff, RotateCcw } from 'lucide-react'
import { ALBUM_PAGE_SIZE, fetchAlbumPage } from '../lib/api'
import { Lightbox, PhotoGrid } from './MatchedGallery'
import { Badge, Button, Spinner } from './ui'

/** Start fetching the next page this far before the guest reaches the bottom. */
const SCROLL_MARGIN = '600px'

/** How close to the last loaded photo the lightbox asks for the next page. */
const LIGHTBOX_MARGIN = 3

/**
 * The whole album, newest first, fetched a page at a time as the guest scrolls.
 * There is no "download all" here: it would be well over a thousand files.
 */
export default function AllPhotosGallery() {
  const [photos, setPhotos] = useState([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [openIndex, setOpenIndex] = useState(null)
  const sentinel = useRef(null)
  const fetching = useRef(false)
  const nextFrom = useRef(0)

  const loadMore = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    setLoading(true)
    setFailed(false)
    try {
      const page = await fetchAlbumPage(nextFrom.current)
      nextFrom.current += page.photos.length
      if (page.total !== null) setTotal(page.total)
      // Photos added while browsing push older ones into the next page, so one can come twice.
      setPhotos((current) => {
        const seen = new Set(current.map((photo) => photo.id))
        return [...current, ...page.photos.filter((photo) => !seen.has(photo.id))]
      })
      setHasMore(page.photos.length === ALBUM_PAGE_SIZE)
    } catch (err) {
      console.error('Album page failed to load', err)
      setFailed(true)
    } finally {
      fetching.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadMore()
  }, [loadMore])

  // Observed anew after every page: if the sentinel is still in view (a tall
  // screen), the observer reports that straight away and the next page follows.
  useEffect(() => {
    if (loading || failed || !hasMore || !sentinel.current) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore()
      },
      { rootMargin: SCROLL_MARGIN }
    )
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [loading, failed, hasMore, loadMore])

  // Swiping through the lightbox does not scroll the page, so it asks on its own.
  useEffect(() => {
    if (openIndex === null || loading || failed || !hasMore) return
    if (openIndex >= photos.length - LIGHTBOX_MARGIN) loadMore()
  }, [openIndex, photos.length, loading, failed, hasMore, loadMore])

  if (!loading && !failed && photos.length === 0) {
    return (
      <div className="space-y-3 py-6 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border-2 border-brand-black bg-brand-yellow shadow-brutal-xs">
          <ImageOff className="h-8 w-8" />
        </div>
        <p className="text-base font-extrabold">התמונות עוד לא עלו לאלבום. נסו שוב בקרוב.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {total > 0 && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-black">כל התמונות מהמסיבה</h2>
          <Badge tone="lime">{total} תמונות</Badge>
        </div>
      )}

      <PhotoGrid photos={photos} onOpen={setOpenIndex} />

      <div ref={sentinel} className="flex flex-col items-center gap-3">
        {loading && <Spinner className="h-7 w-7" />}
        {failed && (
          <>
            <p role="alert" className="text-center text-sm font-extrabold">
              לא הצלחנו לטעון את התמונות. בדקו את החיבור ונסו שוב.
            </p>
            <Button variant="ghost" onClick={loadMore}>
              <RotateCcw className="h-4 w-4" />
              נסו שוב
            </Button>
          </>
        )}
      </div>

      {openIndex !== null && (
        <Lightbox
          photos={photos}
          index={openIndex}
          // A failed or finished list is complete as far as the viewer can tell, so it wraps around.
          total={hasMore && !failed ? Math.max(total, photos.length) : photos.length}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  )
}
