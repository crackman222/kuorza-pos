-- 018b_lock_direct_ticket_inserts
--
-- Applied 2026-11-17, after the RPC frontend was deployed.
--
-- Until this runs, create_treatment() exists but nothing stops a signed-in
-- user from bypassing it with direct inserts (and their own prices). After
-- it, the only way to create a ticket or its lines is the RPC, which is
-- SECURITY DEFINER and so doesn't need these policies.
--
-- payments keeps its insert policy: recordPayment() still inserts directly
-- when settling a ticket that was queued unpaid.

drop policy if exists "treatments: active users can insert" on public.treatments;
drop policy if exists "treatment_items: active users can insert" on public.treatment_items;
