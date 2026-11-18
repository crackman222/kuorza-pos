import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveServices, getAvailableShelfItems, getActiveProfiles, createTreatment, checkoutTreatment } from '../api'
import { ServicePicker } from '../components/ServicePicker'
import { ShelfItemPicker } from '../components/ShelfItemPicker'
import { StaffPicker } from '../components/StaffPicker'
import { MultiStaffPicker } from '../components/MultiStaffPicker'
import { MissingFieldsModal } from '../components/MissingFieldsModal'
import { PaymentModal } from '../components/PaymentModal'
import { formatRupiah } from '../lib/format'
import { getServicePrice, hasPromo, PRICE_MODES } from '../lib/servicePrice'
import { PriceModeToggle } from '../components/PriceModeToggle'
import { findDefaultQcStaff } from '../lib/staffDefaults'
import { useAuth } from '../context/useAuth'
import { isStaff } from '../lib/roles'
import { useLanguage } from '../context/useLanguage'
import { translateServiceName } from '../lib/i18n'
import { Icon } from '../components/Icon'

// Workers build a ticket one page at a time — items, customer, confirmation —
// while the desk keeps the single two-column screen. Both share the same state
// and the same submit; only the chrome around it changes.

const WIZARD_STEPS = [
  { number: 1, label: 'Item' },
  { number: 2, label: 'Pelanggan' },
  { number: 3, label: 'Konfirmasi' },
]

// Service lines are translated for display; shelf items (serviceId == null)
// are shop goods with free-form names and show as stored.
function lineName(tService, item) {
  return item.serviceId != null ? tService(item.serviceName) : item.serviceName
}

function TicketLines({ items, emptyText, invalid = false, onQuantityChange, onRemove }) {
  const { t, tService } = useLanguage()
  if (items.length === 0) {
    return (
      <p className={`ticket-lines-empty ${invalid ? 'is-invalid' : ''}`} data-field="items">
        {emptyText}
      </p>
    )
  }

  return (
    <div className="ticket-lines">
      {items.map((item) => (
        <div key={item.key} className="ticket-line">
          <div className="ticket-line-info">
            <span className="ticket-line-name">{lineName(tService, item)}</span>
            <span className="ticket-line-unit">
              {formatRupiah(item.unitPrice)} / {t('item')}
              {item.maxQuantity != null && ` · ${t('stok {count}', { count: item.maxQuantity })}`}
            </span>
          </div>
          <div className="ticket-line-qty">
            <button
              type="button"
              onClick={() => onQuantityChange(item.key, item.quantity - 1)}
              aria-label={t('Kurangi')}
            >
              <Icon name="remove" size={18} />
            </button>
            <span>{item.quantity}</span>
            <button
              type="button"
              onClick={() => onQuantityChange(item.key, item.quantity + 1)}
              disabled={item.maxQuantity != null && item.quantity >= item.maxQuantity}
              aria-label={t('Tambah')}
            >
              <Icon name="add" size={18} />
            </button>
          </div>
          <span className="ticket-line-total">
            {formatRupiah(item.unitPrice * item.quantity)}
          </span>
          <button
            type="button"
            className="ticket-line-remove"
            onClick={() => onRemove(item.key)}
            aria-label={t('Hapus item')}
          >
            <Icon name="delete" size={20} />
          </button>
        </div>
      ))}
    </div>
  )
}

// One vehicle per unit of a vehicle service on the ticket — "Motor Basic Wash
// - S" ×2 is two motorbikes, each needing its own plate. Slots are keyed by
// line key + index rather than position, so removing one line doesn't shift
// the plates already typed for the others onto the wrong service.
function buildVehicleSlots(items) {
  const vehicleLines = items.filter((item) => item.requiresVehicle)
  const slots = []
  for (const line of vehicleLines) {
    for (let i = 0; i < line.quantity; i++) {
      slots.push({
        key: `${line.key}-${i}`,
        serviceName: line.serviceName,
        // Only number units within a line when there's more than one of it.
        unitLabel: line.quantity > 1 ? ` #${i + 1}` : '',
      })
    }
  }
  return slots
}

// "Nomor Plat", or "Nomor Plat Kendaraan 2 — Motor Basic Wash - S #2" once
// there's more than one vehicle — used by both the field and the popup, so
// the popup names exactly the label staff will see on screen. `field` is the
// untranslated Indonesian label ('Nomor Plat' / 'Merek Kendaraan').
function vehicleFieldLabel(t, field, vehicleSlots, index) {
  if (vehicleSlots.length <= 1) return t(field)
  const slot = vehicleSlots[index]
  return t('{field} Kendaraan {number} — {service}', {
    field: t(field),
    number: index + 1,
    service: `${translateServiceName(slot.serviceName)}${slot.unitLabel}`,
  })
}

// Small red note under a highlighted field, so the reason survives after the
// popup is dismissed.
function FieldHint({ show, children }) {
  const { t } = useLanguage()
  if (!show) return null
  return <span className="field-invalid-hint">{children ?? t('Wajib diisi')}</span>
}

function CustomerFields({
  isInvalid,
  needsVehicle,
  vehicleSlots,
  plateNumbers,
  setPlateNumber,
  vehicleBrands,
  setVehicleBrand,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
}) {
  const { t } = useLanguage()
  return (
    <div className="ticket-fields">
      {needsVehicle && (
        <>
          {vehicleSlots.map((slot, index) => {
            const plateIssue = isInvalid(`plate-${slot.key}`)
            return (
              <Fragment key={slot.key}>
                <label className={plateIssue ? 'is-invalid' : ''}>
                  {vehicleFieldLabel(t, 'Nomor Plat', vehicleSlots, index)}
                  <input
                    className={plateIssue ? 'is-invalid' : ''}
                    data-field={`plate-${slot.key}`}
                    value={plateNumbers[slot.key] ?? ''}
                    onChange={(e) => setPlateNumber(slot.key, e.target.value)}
                    placeholder={t('Contoh: B 1234 XYZ')}
                    required
                    aria-invalid={plateIssue ? true : undefined}
                  />
                  <FieldHint show={plateIssue}>
                    {plateIssue === 'duplicate' ? t('Nomor plat sama dengan kendaraan lain') : t('Wajib diisi')}
                  </FieldHint>
                </label>
                <label>
                  {vehicleFieldLabel(t, 'Merek Kendaraan', vehicleSlots, index)}
                  <input
                    value={vehicleBrands[slot.key] ?? ''}
                    onChange={(e) => setVehicleBrand(slot.key, e.target.value)}
                    placeholder={t('Contoh: Honda Vario')}
                  />
                </label>
              </Fragment>
            )
          })}
        </>
      )}
      <label className={isInvalid('customerName') ? 'is-invalid' : ''}>
        {t('Nama Pelanggan')}
        <input
          className={isInvalid('customerName') ? 'is-invalid' : ''}
          data-field="customerName"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder={t('Nama pelanggan')}
          required
          aria-invalid={isInvalid('customerName') ? true : undefined}
        />
        <FieldHint show={isInvalid('customerName')} />
      </label>
      <label>
        {t('Nomor Telepon')}
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
  const { t } = useLanguage()
  return (
    <div className="ticket-fields ticket-staff-fields">
      <div className="ticket-staff-row">
        <span className="ticket-staff-label">{t('Petugas Cuci')}</span>
        <MultiStaffPicker value={washStaff} onChange={setWashStaff} />
      </div>
      <div className="ticket-staff-row">
        <span className="ticket-staff-label">{t('Petugas QC')}</span>
        <StaffPicker value={qcStaff} onChange={setQcStaff} />
      </div>
    </div>
  )
}

// Custom discount input — disabled: new tickets no longer take a manual
// discount (the promo/harga normal toggle is the only price reduction).
// Kept commented out in case it's wanted back.
// function DiscountFields({
//   discountType,
//   setDiscountType,
//   discountInput,
//   setDiscountInput,
// }) {
//   const { t } = useLanguage()
//   return (
//     <div className="ticket-discount">
//       <label>
//         {t('Diskon')}
//         <select
//           value={discountType}
//           onChange={(e) => {
//             // A number typed as a percentage means something completely
//             // different in Rupiah, so don't carry it across.
//             setDiscountType(e.target.value)
//             setDiscountInput('')
//           }}
//         >
//           <option value="percent">{t('Persentase (%)')}</option>
//           <option value="nominal">{t('Nominal (Rp)')}</option>
//         </select>
//       </label>
//       <input
//         type="number"
//         min="0"
//         max={discountType === 'percent' ? 100 : undefined}
//         inputMode="numeric"
//         value={discountInput}
//         onChange={(e) => setDiscountInput(e.target.value)}
//         placeholder={discountType === 'percent' ? t('Contoh: 10') : t('Contoh: 20000')}
//         aria-label={discountType === 'percent' ? t('Diskon dalam persen') : t('Diskon dalam Rupiah')}
//       />
//     </div>
//   )
// }

function NotesField({ notes, setNotes }) {
  const { t } = useLanguage()
  return (
    <label className="ticket-notes">
      {t('Catatan')}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t('Catatan tambahan (opsional)')}
      />
    </label>
  )
}

function TicketSummary({ subtotal, total /* , discountValue */ }) {
  const { t } = useLanguage()
  return (
    <div className="transaksi-summary">
      <div>
        <span>{t('Subtotal')}</span>
        <span>{formatRupiah(subtotal)}</span>
      </div>
      {/* Discount row — disabled along with DiscountFields.
      <div>
        <span>{t('Diskon')}</span>
        <span>{formatRupiah(discountValue)}</span>
      </div>
      */}
      <div className="transaksi-total">
        <span>{t('Total')}</span>
        <span>{formatRupiah(total)}</span>
      </div>
    </div>
  )
}

export default function TransaksiBaru() {
  const { profile } = useAuth()
  const { t, tService } = useLanguage()
  const navigate = useNavigate()
  // Staff get the phone wizard; supervisors/admin keep the desk layout.
  const workerView = isStaff(profile)

  const [services, setServices] = useState([])
  const [shelfItems, setShelfItems] = useState([])
  const [selectedItems, setSelectedItems] = useState([])
  // Plates by vehicle slot key (see buildVehicleSlots). Entries for slots that
  // no longer exist are kept, so bumping a quantity back up restores what was
  // typed — only the current slots are ever validated or saved.
  const [plateNumbers, setPlateNumbers] = useState({})
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  // Brands by vehicle slot key, same as plateNumbers.
  const [vehicleBrands, setVehicleBrands] = useState({})
  // Disabled with DiscountFields:
  // const [discountType, setDiscountType] = useState('percent')
  // const [discountInput, setDiscountInput] = useState('')
  const [notes, setNotes] = useState('')
  // Promo or harga normal for every service on this ticket — see
  // PriceModeToggle. Defaults to promo, which is what Katalog advertises.
  const [priceMode, setPriceMode] = useState(PRICE_MODES.PROMO)
  const [washStaff, setWashStaff] = useState([])
  // undefined = roster not loaded yet, so the default hasn't been applied;
  // null = deliberately nobody. Keeps a choice made before the roster arrives
  // from being overwritten by the default.
  const [qcStaff, setQcStaff] = useState(undefined)
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Set after a submit/Lanjut attempt that found gaps. Highlights are then
  // computed live from the form state, so each one clears as soon as that
  // field is filled — no need to resubmit to see what's left.
  const [showInvalid, setShowInvalid] = useState(false)
  // The issues listed in the popup, or null when it's closed.
  const [missingPopup, setMissingPopup] = useState(null)
  // Checkout payment popup for an item-only sale (see itemOnly).
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const wizardRef = useRef(null)
  const deskRef = useRef(null)

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
      unitPrice: getServicePrice(service, priceMode),
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

  // Switching mode reprices the service lines already on the ticket, so the
  // whole ticket is always on one price mode. Shelf items keep their price.
  function changePriceMode(mode) {
    setPriceMode(mode)
    setSelectedItems((items) =>
      items.map((item) => {
        if (item.serviceId == null) return item
        const service = services.find((s) => s.id === item.serviceId)
        return service ? { ...item, unitPrice: getServicePrice(service, mode) } : item
      })
    )
  }

  const promoCount = useMemo(() => services.filter(hasPromo).length, [services])

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
  // Nothing but shelf goods: no wash, so no queue and no wash/QC crew — it's
  // paid at checkout and closed straight away.
  const itemOnly = selectedItems.length > 0 && selectedItems.every((item) => item.shelfItemId != null)
  const vehicleSlots = useMemo(() => buildVehicleSlots(selectedItems), [selectedItems])
  const currentPlates = vehicleSlots.map((slot) => (plateNumbers[slot.key] ?? '').trim())

  const currentBrands = vehicleSlots.map((slot) => (vehicleBrands[slot.key] ?? '').trim())

  function setPlateNumber(slotKey, value) {
    setPlateNumbers((plates) => ({ ...plates, [slotKey]: value }))
  }

  function setVehicleBrand(slotKey, value) {
    setVehicleBrands((brands) => ({ ...brands, [slotKey]: value }))
  }

  // Brand stays optional per vehicle. treatment_type is one text column, so
  // brands are stored comma-separated in the same order as the plates; a
  // blank one is written as '-' so the Nth brand still lines up with the Nth
  // plate. Null when no brand was typed at all.
  
  const treatmentTypeValue = currentBrands.some(Boolean)
    ? currentBrands.map((brand) => brand || '-').join(', ')
    : null

  // Everything a ticket can't be saved without, as { key, label, kind } —
  // key matches the field's data-field attribute so it can be highlighted
  // and focused. `scope` limits it to one wizard page: 'items', 'customer',
  // or 'all' for the final submit / desk form. Phone is optional for now.
  
  function collectIssues(scope = 'all') {
    const issues = []
    if ((scope === 'all' || scope === 'items') && selectedItems.length === 0) {
      issues.push({ key: 'items', label: t('Pilih minimal satu layanan atau barang'), kind: 'missing' })
    }
    if (scope === 'all' || scope === 'customer') {
      if (needsVehicle) {
        // Every vehicle needs a plate, and no plate twice — two vehicles
        // can't share one.
        const normalized = currentPlates.map((plate) => plate.toUpperCase().replace(/\s+/g, ''))
        vehicleSlots.forEach((slot, index) => {
          const key = `plate-${slot.key}`
          const label = vehicleFieldLabel(t, 'Nomor Plat', vehicleSlots, index)
          if (!currentPlates[index]) {
            issues.push({ key, label, kind: 'missing' })
          } else if (normalized.indexOf(normalized[index]) !== index) {
            issues.push({ key, label: t('{label} (sama dengan kendaraan lain)', { label }), kind: 'duplicate' })
          }
        })
      }
      if (!customerName.trim()) {
        issues.push({ key: 'customerName', label: t('Nama Pelanggan'), kind: 'missing' })
      }
    }
    return issues
  }

  const liveIssues = showInvalid ? collectIssues() : []
  // Truthy for a highlighted field: 'missing' or 'duplicate'.
  function isInvalid(key) {
    return liveIssues.find((issue) => issue.key === key)?.kind ?? false
  }

  // Returns true when the form may continue; otherwise flags the fields and
  // opens the popup listing them.
  function checkRequired(scope) {
    const issues = collectIssues(scope)
    if (issues.length === 0) return true
    setError('')
    setShowInvalid(true)
    setMissingPopup(issues)
    return false
  }

  // After the popup is dismissed, put the cursor in the first field it named
  // so staff land right where they need to type.
  function closeMissingPopup() {
    const firstKey = missingPopup?.[0]?.key
    setMissingPopup(null)
    if (!firstKey) return
    requestAnimationFrame(() => {
      const root = (workerView ? wizardRef : deskRef).current
      const target = root?.querySelector(`[data-field="${firstKey}"]`)
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      if (target.tagName === 'INPUT') target.focus({ preventScroll: true })
    })
  }

  // No custom discount on a new ticket — the only price reduction is the
  // promo/harga normal toggle, already reflected in each line's unit price.
  const total = subtotal

  // Disabled with DiscountFields. Staff typed the discount as either a
  // percentage of the bill or a straight Rupiah amount. Percentages were
  // resolved against the subtotal and rounded to a whole Rupiah, and a
  // discount couldn't exceed the bill. To restore, uncomment this and set
  // `total = subtotal - discountValue`.
  // const discountValue = useMemo(() => {
  //   const typed = Math.max(Number(discountInput) || 0, 0)
  //   if (!typed) return 0
  //   const value =
  //     discountType === 'percent'
  //       ? Math.round((subtotal * Math.min(typed, 100)) / 100)
  //       : Math.round(typed)
  //   return Math.min(value, subtotal)
  // }, [discountInput, discountType, subtotal])
  // const total = subtotal - discountValue

  // The screen scrolls inside `.worker-content`, not the window, so bring the
  // wizard's own top back into view whenever the page (or error) changes.
  function scrollToTop() {
    requestAnimationFrame(() => {
      wizardRef.current?.scrollIntoView({ block: 'start' })
    })
  }

  function goToStep(next) {
    setError('')
    setShowInvalid(false)
    setStep(next)
    scrollToTop()
  }

  function goNext() {
    if (step === 1) {
      if (!checkRequired('items')) return
      goToStep(2)
      return
    }
    if (step === 2) {
      if (!checkRequired('customer')) return
      goToStep(3)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!checkRequired('all')) return
    // if (!customerPhone.trim()) {
    //   setError('Nomor telepon wajib diisi')
    //   return
    // }

    if (itemOnly) {
      setPaymentError('')
      setPaymentOpen(true)
      return
    }

    setSubmitting(true)
    try {
      // No paymentMethod — a new ticket is always queued unpaid and settled
      // later from Detail Transaksi, so it lands at status 'created' with no
      // payment row.
      await createTreatment({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        // treatments.plate_number is one text column, so several vehicles'
        // plates share it comma-separated — the same convention as
        // wash_staff. Plate search (ilike) still finds each one.
        plateNumber: needsVehicle ? currentPlates.join(', ') : null,
        treatmentType: needsVehicle ? treatmentTypeValue : null,
        notes: notes.trim() || null,
        items: selectedItems,
        priceMode,
        discount: 0, // was: discountValue
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

  // Item-only checkout: record payment (+ proof), close, show the receipt.
  async function handleCheckout({ paymentMethod, proofFile }) {
    setPaymentError('')
    setSubmitting(true)
    try {
      const treatment = await checkoutTreatment(
        {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          plateNumber: null,
          treatmentType: null,
          notes: notes.trim() || null,
          items: selectedItems,
          discount: 0,
        },
        { paymentMethod, proofFile }
      )
      navigate(`/struk/${treatment.id}`)
    } catch (err) {
      // The sale went through but its proof photo or close didn't — it now
      // sits in the queue as paid-but-open, so send staff to that ticket to
      // finish it rather than letting them submit (and sell) it a second time.
      if (err.treatmentId) {
        navigate(`/treatment/${err.treatmentId}`)
        return
      }
      setPaymentError(err.message?.includes('Stok') ? err.message : 'Gagal menyimpan transaksi, coba lagi')
    } finally {
      setSubmitting(false)
    }
  }

  const customerFields = (
    <CustomerFields
      isInvalid={isInvalid}
      needsVehicle={needsVehicle}
      vehicleSlots={vehicleSlots}
      plateNumbers={plateNumbers}
      setPlateNumber={setPlateNumber}
      vehicleBrands={vehicleBrands}
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

  const priceModeToggle = (
    <PriceModeToggle value={priceMode} onChange={changePriceMode} promoCount={promoCount} />
  )

  // Disabled with DiscountFields:
  // const discountFields = (
  //   <DiscountFields
  //     discountType={discountType}
  //     setDiscountType={setDiscountType}
  //     discountInput={discountInput}
  //     setDiscountInput={setDiscountInput}
  //   />
  // )

  const missingFieldsModal = (
    <>
      {missingPopup && <MissingFieldsModal issues={missingPopup} onClose={closeMissingPopup} />}
      {paymentOpen && (
        <PaymentModal
          total={total}
          busy={submitting}
          error={paymentError}
          onConfirm={handleCheckout}
          onCancel={() => setPaymentOpen(false)}
        />
      )}
    </>
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
      <>
      <form ref={wizardRef} className="worker-wizard" onSubmit={handleWizardSubmit} noValidate>
        <ol className="worker-wizard-steps" aria-label={t('Tahap transaksi baru')}>
          {WIZARD_STEPS.map((item) => (
            <li
              key={item.number}
              className={`worker-wizard-step ${step === item.number ? 'active' : ''} ${step > item.number ? 'done' : ''
                }`}
              aria-current={step === item.number ? 'step' : undefined}
            >
              <span className="worker-wizard-step-dot">
                {step > item.number ? <Icon name="check" size={18} /> : item.number}
              </span>
              <span className="worker-wizard-step-label">{t(item.label)}</span>
            </li>
          ))}
        </ol>

        {error && <p className="form-error worker-wizard-error">{t(error)}</p>}

        {step === 1 && (
          <section className="worker-wizard-page">
            <header className="worker-wizard-head">
              <h2 className="worker-wizard-title">{t('Pilih Layanan & Barang')}</h2>
              <p className="worker-wizard-subtitle">
                {t('Ketuk kartu untuk menambah. Jumlah bisa diubah di daftar bawah.')}
              </p>
            </header>

            {priceModeToggle}

            <h2 className="transaksi-section-label">{t('Layanan')}</h2>
            <ServicePicker
              services={services}
              selectedItems={selectedItems}
              onAdd={addService}
              priceMode={priceMode}
              worker
            />

            <h2 className="transaksi-section-label">{t('Barang')}</h2>
            <ShelfItemPicker
              items={shelfItems}
              selectedItems={selectedItems}
              onAdd={addShelfItem}
            />

            {selectedItems.length > 0 && (
              <div className="worker-wizard-card">
                <div className="worker-wizard-card-title">{t('Item dipilih')}</div>
                <TicketLines
                  items={selectedItems}
                  emptyText={t('Belum ada item dipilih')}
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
              <h2 className="worker-wizard-title">{t('Informasi Pelanggan')}</h2>
              <p className="worker-wizard-subtitle">
                {needsVehicle
                  ? t('Isi data pelanggan dan kendaraan yang akan dicuci.')
                  : t('Isi data pelanggan untuk tiket ini.')}
              </p>
            </header>

            <div className="worker-wizard-card">{customerFields}</div>

            {!itemOnly && (
              <div className="worker-wizard-card">
                <div className="worker-wizard-card-title">{t('Petugas')}</div>
                {staffFields}
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="worker-wizard-page">
            <header className="worker-wizard-head">
              <h2 className="worker-wizard-title">{t('Konfirmasi')}</h2>
              <p className="worker-wizard-subtitle">
                {itemOnly
                  ? t('Periksa detail sebelum pembayaran.')
                  : t('Periksa detail tiket sebelum disimpan ke antrian.')}
              </p>
            </header>

            <div className="worker-wizard-card">
              <div className="worker-wizard-card-title">{t('Pelanggan')}</div>
              <dl className="worker-wizard-review">
                <div className="worker-wizard-review-row">
                  <dt>{t('Nama')}</dt>
                  <dd>{customerName.trim() || '—'}</dd>
                </div>
                {customerPhone.trim() && (
                  <div className="worker-wizard-review-row">
                    <dt>{t('Telepon')}</dt>
                    <dd>{customerPhone.trim()}</dd>
                  </div>
                )}
                {needsVehicle && (
                  <>
                    {vehicleSlots.map((slot, index) => {
                      const number = vehicleSlots.length > 1 ? ` ${index + 1}` : ''
                      return (
                        <Fragment key={slot.key}>
                          <div className="worker-wizard-review-row">
                            <dt>{`${t('Nomor Plat')}${number}`}</dt>
                            <dd>{currentPlates[index] || '—'}</dd>
                          </div>
                          {currentBrands[index] && (
                            <div className="worker-wizard-review-row">
                              <dt>{`${t('Kendaraan')}${number}`}</dt>
                              <dd>{currentBrands[index]}</dd>
                            </div>
                          )}
                        </Fragment>
                      )
                    })}
                  </>
                )}
                {!itemOnly && (
                  <>
                    <div className="worker-wizard-review-row">
                      <dt>{t('Petugas Cuci')}</dt>
                      <dd>{washStaff.length ? washStaff.join(', ') : '—'}</dd>
                    </div>
                    <div className="worker-wizard-review-row">
                      <dt>{t('Petugas QC')}</dt>
                      <dd>{qcStaff || '—'}</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>

            <div className="worker-wizard-card">
              <div className="worker-wizard-card-title">
                {t('Item ({count})', { count: lineCount })}
                {promoCount > 0 &&
                  ` · ${priceMode === PRICE_MODES.PROMO ? t('Harga Promo') : t('Harga Normal')}`}
              </div>
              <ul className="worker-wizard-review-items">
                {selectedItems.map((item) => (
                  <li key={item.key} className="worker-wizard-review-item">
                    <span className="worker-wizard-review-qty">{item.quantity}×</span>
                    <span className="worker-wizard-review-name">{lineName(tService, item)}</span>
                    <span className="worker-wizard-review-price">
                      {formatRupiah(item.unitPrice * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="worker-wizard-card">
              {/* {discountFields} */}
              <NotesField notes={notes} setNotes={setNotes} />
            </div>

            <div className="worker-wizard-card">
              <TicketSummary subtotal={subtotal} total={total} /* discountValue={discountValue} */ />
            </div>
          </section>
        )}

        <div className="worker-actionbar worker-wizard-bar">
          <div className="worker-actionbar-summary">
            <span className="worker-actionbar-count">
              {lineCount === 0 ? t('0 item dipilih') : t('{count} item', { count: lineCount })}
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
                {t('Kembali')}
              </button>
            )}
            <button
              type="submit"
              className="worker-actionbar-submit"
              disabled={submitting}
            >
              {step === WIZARD_STEPS.length
                ? submitting
                  ? t('Menyimpan...')
                  : itemOnly
                    ? t('Bayar Sekarang')
                    : t('Simpan')
                : t('Lanjut')}
            </button>
          </div>
        </div>
      </form>
      {missingFieldsModal}
      </>
    )
  }

  // ---- Desk flow: the two-column screen, unchanged ----
  // noValidate: the browser's own "please fill out this field" bubble would
  // stop the submit before handleSubmit runs and only ever names one field.
  return (
    <>
    <form ref={deskRef} className="transaksi-baru-screen" onSubmit={handleSubmit} noValidate>
      <div className="transaksi-catalog">
        <div className="transaksi-catalog-header">
          <h1>{t('Transaksi Baru')}</h1>
        </div>
        {priceModeToggle}
        <h2 className="transaksi-section-label">{t('Layanan')}</h2>
        <ServicePicker
          services={services}
          selectedItems={selectedItems}
          onAdd={addService}
          priceMode={priceMode}
        />

        <h2 className="transaksi-section-label transaksi-section-label-spaced">{t('Barang')}</h2>
        <ShelfItemPicker items={shelfItems} selectedItems={selectedItems} onAdd={addShelfItem} />
      </div>

      <aside className="ticket-panel">
        <div className="ticket-panel-title">{t('Tiket Saat Ini')}</div>

        {customerFields}

        {!itemOnly && staffFields}

        <TicketLines
          items={selectedItems}
          emptyText={t('Belum ada item — pilih layanan atau barang di sebelah kiri')}
          invalid={Boolean(isInvalid('items'))}
          onQuantityChange={changeQuantity}
          onRemove={removeLine}
        />

        {/* {discountFields} */}

        <NotesField notes={notes} setNotes={setNotes} />

        <TicketSummary subtotal={subtotal} total={total} /* discountValue={discountValue} */ />

        {error && <p className="form-error">{t(error)}</p>}

        <button type="submit" className="ticket-submit" disabled={submitting}>
          {submitting ? t('Menyimpan...') : itemOnly ? t('Bayar & Selesai') : t('Simpan ke Antrian')}
        </button>
      </aside>
    </form>
    {missingFieldsModal}
    </>
  )
}
