import { useEffect, useState } from 'react'
import {
  getActiveServices,
  setServicePrices,
  getShelfItems,
  createShelfItem,
  addShelfStock,
} from '../api'
import { formatRupiah } from '../lib/format'
import { getServicePrice, hasPromo } from '../lib/servicePrice'
import { groupServicesByCategory } from '../lib/serviceCategories'
import { ServiceIcon } from '../components/ServiceIcon'
import { useAuth } from '../context/useAuth'
import { isSupervisor } from '../lib/roles'
import { useLanguage } from '../context/useLanguage'

export default function Katalog() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const canManageStock = isSupervisor(profile)
  const [services, setServices] = useState([])
  const [shelfItems, setShelfItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([getActiveServices(), getShelfItems()])
      .then(([s, items]) => {
        setServices(s)
        setShelfItems(items)
      })
      .catch(() => setError('Gagal memuat katalog'))
      .finally(() => setLoading(false))
  }, [])

  function reloadServices() {
    getActiveServices().then(setServices).catch(() => setError('Gagal memuat layanan'))
  }

  function reloadShelf() {
    getShelfItems().then(setShelfItems).catch(() => setError('Gagal memuat barang'))
  }

  return (
    <div className="katalog-screen">
      <h1>{t('Katalog')}</h1>

      {error && <p className="form-error">{t(error)}</p>}
      {loading && <p className="riwayat-loading">{t('Memuat...')}</p>}

      {!loading && (
        <>
          <ServiceSection
            services={services}
            canManagePromo={canManageStock}
            onChanged={reloadServices}
            onError={setError}
          />

          <ShelfSection
            items={shelfItems}
            canManageStock={canManageStock}
            onChanged={reloadShelf}
            onError={setError}
          />
        </>
      )}
    </div>
  )
}

// Layanan: names are managed in the Supabase dashboard. Supervisors set the
// normal and promo prices here. Same collapsible sections as the Transaksi
// Baru picker: one category open at a time, all closed to start.
function ServiceSection({ services, canManagePromo, onChanged, onError }) {
  const { t } = useLanguage()
  const groups = groupServicesByCategory(services)
  // null = everything closed, which is how the page opens.
  const [currentKey, setOpenKey] = useState(null)

  return (
    <section className="katalog-section">
      <h2 className="transaksi-section-label">{t('Layanan')}</h2>
      <p className="katalog-note">
        {canManagePromo
          ? t('Harga normal dan harga promo bisa diubah di sini. Kosongkan harga promo lalu simpan untuk mengakhiri promo. Nama layanan dikelola lewat dashboard Supabase.')
          : t('Untuk menambah atau mengubah layanan, hubungi admin — dikelola lewat dashboard Supabase.')}
      </p>
      {services.length === 0 ? (
        <p className="riwayat-empty">{t('Belum ada layanan aktif')}</p>
      ) : (
        <div className="service-category-list">
          {groups.map((group) => {
            const isOpen = group.key === currentKey
            const panelId = `katalog-category-${group.key}`
            return (
              <div key={group.key} className={`service-category ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="service-category-header"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenKey(isOpen ? null : group.key)}
                >
                  <span className="service-category-label">{t(group.label)}</span>
                  <span className="service-category-meta">
                    {t('{count} layanan', { count: group.services.length })}
                  </span>
                  <span className="service-category-chevron" aria-hidden="true" />
                </button>

                {isOpen && (
                  <div
                    id={panelId}
                    className={`riwayat-table katalog-table katalog-category-panel ${
                      canManagePromo ? 'katalog-service-managed' : 'katalog-service'
                    }`}
                  >
                    <div className="riwayat-table-row riwayat-table-head">
                      <span>{t('Nama Layanan')}</span>
                      <span>{t('Harga Normal')}</span>
                      <span>{t('Harga Promo')}</span>
                      {canManagePromo && <span></span>}
                    </div>
                    {group.services.map((service) =>
                      canManagePromo ? (
                        <ServicePriceEditor
                          key={`${service.id}-${service.price}-${service.promo_price}`}
                          service={service}
                          onChanged={onChanged}
                          onError={onError}
                        />
                      ) : (
                        <div key={service.id} className="riwayat-table-row">
                          <ServiceNameCell service={service} />
                          <span className={hasPromo(service) ? 'katalog-normal-price-struck' : 'riwayat-total'}>
                            {formatRupiah(service.price)}
                          </span>
                          <span className="riwayat-total">
                            {hasPromo(service) ? formatRupiah(getServicePrice(service)) : '—'}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ServiceNameCell({ service }) {
  return (
    <span className="riwayat-plate katalog-service-name">
      <ServiceIcon name={service.name} />
      {service.name}
    </span>
  )
}

// One row with an input in each price column and a single Simpan. The RPC
// re-checks everything below (supervisor, > 0, promo < normal); the
// client-side checks are just for a friendlier message. The row is keyed on
// both prices, so after a save it remounts with the stored values.
function ServicePriceEditor({ service, onChanged, onError }) {
  const { t } = useLanguage()
  const [priceValue, setPriceValue] = useState(String(Number(service.price)))
  const [promoValue, setPromoValue] = useState(
    service.promo_price != null ? String(Number(service.promo_price)) : ''
  )
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    const price = Math.round(Number(priceValue.trim()))
    if (priceValue.trim() === '' || !Number.isFinite(price) || price <= 0) {
      onError('Harga normal harus angka lebih dari nol')
      return
    }
    const promoTrimmed = promoValue.trim()
    const promo = promoTrimmed === '' ? null : Math.round(Number(promoTrimmed))
    if (promo !== null && (!Number.isFinite(promo) || promo <= 0)) {
      onError('Harga promo harus angka lebih dari nol')
      return
    }
    if (promo !== null && promo >= price) {
      onError('Harga promo harus lebih kecil dari harga normal')
      return
    }
    setBusy(true)
    onError('')
    try {
      await setServicePrices(service.id, price, promo)
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal mengubah harga layanan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="riwayat-table-row">
      <ServiceNameCell service={service} />
      <span className="katalog-price-input">
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={priceValue}
          onChange={(e) => setPriceValue(e.target.value)}
          placeholder={t('Normal')}
          aria-label={t('Harga normal {name}', { name: service.name })}
          disabled={busy}
        />
      </span>
      <span className="katalog-price-input">
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={promoValue}
          onChange={(e) => setPromoValue(e.target.value)}
          placeholder={t('Promo')}
          aria-label={t('Harga promo {name}', { name: service.name })}
          disabled={busy}
        />
      </span>
      <span className="katalog-stock-actions">
        <button type="button" className="btn-secondary" onClick={handleSave} disabled={busy}>
          {t('Simpan')}
        </button>
      </span>
    </div>
  )
}

// Barang: goods with finite stock. Everyone sees the shelf and what's left on
// it; only supervisors can add an item or move the stock figure.
function ShelfSection({ items, canManageStock, onChanged, onError }) {
  const { t } = useLanguage()
  const [showAddForm, setShowAddForm] = useState(false)

  return (
    <section className="katalog-section">
      <div className="staf-section-header">
        <h2 className="transaksi-section-label">{t('Barang')}</h2>
        {canManageStock && (
          <button type="button" className="btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? t('Tutup') : `+ ${t('Tambah Barang')}`}
          </button>
        )}
      </div>
      <p className="katalog-note">
        {canManageStock
          ? t('Stok berkurang otomatis setiap barang terjual di transaksi.')
          : t('Stok hanya bisa diubah oleh supervisor.')}
      </p>

      {showAddForm && (
        <AddShelfItemForm
          onCreated={() => {
            setShowAddForm(false)
            onChanged()
          }}
          onError={onError}
        />
      )}

      {items.length === 0 ? (
        <p className="riwayat-empty">{t('Belum ada barang')}</p>
      ) : (
        <div className={`riwayat-table katalog-table ${canManageStock ? 'katalog-shelf-managed' : 'katalog-shelf'}`}>
          <div className="riwayat-table-row riwayat-table-head">
            <span>{t('Nama Barang')}</span>
            <span>{t('Harga')}</span>
            <span>{t('Stok')}</span>
            {canManageStock && <span></span>}
          </div>
          {items.map((item) => (
            <div key={item.id} className="riwayat-table-row">
              <span className="riwayat-plate">{item.name}</span>
              <span className="riwayat-total">{formatRupiah(item.price)}</span>
              <span className={`status-badge ${item.stock > 0 ? 'status-closed' : 'status-voided'}`}>
                {item.stock > 0 ? t('{count} tersedia', { count: item.stock }) : t('Habis')}
              </span>
              {canManageStock && (
                <StockAdjuster item={item} onChanged={onChanged} onError={onError} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Adds to stock rather than setting it — the server does the arithmetic, so
// two supervisors restocking at once both count. Negative values are allowed
// as a correction (a breakage, a miscount).
function StockAdjuster({ item, onChanged, onError }) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleAdd() {
    const value = Number(amount)
    if (!Number.isInteger(value) || value === 0) {
      onError('Jumlah stok harus angka bulat dan tidak nol')
      return
    }
    setBusy(true)
    onError('')
    try {
      await addShelfStock(item.id, value)
      setAmount('')
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal mengubah stok')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="katalog-stock-actions">
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="+/-"
        aria-label={t('Ubah stok {name}', { name: item.name })}
        disabled={busy}
      />
      <button type="button" className="btn-secondary" onClick={handleAdd} disabled={busy}>
        {t('Ubah Stok')}
      </button>
    </span>
  )
}

function AddShelfItemForm({ onCreated, onError }) {
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    onError('')
    if (!name.trim()) {
      onError('Nama barang wajib diisi')
      return
    }
    const priceValue = Math.round(Number(price) || 0)
    const stockValue = Math.round(Number(stock) || 0)
    if (priceValue <= 0) {
      onError('Harga harus lebih dari nol')
      return
    }
    if (stockValue < 0) {
      onError('Stok tidak boleh negatif')
      return
    }

    setSubmitting(true)
    try {
      await createShelfItem({ name: name.trim(), price: priceValue, stock: stockValue })
      setName('')
      setPrice('')
      setStock('')
      onCreated()
    } catch (err) {
      onError(err.message || 'Gagal menambah barang')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="payment-form staf-form" onSubmit={handleSubmit}>
      <div className="payment-form-title">{t('Tambah Barang')}</div>
      <div className="staf-form-grid">
        <label>
          {t('Nama Barang')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Contoh: Parfum Mobil')} />
        </label>
        <label>
          {t('Harga')}
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="25000"
          />
        </label>
        <label>
          {t('Stok Awal')}
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="10"
          />
        </label>
      </div>
      <button type="submit" className="btn-primary payment-form-trigger" disabled={submitting}>
        {submitting ? t('Menyimpan...') : t('Simpan Barang')}
      </button>
    </form>
  )
}
