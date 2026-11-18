# Setting up the separate production project

From here on there are two Supabase projects:

| | Supabase project | Git branch | Vercel environment |
|---|---|---|---|
| **dev** | the current project (ref `gxcaeyohtiymyljodnjw`) | `dev` | Preview + local `.env` |
| **prod** | a **new** project | `main` | Production |

The current project keeps all its existing data and becomes the place to
test. The new project starts with the same schema, the same menu, and its own
people and logins.

---

## 0. Before you start
- [ ] Start Docker Desktop. The scripts use `pg_dump`/`psql` 17 from the
      `postgres:17-alpine` image, because the server runs Postgres 17 and the
      locally installed `pg_dump` is 16.
- [ ] Create `.env.dump.local` in the repo root. It's gitignored through
      `.env.*.local`; never commit it:
      ```
      SOURCE_DB_URL=<current project, Session pooler string>
      TARGET_DB_URL=<new prod project, Session pooler string>
      ```
      Get each string from Dashboard → **Connect** → **Session pooler**, with
      the database password filled in. The direct `db.<ref>.supabase.co` host
      is IPv6-only, which Docker on Windows usually can't reach.

## 1. Dump the schema from the current project
- [ ] `bash scripts/dump-schema.sh`
      - writes `supabase/migrations/000_baseline_schema.sql` (all of
        `public`: tables, views, functions, triggers, RLS, grants)
      - writes `supabase/seed/config_data.sql` (services, shelf items, wage
        settings, service wage rates)
- [ ] Skim both files. The seed must not contain transactions or people, only
      the four tables above.
- [ ] Commit them on `dev`, together with `supabase/baseline/extras.sql`.

## 2. Create the prod project
- [ ] New project in the Supabase dashboard, **same region** as the current one
      (lowest latency for the shop; check Settings → General on the current project).
- [ ] Save the database password in a password manager. You need it for
      `TARGET_DB_URL`, and Supabase won't show it again.
- [ ] Fill in `TARGET_DB_URL` in `.env.dump.local`.

## 3. Build the prod database
Run these in this order. Each one runs in a single transaction, so a failure
leaves the database unchanged. Fix the cause and rerun the same file.
- [ ] `bash scripts/apply-sql.sh supabase/migrations/000_baseline_schema.sql`
- [ ] `bash scripts/apply-sql.sh supabase/baseline/extras.sql`
- [ ] `bash scripts/apply-sql.sh supabase/seed/config_data.sql`
- [ ] Check in the new project's dashboard:
      - Database → Tables: `treatments`, `profiles`, `cash_days`,
        `kasbon_entries`, etc. are present and empty
      - `services` has the full menu
      - Storage: there's a private `foto_kendaraan` bucket with 3 policies
      - Database → Publications → `supabase_realtime`: `treatments`,
        `payments`, `photos`
      - Advisors → Security: no new warnings compared with the current
        project

## 4. Auth settings (dashboard, not SQL)
Copy each setting from the current project. Open both side by side.
- [ ] Authentication → Sign In / Providers → Email: enabled, **Confirm email
      off**. The `@nineteendetails.internal` addresses can't receive mail.
- [ ] **Allow new users to sign up: off**, if it's off on the current project.
      Logins are only created by `create-worker` (admin API) or by hand, so
      public sign-up should be closed.
- [ ] Minimum password length 6, since the PIN is the password.
- [ ] Attack Protection → CAPTCHA: if Turnstile is used, enable it with the
      Turnstile **secret** key (the frontend sends `captchaToken` on login,
      see `src/api/auth.js`).
- [ ] URL Configuration → Site URL: the production Vercel domain.

## 5. Edge Functions
- [ ] Deploy `create-worker` and `upload-wash-proof` from `supabase/functions/`
      to the prod project. Both use **Verify JWT: on**, the same as now.
- [ ] Secrets (Edge Functions → Secrets). `SUPABASE_URL` and
      `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. Add:
      - `TINIFY_API_KEY`: photo compression. Without it, photo upload fails.
      - `ALLOWED_ORIGIN`: the production domain, e.g.
        `https://<app>.vercel.app`. Optional, but set it on prod. Leave it
        unset on dev so preview URLs keep working.

## 6. First admin and the roster
Prod starts with nobody in it.
- [ ] Bootstrap one admin by hand (the steps are also in CLAUDE.md):
      Authentication → Users → Add user, email
      `<username>@nineteendetails.internal`, password = their 6-digit PIN,
      **Auto Confirm** ticked. Then in the SQL Editor:
      ```sql
      insert into profiles (id, full_name, username, role, is_active)
      values ('<uuid from Auth>', '<Full Name>', '<username>', 'admin', true);
      ```
- [ ] Sign in to the prod app as that admin and add everyone else in
      **Kelola Staf**, with or without a login. Each person sets a fresh PIN
      with the admin in person. PINs from the dev project don't carry over.
- [ ] Katalog: set the real shelf stock counts. The seed copied dev's numbers.
- [ ] Kelola Upah / Keuangan: check the meal allowance and kasbon repayment
      percentage (they came across with `wage_settings`). Enter each person's
      opening kasbon balance (`saldo_awal`) if they owe anything.

## 7. Vercel
- [ ] Settings → Git: Production Branch = `main`.
- [ ] Settings → Environment Variables:
      - **Production**: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` = the
        **new prod** project (Settings → API Keys, publishable key)
      - **Preview**: the same two variables = the **current (dev)** project
      - `VITE_TURNSTILE_SITE_KEY`: on both if used; add the preview domain to
        the Turnstile widget's allowed hostnames
- [ ] Redeploy production after changing the variables. Vite bakes them in
      at build time, so changing them alone does nothing.
- [ ] Local `.env` keeps pointing at the dev project.

## 8. Smoke test on prod
- [ ] Log in. Run a full ticket: Transaksi Baru → payment → wash photo → close.
- [ ] A second device sees the Antrian update live.
- [ ] Struk renders; Laporan shows the ticket.
- [ ] Log in as a `staff` account: Riwayat, Laporan and Kelola Staf are not
      reachable.
- [ ] Void the test ticket (never delete). If it would distort the first
      real day's numbers, run the test before opening hours and void it.

## 9. Switching over
- [ ] Choose a cut-over day. From then on staff use the production URL only.
- [ ] Decide what happens to the current project's real history (Aug–Nov
      tickets, kasbon, attendance). It stays readable on dev. Copying it to
      prod is possible, but it's a separate job: `profiles` ids must match
      `attendance`/`kasbon_entries`/`cash_expenses`, and logins would have to
      move with their password hashes.
- [ ] Remember the dev project now holds the old real data plus test data.
      Laporan on dev is not the shop's books any more.

---

## How changes reach prod from now on
1. Write the change as a new numbered file in `supabase/migrations/` (next
   number after 023) on `dev`.
2. Apply it to **dev** and test on a Preview deploy.
3. Merge `dev` → `main`.
4. Apply the **same file** to **prod**: set `TARGET_DB_URL` to prod and run
   `bash scripts/apply-sql.sh supabase/migrations/0NN_….sql`.
5. Vercel deploys `main`.

Where possible, write migrations so that both the old and the new frontend
work with them. Then it doesn't matter whether step 4 or step 5 lands first.
Edge Function changes are deployed to dev first, then to prod, the same way.

The Supabase MCP connection in Claude Code (`.mcp.json`) points at the
current project, which is now **dev**. Prod changes go only through
migration files and `apply-sql.sh`.
