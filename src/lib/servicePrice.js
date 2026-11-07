// A service's `price` is its normal price; `promo_price`, when set, is what
// the customer is actually charged. Supervisors turn promos on and off in
// Katalog, so always go through this instead of reading `price` directly.
export function getServicePrice(service) {
  return hasPromo(service) ? Number(service.promo_price) : Number(service.price)
}

export function hasPromo(service) {
  return service.promo_price != null && Number(service.promo_price) < Number(service.price)
}
