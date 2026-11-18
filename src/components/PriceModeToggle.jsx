import { PRICE_MODES } from '../lib/servicePrice'
import { useLanguage } from '../context/useLanguage'

const OPTIONS = [
  { value: PRICE_MODES.PROMO, label: 'Harga Promo' },
  { value: PRICE_MODES.NORMAL, label: 'Harga Normal' },
]

// Picks which price a ticket charges for its services. Promos come and go in
// Katalog, so this is chosen per ticket rather than fixed: Promo uses each
// service's promo price where one is set, Normal ignores promos entirely.
// Shelf items have one price only and aren't affected.
export function PriceModeToggle({ value, onChange, promoCount }) {
  const { t } = useLanguage()
  const noPromo = promoCount === 0

  return (
    <div className="price-mode">
      <div className="price-mode-toggle" role="radiogroup" aria-label={t('Mode harga layanan')}>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`price-mode-option ${value === option.value ? 'active' : ''}`}
            onClick={() => onChange(option.value)}
            disabled={noPromo}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
      <span className="price-mode-hint">
        {noPromo
          ? t('Belum ada promo aktif — semua layanan memakai harga normal')
          : value === PRICE_MODES.PROMO
            ? t('Promo berlaku untuk {count} layanan', { count: promoCount })
            : t('Promo tidak dipakai untuk tiket ini')}
      </span>
    </div>
  )
}
