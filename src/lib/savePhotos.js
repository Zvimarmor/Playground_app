import { photoUrl } from './api'

/*
 * Getting photos onto the guest's device. On a phone the share sheet is the
 * only way to land them in the camera roll ("Save Image"), so touch devices
 * that can share files use it. Everywhere else a plain download link is used.
 */

/** File name a saved photo gets: playground-23-10-<first 8 chars of its id>.jpg */
export const photoFileName = (photo) => `playground-23-10-${photo.id.slice(0, 8)}.jpg`

/** Touch device that can share files - save through the share sheet. */
export const prefersShare = () =>
  typeof navigator.canShare === 'function' && window.matchMedia?.('(pointer: coarse)').matches

/** Fetches album photos as File objects, ready for navigator.share(). */
export async function fetchPhotoFiles(photos) {
  return Promise.all(
    photos.map(async (photo) => {
      const response = await fetch(photoUrl(photo.path))
      if (!response.ok) throw new Error('הורדת התמונה נכשלה')
      return new File([await response.blob()], photoFileName(photo), { type: 'image/jpeg' })
    })
  )
}

/** Whether `files` can go through the share sheet on this device. */
export const canShareFiles = (files) => prefersShare() && navigator.canShare({ files })

/**
 * Opens the share sheet. Resolves 'shared', 'cancelled', or 'needs-tap' when
 * the browser wants a fresh tap first - Safari drops the tap's permission if
 * the files took a while to download - so the caller can offer a second button.
 */
export async function shareFiles(files) {
  try {
    await navigator.share({ files })
    return 'shared'
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'
    if (err?.name === 'NotAllowedError') return 'needs-tap'
    throw err
  }
}

function triggerDownload(photo) {
  const link = document.createElement('a')
  link.href = photoUrl(photo.path, photoFileName(photo))
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * Downloads photos one after another. Storage's ?download= URL sends
 * Content-Disposition: attachment, so this works cross-origin. The pause
 * keeps browsers from swallowing back-to-back downloads.
 */
export async function downloadPhotos(photos) {
  for (const [index, photo] of photos.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 400))
    triggerDownload(photo)
  }
}

/** One photo: share sheet on a phone, plain download elsewhere. */
export async function savePhoto(photo) {
  if (prefersShare()) {
    const files = await fetchPhotoFiles([photo])
    if (canShareFiles(files)) {
      const result = await shareFiles(files)
      if (result !== 'needs-tap') return
    }
  }
  triggerDownload(photo)
}
