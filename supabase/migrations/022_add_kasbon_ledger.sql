-- 022_add_kasbon_ledger
--
-- Kasbon: an advance on pay that a worker repays out of later wages (the
-- "Kasbon" / "Sisa Kasbon" columns on the paper wage sheet).
--
-- The balance is never stored. Every movement is a row in kasbon_entries and
-- the balance is the sum of them, so it can't drift out of step:
--   saldo_awal  opening balance carried over from the paper book (once per person)
--   pinjam      a new advance                       -> balance goes up
--   bayar       the day's repayment out of wages    -> balance goes down
--   koreksi     reverses a mistaken entry           -> balance goes down
-- Loans, opening balances and corrections are add-only: there is no update or
-- delete. A mistake is fixed with a koreksi, not by editing history.
--
-- The one exception is the day's repayment ('bayar'). It is a decision made
-- while looking at that day's pay, so it can be changed until the day is
-- closed (day closing comes with Setoran Harian). One per person per day.
--
-- Repayment policy: the pay screen suggests kasbon_repay_percent (default
-- 40) of that day's service wages and lets a supervisor go above it with a
-- reason. That cap is a default, not a hard limit, and the server does not
-- see wages, so it only checks what it can: the repayment never exceeds the
-- balance, and an override needs a reason.
--
-- Read by supervisors only; written only through the functions below (no
-- client INSERT/UPDATE/DELETE policy), same as 021. Every function takes a
-- row lock on the person first, so two supervisors acting at once can't both
-- spend the same balance.

alter table public.wage_settings drop constraint wage_settings_key_check;
alter table public.wage_settings
  add constraint wage_settings_key_check
  check (key in ('meal_allowance', 'kasbon_repay_percent'));

insert into public.wage_settings (key, value) values ('kasbon_repay_percent', 40);

create table public.kasbon_entries (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on update cascade,
  entry_date  date not null,
  type        text not null check (type in ('saldo_awal', 'pinjam', 'bayar', 'koreksi')),
  amount      numeric not null check (amount > 0 and amount = round(amount)),
  note        text,
  recorded_by uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index kasbon_entries_profile_idx on public.kasbon_entries (profile_id, entry_date);
create unique index kasbon_one_repayment_per_day
  on public.kasbon_entries (profile_id, entry_date) where type = 'bayar';

alter table public.kasbon_entries enable row level security;

create policy "supervisors can read kasbon entries"
  on public.kasbon_entries for select using (public.is_supervisor());

revoke all on public.kasbon_entries from anon, authenticated;
grant select on public.kasbon_entries to authenticated;

-- What someone currently owes. SECURITY INVOKER, so a direct call only sees
-- what the caller's RLS lets them (supervisors); inside the functions below
-- it runs as their owner.
create or replace function public.kasbon_balance(p_profile_id uuid)
returns numeric
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select coalesce(sum(case when type in ('saldo_awal', 'pinjam') then amount else -amount end), 0)
    from public.kasbon_entries
   where profile_id = p_profile_id;
$function$;

-- Records saldo_awal, pinjam or koreksi. Dates can't be in the future (the
-- business day turns over at 04:00 shop time, as in src/lib/dateRange.js).
create or replace function public.add_kasbon_entry(
  p_profile_id uuid,
  p_date       date,
  p_type       text,
  p_amount     numeric,
  p_note       text default null
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

  insert into public.kasbon_entries (profile_id, entry_date, type, amount, note)
  values (p_profile_id, p_date, p_type, p_amount, v_note);
end;
$function$;

-- Sets the day's repayment out of wages, replacing any earlier one for that
-- person and day; 0 clears it. p_override says the supervisor went above the
-- suggested share and must give a reason.
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

  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Staf tidak ditemukan';
  end if;

  select amount into v_existing
    from public.kasbon_entries
   where profile_id = p_profile_id and entry_date = p_date and type = 'bayar';

  -- What could be repaid if this day's repayment were not already counted.
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

-- The suggested share of a day's service wages that goes to repayment.
create or replace function public.set_kasbon_repay_percent(p_percent numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mengubah persentase cicilan';
  end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'Persentase harus antara 0 dan 100';
  end if;

  update public.wage_settings
     set value = round(p_percent), updated_at = now()
   where key = 'kasbon_repay_percent';
end;
$function$;

revoke all on function public.kasbon_balance(uuid) from public, anon;
grant execute on function public.kasbon_balance(uuid) to authenticated;
revoke all on function public.add_kasbon_entry(uuid, date, text, numeric, text) from public, anon;
grant execute on function public.add_kasbon_entry(uuid, date, text, numeric, text) to authenticated;
revoke all on function public.set_kasbon_repayment(uuid, date, numeric, boolean, text) from public, anon;
grant execute on function public.set_kasbon_repayment(uuid, date, numeric, boolean, text) to authenticated;
revoke all on function public.set_kasbon_repay_percent(numeric) from public, anon;
grant execute on function public.set_kasbon_repay_percent(numeric) to authenticated;
