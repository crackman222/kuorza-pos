-- 021_add_attendance_meal_allowance
--
-- Uang makan: a flat daily meal allowance paid to everyone who worked that
-- day (the "Uang Makan" column on the paper wage sheet, Rp 10.000 each).
-- Needs two things the app never had: a record of who was present, and the
-- current allowance rate.
--
-- attendance: one row per person per business day they were present. Absent =
-- no row. meal_allowance is a snapshot of the rate at the moment the row was
-- written, so changing the rate later never rewrites a past day's pay. The
-- day's pay (src/api/wages.js) adds it on top of service wages.
--
-- wage_settings: tiny key/value table; for now only 'meal_allowance'.
--
-- Both are readable by supervisors (is_supervisor() also requires an active
-- profile since 014) and written ONLY through the two SECURITY DEFINER
-- functions below -- no client INSERT/UPDATE/DELETE policy exists, same idea
-- as 018b/019b for tickets and payments.
--
-- attendance.profile_id references profiles(id) ON UPDATE CASCADE: giving a
-- login-less person an account (create-worker) moves their profiles.id onto
-- the new auth UUID, and their attendance must follow. (wage_adjustments has
-- no cascade, so that move currently fails for anyone who has adjustments.)

create table public.wage_settings (
  key        text primary key check (key in ('meal_allowance')),
  value      numeric not null check (value >= 0),
  updated_at timestamptz not null default now()
);

insert into public.wage_settings (key, value) values ('meal_allowance', 10000);

create table public.attendance (
  id              bigint generated always as identity primary key,
  profile_id      uuid not null references public.profiles (id) on update cascade,
  attendance_date date not null,
  meal_allowance  numeric not null check (meal_allowance >= 0),
  recorded_by     uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (profile_id, attendance_date)
);

alter table public.wage_settings enable row level security;
alter table public.attendance    enable row level security;

create policy "supervisors can read wage settings"
  on public.wage_settings for select using (public.is_supervisor());
create policy "supervisors can read attendance"
  on public.attendance for select using (public.is_supervisor());

-- Read-only from the client; the functions below do the writing.
revoke all on public.wage_settings from anon, authenticated;
revoke all on public.attendance    from anon, authenticated;
grant select on public.wage_settings to authenticated;
grant select on public.attendance    to authenticated;

-- Sets the allowance for days marked from now on. Rows already written keep
-- the amount they were marked with.
create or replace function public.set_meal_allowance(p_amount numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_supervisor() then
    raise exception 'Hanya supervisor yang bisa mengubah uang makan';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Uang makan tidak valid';
  end if;

  update public.wage_settings
     set value = round(p_amount), updated_at = now()
   where key = 'meal_allowance';
end;
$function$;

-- Marks someone present (or not) for a business day. Present writes the row
-- with the current allowance, doing nothing if it is already there (so
-- re-ticking never changes an amount); not present removes it. Today's
-- business day starts at 04:00 shop time, matching src/lib/dateRange.js.
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

revoke all on function public.set_meal_allowance(numeric) from public, anon;
grant execute on function public.set_meal_allowance(numeric) to authenticated;
revoke all on function public.set_attendance(uuid, date, boolean) from public, anon;
grant execute on function public.set_attendance(uuid, date, boolean) to authenticated;
