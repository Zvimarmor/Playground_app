import { TICKET_TYPES } from './format'

/**
 * Tiers fill up in `sort_order`. The active tier is the first one whose
 * cumulative capacity has not been consumed yet by the tickets sold so far.
 *
 * Business rule: a group ticket is always priced entirely at the active tier,
 * even when the tier has fewer remaining spots than the group size. The sold
 * count simply overflows, which moves the next buyer on to the next tier.
 */
export function resolveActiveTier(tiers, soldCount) {
  const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order)
  let cumulative = 0
  for (const tier of sorted) {
    cumulative += tier.capacity
    if (soldCount < cumulative) {
      return { tier, remainingInTier: cumulative - soldCount, totalCapacity: totalCapacity(tiers) }
    }
  }
  return { tier: null, remainingInTier: 0, totalCapacity: cumulative }
}

export const totalCapacity = (tiers) =>
  tiers.reduce((sum, tier) => sum + (tier.capacity || 0), 0)

/** Price of a whole order of `type` at `tier`, plus the "full price" reference. */
export function priceFor(tier, type) {
  const meta = TICKET_TYPES[type]
  if (!tier || !meta) return { total: 0, fullPrice: 0, discount: 0, perPerson: 0 }
  const total = Number(tier[meta.priceField]) || 0
  const fullPrice = (Number(tier.price_single) || 0) * meta.count
  return {
    total,
    fullPrice,
    discount: Math.max(fullPrice - total, 0),
    perPerson: total / meta.count,
  }
}
