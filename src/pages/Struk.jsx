import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getTreatmentDetail } from '../api'
import { formatRupiah, formatDateTime } from '../lib/format'
import { useLanguage } from '../context/useLanguage'

const PAYMENT_LABELS = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' }

export default function Struk() {
  const { id } = useParams()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [treatment, setTreatment] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getTreatmentDetail(id)
      .then(setTreatment)
      .catch(() => setError('Gagal memuat struk'))
  }, [id])

  if (error) {
    return (
      <div className="struk-screen">
        <p className="form-error">{t(error)}</p>
      </div>
    )
  }
  if (!treatment) {
    return <div className="loading-screen">{t('Memuat...')}</div>
  }

  const isPaid = Boolean(treatment.payment)

  return (
    <div className="struk-screen">
      <div className="struk-card">
        <div className={`struk-check ${isPaid ? '' : 'struk-check-pending'}`}>{isPaid ? '✓' : '⏳'}</div>
        <h1>Kuorza</h1>
        <p className="struk-meta">{formatDateTime(treatment.created_at)}</p>
        <p className="struk-meta">{treatment.treatment_code}</p>

        {/* No vehicle on the ticket (e.g. Cuci Helm) means no plate and no
            brand — the rows are left off the receipt entirely rather than
            printed empty. */}
        {treatment.plate_number && (
          <>
            <div className="struk-row">
              <span>{t('Plat')}</span>
              <span>{treatment.plate_number}</span>
            </div>
            <div className="struk-row">
              <span>{t('Kendaraan')}</span>
              <span>{treatment.treatment_type || '-'}</span>
            </div>
          </>
        )}
        <div className="struk-row">
          <span>{t('Staf')}</span>
          <span>{treatment.pic}</span>
        </div>

        <hr />
        <div className="struk-items">
          {treatment.items.map((item) => (
            <div key={item.id} className="struk-item">
              <span>
                {item.service_name} x{item.quantity}
              </span>
              <span>{formatRupiah(item.subtotal)}</span>
            </div>
          ))}
        </div>
        <hr />

        <div className="struk-row">
          <span>{t('Subtotal')}</span>
          <span>{formatRupiah(treatment.subtotal)}</span>
        </div>
        {treatment.discount > 0 && (
          <div className="struk-row">
            <span>{t('Diskon')}</span>
            <span>-{formatRupiah(treatment.discount)}</span>
          </div>
        )}
        <div className="struk-row struk-total">
          <span>{t('Total')}</span>
          <span>{formatRupiah(treatment.total)}</span>
        </div>
        <div className="struk-row">
          <span>{t('Pembayaran')}</span>
          <span>{isPaid ? t(PAYMENT_LABELS[treatment.payment.payment_method]) : t('Belum dibayar')}</span>
        </div>

        {treatment.notes && (
          <p className="struk-notes">
            {t('Catatan')}: {treatment.notes}
          </p>
        )}

        <button type="button" className="btn-primary struk-done" onClick={() => navigate('/')}>
          {t('Kembali')}
        </button>
      </div>
    </div>
  )
}
