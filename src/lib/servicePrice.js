// A service's `price` is its normal price; `promo_price`, when set, is what
// the customer is actually charged. Supervisors turn promos on and off in
// Katalog, so always go through this instead of reading `price` directly.
//
// `mode` lets a ticket opt out of the promo: 'promo' (default) charges the
// promo price where one is set, 'normal' always charges the harga normal.
export function getServicePrice(service, mode = PRICE_MODES.PROMO) {
  if (mode === PRICE_MODES.NORMAL) return Number(service.price)
  return hasPromo(service) ? Number(service.promo_price) : Number(service.price)
}

export const PRICE_MODES = {
  PROMO: 'promo',
  NORMAL: 'normal',
}

export function hasPromo(service) {
  return service.promo_price != null && Number(service.promo_price) < Number(service.price)
}
