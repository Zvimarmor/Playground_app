import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Button, Spinner } from './ui'

/** Whether this browser can open a live camera at all (needs HTTPS). */
export const hasLiveCamera = () => Boolean(navigator.mediaDevices?.getUserMedia)

/**
 * Live front-camera viewfinder with a shutter button. The preview is mirrored
 * so it feels like a mirror; the captured frame is not, so it matches how the
 * event photographers saw the guest.
 *
 * @param {{
 *   onCapture: (blob: Blob) => void,
 *   onUnavailable: (reason: 'denied' | 'unavailable') => void,
 *   disabled?: boolean,
 * }} props
 */
export default function SelfieCamera({ onCapture, onUnavailable, disabled = false }) {
  const videoRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    let stream = null
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop())
          return
        }
        stream = media
        videoRef.current.srcObject = media
      })
      .catch((err) => {
        if (!cancelled) onUnavailable(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'unavailable')
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onUnavailable])

  const capture = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setFlash(true)
    setTimeout(() => setFlash(false), 150)
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.92)
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border-[3px] border-brand-black bg-brand-black shadow-brutal-sm">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedData={() => setReady(true)}
          className="h-full w-full -scale-x-100 object-cover"
        />
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-brand-white">
            <Spinner className="h-8 w-8" />
          </div>
        )}
        {/* Face guide - just a hint where to look, nothing is cropped to it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[45%] h-[55%] w-[60%] -translate-x-1/2 -translate-y-1/2
            rounded-[50%] border-4 border-dashed border-brand-white/70"
        />
        {flash && <div aria-hidden="true" className="absolute inset-0 bg-brand-white" />}
      </div>
      <Button onClick={capture} disabled={!ready || disabled} className="w-full py-4 text-base">
        <Camera className="h-5 w-5" />
        צילום
      </Button>
    </div>
  )
}
