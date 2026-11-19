-- 024_require_promo_proof
--
-- A ticket sold at promo price needs a photo showing the customer qualified
-- for the promo (e.g. the follow/share screen, a voucher, a member card).
-- Without it, "promo" is just a discount anyone can tick.
--
-- The photo is taken on Transaksi Baru when the promo box is ticked and goes
-- through the upload-wash-proof Edge Function with kind=promo. It is stored at
-- foto_kendaraan/<id>/bukti-promo and tracked by a photos row with
-- photo_type 'bukti_promo' -- same shape as the wash proof ('bukti_cuci').
--
-- A promo ticket is one with a service line sold below its list price:
-- shelf_item_id is null and unit_price < normal_unit_price (020). Lines from
-- before 020 have normal_unit_price null ("unknown") and never count.
--
-- Enforcement mirrors 013: the ticket can't become 'closed' without the
-- photo. Creating the ticket isn't blocked, because the photo can only be
-- uploaded once the ticket exists -- the client creates then uploads, and if
-- the upload fails the ticket waits in the queue for a retry. Mirrors
-- needsPromoProof() in src/api/treatments.js.
--
-- Only tickets created after this migration are held to it:
-- treatments.requires_promo_proof is added false for every existing row, then
-- its default flips to true, so new tickets get true without create_treatment()
-- changing. Clients can't write the column (column grants since 019 only allow
-- status/wash_staff/qc_staff/updated_at).

alter table public.treatments
  add column if not exists requires_promo_proof boolean not null default false;
alter table public.treatments
  alter column requires_promo_proof set default true;

create or replace function public.treatment_has_promo(p_treatment_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.treatment_items
     where treatment_id = p_treatment_id
       and shelf_item_id is null
       and normal_unit_price is not null
       and unit_price < normal_unit_price
  );
$function$;

revoke execute on function public.treatment_has_promo(bigint) from public, anon;

create or replace function public.require_promo_proof_to_close()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status is distinct from 'closed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' then
    return new;
  end if;

  if new.requires_promo_proof
     and public.treatment_has_promo(new.id)
     and not exists (
       select 1 from public.photos
        where treatment_id = new.id and photo_type = 'bukti_promo'
     ) then
    raise exception 'Bukti promo belum diunggah — transaksi belum bisa ditutup'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

revoke execute on function public.require_promo_proof_to_close() from public, anon;

drop trigger if exists treatments_require_promo_proof on public.treatments;
create trigger treatments_require_promo_proof
  before insert or update of status on public.treatments
  for each row execute function public.require_promo_proof_to_close();
