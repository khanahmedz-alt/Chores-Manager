# Chores Manager (Supabase app)

The multi-family version of Chores Manager: React + TypeScript (Vite) on the front, Supabase (Postgres, Auth, Realtime) behind it. Any family can sign up; each family's data is kept separate by row-level security in the database.

## What's in here

| Path | What it is |
| --- | --- |
| `supabase/migrations/0001_init.sql` | Tables, access rules, triggers and the functions the app calls |
| `supabase/migrations/0002_bonus_and_teams.sql` | Performance bonus (metrics + weekly reviews) and team chores (split pay). Run after 0001 |
| `supabase/migrations/0003_cleanup_unlinked_logins.sql` | Nightly clean-up of child-device logins that were never linked to a child |
| `supabase/migrations/0004_contact_messages.sql` | Contact-page messages: table (no client access) and the submit function with the rate limit |
| `supabase/migrations/0005_fixed_sessions.sql` | Time logged = the chore's fixed session; entries record when the chore was done |
| `supabase/migrations/0006_country_and_descriptions.sql` | The family's country, and a description (standard) for each chore |
| `supabase/migrations/0008_chore_times.sql` | An optional time of day for a chore: at a set time, or done by a time |
| `supabase/migrations/0007_week_start.sql` | Each family chooses the first day of its week; changing it moves the schedule and bonus reviews into the new weeks |
| `supabase/functions/contact/` | Edge Function behind the Contact page: saves the message and emails the team through Resend |
| `supabase/tests/rls.test.mjs` | 64 checks of the access rules against a real Postgres |
| `supabase/tests/contact.test.mjs` | 9 checks of the Contact function (honeypot, validation, rate limit, email failure) |
| `scripts/backup-db.sh`, `../.github/workflows/nightly-backup.yml` | Nightly encrypted database backup |
| `src/` | The app: sign-in, family set-up, timesheets, approvals, schedule, chores & pay, balances, family |

## How people sign in

- **Parents** use an email and password. The first parent creates the family. They invite the second parent from **Family → Invite a parent**, which gives a one-time code. The second parent creates their own account, then chooses **Join with a code**.
- **Children** don't need an email. A parent adds the child on **Family**, then taps **Device code**. On the child's phone or tablet, the child chooses **I'm a child** and types the code. That device gets its own anonymous login, linked to that child. If a phone is lost, use **Unlink** and make a new code.

## Performance bonus and team chores

- **Performance bonus:** parents set metrics on the **Remuneration** page (Performance bonus section) (e.g. School grades, max 10%), with what earns each level. When reviewing a week (on **Approvals** or **Remuneration**), each metric is rated **Meets** (0% of its max), **Good** (25%) or **Excelled** (100%). The bonus is that % of the child's approved chore pay for the week, and it's added to their balance.
- **Team chores:** when logging time, a child can pick siblings who helped. Everyone gets the same time; the chore's pay is split equally. Only the child who logged it, or a parent, can change it, and approving it approves it for the whole team.

## What the database enforces

The app can't get around these, because the database checks them:

- **Families are separate:** a family can't see or change another family's data.
- **Children's limits:** a child sees their own timesheet and payments only. They can't log time for a sibling or for a future day, can't approve their own time, and can't change time once it's approved.
- **Pay comes from the database:** the time logged is the chore's fixed session (hours per week ÷ the days it's on, rounded to 5 minutes), and pay is that time × the chore's rate (or the family rate). The app only sends the day and time the chore was done. Each entry keeps the time and rate it was logged with.
- **Schedule picking:** children can pick only once that week's schedule is up (default Saturday 18:00 in the family's time zone). If two children tap the same slot, the first gets it. A child can't drop a chore a parent gave them.
- **Payments:** only parents record payments, only the child who was paid can confirm one, and a confirmed payment can't be deleted.

## Set up a Supabase project

1. Create a project at supabase.com. A region near your users is best (e.g. `eu-west-2` London or `me-central-1` UAE).
2. **SQL Editor** → paste `supabase/migrations/0001_init.sql` → Run. Then do the same with `0002_bonus_and_teams.sql`, `0003_cleanup_unlinked_logins.sql`, `0004_contact_messages.sql`, `0005_fixed_sessions.sql`, `0006_country_and_descriptions.sql`, `0007_week_start.sql` and `0008_chore_times.sql` (turn on **pg_cron** under Database → Extensions first, so the clean-up runs nightly). If you use the Supabase CLI, run `supabase db push` instead.
3. **Authentication → Sign In / Providers**:
   - Email: on. Keep "Confirm email" on for production.
   - **Allow anonymous sign-ins: on.** Children's devices need this.
4. **Authentication → URL Configuration**: set the Site URL to where you'll host the app, and add `http://localhost:5173` for development.
5. **Project Settings → API**: copy the Project URL and the anon (publishable) key.

## Run it

```sh
cd app
cp .env.example .env        # paste the URL and key
npm install
npm run dev                 # http://localhost:5173
```

`npm run build` writes a static site to `dist/`. Host it on Vercel, Netlify or Cloudflare Pages; the build command is `npm run build`, the output folder is `dist`, and the same two `VITE_…` variables are set there.

## Test the access rules

You need a local Postgres 15 or 16.

```sh
PGURL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db   # access rules + Contact function
```

The test creates a throwaway database and loads a small stand-in for Supabase's `auth` schema. It then acts as each kind of user: parent, second parent, each child's device, another family, and someone not signed in. It deletes the database at the end.

## English and Arabic

- The **English / العربية** button in the header switches the whole app, including sign-in, to Arabic and a right-to-left layout. Each device remembers its choice, and devices whose system language is Arabic start in Arabic.
- Strings are written in English in the code and wrapped in `t()`. Arabic is in `src/i18n.ar.ts`. Run `npm run check:i18n` to list anything not yet translated. Database error messages are translated too.
- Dates use Arabic month and day names with the Gregorian calendar. Numbers and amounts keep Western digits. Names, chore names and notes stay as the family typed them.

## Contact page

`/contact` is open to everyone, signed in or not. It's linked from every footer and, when signed in, from the name menu in the header. The form has three fields:
- **Email:** filled in for a signed-in parent, and still editable.
- **Topic:** Support, Billing, Feedback, Privacy / Data request or Other.
- **Message:** 10–5,000 characters.

Sending calls the `contact` Edge Function, which:
1. Silently drops the submission if the hidden honeypot field is filled.
2. Checks the fields and applies the rate limit: 5 messages per email or per IP address in any hour. The IP is only stored as a salted hash.
3. Saves the message in `contact_messages` with status `new`, plus the sender's user and family ID if they're signed in. Browsers can't read or write this table.
4. Emails it through Resend:
   - **From:** `Mizala Contact <noreply@mizala.ai>`
   - **To:** `contact@mizala.ai`
   - **Reply-to:** the sender
   - **Subject:** `[Topic] New contact message`

   If the email fails, the message is still saved, the error is logged and stored in `email_error`, and the visitor still sees "Thanks, we'll reply by email".

The Resend API key lives only in the function's secrets. To add CAPTCHA later, look for `TODO(captcha)` in `src/views/Contact.tsx` and `supabase/functions/contact/index.ts`.

Read and manage messages in Supabase → Table Editor → `contact_messages`. Set `status` to `replied`, `closed` or `spam` as you go.

### Setting it up

1. **Run the migration:** in the SQL Editor, run `supabase/migrations/0004_contact_messages.sql`.
2. **Verify mizala.ai in Resend** (resend.com → Domains → Add domain → `mizala.ai`, region **eu-west-1 Ireland**). Resend then shows the exact records to add at your DNS provider. They look like this:

   | Type | Name (host) | Value | Notes |
   | --- | --- | --- | --- |
   | TXT | `resend._domainkey` | `p=MIGfMA0G…` (long key from Resend) | DKIM: proves the email is from you |
   | MX | `send` | `feedback-smtp.eu-west-1.amazonses.com`, priority `10` | Bounce handling on the `send.` subdomain |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the `send.` subdomain |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:contact@mizala.ai` | Recommended; tighten to `p=quarantine` later |

   These sit on the `send.` and `resend._domainkey` sub-names, so they don't touch your normal email (the MX records on `mizala.ai` itself). Click **Verify** in Resend once they're added; it can take a few minutes to a few hours.
3. **Create an API key:** in Resend, go to API Keys → Create, with permission "Sending access", limited to the domain `mizala.ai`.
4. **Set the function's secrets:** Supabase → Edge Functions → Secrets → Add. Or, with the CLI:
   ```sh
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx CONTACT_IP_SALT="$(openssl rand -hex 32)" --project-ref twisallsmlaoazdcpzxc
   ```
   You can also set `ALLOWED_ORIGINS=https://your-app.vercel.app`, so only your site can call the function.
5. **Deploy the function.** JWT checking must be off, because signed-out visitors use the form; the function does its own checks.
   ```sh
   supabase login
   supabase functions deploy contact --no-verify-jwt --project-ref twisallsmlaoazdcpzxc
   ```
   Without the CLI, go to Supabase → Edge Functions → Deploy a new function → Via editor. Name it `contact`, add both files from `supabase/functions/contact/` (`index.ts` and `handler.ts`), and turn **Enforce JWT verification** off in the function's settings.
6. **Make sure the `contact@mizala.ai` inbox exists** and can receive mail.
7. **Test it:** send a message from `/contact`. It should arrive at contact@mizala.ai, and the row should show `email_sent_at`. If `email_error` is filled in instead, it holds Resend's reason. Function logs are under Edge Functions → contact → Logs.

## Backups

The GitHub Actions workflow `.github/workflows/nightly-backup.yml` runs every night at 00:17 UTC (03:17 Riyadh). Each backup is encrypted and kept for 30 days under that run's **Artifacts**. You can also run it any time with **Actions → Nightly database backup → Run workflow**. Each backup holds:
- **App data:** all of it, in the `public` schema: tables, data, functions and access rules.
- **Logins:** `auth.users` and `auth.identities`, data only.
- **Row counts:** a list of rows per table, to check a restore against.

Setting it up (once):
1. **Database connection string:** in Supabase, go to **Connect** → **Session pooler**, copy the connection string, and put in your database password. Use the session pooler: the direct address doesn't work from GitHub.
2. **Repository secrets:** in GitHub, go to the repo → **Settings → Secrets and variables → Actions → New repository secret**, and add:
   - `SUPABASE_DB_URL`: the connection string from step 1.
   - `BACKUP_PASSPHRASE`: a long passphrase. **Store it in your password manager.** Without it, the backups can't be opened.
3. **Test run:** run the workflow once by hand and check it goes green.

GitHub pauses scheduled workflows in a repo with no activity for 60 days. If that happens, re-enable it on the Actions tab.

To restore, starting from a downloaded artifact (a zip containing `chores-db-….tgz.gpg`):
```sh
gpg -d chores-db-2026-11-19T0017Z.tgz.gpg | tar -xz          # asks for BACKUP_PASSPHRASE
cat counts.txt                                                # what you should end up with
# Into a NEW, empty Supabase project (recommended), or the same one after a disaster:
pg_restore -d "$SUPABASE_DB_URL" --no-owner --data-only auth.dump
pg_restore -d "$SUPABASE_DB_URL" --no-owner --clean --if-exists public.dump
```
Then turn on anonymous sign-ins and pg_cron again in the new project, and point Vercel's `VITE_SUPABASE_*` variables at it. Restoring with `--clean` replaces what's in `public`, so restore into a fresh project unless you mean to overwrite.

## Where customer data lives

| What | Where |
| --- | --- |
| Everything a family enters (members, chores, schedule, timesheets, bonuses, payments) | Supabase Postgres database, project region **eu-west-1 (Ireland)** |
| Parent emails and password hashes, child-device logins | Supabase Auth (same project, `auth` schema) |
| Login session, chosen family, language | The browser's local storage on each device |
| The website files only (no customer data) | Vercel |
| Code only (no customer data) | GitHub |

Supabase encrypts data at rest and all traffic uses HTTPS. **The Free plan has no automatic backups**, so the nightly GitHub backup below covers it. Supabase Pro adds its own daily backups and point-in-time recovery.

## Bot protection

- **Honeypot:** the New family, I'm a child and password-reset forms have two hidden fields that people never see, plus a minimum fill time (2.5 s). A form that fills either field, or is sent faster than that, is stopped in the browser and nothing reaches Supabase. Sign-in is not trapped.
- **Server side:** a honeypot only stops form-filling bots; anyone can call Supabase directly with the public key. So keep Supabase's rate limits (Authentication → Rate Limits; lower "anonymous sign-ins per hour" to about 10), and run migration 0003, which deletes child-device logins not linked to a child within a day. CAPTCHA (Authentication → Attack Protection) remains the stronger option if abuse ever shows up.

## Before selling it

- **Privacy:** write a privacy policy and terms. Add account and data deletion for parents (a `delete_household` function).
- **Next steps:** push notifications, Stripe, then the Capacitor app-store builds (steps 2–3 of the plan).
