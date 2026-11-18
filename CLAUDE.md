# Nineteen Details POS — Claude Code Instructions

## Project overview
A point-of-sale web app for Nineteen Details, a car/motorcycle wash and detailing
service business in Indonesia. It replaces a manual process of WhatsApp group
reporting and handwritten receipts. Staff use it to record completed service
treatments and view digital receipts.

## What this system does
1. Staff opens the app — sees a list of active staff names
2. Staff taps their name and enters their 6-digit PIN
3. Staff creates a treatment — vehicle plate, services rendered, payment method
4. App saves the treatment and displays a digital receipt
5. Staff closes the treatment

That is the entire scope. No payment processing, no booking system, no inventory.

## Tech stack
- Frontend: React + Vite (JSX — not TypeScript, do not introduce TSX or TS files)
- Backend: Supabase (auth + database + auto-generated API)
- Database: PostgreSQL via Supabase
- Styling: CSS (existing app.css and index.css — expand, do not replace)
- Hosting: Vercel

## Language
The UI is bilingual: Bahasa Indonesia (default) and English, switched with the
ID/EN toggle on the login card and in both app shells (`LanguageToggle`). The
choice is remembered per device in localStorage (`kuorza-language`).

Indonesian is the source language. Write every user-facing string — labels,
buttons, placeholders, error messages — in Indonesian and pass it through
`t()` from `useLanguage()` (`src/context/useLanguage.js`). The Indonesian text
itself is the lookup key; add its English to `src/lib/i18n-en.js`. A string
with no English entry simply shows in Indonesian. Placeholders are
`{name}`-style: `t('Sisa {count}', { count })`.
- Error messages are stored as the Indonesian string and translated where
  they're displayed (`{t(error)}`), so API/validation errors keep working
- Plain modules (exports, date formatting) use `translate()` / `dateLocale()`
  from `src/lib/i18n.js` instead of the hook
- Don't name a `.map()` variable `t` in a component that uses `t()`
- Money is never localized: always `formatRupiah` → "Rp 15.000"
- Data from the database (customer names, notes, shelf item names) and
  messages raised by Postgres triggers/Edge Functions are shown as stored
- Service names are the one exception: in English mode they're translated
  for display with `tService()` (`translateServiceName()` in
  `src/lib/i18n.js`) — the vehicle prefix (Motor/Mobil/Helm), "Ojek Online",
  and the five old generic names matched whole. What's saved to
  `treatment_items.service_name` stays the stored Indonesian name. A new
  service that doesn't follow the "Vehicle Treatment - Size" naming shows as
  stored. Currently applied on Transaksi Baru only

Code — variable names, function names, comments — stays in English.

---

## Project structure

### Current (already exists — do not recreate these files)
```
src/
├── lib/
│   └── supabase.jsx        # Supabase client — already working
├── app.css                 # Global styles
├── app.jsx                 # Root component
├── index.css               # Base styles
└── main.jsx                # Entry point
```

### Target (expand into this)
```
src/
├── lib/
│   └── supabase.jsx        # Already exists
├── api/
│   ├── index.js            # Barrel export
│   ├── auth.js             # login, logout, getCurrentProfile
│   ├── services.js         # getActiveServices
│   └── treatments.js       # createTreatment, closeTreatment, voidTreatment, search
├── components/             # Reusable UI components
├── pages/                  # One file per screen
├── app.css
├── app.jsx
├── index.css
└── main.jsx
```

---

## Database schema

These tables already exist in Supabase. Do not recreate or alter them
unless a migration file explicitly says to.

### `profiles`
Everyone who works here — one roster, since migration 009 folded
`field_workers` into this table. Having a dashboard login is optional: a row
with `username = null` is a person who can be assigned wash/QC duty but
cannot sign in.
- id uuid PK (default gen_random_uuid()). For anyone with a login this IS
  the auth UUID — `login()`/`getCurrentProfile()` resolve the row by
  `session.user.id`. The FK to `auth.users` was dropped in migration 009 so
  login-less rows are possible; nothing else FKs this column either, since
  `pic`/`wash_staff`/`qc_staff` are text snapshots
- username text UNIQUE, nullable — the login handle. The address actually
  signed in with is always `username@nineteendetails.internal`, so it must
  match the local part of the Auth account's email. Null = no login yet
- full_name text
- role text (default: 'staff') — 'staff' | 'supervisor' | 'admin', enforced
  by the `profiles_role_check` constraint (migration 008). In increasing
  order of reach:
  - `staff` — the people doing the work. Dashboard, Transaksi Baru, Katalog,
    plus Detail Treatment / Struk (not nav items, but where a ticket is
    actually worked, and where Transaksi Baru lands after submitting)
  - `supervisor` — everything staff sees plus Riwayat and Laporan. This is
    what `staff` meant before the split; the existing office staff were
    migrated to it. Managing wages is planned here but not built yet
  - `admin` — everything, including Kelola Staf
  Client-side gating is `AdminRoute` / `SupervisorRoute` + the `access` field
  on `AppShell`'s NAV_ITEMS; role helpers live in `src/lib/roles.js`. RLS
  has `is_admin()` and `is_supervisor()` (the latter admits admins too, and
  is not yet used by any policy)
- phone text, nullable
- is_active boolean (default: true) — "removing" a worker sets this false
  rather than deleting the row or the auth user; see Auth Rules below
- created_at timestamptz

RLS: staff can only read their own row. Only role='admin' can read/insert/
update/delete other rows (see `is_admin()` helper + policies, added
alongside the worker-management feature). The old "any authenticated user,
full access" policy on `profiles` is gone — it let any logged-in staff read
or edit any other staff's row, including their own `role`.

### `active_staff_names` (view)
`select id, full_name from profiles where is_active = true`. Names only, so
phone numbers, roles, and usernames never reach it. It feeds the wash/QC
assignment dropdown (`StaffPicker` / `MultiStaffPicker`) and is readable by
any signed-in user — the view runs with owner privileges, which is what gets
past the admin-only RLS on `profiles` itself. **Not** anon-readable: the
grant to `anon` was revoked in migration 009, when the login name picker was
replaced by a typed username, so an anonymous visitor can no longer
enumerate who works here.

`field_workers` and `active_field_workers` were dropped in migration 009 —
everyone is in `profiles` now.

### `services`
The menu of available wash/detailing services.
- id bigint PK
- name text
- requires_vehicle boolean (default: true) — false for services with no
  vehicle involved (e.g. Cuci Helm). Drives whether Transaksi Baru asks for
  a plate number and vehicle brand at all; set it in the Supabase dashboard
  when adding the service
- price numeric — the normal price ("harga normal")
- promo_price numeric, nullable (migration 011) — when set, this is what's
  charged. Always read the charged price through `getServicePrice()` in
  `src/lib/servicePrice.js`, never `price` directly. Supervisors change it in
  Katalog via the `set_service_promo_price(p_service_id, p_promo_price)` RPC,
  which only touches this column and refuses a promo that is <= 0 or not
  below `price`; null ends the promo
  Katalog now edits `price` and `promo_price` together through
  `set_service_prices(p_service_id, p_price, p_promo_price)` (migration 017),
  same checks plus `price > 0`; the older RPC is no longer called from the UI
- sort_order integer — menu order (1xx Motor, 2xx Mobil, 3xx Helm, sizes
  ascending within each). One row per size, named e.g. "Motor Basic Wash - S"

### `shelf_items`
Goods sold off the shelf alongside services (added via migration 010).
Unlike a service, a shelf item is finite.
- id bigint PK
- name text
- price numeric
- stock integer, `check (stock >= 0)` — **never written from the client**.
  A sale draws it down through the `consume_shelf_stock` trigger on
  `treatment_items`; voiding a treatment puts it back via
  `restore_shelf_stock` on `treatments`; supervisors adjust it through the
  `add_shelf_stock(item_id, amount)` RPC, which increments (so simultaneous
  restocks don't clobber each other) and refuses to go below zero
- is_active boolean (default: true)
- created_at timestamptz

RLS: any signed-in user can read; only `is_supervisor()` (which admits
admins) can insert or update. The two triggers and the RPC are SECURITY
DEFINER precisely because staff have no update rights here — selling has to
move stock, managing it must not be possible any other way.

### `treatments`
One row per vehicle visit. Core entity of the system.
- id bigint PK
- treatment_code text UNIQUE
- customer_name text, NOT NULL — required by the ticket form
- customer_phone text, NOT NULL — same; rows created before this rule were
  backfilled with generated placeholder names/numbers (migration 007), so
  older customer contacts are not real data
- plate_number text, nullable — null when no service on the ticket
  requires a vehicle
- treatment_type text, nullable — the vehicle's brand as typed by staff
  (e.g. "Honda Vario"); it used to hold "Mobil"/"Motor" derived from the
  service names, so older rows still read that way
- pic text
- status text (default: 'created')
- notes text
- subtotal numeric
- discount numeric
- total numeric
- wash_staff text, nullable — snapshot of a `profiles.full_name`, not a live
  FK; holds several names comma-separated when a wash is shared (see
  `src/lib/staffNames.js`)
- qc_staff text, nullable — same, for whoever did QC
- created_at timestamptz
- updated_at timestamptz

### `treatment_items`
Itemized lines per treatment — services and shelf items alike. Added via
migration 004.
- id bigint PK
- treatment_id bigint FK → treatments.id
- service_name text (snapshot — not a live FK to services.name)
- unit_price numeric (snapshot — not a live FK to services.price)
- quantity int
- subtotal numeric
- shelf_item_id bigint FK → shelf_items.id, nullable (migration 010) — null
  for a service line, set for a shelf item. This is the one live FK on the
  row, and it exists to know what stock to move, not for display: name and
  price stay snapshots either way
- normal_unit_price numeric, nullable (migration 020) — list price at the
  moment of sale, a snapshot like unit_price. A line was sold on promo when
  `unit_price < normal_unit_price`. Null on rows from before 020 means
  "unknown", not "no promo"
- created_at timestamptz

### `payments`
One row per payment, linked to a treatment.
- id bigint PK
- treatment_id bigint FK → treatments.id
- amount numeric
- payment_method text (cash | qris | transfer)
- proof_url text
- paid_at timestamptz

### `photos`
Vehicle/payment photos linked to a treatment. Not yet used in the UI.
- id bigint PK
- treatment_id bigint FK → treatments.id
- image_url text
- photo_type text
- uploaded_at timestamptz

### `treatment_logs`
Audit log for status changes. Write to this on every status change.
- id bigint PK
- treatment_id bigint FK → treatments.id
- action text
- created_at timestamptz

### `treatment_summary` (view)
Joins treatments + profiles + payments + treatment_items into one query.
Use this for the receipt screen and treatment history list.

---

## Auth — username + PIN

### Flow
1. Staff types their username and 6-digit PIN (`src/pages/Login.jsx`)
2. App builds the login email: `{username}@nineteendetails.internal`
3. App calls Supabase signInWithPassword with that email and the PIN as password
4. login() loads the profile and rejects it if `is_active` is false
5. On success → redirect to main screen

There is no name picker any more. Listing every active person before sign-in
advertised the roster to anyone who opened the page and made it easy to tap
the wrong name; the username is now something you have to know.

### Login email convention
`profiles.username` + `@nineteendetails.internal` — see `buildLoginEmail()`
in `src/api/auth.js`, mirrored in the create-worker Edge Function.

The username is a **stored, stable handle**, never derived from `full_name`.
Deriving it was a live bug: renaming someone in Kelola Staf changed the
derived address while their Auth email stayed put, silently locking them out.

This email is never shown in the UI anywhere.

### getCurrentProfile
Resolves the logged-in user's profile row:
```js
const { data } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', session.user.id)   // profiles.id IS the auth UUID
  .single()
```
Never use auth.uid() directly in frontend queries — always resolve to a profile first.

### Rules
- Never show email anywhere in the UI
- Never expose or log the PIN
- Never let staff change their own PIN from the app
- PINs are 6 digits only — validate before submitting (matches Supabase
  Auth's default 6-character minimum password length, since the PIN doubles
  as the account password)
- login() must check profiles.is_active after signInWithPassword succeeds,
  and sign the session back out if false — a deactivated worker's Auth
  account still has a valid password until someone changes it, so is_active
  is what actually blocks them, not account deletion

### Adding people — two separate steps, do not conflate them
Both live in **Kelola Staf** (`/staf`), admin-only.

**Adding someone to the roster** (no login): a plain insert into `profiles`
with `username` left null. They can be assigned wash/QC duty immediately and
cannot sign in.

**Giving someone a login**: tick "buat akun login" when adding, or press
**Buat Akun** on an existing roster row. Either way it goes through the
`create-worker` Edge Function (`supabase/functions/create-worker`, deployed),
which holds the service role key: it creates the Auth user with
`username@nineteendetails.internal` and the PIN as password, then writes the
`profiles` row. This cannot be done client-side — `supabase.auth.signUp()`
would replace the calling admin's own session with the new user's.

The function takes an optional `profileId`. Pass it to attach a login to
someone already on the roster: it moves that row's `id` onto the new auth
UUID and sets `username`, so the person keeps their row. If the profile write
fails, the just-created Auth user is deleted so no orphaned login is left
behind.

The admin types the PIN and hands it over in person — the app never
generates, displays, or stores one.

Manual route (Supabase dashboard) — still how the very first admin is
bootstrapped, since Kelola Staf requires an existing admin to access:
1. Authentication → Users → Add user
   Email: username@nineteendetails.internal
   Password: their 6-digit PIN
2. Copy the UUID Supabase assigns
3. Either update the person's existing profiles row (set `id` to that UUID
   and `username` to the local part), or insert a new row with id, full_name,
   username, role, is_active = true

### Resetting a forgotten PIN
Supabase dashboard → Authentication → Users → find
`username@nineteendetails.internal` → ⋮ → Reset password / Update user →
set a new 6-digit password. Nothing in `profiles` changes. There is no
in-app PIN change or reset flow, by design.

---

## Key rules

### Never revamp — always expand
The project has existing working files. Build on top of them.
Do not delete or rewrite existing files unless explicitly instructed.
If something needs changing, edit the specific part that needs changing.

### Money
- All prices are numeric in the database
- Never use float arithmetic for totals
- Always display in Indonesian Rupiah format: Rp 15.000
  (dot as thousands separator, no decimal for whole amounts)
- Use this helper consistently across all components:
  ```js
  export function formatRupiah(amount) {
    return `Rp ${Number(amount).toLocaleString('id-ID')}`
  }
  ```

### Treatments
- Creating a treatment goes through the `create_treatment()` RPC (migration
  018), which writes `treatments`, `treatment_items`, the optional `payments`
  row and the logs in one transaction. The client sends service/shelf item
  ids, quantities and the price mode — never prices or totals; the RPC looks
  them up and sets `pic` to the caller. Don't insert tickets directly
- treatment_items stores name and price as snapshots — not live FKs to services
- Never DELETE a treatment row — set status to 'voided' instead
- Write to treatment_logs on every status change
- plate_number must be .toUpperCase().trim() before saving, when there is one

### Payment methods
Three options only: cash, qris, transfer
Do not add others without confirming with the client.

### Status values for treatments
- created — just opened
- paid — payment recorded
- completed — work done, ready to close
- closed — treatment finished
- voided — cancelled, do not delete

---

## Screens to build

1. **Login** — typed username + 6-digit PIN, no roster listing, no email field
2. **Antrian Hari Ini** (dashboard home, `/`) — today's treatments still open
   (status `created`/`paid`/`completed`), read from `treatments`; a queue view,
   not a booking/scheduling system — no bay/tech/ETA concepts, those don't
   exist in the schema and aren't in scope
3. **Transaksi Baru** (`/transaksi-baru`) — service multi-picker plus a shelf
   item picker (in-stock items only, quantity capped at stock), plate number
   input, vehicle brand, discount input, notes, submit. Ticket lines are keyed
   `service-<id>` / `shelf-<id>`, since the two id spaces would otherwise
   collide
4. **Katalog** (`/katalog`) — two sections. **Layanan** is a read-only listing
   of `services` (still managed via the Supabase dashboard). **Barang** lists
   `shelf_items` with their stock; supervisors and admins additionally get
   "Tambah Barang" and a +/- stock adjuster there, gated by `isSupervisor()`
   client-side and by RLS server-side
5. **Struk** (`/struk/:id`) — digital receipt using treatment_summary view;
   shows shop name, date/time, plate, vehicle type, staff name, itemized
   services, subtotal, discount, total, payment method
6. **Riwayat Transaksi** (`/riwayat`) — today's treatments list, searchable by
   plate number
7. **Laporan** (`/laporan`) — read-only daily numbers computed from
   `treatments`/`payments` (revenue today, transaction count, avg ticket,
   7-day revenue, payment-method split). Display only — it doesn't process or
   move money, just reports what's already been collected.
8. **Detail Treatment** (`/treatment/:id`) — single treatment view with
   close/void actions
9. **Kelola Staf** (`/staf`, admin-only) — one roster of everyone in
   `profiles`: add (with or without a login), give an existing person a login
   via **Buat Akun**, edit name/phone/role, deactivate. Usernames are shown
   but never editable after creation — the handle is the local part of the
   Auth email, which only the Edge Function can change. Deactivate instead of
   delete. Admins and the viewer's own row are filtered out. Gated by
   `AdminRoute` client-side and by RLS server-side on `profiles` (both must
   agree — client-side gating alone is not enforcement)

The dashboard shell (sidebar with the 5 nav pages above + header) lives in
`src/components/AppShell.jsx`. Its 5-item nav is styled after
`POS Mockups Standalone.html`, adapted to this app's real screens, Indonesian
labels, and Rupiah — that mockup is a generic English/USD demo (card
payments, job-queue scheduling with bay/tech/ETA, in-app catalog editing) and
is a styling reference only, not a literal spec to replicate.

## Receipt
Digital on-screen display only — no print layout yet.
Printing format (thermal vs A4) is not decided and will be handled in a later phase.
Receipt must show: Nineteen Details, date/time, treatment code, plate number,
vehicle type, staff name (PIC), itemized services, subtotal, discount if any,
total, payment method.

---

## Do not build
- Admin panel for managing services (done via Supabase dashboard) — staff
  management is now in-app (Kelola Staf, admin-only), this line no longer
  covers staff
- Photo upload feature (table exists but UI deferred) — also now built (wash
  proof photos), this line is stale; kept here as a flag that this doc needs
  a fuller sync pass against the current status flow (created/paid/diproses/
  qc/selesai/closed/voided) and other features added outside this doc
- Multi-location support
- Customer loyalty or points system
- Payment processing of any kind — payment is collected physically
- Inventory management beyond `shelf_items` stock — no purchase orders,
  suppliers, cost price, or stock-movement history; the stock number is the
  whole model
- Print layout — digital display only for now

---

## Migrations applied
All SQL migrations have been run against the Supabase project in order:
- 001_initial_schema.sql — base tables
- 002_rls_policies.sql — row level security
- 003_auth_setup.sql — auth + staff link
- 004_add_treatment_items.sql — treatment_items table + view + columns
- 005_add_customer_phone.sql — customer_phone column on treatments
- 006_optional_vehicle_services — services.requires_vehicle column +
  treatments.plate_number made nullable
- 007_require_customer_contact — backfilled null customer_name/customer_phone
  with generated values, then made both columns NOT NULL
- 008_add_supervisor_role — migrated existing role='staff' rows to
  'supervisor', added the profiles_role_check constraint, added the
  is_supervisor() helper
- 009_merge_field_workers_into_profiles — dropped the profiles→auth.users FK,
  added profiles.username (backfilled from each account's auth email),
  copied field_workers in as role='staff' with no login, repointed
  active_staff_names at profiles and revoked anon's grant on it, dropped
  active_field_workers and field_workers
- 010_add_shelf_items — shelf_items table + RLS, treatment_items.shelf_item_id,
  the consume/restore stock triggers, and the add_shelf_stock() RPC
- 011_revise_service_menu — services.promo_price + sort_order, the 50-item
  per-size menu from the shop posters (Motor, Mobil, Helm), and the
  set_service_promo_price() RPC. The intended delete of the 5 old generic
  services (Cuci Motor, Cuci Mobil, Poles Body, Coating Kaca, Cuci Helm) was
  blocked from the tooling and has to be run by hand in the SQL Editor
- 013_require_verified_payment_to_close — `treatments_require_verified_payment`
  trigger (BEFORE INSERT OR UPDATE OF status): a treatment can only become
  'closed' when its latest payment exists and, for qris/transfer, has a
  `proof_url` (camera photo of the payment screen, uploaded via the
  `upload-wash-proof` Edge Function with `kind=payment`). Cash needs no
  photo. Mirrors `isPaymentVerified()` in `src/api/treatments.js`
- 014_require_active_user — RLS now requires an **active** profile, not
  just a session: new `is_active_user()` helper replaces every `true` policy
  on treatments/treatment_items/payments/treatment_logs/photos/services/
  shelf_items and the foto_kendaraan storage policies; `is_admin()` and
  `is_supervisor()` also require `is_active`. A deactivated user's still-valid
  JWT gets nothing on the next request. Exception: "users can read own
  profile" stays ungated so `login()` can see `is_active = false`.
  `active_staff_names` and `treatment_summary` (owner-privilege views, which
  bypass RLS) got a `WHERE is_active_user()` and are now SELECT-only —
  `active_staff_names` was auto-updatable, letting any signed-in user rename
  or delete any profile through it. Revoked all `anon` table grants and
  dropped the dashboard-template anon upload policies on foto_kendaraan.
  014b revoked anon EXECUTE on the helper/RPC functions. Rule going forward:
  every new policy, view, SECURITY DEFINER RPC and Edge Function must check
  `is_active_user()` / `is_active`, never just "authenticated"
- 015_logout_on_deactivate — `profiles_end_sessions_on_deactivate` trigger:
  when `is_active` goes true→false it deletes that user's `auth.sessions`
  (cascading to refresh tokens), so their next token refresh fails. Not a
  ban — the Auth user is untouched and reactivating needs nothing else.
  Client side, `AuthContext` re-reads the profile every 60s, on tab focus,
  and on session restore, and signs out with "Akun tidak aktif — hubungi
  admin" on Login when `is_active` is false
- 016_enable_realtime_queue — added `treatments`, `payments`, `photos` to the
  `supabase_realtime` publication so the Antrian queue updates live across
  signed-in users (`subscribeToQueueChanges()` in `src/api/treatments.js`).
  Realtime enforces each table's SELECT RLS (authenticated-only)
- 017_service_price_editing — `set_service_prices()` RPC (SECURITY DEFINER,
  `is_supervisor()`-gated, EXECUTE revoked from anon) so supervisors set a
  service's normal and promo price together in Katalog
- 018_create_treatment_rpc — `create_treatment()` RPC (SECURITY DEFINER,
  active-user gated, EXECUTE revoked from anon): whole ticket in one
  transaction with server-side pricing. SQL kept in `supabase/migrations/`.
- 018b_lock_direct_ticket_inserts — dropped the direct INSERT policies on
  `treatments`/`treatment_items`, so `create_treatment()` is the only way to
  create a ticket or its lines
- 019_protect_ticket_updates — `treatments_protect_direct_updates` trigger on
  direct client updates (`current_user = 'authenticated'` only): closed/voided
  tickets are frozen, status can't return to 'created', 'paid' needs a
  payment, 'voided' needs none, 'selesai' needs wash + QC staff. (Column
  grants already limited direct updates to status/wash_staff/qc_staff/
  updated_at.) Plus `record_payment(p_treatment_id, p_payment_method)` RPC:
  amount is always the ticket's stored total, one payment per ticket.
- 019b_lock_direct_payment_inserts — dropped the direct INSERT policy on
  `payments`, so `record_payment()` / `create_treatment()` are the only ways
  to create a payment
- 020_add_promo_flag — `treatment_items.normal_unit_price` plus
  `create_treatment()` filling it from `services.price` / `shelf_items.price`.
  Existing rows are left null (old list prices aren't recoverable)
- 021_add_attendance_meal_allowance — uang makan. `attendance` (one row per
  person per business day present; `meal_allowance` is a snapshot of the rate
  when marked, so a rate change never rewrites a past day) and
  `wage_settings` (key `meal_allowance`, default 10000). Supervisor-read-only
  tables; written only through `set_attendance(profile, date, present)` and
  `set_meal_allowance(amount)` (SECURITY DEFINER, `is_supervisor()`-gated,
  EXECUTE revoked from anon). Kelola Upah ticks Hadir per person per day and
  adds the allowance to that day's net wage (`getDailyWageSummary`)
- 022_add_kasbon_ledger — kasbon (advances on pay). `kasbon_entries` is an
  add-only ledger (`saldo_awal` once per person, `pinjam`, `bayar`,
  `koreksi`); the balance is never stored, it is the sum of the rows
  (`kasbonBalances()` in `src/api/kasbon.js`, `kasbon_balance()` in SQL).
  Supervisor-read-only; written through `add_kasbon_entry`,
  `set_kasbon_repayment` (one `bayar` per person per day, replaceable until
  day-close exists) and `set_kasbon_repay_percent`, all SECURITY DEFINER,
  `is_supervisor()`-gated, locking the person's profile row first. The
  suggested daily repayment is `wage_settings.kasbon_repay_percent` (40) of
  that day's service wages — a default, not a limit: going above it needs a
  reason, and only "never more than the balance" is hard-enforced. The
  **Keuangan** page (`/keuangan`, supervisor+) is the ledger; the repayment
  is set per person per day on Kelola Upah and is deducted from net wage.
  Known gap: a deactivated person's balance isn't listed (supervisors can
  only read active names)
- 023_add_setoran_harian — the end-of-day cash reconciliation, as the
  **Setoran Harian** tab of Keuangan. Income is never entered: it is read from
  `payments` (same numbers as Laporan). New tables `cash_days` (opening cash;
  at closing a snapshot of income, expected cash, counted cash, difference)
  and `cash_expenses` (wages paid — `category='gaji'`, one per person per day —
  plus `operasional`/`lain`), both supervisor-read-only. Channels are `cash`
  and `transfer`, where `transfer` is the whole non-cash side (QRIS + bank
  transfer, the sheet's "TF/QR"). `kasbon_entries.channel` says where an
  advance (`pinjam`, required) was paid from, so advances count as outflows
  from the ledger and are never entered twice. Writes: `set_opening_cash`,
  `add_cash_expense`, `pay_wage` (replaces that person's payout for the day),
  `delete_cash_expense`, `close_cash_day`, `reopen_cash_day` (admin only).
  `close_cash_day` works out expected cash itself (opening + cash payments −
  cash outflows) over the 04:00–04:00 shop-time window. **Closing a day locks
  it**: `set_attendance`, `add_kasbon_entry`, `set_kasbon_repayment`, the
  expense functions and a trigger on `wage_adjustments` all refuse that date
  ("Hari ini sudah ditutup"). A payment made after closing still shows in the
  live income, but the stored snapshot never moves. The wage amount recorded
  by `pay_wage` is sent by the client (the database can't see wages); the
  page flags a payout whose wage has since changed