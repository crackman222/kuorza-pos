-- What a fresh project needs beyond the `public` schema dump
-- (000_baseline_schema.sql), taken from the current project on 2026-11-18.
-- Run it after the baseline: the policies call public.is_active_user().

-- Storage: wash-proof and payment-proof photos. Private bucket; reads go
-- through signed URLs (src/api/photos.js), uploads through the
-- upload-wash-proof Edge Function. The old project also has empty
-- `bukti_pembayaran` and `receipts` buckets that nothing uses, so they're
-- left out.
insert into storage.buckets (id, name, public)
values ('foto_kendaraan', 'foto_kendaraan', false)
on conflict (id) do nothing;

create policy "active users can read wash proof photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'foto_kendaraan' and (select public.is_active_user()));

create policy "active users can upload wash proof photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'foto_kendaraan' and (select public.is_active_user()));

create policy "active users can replace wash proof photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'foto_kendaraan' and (select public.is_active_user()))
  with check (bucket_id = 'foto_kendaraan' and (select public.is_active_user()));

-- Realtime: live Antrian queue (migration 016).
alter publication supabase_realtime
  add table public.treatments, public.payments, public.photos;
