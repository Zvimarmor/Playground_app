export const TICKET_TYPES = {
  single: { key: 'single', label: 'כרטיס יחיד', short: 'יחיד', count: 1, priceField: 'price_single' },
  quad:   { key: 'quad',   label: 'כרטיס קבוצתי', short: 'קבוצתי', count: 4, priceField: 'price_quad' },
}

export const TICKET_TYPE_LIST = [TICKET_TYPES.single, TICKET_TYPES.quad]

/** Shown when the active tier has no group ticket left to sell. */
export const GROUP_SOLD_OUT_NOTE = 'כרטיסים קבוצתיים אזלו לסבב זה'

export const STATUS_LABELS = {
  pending: 'ממתין לתשלום',
  paid: 'שולם',
  cancelled: 'בוטל',
}

const currency = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
})

export const formatMoney = (value) => currency.format(Number(value) || 0)

// Same as formatMoney but keeps up to two decimals, for averages like ₪87.5.
const preciseCurrency = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export const formatMoneyPrecise = (value) => preciseCurrency.format(Number(value) || 0)

export const formatTime = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : ''

export const formatDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('he-IL', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

/** Normalises a phone number for comparison/search (digits only). */
export const digitsOnly = (value) => (value || '').replace(/\D/g, '')

/** wa.me link for a stored phone; local Israeli numbers (leading 0) get the 972 prefix. */
export const whatsappUrl = (value) => {
  let digits = digitsOnly(value)
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = `972${digits.slice(1)}`
  return digits ? `https://wa.me/${digits}` : null
}

/**
 * A stored phone as a local Israeli number: +972 / 972 / 00972 becomes a
 * leading 0, and the result gets a dash (052-1234567). The dash also stops
 * Excel from reading it as a number and dropping the leading zero.
 */
export const localPhone = (value) => {
  let digits = digitsOnly(value)
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('972')) digits = `0${digits.slice(3)}`
  if (digits.length === 10 && digits.startsWith('05')) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  if (digits.length === 9 && digits.startsWith('0')) return `${digits.slice(0, 2)}-${digits.slice(2)}`
  return (value ?? '').trim()
}

export const isValidPhone = (value) => {
  const digits = digitsOnly(value)
  return digits.length >= 9 && digits.length <= 15
}
