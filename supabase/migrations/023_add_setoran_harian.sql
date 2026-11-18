-- 023_add_setoran_harian
--
-- Setoran Harian: the end-of-day cash reconciliation (the "Total Setoran"
-- block on the paper sheet). Income is NOT entered here -- it is read from
-- payments, the same source as Laporan. What this adds is the money going
-- out and the count of what is left:
--
--   cash_days      one row per business day: opening cash, and once the day is
--                  closed, a snapshot (income, expected cash, counted cash,
--                  the difference) plus who closed it and when.
--   cash_expenses  money paid out of the till or the transfer/QR account:
--                  wages paid ('gaji', one per person per day) and other
--                  expenses ('operasional', 'lain').
--   kasbon_entries.channel  where a kasbon advance ('pinjam') was paid from.
--                  Advances are already in the kasbon ledger, so they count as
--                  outflows from there instead of being entered twice.
--
-- channel is 'cash' or 'transfer' -- 'transfer' stands for the whole
-- non-cash side (QRIS and bank transfer land in the same account, which is
-- how the sheet's "TF/QR" column treats them).
--
-- A business day runs 04:00 to 04:00 shop time (src/lib/dateRange.js);
-- is_cash_day_closed() and close_cash_day() use the same window.
--
-- Closing a day freezes it: attendance, kasbon entries and repayment, wage
-- adjustments, expenses and the opening cash for that date all refuse changes
-- afterwards. Only an admin can reopen it. Late payments still show in the
-- live income, but the snapshot taken at closing never moves.
--
-- Same access model as 021/022: supervisor-read-only tables, writes only
-- through SECURITY DEFINER functions.

-- ---------------------------------------------------------------- tables

create table public.cash_days (
  business_date date primary key,
  opening_cash  numeric not null default 0 check (opening_cash >= 0 and opening_cash = round(opening_cash)),
  closed_at     timestamptz,
  closed_by     uuid,
  cash_income   numeric,
  noncash_income numeric,
  expected_cash numeric,
  counted_cash  numeric check (counted_cash is null or counted_cash >= 0),
  difference    numeric,
  updated_at    timestamptz not null default now()
);

create table public.cash_expenses (
  id            bigint generated always as identity primary key,
  business_date date not null,
  channel       text not null check (channel in ('cash', 'transfer')),
  category      text not null check (category in ('gaji', 'operasional', 'lain')),
  profile_id    uuid references public.profiles (id) on update cascade,
  amount        numeric not null check (amount > 0 and amount = round(amount)),
  note          text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  -- A wage payout belongs to a person; anything else does not.
  check ((category = 'gaji') = (profile_id is not null))
);

create index cash_expenses_date_idx on public.cash_expenses (business_date);
create unique index cash_one_wage_payout_per_day
  on public.cash_expenses (business_date, profile_id) where category = 'gaji';

alter table public.kasbon_entries
  add column channel text check (channel in ('cash', 'transfer'));
-- Only an advance has a source of funds.
alter table public.kasbon_entries
  add constraint kasbon_channel_only_for_loans check ((type = 'pinjam') = (channel is not null));

alter table public.cash_days     enable row level security;
alter table public.cash_expenses enable row level security;

create policy "supervisors can read cash days"
  on public.cash_days for select using (public.is_supervisor());
create policy "supervisors can read cash expenses"
  on public.cash_expenses for select using (public.is_supervisor());

revoke all on public.cash_days     from anon, authenticated;
revoke all on public.cash_expenses from anon, authenticated;
grant select on public.cash_days     to authenticated;
grant select on public.cash_expenses to authenticated;

-- ---------------------------------------------------------------- helpers

-- Whether a business day has been closed. Only called from the SECURITY
-- DEFINER functions below, so nobody else gets EXECUTE.
create or replace function public.is_cash_day_closed(p_date date)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.cash_days
     where business_date = p_date and closed_at is not null
  );
$function$;

revoke all on function public.is_cash_day_closed(date) from public, anon, authenticated;

-- Wage adjustments are written straight to the table (see 'supervisors can
-- insert/delete wage adjustments'), so a trigger is what freezes them.
create or replace function public.wage_adjustments_block_closed_day()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.is_cash_day_closed(coalesce(new.adjustment_date, old.adjustment_date)) then
    raise exception 'Hari ini sudah ditutup';
  end if;
  return coalesce(new, old);
end;
$function$;

create trigger wage_adjustments_block_closed_day
  before insert or update or delete on public.wage_adjustments
  for each row execute function public.wage_adjustments_block_closed_day();

revoke all on function public.wage_adjustments_block_closed_day() from public, anon, authenticated;

-- ------------------------------------------------- existing writers, locked
-- Same bodies as 021/022, plus the closed-day check (and, for kasbon
-- advances, the channel they were paid from).

create or replace function public.set_attendance(
  p_profile_id uuid,
  p_date       date,
  p_present    boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today     date := ((now() at time zone 'Asia/Jakarta') - interval '4 hours')::date;
  v_allowance numeric;
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mencatat kehadiran';
  end if;
  if p_profile_id is null or p_date is null or p_present is null then
    raise exception 'Data kehadiran tidak lengkap';
  end if;
  if p_date > v_today then
    raise exception 'Tanggal tidak boleh di masa depan';
  end if;
  if public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;

  if p_present then
    if not exists (
      select 1 from public.profiles where id = p_profile_id and is_active
    ) then
      raise exception 'Staf tidak ditemukan atau tidak aktif';
    end if;

    select value into v_allowance from public.wage_settings where key = 'meal_allowance';

    insert into public.attendance (profile_id, attendance_date, meal_allowance)
    values (p_profile_id, p_date, coalesce(v_allowance, 0))
    on conflict (profile_id, attendance_date) do nothing;
  else
    delete from public.attendance
     where profile_id = p_profile_id and attendance_date = p_date;
  end if;
end;
$function$;

create or replace function public.set_kasbon_repayment(
  p_profile_id uuid,
  p_date       date,
  p_amount     numeric,
  p_override   boolean default false,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today    date := ((now() at time zone 'Asia/Jakarta') - interval '4 hours')::date;
  v_existing numeric;
  v_available numeric;
  v_reason   text := nullif(btrim(p_reason), '');
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mencatat cicilan kasbon';
  end if;
  if p_profile_id is null or p_date is null or p_amount is null then
    raise exception 'Data cicilan tidak lengkap';
  end if;
  if p_amount < 0 or p_amount <> round(p_amount) then
    raise exception 'Cicilan harus bilangan Rupiah, minimal nol';
  end if;
  if p_date > v_today then
    raise exception 'Tanggal tidak boleh di masa depan';
  end if;
  if public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;

  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Staf tidak ditemukan';
  end if;

  select amount into v_existing
    from public.kasbon_entries
   where profile_id = p_profile_id and entry_date = p_date and type = 'bayar';

  v_available := public.kasbon_balance(p_profile_id) + coalesce(v_existing, 0);
  if p_amount > v_available then
    raise exception 'Cicilan melebihi sisa kasbon';
  end if;
  if p_amount > 0 and coalesce(p_override, false) and v_reason is null then
    raise exception 'Alasan wajib diisi jika cicilan melebihi saran';
  end if;

  delete from public.kasbon_entries
   where profile_id = p_profile_id and entry_date = p_date and type = 'bayar';

  if p_amount > 0 then
    insert into public.kasbon_entries (profile_id, entry_date, type, amount, note)
    values (
      p_profile_id, p_date, 'bayar', p_amount,
      case when coalesce(p_override, false) then 'Melebihi saran: ' || v_reason end
    );
  end if;
end;
$function$;

-- New signature (adds p_channel), so the old five-argument version goes.
drop function public.add_kasbon_entry(uuid, date, text, numeric, text);

create or replace function public.add_kasbon_entry(
  p_profile_id uuid,
  p_date       date,
  p_type       text,
  p_amount     numeric,
  p_note       text default null,
  p_channel    text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today   date := ((now() at time zone 'Asia/Jakarta') - interval '4 hours')::date;
  v_balance numeric;
  v_note    text := nullif(btrim(p_note), '');
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mencatat kasbon';
  end if;
  if p_profile_id is null or p_date is null or p_type is null then
    raise exception 'Data kasbon tidak lengkap';
  end if;
  if p_type not in ('saldo_awal', 'pinjam', 'koreksi') then
    raise exception 'Jenis kasbon tidak valid';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) then
    raise exception 'Jumlah harus bilangan Rupiah lebih dari nol';
  end if;
  if p_date > v_today then
    raise exception 'Tanggal tidak boleh di masa depan';
  end if;
  if public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;
  -- An advance is money leaving the till or the account, so say which.
  if p_type = 'pinjam' and (p_channel is null or p_channel not in ('cash', 'transfer')) then
    raise exception 'Pilih sumber dana: tunai atau transfer';
  end if;
  if p_type <> 'pinjam' and p_channel is not null then
    raise exception 'Sumber dana hanya untuk pinjaman baru';
  end if;

  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Staf tidak ditemukan';
  end if;

  v_balance := public.kasbon_balance(p_profile_id);

  if p_type = 'pinjam' and not exists (
    select 1 from public.profiles where id = p_profile_id and is_active
  ) then
    raise exception 'Staf tidak aktif';
  end if;

  if p_type = 'saldo_awal' and exists (
    select 1 from public.kasbon_entries where profile_id = p_profile_id
  ) then
    raise exception 'Saldo awal hanya bisa dicatat sekali, sebelum catatan lain';
  end if;

  if p_type = 'koreksi' then
    if v_note is null then
      raise exception 'Alasan koreksi wajib diisi';
    end if;
    if p_amount > v_balance then
      raise exception 'Koreksi melebihi sisa kasbon';
    end if;
  end if;

  insert into public.kasbon_entries (profile_id, entry_date, type, amount, note, channel)
  values (p_profile_id, p_date, p_type, p_amount, v_note, p_channel);
end;
$function$;

-- ---------------------------------------------------------- new functions

create or replace function public.set_opening_cash(p_date date, p_amount numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := ((now() at time zone 'Asia/Jakarta') - interval '4 hours')::date;
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mengubah modal awal kas';
  end if;
  if p_date is null or p_amount is null or p_amount < 0 or p_amount <> round(p_amount) then
    raise exception 'Modal awal harus bilangan Rupiah, minimal nol';
  end if;
  if p_date > v_today then
    raise exception 'Tanggal tidak boleh di masa depan';
  end if;
  if public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;

  insert into public.cash_days (business_date, opening_cash)
  values (p_date, p_amount)
  on conflict (business_date)
  do update set opening_cash = excluded.opening_cash, updated_at = now();
end;
$function$;

-- Other expenses (not wages -- those go through pay_wage).
create or replace function public.add_cash_expense(
  p_date     date,
  p_channel  text,
  p_category text,
  p_amount   numeric,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := ((now() at time zone 'Asia/Jakarta') - interval '4 hours')::date;
  v_note  text := nullif(btrim(p_note), '');
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mencatat pengeluaran';
  end if;
  if p_date is null or p_channel not in ('cash', 'transfer') then
    raise exception 'Sumber dana tidak valid';
  end if;
  if p_category is null or p_category not in ('operasional', 'lain') then
    raise exception 'Kategori pengeluaran tidak valid';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) then
    raise exception 'Jumlah harus bilangan Rupiah lebih dari nol';
  end if;
  if p_date > v_today then
    raise exception 'Tanggal tidak boleh di masa depan';
  end if;
  if public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;
  if v_note is null then
    raise exception 'Keterangan pengeluaran wajib diisi';
  end if;

  insert into public.cash_expenses (business_date, channel, category, amount, note)
  values (p_date, p_channel, p_category, p_amount, v_note);
end;
$function$;

-- Records the wage actually paid to one person for a day, replacing an
-- earlier payout for that person and day. The amount is the net wage shown on
-- Kelola Upah at that moment (the database does not see wages).
create or replace function public.pay_wage(
  p_profile_id uuid,
  p_date       date,
  p_amount     numeric,
  p_channel    text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := ((now() at time zone 'Asia/Jakarta') - interval '4 hours')::date;
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mencatat pembayaran upah';
  end if;
  if p_profile_id is null or p_date is null or p_channel not in ('cash', 'transfer') then
    raise exception 'Data pembayaran upah tidak lengkap';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount) then
    raise exception 'Jumlah harus bilangan Rupiah lebih dari nol';
  end if;
  if p_date > v_today then
    raise exception 'Tanggal tidak boleh di masa depan';
  end if;
  if public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;

  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Staf tidak ditemukan';
  end if;

  delete from public.cash_expenses
   where business_date = p_date and category = 'gaji' and profile_id = p_profile_id;

  insert into public.cash_expenses (business_date, channel, category, profile_id, amount)
  values (p_date, p_channel, 'gaji', p_profile_id, p_amount);
end;
$function$;

create or replace function public.delete_cash_expense(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_date date;
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa menghapus pengeluaran';
  end if;

  select business_date into v_date from public.cash_expenses where id = p_id;
  if not found then
    raise exception 'Pengeluaran tidak ditemukan';
  end if;
  if public.is_cash_day_closed(v_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;

  delete from public.cash_expenses where id = p_id;
end;
$function$;

-- Closes the day: works out expected cash from the database itself (opening
-- cash + cash payments - cash wages/expenses - cash kasbon advances), stores
-- it next to the counted amount and the difference, and locks the date.
create or replace function public.close_cash_day(p_date date, p_counted_cash numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today      date := ((now() at time zone 'Asia/Jakarta') - interval '4 hours')::date;
  v_start      timestamptz := (p_date::timestamp + interval '4 hours') at time zone 'Asia/Jakarta';
  v_end        timestamptz := ((p_date::timestamp + interval '4 hours') at time zone 'Asia/Jakarta') + interval '1 day';
  v_opening    numeric;
  v_cash_in    numeric;
  v_noncash_in numeric;
  v_cash_out   numeric;
  v_expected   numeric;
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa menutup hari';
  end if;
  if p_date is null or p_counted_cash is null or p_counted_cash < 0 or p_counted_cash <> round(p_counted_cash) then
    raise exception 'Uang tunai terhitung harus bilangan Rupiah, minimal nol';
  end if;
  if p_date > v_today then
    raise exception 'Tanggal tidak boleh di masa depan';
  end if;
  if public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini sudah ditutup';
  end if;

  select coalesce(opening_cash, 0) into v_opening
    from public.cash_days where business_date = p_date;
  v_opening := coalesce(v_opening, 0);

  select coalesce(sum(amount) filter (where payment_method = 'cash'), 0),
         coalesce(sum(amount) filter (where payment_method in ('qris', 'transfer')), 0)
    into v_cash_in, v_noncash_in
    from public.payments
   where paid_at >= v_start and paid_at < v_end;

  select
    coalesce((select sum(amount) from public.cash_expenses
               where business_date = p_date and channel = 'cash'), 0)
    + coalesce((select sum(amount) from public.kasbon_entries
                 where entry_date = p_date and type = 'pinjam' and channel = 'cash'), 0)
    into v_cash_out;

  v_expected := v_opening + v_cash_in - v_cash_out;

  insert into public.cash_days (
    business_date, opening_cash, closed_at, closed_by,
    cash_income, noncash_income, expected_cash, counted_cash, difference
  ) values (
    p_date, v_opening, now(), auth.uid(),
    v_cash_in, v_noncash_in, v_expected, p_counted_cash, p_counted_cash - v_expected
  )
  on conflict (business_date) do update set
    closed_at = excluded.closed_at, closed_by = excluded.closed_by,
    cash_income = excluded.cash_income, noncash_income = excluded.noncash_income,
    expected_cash = excluded.expected_cash, counted_cash = excluded.counted_cash,
    difference = excluded.difference, updated_at = now();
end;
$function$;

-- Admin only: a closed day can be reopened to fix a mistake. The snapshot is
-- cleared and rebuilt when the day is closed again.
create or replace function public.reopen_cash_day(p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Hanya admin yang bisa membuka kembali hari yang sudah ditutup';
  end if;
  if not public.is_cash_day_closed(p_date) then
    raise exception 'Hari ini belum ditutup';
  end if;

  update public.cash_days
     set closed_at = null, closed_by = null, cash_income = null, noncash_income = null,
         expected_cash = null, counted_cash = null, difference = null, updated_at = now()
   where business_date = p_date;
end;
$function$;

revoke all on function public.set_attendance(uuid, date, boolean) from public, anon;
grant execute on function public.set_attendance(uuid, date, boolean) to authenticated;
revoke all on function public.set_kasbon_repayment(uuid, date, numeric, boolean, text) from public, anon;
grant execute on function public.set_kasbon_repayment(uuid, date, numeric, boolean, text) to authenticated;
revoke all on function public.add_kasbon_entry(uuid, date, text, numeric, text, text) from public, anon;
grant execute on function public.add_kasbon_entry(uuid, date, text, numeric, text, text) to authenticated;
revoke all on function public.set_opening_cash(date, numeric) from public, anon;
grant execute on function public.set_opening_cash(date, numeric) to authenticated;
revoke all on function public.add_cash_expense(date, text, text, numeric, text) from public, anon;
grant execute on function public.add_cash_expense(date, text, text, numeric, text) to authenticated;
revoke all on function public.pay_wage(uuid, date, numeric, text) from public, anon;
grant execute on function public.pay_wage(uuid, date, numeric, text) to authenticated;
revoke all on function public.delete_cash_expense(bigint) from public, anon;
grant execute on function public.delete_cash_expense(bigint) to authenticated;
revoke all on function public.close_cash_day(date, numeric) from public, anon;
grant execute on function public.close_cash_day(date, numeric) to authenticated;
revoke all on function public.reopen_cash_day(date) from public, anon;
grant execute on function public.reopen_cash_day(date) to authenticated;
