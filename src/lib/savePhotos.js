import { photoUrl } from './api'

/*
 * Getting photos onto the guest's device.
 *
 * Every save starts from a Blob fetched from Storage (which sends CORS
 * headers). A cross-origin <a download> is ignored by mobile browsers, so it
 * is never used. From the Blob:
 *  1. Phones that can share files get the share sheet - "Save Image" puts the
 *     photo straight in the camera roll.
 *  2. Otherwise a same-origin blob: URL is downloaded through <a download>.
 *  3. Where blob downloads do nothing (iOS in-app browsers such as Instagram
 *     or Facebook), the image opens in a new tab to long-press and save.
 *
 * The share sheet only opens during a tap, and Safari stops counting the tap
 * while a slow download runs. So files are prefetched before the tap where
 * possible, and a share refused for that reason comes back as 'needs-tap' so
 * the page can ask for one more tap - by then the file is ready.
 */

export const SHARE_TITLE = 'Playground Photo'

/** Files per share sheet - Chrome on Android refuses more than 10 at once. */
export const SHARE_BATCH = 10

/** File name a saved photo gets: playground-23-10-<first 8 chars of its id>.jpg */
export const photoFileName = (photo) => `playground-23-10-${photo.id.slice(0, 8)}.jpg`

/** Touch device that can share files - save through the share sheet. */
export const prefersShare = () =>
  typeof navigator.canShare === 'function' && window.matchMedia?.('(pointer: coarse)').matches

/** Whether <a download> on a blob: URL saves anything here. */
export function blobDownloadWorks() {
  if (!('download' in HTMLAnchorElement.prototype)) return false
  // iOS in-app browsers are WebViews without the "Safari/" token; they ignore downloads.
  const ua = navigator.userAgent
  return !(/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua))
}

const files = new Map() // photo.id -> Promise<File>

/** The photo as a File, fetched once per page visit. A failed fetch is retried next time. */
export function fetchPhotoFile(photo) {
  if (!files.has(photo.id)) {
    const file = fetch(photoUrl(photo.path)).then(async (response) => {
      if (!response.ok) throw new Error('הורדת התמונה נכשלה')
      return new File([await response.blob()], photoFileName(photo), { type: 'image/jpeg' })
    })
    file.catch(() => files.delete(photo.id))
    files.set(photo.id, file)
  }
  return files.get(photo.id)
}

/** Starts fetching in the background, so a later tap can share at once. */
export function prefetchPhotoFiles(photos) {
  photos.forEach((photo) => fetchPhotoFile(photo).catch(() => {}))
}

export const canShareFiles = (list) => prefersShare() && navigator.canShare({ files: list })

/**
 * Opens the share sheet.
 * @returns {Promise<'shared' | 'cancelled' | 'needs-tap' | 'unsupported'>}
 *   'needs-tap': the browser wants a fresh tap; 'unsupported': fall back to downloading.
 */
export async function shareFiles(list) {
  try {
    await navigator.share({ files: list, title: SHARE_TITLE })
    return 'shared'
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'
    if (err?.name === 'NotAllowedError') return 'needs-tap'
    return 'unsupported'
  }
}

/**
 * Saves a File without the share sheet.
 *
 * @param {File} file
 * @param {Window | null} [tab] a tab opened during the tap, for the long-press fallback
 * @returns {'downloaded' | 'opened' | 'long-press'} 'long-press': even the tab was blocked
 */
export function saveFile(file, tab = null) {
  const url = URL.createObjectURL(file)
  // Revoked later rather than now: Safari and Firefox abort a download whose URL is gone.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)

  if (blobDownloadWorks()) {
    tab?.close()
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    return 'downloaded'
  }
  if (tab) {
    tab.location.href = url
    return 'opened'
  }
  return window.open(url, '_blank') ? 'opened' : 'long-press'
}

/**
 * One photo. Call it straight from the tap handler: its first steps rely on
 * that tap.
 *
 * @returns {Promise<'shared' | 'cancelled' | 'needs-tap' | 'downloaded' | 'opened' | 'long-press'>}
 */
export async function savePhoto(photo) {
  const share = prefersShare()
  // Popup blockers only allow a tab opened during the tap, so open it now if
  // it is going to be needed and fill it once the file is here.
  const tab = !share && !blobDownloadWorks() ? window.open('', '_blank') : null
  try {
    const file = await fetchPhotoFile(photo)
    if (share && navigator.canShare({ files: [file] })) {
      const result = await shareFiles([file])
      if (result !== 'unsupported') return result
    }
    return saveFile(file, tab)
  } catch (err) {
    tab?.close()
    throw err
  }
}

/** Downloads files one after another; the pause stops browsers swallowing back-to-back downloads. */
export async function downloadFiles(list) {
  for (const [index, file] of list.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 400))
    saveFile(file)
  }
}
