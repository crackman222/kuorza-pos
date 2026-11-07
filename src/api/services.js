import { supabase } from '../lib/supabase'

// sort_order groups the menu the way the posters do (Motor, Mobil, Helm, and
// S/M/L/XL within each service). Name order alone would put the sizes in
// L, M, S, XL order.
export async function getActiveServices() {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .order('sort_order')
    .order('name')
  if (error) throw error
  return data
}

// Supervisor-only (the RPC checks is_supervisor() itself). Only promo_price is
// writable this way; the name and normal price stay dashboard-managed.
// Pass null to end a promo.
export async function setServicePromoPrice(serviceId, promoPrice) {
  const { error } = await supabase.rpc('set_service_promo_price', {
    p_service_id: serviceId,
    p_promo_price: promoPrice,
  })
  if (error) throw new Error(error.message || 'Gagal mengubah harga promo')
}
