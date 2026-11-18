-- 019_protect_ticket_updates
--
-- 1. treatments_protect_direct_updates trigger
--    The "active users can update status fields" policy on treatments never
--    actually limited columns — any active user could rewrite total, pic,
--    customer, plate, etc. from devtools. This trigger enforces what the app
--    really does with a direct update: move status forward and (re)assign
--    wash/QC staff. It only applies to direct client updates
--    (current_user = 'authenticated'); SECURITY DEFINER functions, Edge
--    Functions (service_role) and the SQL Editor are not restricted by it.
--
--    Rules for a direct update:
--    - only status, wash_staff, qc_staff, updated_at may change
--    - closed and voided tickets can't be changed at all (wages are computed
--      from wash_staff, and un-voiding would re-sell stock the void already
--      restored)
--    - status can't go back to 'created'
--    - 'paid' needs a payment row; 'voided' needs no payment row (mirrors
--      voidTreatment()); 'selesai' needs wash + QC staff (mirrors
--      markSelesai()). 'closed' is already guarded by migration 013.
--
-- 2. record_payment(p_treatment_id, p_payment_method) RPC
--    Replaces the client inserting into payments with its own amount. The
--    amount is always the ticket's stored total; one payment per ticket (the
--    screens only offer "record payment" on an unpaid ticket). Moves
--    'created' -> 'paid', otherwise logs 'payment recorded' — same as the old
--    recordPayment().

create or replace function public.protect_treatment_direct_updates()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if old.status in ('closed', 'voided') then
    raise exception 'Transaksi yang sudah ditutup atau dibatalkan tidak bisa diubah'
      using errcode = 'check_violation';
  end if;

  if (to_jsonb(new) - array['status', 'wash_staff', 'qc_staff', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'wash_staff', 'qc_staff', 'updated_at']) then
    raise exception 'Hanya status dan petugas yang bisa diubah'
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if new.status not in ('paid', 'diproses', 'qc', 'selesai', 'closed', 'voided') then
      raise exception 'Status tidak valid' using errcode = 'check_violation';
    end if;

    if new.status = 'paid'
       and not exists (select 1 from payments where treatment_id = new.id) then
      raise exception 'Pembayaran belum dicatat' using errcode = 'check_violation';
    end if;

    if new.status = 'voided'
       and exists (select 1 from payments where treatment_id = new.id) then
      raise exception 'Transaksi yang sudah dibayar tidak bisa dibatalkan'
        using errcode = 'check_violation';
    end if;

    if new.status = 'selesai'
       and (nullif(btrim(new.wash_staff), '') is null or nullif(btrim(new.qc_staff), '') is null) then
      raise exception 'Petugas cuci dan petugas QC wajib diisi sebelum transaksi diselesaikan'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists treatments_protect_direct_updates on public.treatments;
create trigger treatments_protect_direct_updates
  before update on public.treatments
  for each row execute function public.protect_treatment_direct_updates();


create or replace function public.record_payment(
  p_treatment_id   bigint,
  p_payment_method text
)
returns public.payments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_treatment public.treatments;
  v_payment   public.payments;
begin
  if not public.is_active_user() then
    raise exception 'Akun tidak aktif — hubungi admin';
  end if;

  if p_payment_method is null or p_payment_method not in ('cash', 'qris', 'transfer') then
    raise exception 'Metode pembayaran tidak valid';
  end if;

  -- Lock the ticket so two devices can't both record a payment.
  select * into v_treatment
    from public.treatments
   where id = p_treatment_id
     for update;
  if not found then
    raise exception 'Transaksi tidak ditemukan';
  end if;

  if v_treatment.status in ('closed', 'voided') then
    raise exception 'Transaksi yang sudah ditutup atau dibatalkan tidak bisa diubah';
  end if;

  if exists (select 1 from public.payments where treatment_id = p_treatment_id) then
    raise exception 'Pembayaran sudah dicatat';
  end if;

  insert into public.payments (treatment_id, amount, payment_method)
  values (p_treatment_id, coalesce(v_treatment.total, 0), p_payment_method)
  returning * into v_payment;

  if v_treatment.status = 'created' then
    update public.treatments
       set status = 'paid', updated_at = now()
     where id = p_treatment_id;
    insert into public.treatment_logs (treatment_id, action)
    values (p_treatment_id, 'status changed to paid');
  else
    insert into public.treatment_logs (treatment_id, action)
    values (p_treatment_id, 'payment recorded');
  end if;

  return v_payment;
end;
$function$;

revoke all on function public.record_payment(bigint, text) from public, anon;
grant execute on function public.record_payment(bigint, text) to authenticated;
