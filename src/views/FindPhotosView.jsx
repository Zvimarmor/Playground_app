import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, ImageOff, RotateCcw, ScanFace, Search, ShieldCheck, Upload } from 'lucide-react'
import { findMyPhotos } from '../lib/api'
import { EXPANDED_THRESHOLD, MATCH_THRESHOLD, STRICT_THRESHOLD, averageEmbedding } from '../lib/faceMath'
import { FaceModelError, SelfieError, loadFaceModels, selfieEmbedding } from '../lib/faces'
import SelfieCamera, { hasLiveCamera } from '../components/SelfieCamera'
import SelfiePreview from '../components/SelfiePreview'
import MatchedGallery from '../components/MatchedGallery'
import EventHeader from '../components/EventHeader'
import { BackButton, Badge, Button, Card, ErrorBanner, Sky, Spinner } from '../components/ui'

/*
 * /find-photos - guests take 2-3 selfies, each is turned into a face
 * embedding on the device, the embeddings are averaged, and the database
 * returns every album photo with a face at cosine similarity >= 0.42.
 * The averaged vector is kept, so re-searching at 0.38 (nothing found) or
 * 0.46 (strangers in the results) needs no new selfies.
 */

const PROMPTS = [
  { title: 'פנים ישרות', hint: 'הביטו ישר למצלמה, עם הפנים גלויות ומוארות' },
  { title: 'חיוך', hint: 'עכשיו חיוך גדול, כמו ברחבה 😁' },
  { title: 'זווית קלה', hint: 'סובבו קצת את הראש הצידה' },
]

/** Searching needs at least this many good selfies; a third one sharpens the average. */
const MIN_SELFIES = 2

const SELFIE_ERRORS = {
  'no-face': 'לא זיהינו פנים בתמונה. נסו שוב באור טוב יותר.',
  'many-faces': 'יש בתמונה יותר מאדם אחד. צלמו רק את עצמכם.',
  'too-small': 'הפנים קטנות מדי בתמונה. התקרבו קצת למצלמה.',
}

const MODELS_ERROR_TEXT = 'לא הצלחנו לטעון את זיהוי הפנים בדפדפן הזה. לחצו "לנסות שוב", ואם זה לא עוזר נסו דפדפן אחר.'

/** What to tell the guest when a selfie could not be checked. */
function selfieErrorText(err) {
  if (err instanceof SelfieError) return SELFIE_ERRORS[err.reason]
  if (err instanceof FaceModelError) return MODELS_ERROR_TEXT
  return 'לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת.'
}

const CAMERA_NOTICES = {
  denied: 'אין גישה למצלמה. אפשר לאשר גישה בהגדרות הדפדפן, או פשוט להעלות סלפי כאן למטה.',
  unavailable: 'לא הצלחנו לפתוח את המצלמה. אפשר להעלות סלפי כאן למטה.',
}

const EMPTY_TEXT =
  'לא מצאנו תמונות מתאימות באלבום. מומלץ לצלם סלפי מחדש בתאורה טובה יותר וללא משקפי שמש.'

/** @returns {import('../components/SelfiePreview').SelfieSlot[]} */
const emptySlots = () => PROMPTS.map(() => ({ status: 'empty' }))

export default function FindPhotosView() {
  const [slots, setSlots] = useState(emptySlots)
  const [retakeIndex, setRetakeIndex] = useState(null)
  const [source, setSource] = useState(() => (hasLiveCamera() ? 'camera' : 'upload'))
  const [cameraNotice, setCameraNotice] = useState(null)
  const [models, setModels] = useState('loading') // 'loading' | 'ready' | 'error'
  const [modelsError, setModelsError] = useState(null)
  const [phase, setPhase] = useState('capture') // 'capture' | 'searching' | 'results'
  const [results, setResults] = useState([])
  const [searchError, setSearchError] = useState(null)
  // v_avg of the last search and the threshold it ran with.
  const [embedding, setEmbedding] = useState(null)
  const [threshold, setThreshold] = useState(MATCH_THRESHOLD)

  // Latest slots for the async selfie check, which must not write over a
  // slot that was retaken while it ran.
  const slotsRef = useRef(slots)
  slotsRef.current = slots

  const loadModels = useCallback(() => {
    setModels('loading')
    setModelsError(null)
    loadFaceModels().then(
      () => setModels('ready'),
      (err) => {
        console.error('Face models failed to load', err)
        setModelsError(err)
        setModels('error')
      }
    )
  }, [])

  // Start downloading the models right away so they are ready by the first selfie.
  useEffect(loadModels, [loadModels])

  // Release the selfie thumbnails when leaving the page.
  useEffect(() => () => slotsRef.current.forEach((slot) => slot.url && URL.revokeObjectURL(slot.url)), [])

  const activeIndex = retakeIndex ?? slots.findIndex((slot) => slot.status === 'empty' || slot.status === 'error')
  const ready = slots.filter((slot) => slot.status === 'ok')
  const checking = slots.some((slot) => slot.status === 'checking')
  const canSearch = ready.length >= MIN_SELFIES && !checking

  const updateSlot = (index, slot) => setSlots((current) => current.map((old, i) => (i === index ? slot : old)))

  const addSelfie = async (blob) => {
    const index = activeIndex
    if (index < 0) return
    const previous = slots[index]
    if (previous.url) URL.revokeObjectURL(previous.url)
    const url = URL.createObjectURL(blob)
    updateSlot(index, { status: 'checking', url })
    setRetakeIndex(null)

    let next
    try {
      next = { status: 'ok', url, embedding: await selfieEmbedding(blob) }
    } catch (err) {
      if (!(err instanceof SelfieError)) console.error('Selfie check failed', err)
      next = { status: 'error', url, error: selfieErrorText(err) }
    }
    if (slotsRef.current[index].url === url) updateSlot(index, next)
  }

  const onCameraUnavailable = useCallback((reason) => {
    setCameraNotice(reason)
    setSource('upload')
  }, [])

  /** On failure the guest goes back to where they searched from, with the error shown. */
  const runSearch = async (vector, value) => {
    const from = phase
    setPhase('searching')
    setSearchError(null)
    try {
      const photos = await findMyPhotos(vector, value)
      setEmbedding(vector)
      setThreshold(value)
      setResults(photos)
      setPhase('results')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setSearchError(err)
      setPhase(from)
    }
  }

  const search = () => runSearch(averageEmbedding(ready.map((slot) => slot.embedding)), MATCH_THRESHOLD)

  /** Same selfies, different threshold. */
  const searchAgain = (value) => runSearch(embedding, value)

  const reset = () => {
    slots.forEach((slot) => slot.url && URL.revokeObjectURL(slot.url))
    setSlots(emptySlots())
    setRetakeIndex(null)
    setResults([])
    setSearchError(null)
    setEmbedding(null)
    setThreshold(MATCH_THRESHOLD)
    setPhase('capture')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <Sky>
      <div className="mx-auto max-w-lg space-y-5 p-4 pb-16 sm:p-6">
        <BackButton to="/" />
        <EventHeader compact />

        <header className="rounded-2xl border-4 border-brand-black bg-brand-yellow p-5 text-center shadow-[8px_8px_0px_#000]">
          <h1 className="text-2xl font-black leading-tight sm:text-3xl">מצא את התמונות שלי 📸</h1>
          <p className="mt-2 text-sm font-bold leading-relaxed">
            צלמו 2-3 סלפי, ואנחנו נמצא אתכם בכל התמונות מהמסיבה
          </p>
        </header>

        {phase === 'capture' && (
          <>
            {activeIndex >= 0 && (
              <Card className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="black">
                    שלב {activeIndex + 1} מתוך {PROMPTS.length}
                  </Badge>
                  <ModelStatus state={models} onRetry={loadModels} />
                </div>
                <div>
                  <h2 className="text-xl font-black">{PROMPTS[activeIndex].title}</h2>
                  <p className="mt-1 text-sm font-bold text-brand-black/70">{PROMPTS[activeIndex].hint}</p>
                </div>

                {models === 'error' && (
                  <ErrorBanner error={`${MODELS_ERROR_TEXT}${modelsError?.message ? ` (${modelsError.message})` : ''}`} />
                )}
                {slots[activeIndex].status === 'error' && <ErrorBanner error={slots[activeIndex].error} />}
                {cameraNotice && source === 'upload' && (
                  <p className="rounded-2xl border-2 border-brand-black bg-brand-yellow px-4 py-3 text-sm font-bold">
                    {CAMERA_NOTICES[cameraNotice]}
                  </p>
                )}

                {source === 'camera' ? (
                  <SelfieCamera onCapture={addSelfie} onUnavailable={onCameraUnavailable} />
                ) : (
                  <UploadButtons onFile={addSelfie} />
                )}

                {retakeIndex !== null && (
                  <Button variant="ghost" onClick={() => setRetakeIndex(null)} className="w-full">
                    ביטול, להשאיר את הקודמת
                  </Button>
                )}

                {hasLiveCamera() && cameraNotice !== 'denied' && (
                  <button
                    type="button"
                    onClick={() => setSource(source === 'camera' ? 'upload' : 'camera')}
                    className="mx-auto flex items-center gap-1.5 text-sm font-extrabold underline underline-offset-4"
                  >
                    {source === 'camera' ? <Upload className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                    {source === 'camera' ? 'העלאת תמונה במקום' : 'חזרה למצלמה'}
                  </button>
                )}
              </Card>
            )}

            <Card className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-black">הסלפי שלכם</h2>
                <Badge tone={ready.length >= MIN_SELFIES ? 'lime' : 'white'}>
                  {ready.length} מתוך {PROMPTS.length} צולמו
                </Badge>
              </div>
              <SelfiePreview
                slots={slots}
                prompts={PROMPTS}
                activeIndex={activeIndex}
                onRetake={(index) => {
                  setRetakeIndex(index)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
              <ErrorBanner error={searchError} onDismiss={() => setSearchError(null)} />
              <Button onClick={search} disabled={!canSearch} className="w-full py-4 text-base">
                <Search className="h-5 w-5" />
                חיפוש התמונות שלי
              </Button>
              {ready.length === MIN_SELFIES && activeIndex >= 0 && (
                <p className="text-center text-xs font-bold text-brand-black/60">
                  אפשר לחפש כבר עכשיו. סלפי שלישי ישפר את הדיוק.
                </p>
              )}
            </Card>

            <p className="flex items-start gap-2 px-1 text-xs font-bold leading-relaxed text-brand-black/70">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              הסלפי לא נשמרים ולא נשלחים לשום מקום. הזיהוי קורה בתוך הטלפון שלכם, ולחיפוש נשלח רק קוד מספרי של
              תווי הפנים, שלא נשמר אצלנו.
            </p>
          </>
        )}

        {phase === 'searching' && <Searching />}

        {phase === 'results' &&
          (results.length > 0 ? (
            <Card className="space-y-4">
              <div className="text-center">
                <h2 className="text-2xl font-black">מצאנו {results.length} תמונות שלכם! 🎉</h2>
              </div>
              <MatchedGallery photos={results} />
              {threshold < STRICT_THRESHOLD && (
                <button
                  type="button"
                  onClick={() => searchAgain(STRICT_THRESHOLD)}
                  className="mx-auto block text-sm font-bold text-brand-black/60 underline underline-offset-4
                    transition hover:text-brand-black"
                >
                  רואה תמונות שלא שלך? אם כן לחץ כאן
                </button>
              )}
              <ErrorBanner error={searchError} onDismiss={() => setSearchError(null)} />
              <Button variant="ghost" onClick={reset} className="w-full">
                <RotateCcw className="h-4 w-4" />
                חיפוש חדש
              </Button>
            </Card>
          ) : (
            <Card className="space-y-4 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border-2 border-brand-black bg-brand-yellow shadow-brutal-xs">
                <ImageOff className="h-8 w-8" />
              </div>
              <p className="text-base font-extrabold leading-relaxed">{EMPTY_TEXT}</p>
              <ErrorBanner error={searchError} onDismiss={() => setSearchError(null)} />
              {threshold > EXPANDED_THRESHOLD && (
                <Button onClick={() => searchAgain(EXPANDED_THRESHOLD)} className="w-full py-4 text-base">
                  <Search className="h-5 w-5" />
                  נסה חיפוש מורחב
                </Button>
              )}
              <Button
                variant={threshold > EXPANDED_THRESHOLD ? 'ghost' : 'primary'}
                onClick={reset}
                className="w-full py-4 text-base"
              >
                <RotateCcw className="h-5 w-5" />
                נסו שוב
              </Button>
            </Card>
          ))}
      </div>
    </Sky>
  )
}

function ModelStatus({ state, onRetry }) {
  if (state === 'ready') {
    return (
      <Badge tone="lime">
        <ScanFace className="h-4 w-4" />
        מוכן
      </Badge>
    )
  }
  if (state === 'error') {
    return (
      <button type="button" onClick={onRetry}>
        <Badge tone="coral">טעינה נכשלה · לחצו לנסות שוב</Badge>
      </button>
    )
  }
  return (
    <Badge tone="white">
      <Spinner className="h-3.5 w-3.5" />
      טוענים את הזיהוי
    </Badge>
  )
}

/**
 * Two file pickers: `capture="user"` opens the phone's own camera app (no web
 * permission needed), the other one picks an existing photo.
 */
function UploadButtons({ onFile }) {
  const cameraInput = useRef(null)
  const galleryInput = useRef(null)

  const onChange = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onFile(file)
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Button onClick={() => cameraInput.current.click()} className="py-4 text-base">
        <Camera className="h-5 w-5" />
        צילום סלפי
      </Button>
      <Button variant="ghost" onClick={() => galleryInput.current.click()} className="py-4 text-base">
        <ImagePlus className="h-5 w-5" />
        בחירה מהגלריה
      </Button>
      <input ref={cameraInput} type="file" accept="image/*" capture="user" onChange={onChange} className="hidden" />
      <input ref={galleryInput} type="file" accept="image/*" onChange={onChange} className="hidden" />
    </div>
  )
}

function Searching() {
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-center gap-3">
        <Spinner className="h-6 w-6" />
        <p className="text-lg font-black">מחפשים אתכם באלבום...</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-xl border-[3px] border-brand-black/20 bg-brand-black/10"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </Card>
  )
}
