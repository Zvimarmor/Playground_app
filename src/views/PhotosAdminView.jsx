import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Images, Play, ScanFace, Square, TriangleAlert } from 'lucide-react'
import { addAlbumPhoto, fetchAlbumIndex, uploadPhotoFile } from '../lib/api'
import { analyzeFaces, imageToCanvas, loadFaceModels } from '../lib/faces'
import { usePinGate } from '../hooks/usePinGate'
import PinGate from '../components/PinGate'
import { BackButton, Badge, Button, Card, ErrorBanner, FullPageSpinner, Sky } from '../components/ui'

/*
 * /admin/photos - builds the album that /find-photos searches. For each
 * original it makes a 2048px display copy and a 480px thumbnail, finds every
 * face (with tiling, for crowd shots), uploads both copies and saves the face
 * embeddings. Everything runs in this browser tab with the same code the
 * guests' phones use, so album and selfie vectors match.
 *
 * Re-running is safe: photos already in the album (same file name and size)
 * are skipped, so a stopped or crashed run simply picks up where it was.
 */

const DISPLAY_SIDE = 2048
const THUMB_SIDE = 480

/** Matches photos.source_key. Name + size survives picking files vs. a folder. */
const sourceKey = (file) => `${file.name}|${file.size}`

const isImage = (file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic)$/i.test(file.name)

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG encode failed'))), 'image/jpeg', quality)
  )
}

function shrink(canvas, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height))
  const out = document.createElement('canvas')
  out.width = Math.round(canvas.width * scale)
  out.height = Math.round(canvas.height * scale)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, out.width, out.height)
  return out
}

/** Everything about one original that does not need the network. */
async function preparePhoto(file) {
  const canvas = await imageToCanvas(file, DISPLAY_SIDE)
  const faces = await analyzeFaces(canvas, { tiles: true, minFaceSize: 32 })
  return {
    sourceKey: sourceKey(file),
    width: canvas.width,
    height: canvas.height,
    faces,
    display: await toJpeg(canvas, 0.85),
    thumb: await toJpeg(shrink(canvas, THUMB_SIDE), 0.75),
  }
}

async function storePhoto(pin, photo) {
  const id = crypto.randomUUID()
  const path = `${id}.jpg`
  const thumbPath = `thumbs/${id}.jpg`
  await uploadPhotoFile(pin, path, photo.display)
  await uploadPhotoFile(pin, thumbPath, photo.thumb)
  await addAlbumPhoto(pin, { ...photo, path, thumbPath })
}

const formatDuration = (ms) => {
  const minutes = Math.round(ms / 60000)
  return minutes < 1 ? 'פחות מדקה' : minutes < 60 ? `${minutes} דק׳` : `${Math.floor(minutes / 60)} שע׳ ${minutes % 60} דק׳`
}

export default function PhotosAdminView() {
  const gate = usePinGate('admin')

  if (!gate.unlocked) {
    return (
      <PinGate
        title="אלבום התמונות"
        subtitle="הזינו את קוד המנהל"
        checking={gate.checking}
        error={gate.error}
        onSubmit={gate.submit}
      />
    )
  }
  return <Indexer pin={gate.pin} onPinError={gate.handleError} />
}

function Indexer({ pin, onPinError }) {
  const [album, setAlbum] = useState(null) // { keys: Set<string>, faces: number }
  const [files, setFiles] = useState([])
  const [run, setRun] = useState(null)
  const [error, setError] = useState(null)
  const stopRequested = useRef(false)

  const loadAlbum = useCallback(async () => {
    try {
      const { source_keys: keys, faces } = await fetchAlbumIndex(pin)
      setAlbum({ keys: new Set(keys), faces })
    } catch (err) {
      if (!onPinError(err)) setError(err)
    }
  }, [pin, onPinError])

  useEffect(() => {
    loadAlbum()
  }, [loadAlbum])

  // Closing the tab mid-run loses at most the photo in flight, but ask anyway.
  useEffect(() => {
    if (!run?.running) return undefined
    const warn = (event) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [run?.running])

  const pending = useMemo(
    () => (album ? files.filter((file) => !album.keys.has(sourceKey(file))) : []),
    [files, album]
  )

  if (!album) {
    return error ? (
      <Sky>
        <div className="p-6">
          <ErrorBanner error={error} />
        </div>
      </Sky>
    ) : (
      <FullPageSpinner />
    )
  }

  const pickFiles = (event) => {
    setFiles(Array.from(event.target.files ?? []).filter(isImage))
    event.target.value = ''
  }

  const start = async () => {
    stopRequested.current = false
    setError(null)
    const queue = pending
    setRun({ running: true, total: queue.length, done: 0, faces: 0, failed: [], current: null, startedAt: Date.now() })

    const tally = (patch) => setRun((current) => ({ ...current, ...patch(current) }))
    const fail = (file, err) => tally((current) => ({ done: current.done + 1, failed: [...current.failed, `${file.name}: ${err.message}`] }))

    let wakeLock = null
    try {
      wakeLock = await navigator.wakeLock?.request('screen')
    } catch {
      /* not supported or refused - the run still works, keep the screen on by hand */
    }

    try {
      await loadFaceModels()
      // Analyse photo N+1 while photo N uploads.
      let saving = Promise.resolve()
      for (const file of queue) {
        if (stopRequested.current) break
        tally(() => ({ current: file.name }))
        let photo
        try {
          photo = await preparePhoto(file)
        } catch (err) {
          fail(file, new Error('לא ניתן לקרוא את הקובץ'))
          continue
        }
        await saving
        if (stopRequested.current) break
        saving = storePhoto(pin, photo).then(
          () => tally((current) => ({ done: current.done + 1, faces: current.faces + photo.faces.length })),
          (err) => {
            if (onPinError(err)) stopRequested.current = true
            fail(file, err)
          }
        )
      }
      await saving
    } catch (err) {
      setError(err)
    } finally {
      wakeLock?.release().catch(() => {})
      tally(() => ({ running: false, current: null }))
      await loadAlbum()
    }
  }

  const progress = run && run.total > 0 ? run.done / run.total : 0
  const eta = run?.running && run.done > 0 ? ((Date.now() - run.startedAt) / run.done) * (run.total - run.done) : null

  return (
    <Sky>
      <div className="mx-auto max-w-2xl space-y-5 p-4 pb-16 sm:p-6">
        <BackButton to="/admin" />

        <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border-[3px] border-brand-black bg-brand-white p-4 shadow-brutal">
          <div>
            <h1 className="text-xl font-black">אלבום התמונות</h1>
            <p className="mt-1 text-sm font-bold text-brand-black/60">מה שנמצא כאן מופיע בחיפוש של "מצא את התמונות שלי"</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="lime">
              <Images className="h-4 w-4" />
              {album.keys.size} תמונות
            </Badge>
            <Badge tone="yellow">
              <ScanFace className="h-4 w-4" />
              {album.faces} פנים
            </Badge>
          </div>
        </header>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <Card className="space-y-4">
          <h2 className="text-lg font-black">1. בחירת התמונות</h2>
          <ol className="list-inside list-decimal space-y-1 text-sm font-bold text-brand-black/70">
            <li>בגוגל דרייב: קליק ימני על התיקייה ‎23/10‎ ← הורדה (דרייב מוריד כמה קובצי ZIP)</li>
            <li>לפתוח את כל קובצי ה-ZIP לתוך תיקייה אחת במחשב</li>
            <li>לבחור כאן את התיקייה. תמונות שכבר באלבום ידולגו</li>
          </ol>
          <div className="grid gap-2 sm:grid-cols-2">
            <FilePicker icon={FolderOpen} label="בחירת תיקייה" directory onChange={pickFiles} disabled={run?.running} />
            <FilePicker icon={Images} label="בחירת קבצים" onChange={pickFiles} disabled={run?.running} />
          </div>
          {files.length > 0 && (
            <p className="text-sm font-extrabold">
              נבחרו {files.length} תמונות · {files.length - pending.length} כבר באלבום · {pending.length} לעיבוד
            </p>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-lg font-black">2. עיבוד והעלאה</h2>
          <p className="text-sm font-bold text-brand-black/70">
            כל תמונה מוקטנת ל-2048 פיקסלים, נסרקת לזיהוי פנים ומועלית. בערך 1-2 שניות לתמונה במחשב רגיל. השאירו את
            הלשונית פתוחה ובחזית עד הסוף.
          </p>

          {run?.running ? (
            <Button variant="danger" onClick={() => (stopRequested.current = true)} className="w-full py-4">
              <Square className="h-4 w-4" />
              עצירה (אפשר להמשיך אחר כך)
            </Button>
          ) : (
            <Button onClick={start} disabled={pending.length === 0} className="w-full py-4 text-base">
              <Play className="h-5 w-5" />
              התחלה: {pending.length} תמונות
            </Button>
          )}

          {run && (
            <div className="space-y-2">
              <div className="h-5 overflow-hidden rounded-full border-2 border-brand-black bg-brand-white">
                <div className="h-full bg-brand-lime transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-sm font-extrabold">
                <span dir="ltr">
                  {run.done} / {run.total}
                </span>
                <span>{run.faces} פנים נמצאו</span>
                {eta !== null && <span>נותרו כ-{formatDuration(eta)}</span>}
                {!run.running && <span>{run.done === run.total ? 'הסתיים ✓' : 'נעצר'}</span>}
              </div>
              {run.current && <p className="truncate text-xs font-bold text-brand-black/60">מעבד: {run.current}</p>}
            </div>
          )}

          {run?.failed.length > 0 && (
            <details className="rounded-2xl border-2 border-brand-black bg-brand-yellow p-3 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-extrabold">
                <TriangleAlert className="h-4 w-4" />
                {run.failed.length} תמונות לא עובדו (אפשר להריץ שוב)
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-xs" dir="ltr">
                {run.failed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      </div>
    </Sky>
  )
}

function FilePicker({ icon: Icon, label, directory = false, disabled, onChange }) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-brand-black bg-brand-white
        px-4 py-3 text-sm font-extrabold shadow-brutal-sm transition-all hover:bg-brand-yellow active:translate-x-[2px]
        active:translate-y-[2px] active:shadow-brutal-xs ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <Icon className="h-4 w-4" />
      {label}
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={onChange}
        disabled={disabled}
        className="hidden"
        {...(directory ? { webkitdirectory: '', directory: '' } : {})}
      />
    </label>
  )
}
