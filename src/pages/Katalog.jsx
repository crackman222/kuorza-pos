import { useEffect, useState } from 'react'
import {
  getActiveServices,
  setServicePromoPrice,
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

export default function Katalog() {
  const { profile } = useAuth()
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
      <h1>Katalog</h1>

      {error && <p className="form-error">{error}</p>}
      {loading && <p className="riwayat-loading">Memuat...</p>}

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

// Layanan: names and normal prices are managed in the Supabase dashboard.
// The promo price changes from time to time, so supervisors set it here.
function ServiceSection({ services, canManagePromo, onChanged, onError }) {
  return (
    <section className="katalog-section">
      <h2 className="transaksi-section-label">Layanan</h2>
      <p className="katalog-note">
        {canManagePromo
          ? 'Harga promo bisa diubah di sini. Kosongkan lalu simpan untuk mengakhiri promo. Nama dan harga normal dikelola lewat dashboard Supabase.'
          : 'Untuk menambah atau mengubah layanan, hubungi admin — dikelola lewat dashboard Supabase.'}
      </p>
      {services.length === 0 ? (
        <p className="riwayat-empty">Belum ada layanan aktif</p>
      ) : (
        groupServicesByCategory(services).map((group) => (
          <div key={group.key} className="katalog-category">
            <h3 className="katalog-category-title">
              {group.label}
              <span className="katalog-category-count">{group.services.length} layanan</span>
            </h3>
            <div
              className={`riwayat-table katalog-table ${canManagePromo ? 'katalog-service-managed' : 'katalog-service'}`}
            >
              <div className="riwayat-table-row riwayat-table-head">
                <span>Nama Layanan</span>
                <span>Harga Normal</span>
                <span>Harga Promo</span>
                {canManagePromo && <span></span>}
              </div>
              {group.services.map((service) => (
                <div key={service.id} className="riwayat-table-row">
                  <span className="riwayat-plate katalog-service-name">
                    <ServiceIcon name={service.name} />
                    {service.name}
                  </span>
                  <span className={hasPromo(service) ? 'katalog-normal-price-struck' : 'riwayat-total'}>
                    {formatRupiah(service.price)}
                  </span>
                  <span className="riwayat-total">
                    {hasPromo(service) ? formatRupiah(getServicePrice(service)) : '—'}
                  </span>
                  {canManagePromo && (
                    <PromoPriceEditor service={service} onChanged={onChanged} onError={onError} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  )
}

// The RPC re-checks everything below (supervisor, > 0, < normal price); the
// client-side checks are just for a friendlier message.
function PromoPriceEditor({ service, onChanged, onError }) {
  const [value, setValue] = useState(service.promo_price != null ? String(Number(service.promo_price)) : '')
  const [busy, setBusy] = useState(false)

  async function handleSave() {
    const trimmed = value.trim()
    const promo = trimmed === '' ? null : Math.round(Number(trimmed))
    if (promo !== null && (!Number.isFinite(promo) || promo <= 0)) {
      onError('Harga promo harus angka lebih dari nol')
      return
    }
    if (promo !== null && promo >= Number(service.price)) {
      onError('Harga promo harus lebih kecil dari harga normal')
      return
    }
    setBusy(true)
    onError('')
    try {
      await setServicePromoPrice(service.id, promo)
      onChanged()
    } catch (err) {
      onError(err.message || 'Gagal mengubah harga promo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="katalog-stock-actions">
      <input
        type="number"
        min="0"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Promo"
        aria-label={`Harga promo ${service.name}`}
        disabled={busy}
      />
      <button type="button" className="btn-secondary" onClick={handleSave} disabled={busy}>
        Simpan
      </button>
    </span>
  )
}

// Barang: goods with finite stock. Everyone sees the shelf and what's left on
// it; only supervisors can add an item or move the stock figure.
function ShelfSection({ items, canManageStock, onChanged, onError }) {
  const [showAddForm, setShowAddForm] = useState(false)

  return (
    <section className="katalog-section">
      <div className="staf-section-header">
        <h2 className="transaksi-section-label">Barang</h2>
        {canManageStock && (
          <button type="button" className="btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? 'Tutup' : '+ Tambah Barang'}
          </button>
        )}
      </div>
      <p className="katalog-note">
        {canManageStock
          ? 'Stok berkurang otomatis setiap barang terjual di transaksi.'
          : 'Stok hanya bisa diubah oleh supervisor.'}
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
        <p className="riwayat-empty">Belum ada barang</p>
      ) : (
        <div className={`riwayat-table katalog-table ${canManageStock ? 'katalog-shelf-managed' : 'katalog-shelf'}`}>
          <div className="riwayat-table-row riwayat-table-head">
            <span>Nama Barang</span>
            <span>Harga</span>
            <span>Stok</span>
            {canManageStock && <span></span>}
          </div>
          {items.map((item) => (
            <div key={item.id} className="riwayat-table-row">
              <span className="riwayat-plate">{item.name}</span>
              <span className="riwayat-total">{formatRupiah(item.price)}</span>
              <span className={`status-badge ${item.stock > 0 ? 'status-closed' : 'status-voided'}`}>
                {item.stock > 0 ? `${item.stock} tersedia` : 'Habis'}
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
        aria-label={`Ubah stok ${item.name}`}
        disabled={busy}
      />
      <button type="button" className="btn-secondary" onClick={handleAdd} disabled={busy}>
        Ubah Stok
      </button>
    </span>
  )
}

function AddShelfItemForm({ onCreated, onError }) {
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
      <div className="payment-form-title">Tambah Barang</div>
      <div className="staf-form-grid">
        <label>
          Nama Barang
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Parfum Mobil" />
        </label>
        <label>
          Harga
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
          Stok Awal
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
        {submitting ? 'Menyimpan...' : 'Simpan Barang'}
      </button>
    </form>
  )
}
