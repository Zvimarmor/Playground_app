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

export const isValidPhone = (value) => {
  const digits = digitsOnly(value)
  return digits.length >= 9 && digits.length <= 15
}
