-- 019b_lock_direct_payment_inserts
--
-- Applied 2026-11-17, after the record_payment() frontend was deployed.
--
-- After this, record_payment() (SECURITY DEFINER) is the only way to create
-- a payment row, so the amount always comes from the ticket's stored total.
-- Proof photos are unaffected: upload-wash-proof writes proof_url with the
-- service role.

drop policy if exists "payments: active users can insert" on public.payments;
