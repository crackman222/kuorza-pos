import { useLanguage } from '../context/useLanguage'
import { Icon } from './Icon'

const METHODS = [
  { value: 'cash', label: 'Tunai', icon: 'payments' },
  { value: 'qris', label: 'QRIS', icon: 'qr_code_2' },
  { value: 'transfer', label: 'Transfer', icon: 'account_balance' },
]

export function PaymentMethodSelector({ value, onChange }) {
  const { t } = useLanguage()
  return (
    <div className="segmented payment-method-selector" role="radiogroup">
      {METHODS.map((method) => (
        <button
          key={method.value}
          type="button"
          role="radio"
          aria-checked={value === method.value}
          className={`segmented-option payment-method-button ${value === method.value ? 'active' : ''}`}
          onClick={() => onChange(method.value)}
        >
          <Icon name={value === method.value ? 'check' : method.icon} size={18} />
          {t(method.label)}
        </button>
      ))}
    </div>
  )
}
