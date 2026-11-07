import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveServices, getAvailableShelfItems, getActiveProfiles, createTreatment } from '../api'
import { ServicePicker } from '../components/ServicePicker'
import { ShelfItemPicker } from '../components/ShelfItemPicker'
import { StaffPicker } from '../components/StaffPicker'
import { MultiStaffPicker } from '../components/MultiStaffPicker'
import { formatRupiah } from '../lib/format'
import { getServicePrice } from '../lib/servicePrice'
import { findDefaultQcStaff } from '../lib/staffDefaults'
import { useAuth } from '../context/useAuth'
import { isStaff } from '../lib/roles'

// Workers build a ticket one page at a time — items, customer, confirmation —
// while the desk keeps the single two-column screen. Both share the same state
// and the same submit; only the chrome around it changes.
const WIZARD_STEPS = [
  { number: 1, label: 'Item' },
  { number: 2, label: 'Pelanggan' },
  { number: 3, label: 'Konfirmasi' },
]

function TicketLines({ items, emptyText, onQuantityChange, onRemove }) {
  if (items.length === 0) {
    return <p className="ticket-lines-empty">{emptyText}</p>
  }

  return (
    <div className="ticket-lines">
      {items.map((item) => (
        <div key={item.key} className="ticket-line">
          <div className="ticket-line-info">
            <span className="ticket-line-name">{item.serviceName}</span>
            <span className="ticket-line-unit">
              {formatRupiah(item.unitPrice)} / item
              {item.maxQuantity != null && ` · stok ${item.maxQuantity}`}
            </span>
          </div>
          <div className="ticket-line-qty">
            <button
              type="button"
              onClick={() => onQuantityChange(item.key, item.quantity - 1)}
            >
              -
            </button>
            <span>{item.quantity}</span>
            <button
              type="button"
              onClick={() => onQuantityChange(item.key, item.quantity + 1)}
              disabled={item.maxQuantity != null && item.quantity >= item.maxQuantity}
            >
              +
            </button>
          </div>
          <span className="ticket-line-total">
            {formatRupiah(item.unitPrice * item.quantity)}
          </span>
          <button
            type="button"
            className="ticket-line-remove"
            onClick={() => onRemove(item.key)}
            aria-label="Hapus item"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

function CustomerFields({
  needsVehicle,
  plateNumber,
  setPlateNumber,
  vehicleBrand,
  setVehicleBrand,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
}) {
  return (
    <div className="ticket-fields">
      {needsVehicle && (
        <>
          <label>
            Nomor Plat
            <input
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              placeholder="Contoh: B 1234 XYZ"
              required
            />
          </label>
          <label>
            Merek Kendaraan
            <input
              value={vehicleBrand}
              onChange={(e) => setVehicleBrand(e.target.value)}
              placeholder="Contoh: Honda Vario"
            />
          </label>
        </>
      )}
      <label>
        Nama Pelanggan
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Nama pelanggan"
          required
        />
      </label>
      <label>
        Nomor Telepon
        <input
          type="tel"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder="08xxxxxxxxxx"
          // required
        />
      </label>
    </div>
  )
}

// Who washes and who QCs this ticket. Both optional here — wash can still be
// picked at Mulai Proses — but QC starts pre-filled with the regular QC
// person (see lib/staffDefaults) and can be changed or cleared.
function StaffFields({ washStaff, setWashStaff, qcStaff, setQcStaff }) {
  return (
    <div className="ticket-fields ticket-staff-fields">
      <div className="ticket-staff-row">
        <span className="ticket-staff-label">Petugas Cuci</span>
        <MultiStaffPicker value={washStaff} onChange={setWashStaff} />
      </div>
      <div className="ticket-staff-row">
        <span className="ticket-staff-label">Petugas QC</span>
        <StaffPicker value={qcStaff} onChange={setQcStaff} />
      </div>
    </div>
  )
}

function DiscountFields({
  discountType,
  setDiscountType,
  discountInput,
  setDiscountInput,
}) {
  return (
    <div className="ticket-discount">
      <label>
        Diskon
        <select
          value={discountType}
          onChange={(e) => {
            // A number typed as a percentage means something completely
            // different in Rupiah, so don't carry it across.
            setDiscountType(e.target.value)
            setDiscountInput('')
          }}
        >
          <option value="percent">Persentase (%)</option>
          <option value="nominal">Nominal (Rp)</option>
        </select>
      </label>
      <input
        type="number"
        min="0"
        max={discountType === 'percent' ? 100 : undefined}
        inputMode="numeric"
        value={discountInput}
        onChange={(e) => setDiscountInput(e.target.value)}
        placeholder={discountType === 'percent' ? 'Contoh: 10' : 'Contoh: 20000'}
        aria-label={discountType === 'percent' ? 'Diskon dalam persen' : 'Diskon dalam Rupiah'}
      />
    </div>
  )
}

function NotesField({ notes, setNotes }) {
  return (
    <label className="ticket-notes">
      Catatan
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Catatan tambahan (opsional)"
      />
    </label>
  )
}

function TicketSummary({ subtotal, discountValue, total }) {
  return (
    <div className="transaksi-summary">
      <div>
        <span>Subtotal</span>
        <span>{formatRupiah(subtotal)}</span>
      </div>
      <div>
        <span>Diskon</span>
        <span>{formatRupiah(discountValue)}</span>
      </div>
      <div className="transaksi-total">
        <span>Total</span>
        <span>{formatRupiah(total)}</span>
      </div>
    </div>
  )
}

export default function TransaksiBaru() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  // Staff get the phone wizard; supervisors/admin keep the desk layout.
  const workerView = isStaff(profile)

  const [services, setServices] = useState([])
  const [shelfItems, setShelfItems] = useState([])
  const [selectedItems, setSelectedItems] = useState([])
  const [plateNumber, setPlateNumber] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [vehicleBrand, setVehicleBrand] = useState('')
  const [discountType, setDiscountType] = useState('percent')
  const [discountInput, setDiscountInput] = useState('')
  const [notes, setNotes] = useState('')
  const [washStaff, setWashStaff] = useState([])
  // undefined = roster not loaded yet, so the default hasn't been applied;
  // null = deliberately nobody. Keeps a choice made before the roster arrives
  // from being overwritten by the default.
  const [qcStaff, setQcStaff] = useState(undefined)
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const wizardRef = useRef(null)

  useEffect(() => {
    getActiveServices()
      .then(setServices)
      .catch(() => setError('Gagal memuat daftar layanan'))
    // Only what's in stock right now — a ticket can't sell what isn't there,
    // and the database rejects it anyway if the last one goes while this form
    // is open.
    getAvailableShelfItems()
      .then(setShelfItems)
      .catch(() => setError('Gagal memuat daftar barang'))
    getActiveProfiles()
      .then((workers) =>
        setQcStaff((current) => (current === undefined ? findDefaultQcStaff(workers) : current))
      )
      .catch(() => setQcStaff((current) => (current === undefined ? null : current)))
  }, [])

  // A ticket line is a service or a shelf item, so lines are keyed by a
  // composite key rather than a service id — the two id spaces are separate
  // and would otherwise collide.
  function addLine(line) {
    const existing = selectedItems.find((item) => item.key === line.key)
    // maxQuantity is the stock on hand for goods, undefined for services —
    // this branch never applies to a service line.
    if (existing?.maxQuantity != null && existing.quantity >= existing.maxQuantity) {
      setError('Stok barang ini sudah habis, tidak bisa menambah lagi')
      scrollToTop()
      return
    }
    setError('')
    setSelectedItems((items) => {
      if (!existing) return [...items, { ...line, quantity: 1 }]
      return items.map((item) =>
        item.key === line.key ? { ...item, quantity: item.quantity + 1 } : item
      )
    })
  }

  function addService(service) {
    addLine({
      key: `service-${service.id}`,
      serviceId: service.id,
      serviceName: service.name,
      unitPrice: getServicePrice(service),
      requiresVehicle: service.requires_vehicle,
    })
  }

  // soldOut comes straight from the picker's own stock check, so an item that
  // ran out is rejected here before it ever reaches addLine.
  function addShelfItem(item, soldOut) {
    if (soldOut) {
      setError('Stok barang ini sudah habis, tidak bisa menambah lagi')
      scrollToTop()
      return
    }
    addLine({
      key: `shelf-${item.id}`,
      shelfItemId: item.id,
      serviceName: item.name,
      unitPrice: item.price,
      requiresVehicle: false,
      maxQuantity: item.stock,
    })
  }

  function removeLine(key) {
    setSelectedItems((items) => items.filter((item) => item.key !== key))
  }

  function changeQuantity(key, quantity) {
    if (quantity < 1) {
      removeLine(key)
      return
    }
    setSelectedItems((items) =>
      items.map((item) =>
        item.key === key
          ? { ...item, quantity: Math.min(quantity, item.maxQuantity ?? quantity) }
          : item
      )
    )
  }

  const subtotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [selectedItems]
  )
  // Units on the ticket, not distinct lines — two of the same shelf item is
  // "2 item" on the worker action bar, matching what the quantity steppers say.
  const lineCount = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.quantity, 0),
    [selectedItems]
  )
  // Services carry their own requires_vehicle flag (migration 006), so a
  // ticket only asks for plate and brand once something vehicle-related is on
  // it — a Cuci Helm ticket never does.
  const needsVehicle = selectedItems.some((item) => item.requiresVehicle)
  // Staff type the discount as either a percentage of the bill or a straight
  // Rupiah amount. Percentages are resolved against the subtotal and rounded
  // to a whole Rupiah — the DB column is numeric but the app never displays or
  // stores fractional Rupiah (see formatRupiah). A discount can't exceed the
  // bill, whichever way it was entered.
  const discountValue = useMemo(() => {
    const typed = Math.max(Number(discountInput) || 0, 0)
    if (!typed) return 0
    const value =
      discountType === 'percent'
        ? Math.round((subtotal * Math.min(typed, 100)) / 100)
        : Math.round(typed)
    return Math.min(value, subtotal)
  }, [discountInput, discountType, subtotal])
  const total = subtotal - discountValue

  // The screen scrolls inside `.worker-content`, not the window, so bring the
  // wizard's own top back into view whenever the page (or error) changes.
  function scrollToTop() {
    requestAnimationFrame(() => {
      wizardRef.current?.scrollIntoView({ block: 'start' })
    })
  }

  function goToStep(next) {
    setError('')
    setStep(next)
    scrollToTop()
  }

  function goNext() {
    if (step === 1) {
      if (selectedItems.length === 0) {
        setError('Pilih minimal satu layanan atau barang')
        scrollToTop()
        return
      }
      goToStep(2)
      return
    }
    if (step === 2) {
      if (needsVehicle && !plateNumber.trim()) {
        setError('Nomor plat wajib diisi')
        scrollToTop()
        return
      }
      if (!customerName.trim()) {
        setError('Nama pelanggan wajib diisi')
        scrollToTop()
        return
      }
      goToStep(3)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (selectedItems.length === 0) {
      setError('Pilih minimal satu layanan atau barang')
      return
    }
    if (needsVehicle && !plateNumber.trim()) {
      setError('Nomor plat wajib diisi')
      return
    }
    if (!customerName.trim()) {
      setError('Nama pelanggan wajib diisi')
      return
    }
    // if (!customerPhone.trim()) {
    //   setError('Nomor telepon wajib diisi')
    //   return
    // }

    setSubmitting(true)
    try {
      // No paymentMethod — a new ticket is always queued unpaid and settled
      // later from Detail Transaksi, so it lands at status 'created' with no
      // payment row.
      await createTreatment({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        plateNumber: needsVehicle ? plateNumber : null,
        treatmentType: needsVehicle ? vehicleBrand.trim() || null : null,
        pic: profile.full_name,
        notes: notes.trim() || null,
        items: selectedItems,
        discount: discountValue,
        washStaffNames: washStaff,
        qcStaff: qcStaff ?? null,
      })
      navigate('/')
    } catch (err) {
      // Stock can run out between loading this form and submitting it, and
      // that message names the actual problem — don't bury it.
      setError(err.message?.includes('Stok') ? err.message : 'Gagal menyimpan transaksi, coba lagi')
      scrollToTop()
    } finally {
      setSubmitting(false)
    }
  }

  const customerFields = (
    <CustomerFields
      needsVehicle={needsVehicle}
      plateNumber={plateNumber}
      setPlateNumber={setPlateNumber}
      vehicleBrand={vehicleBrand}
      setVehicleBrand={setVehicleBrand}
      customerName={customerName}
      setCustomerName={setCustomerName}
      customerPhone={customerPhone}
      setCustomerPhone={setCustomerPhone}
    />
  )

  const staffFields = (
    <StaffFields
      washStaff={washStaff}
      setWashStaff={setWashStaff}
      qcStaff={qcStaff}
      setQcStaff={setQcStaff}
    />
  )

  const discountFields = (
    <DiscountFields
      discountType={discountType}
      setDiscountType={setDiscountType}
      discountInput={discountInput}
      setDiscountInput={setDiscountInput}
    />
  )

  // ---- Worker flow: three pages, confirmed before it is queued ----
  if (workerView) {
    // on the confirmation page the submit handler has to run, on the earlier
    // pages the same submit button moves to the next page.
    function handleWizardSubmit(e) {
      if (step < WIZARD_STEPS.length) {
        e.preventDefault()
        goNext()
        return
      }
      handleSubmit(e)
    }

    return (
      <form ref={wizardRef} className="worker-wizard" onSubmit={handleWizardSubmit} noValidate>
        <ol className="worker-wizard-steps" aria-label="Tahap transaksi baru">
          {WIZARD_STEPS.map((item) => (
            <li
              key={item.number}
              className={`worker-wizard-step ${step === item.number ? 'active' : ''} ${
                step > item.number ? 'done' : ''
              }`}
              aria-current={step === item.number ? 'step' : undefined}
            >
              <span className="worker-wizard-step-dot">
                {step > item.number ? '✓' : item.number}
              </span>
              <span className="worker-wizard-step-label">{item.label}</span>
            </li>
          ))}
        </ol>

        {error && <p className="form-error worker-wizard-error">{error}</p>}

        {step === 1 && (
          <section className="worker-wizard-page">
            <header className="worker-wizard-head">
              <h2 className="worker-wizard-title">Pilih Layanan &amp; Barang</h2>
              <p className="worker-wizard-subtitle">
                Ketuk kartu untuk menambah. Jumlah bisa diubah di daftar bawah.
              </p>
            </header>

            <h2 className="transaksi-section-label">Layanan</h2>
            <ServicePicker services={services} selectedItems={selectedItems} onAdd={addService} />

            <h2 className="transaksi-section-label">Barang</h2>
            <ShelfItemPicker
              items={shelfItems}
              selectedItems={selectedItems}
              onAdd={addShelfItem}
            />

            {selectedItems.length > 0 && (
              <div className="worker-wizard-card">
                <div className="worker-wizard-card-title">Item dipilih</div>
                <TicketLines
                  items={selectedItems}
                  emptyText="Belum ada item dipilih"
                  onQuantityChange={changeQuantity}
                  onRemove={removeLine}
                />
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="worker-wizard-page">
            <header className="worker-wizard-head">
              <h2 className="worker-wizard-title">Informasi Pelanggan</h2>
              <p className="worker-wizard-subtitle">
                {needsVehicle
                  ? 'Isi data pelanggan dan kendaraan yang akan dicuci.'
                  : 'Isi data pelanggan untuk tiket ini.'}
              </p>
            </header>

            <div className="worker-wizard-card">{customerFields}</div>

            <div className="worker-wizard-card">
              <div className="worker-wizard-card-title">Petugas</div>
              {staffFields}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="worker-wizard-page">
            <header className="worker-wizard-head">
              <h2 className="worker-wizard-title">Konfirmasi</h2>
              <p className="worker-wizard-subtitle">
                Periksa detail tiket sebelum disimpan ke antrian.
              </p>
            </header>

            <div className="worker-wizard-card">
              <div className="worker-wizard-card-title">Pelanggan</div>
              <dl className="worker-wizard-review">
                <div className="worker-wizard-review-row">
                  <dt>Nama</dt>
                  <dd>{customerName.trim() || '—'}</dd>
                </div>
                {customerPhone.trim() && (
                  <div className="worker-wizard-review-row">
                    <dt>Telepon</dt>
                    <dd>{customerPhone.trim()}</dd>
                  </div>
                )}
                {needsVehicle && (
                  <>
                    <div className="worker-wizard-review-row">
                      <dt>Nomor Plat</dt>
                      <dd>{plateNumber.trim() || '—'}</dd>
                    </div>
                    {vehicleBrand.trim() && (
                      <div className="worker-wizard-review-row">
                        <dt>Kendaraan</dt>
                        <dd>{vehicleBrand.trim()}</dd>
                      </div>
                    )}
                  </>
                )}
                <div className="worker-wizard-review-row">
                  <dt>Petugas Cuci</dt>
                  <dd>{washStaff.length ? washStaff.join(', ') : '—'}</dd>
                </div>
                <div className="worker-wizard-review-row">
                  <dt>Petugas QC</dt>
                  <dd>{qcStaff || '—'}</dd>
                </div>
              </dl>
            </div>

            <div className="worker-wizard-card">
              <div className="worker-wizard-card-title">Item ({lineCount})</div>
              <ul className="worker-wizard-review-items">
                {selectedItems.map((item) => (
                  <li key={item.key} className="worker-wizard-review-item">
                    <span className="worker-wizard-review-qty">{item.quantity}×</span>
                    <span className="worker-wizard-review-name">{item.serviceName}</span>
                    <span className="worker-wizard-review-price">
                      {formatRupiah(item.unitPrice * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="worker-wizard-card">
              {discountFields}
              <NotesField notes={notes} setNotes={setNotes} />
            </div>

            <div className="worker-wizard-card">
              <TicketSummary subtotal={subtotal} discountValue={discountValue} total={total} />
            </div>
          </section>
        )}

        <div className="worker-actionbar worker-wizard-bar">
          <div className="worker-actionbar-summary">
            <span className="worker-actionbar-count">
              {lineCount} item{lineCount === 0 ? ' dipilih' : ''}
            </span>
            <span className="worker-actionbar-total">{formatRupiah(total)}</span>
          </div>
          <div className="worker-wizard-bar-actions">
            {step > 1 && (
              <button
                type="button"
                className="worker-wizard-back"
                onClick={() => goToStep(step - 1)}
              >
                Kembali
              </button>
            )}
            <button
              type="submit"
              className="worker-actionbar-submit"
              disabled={submitting}
            >
              {step === WIZARD_STEPS.length
                ? submitting
                  ? 'Menyimpan...'
                  : 'Simpan'
                : 'Lanjut'}
            </button>
          </div>
        </div>
      </form>
    )
  }

  // ---- Desk flow: the two-column screen, unchanged ----
  return (
    <form className="transaksi-baru-screen" onSubmit={handleSubmit}>
      <div className="transaksi-catalog">
        <div className="transaksi-catalog-header">
          <h1>Transaksi Baru</h1>
        </div>
        <h2 className="transaksi-section-label">Layanan</h2>
        <ServicePicker services={services} selectedItems={selectedItems} onAdd={addService} />

        <h2 className="transaksi-section-label transaksi-section-label-spaced">Barang</h2>
        <ShelfItemPicker items={shelfItems} selectedItems={selectedItems} onAdd={addShelfItem} />
      </div>

      <aside className="ticket-panel">
        <div className="ticket-panel-title">Tiket Saat Ini</div>

        {customerFields}

        {staffFields}

        <TicketLines
          items={selectedItems}
          emptyText="Belum ada item — pilih layanan atau barang di sebelah kiri"
          onQuantityChange={changeQuantity}
          onRemove={removeLine}
        />

        {discountFields}

        <NotesField notes={notes} setNotes={setNotes} />

        <TicketSummary subtotal={subtotal} discountValue={discountValue} total={total} />

        {error && <p className="form-error">{error}</p>}

        <button type="submit" className="ticket-submit" disabled={submitting}>
          {submitting ? 'Menyimpan...' : 'Simpan ke Antrian'}
        </button>
      </aside>
    </form>
  )
}
