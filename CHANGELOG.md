# Version history

Every release of Chores Manager, newest first. Each version is saved on GitHub as a `release/vX.Y.Z` branch, so any version can be looked at or restored.

**How versions are numbered**
- **X (major):** big changes that need families to do something differently.
- **Y (minor):** new features.
- **Z (patch):** fixes and small changes.

**Database steps:** some releases need a SQL file run in Supabase (SQL Editor → paste → Run) *before* the new app goes live. They're listed under each version, and every file is safe to run while the previous version is live.

The version number shows in the app's footer, so you can always check which one a device is running.

---

## 1.4.0 (in testing)
Branch: `claude/preview-bonus-teams`, not live yet. Includes everything in 1.3.0.

**Fixed**
- **Take on the children's schedule.** The button now shows "Taking…" while it works and can't be tapped twice. If the chore can't be taken, the reason stays on the page in a red box (not just a pop-up that disappears).
- **Days that have passed are closed for children.** Those boxes are greyed out and can't be tapped. Earlier, an open slot on a past day still said "Open".

**Changed**
- **Fewer pages.** The parents' **Timesheets** page and the children's **My week** page are gone. Parents approve and edit time on **Approvals**. Children log from **Today** on the Schedule (with **+ Log another chore** for an earlier day this week), and see and fix what they logged under **My logged chores** on **My balance**.
- **The children's boxes on the Schedule** now share the full width, so the row lines up with both edges of the table below. Only parents see this row.
- **A child's Schedule** shows **Today** and **My week** side by side (stacked on a phone). My week shows only their own pay and time for the week, how many chores they have, what they've logged so far, and how much is still open.
- **The help line under the children's schedule** has been removed.

**New**
- **Parents choose the day the week starts** (Settings → *The week starts on*), because weekends differ between Europe and the Middle East. The schedule, the timesheet days and the weekly bonus all follow it. Changing it moves the schedule into the new weeks without moving any chore off its date. New families get Sunday for Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, Jordan, Egypt, the US and Canada, and Monday elsewhere.
- **Chores can have a time of day** (optional, in the chore's settings): **at** a set time (e.g. feed the cat at 07:00) or **by** a time (e.g. bins out by 20:00). The time shows on the schedule, in Today (sorted by time, with "overdue" once a "by" time has passed), when logging and in the chore's details. A chore logged after its "by" time is marked **Late** for parents. Pay doesn't change.
- **Children can tap a chore on Remuneration** to see how to do it, its days, the time and pay for each session, and which days are theirs this week. Photos and SOP documents will show here once uploads are added.

**Database steps (run before deploying; safe while 1.2.0 or 1.3.0 is live):**
1. `app/supabase/migrations/0007_week_start.sql`. Until it's run, everything still works and every family stays on Monday. Only changing the week start in Settings will fail.
2. `app/supabase/migrations/0008_chore_times.sql`. Until it's run, only giving a chore a time will fail.

## 1.3.0 (in testing, released together with 1.4.0)
Branch: `claude/preview-bonus-teams`, not live yet.

**Changed**
- **Logging a chore no longer asks how long it took.** The time logged and paid is the chore's fixed session: hours per week ÷ the days it's on, e.g. Dishes, 7 hrs ÷ 7 days = 1h 00m. The child picks the **day and time it was done**, and entries show "Done 18:30".
- **The database sets the time from the chore**, whatever the app sends. Nobody can log a time that hasn't happened yet. Changing a chore's hours later doesn't change entries already logged.

**New**
- **Country and language when a family is set up.** Choosing a country fills in the currency and time zone; choosing a language switches the screen straight away. Existing families can set their country in Settings.
- **Remuneration page.** "Chores & pay" and "Bonus" are now one page for parents and children, with quick links to each section.
- **Children's schedule.** A **Today** panel lists their chores for today, with **Log it** and a ✓ once logged, and open chores with **Take**. The "My chores this week" panel is gone; the siblings' boxes and the table stay.
- **Wide tables are easier to spot.** A "Swipe sideways to see the whole table" note and shaded edges appear when a table is wider than the screen. The schedule opens at today's column, with the chore names pinned.
- **Chore descriptions.** Parents describe what "done properly" looks like, and children see it when they log the chore.

**Database steps (run before deploying, in order; both safe while 1.2.0 is live):**
1. `app/supabase/migrations/0005_fixed_sessions.sql`
2. `app/supabase/migrations/0006_country_and_descriptions.sql`

## 1.2.0 (18 Nov 2026, live)
Backup: branch `release/v1.2.0`.

**New**
- **Contact page** at `/contact`, linked from every footer and the header menu, signed in or out. The form has email (filled in for parents), topic and message fields. It saves to `contact_messages` and emails contact@mizala.ai through Resend, and if the email fails the message is still saved.
- **Spam protection on Contact:** a honeypot field, and a limit of 5 messages per email or per IP in any hour.
- **Nightly encrypted database backup** with GitHub Actions, kept for 30 days.

**Database and set-up steps**
1. Run `app/supabase/migrations/0004_contact_messages.sql`.
2. Verify mizala.ai in Resend (DNS records), set the `RESEND_API_KEY` and `CONTACT_IP_SALT` secrets, and deploy the `contact` function with `--no-verify-jwt`.
3. Add the `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE` secrets in GitHub for the backup.

See app/README.md → "Contact page" and "Backups".

## 1.1.0 (18 Nov 2026)
Backup: branch `release/v1.1.0`.

**New**
- **English / العربية switch** in the header of every screen, including sign-in. The whole app, dates and layout switch to Arabic (right-to-left), and each device remembers its choice.
- **Bot protection (honeypot):** hidden fields and a minimum fill time on the New family, I'm a child and password-reset forms.
- **Nightly clean-up** of child-device logins that were never linked to a child.
- **Version number** shown in the footer.

**Database steps**
1. Database → Extensions → switch on **pg_cron**.
2. Run `app/supabase/migrations/0003_cleanup_unlinked_logins.sql`.

## 1.0.0 (18 Nov 2026)
Backup: branch `release/v1.0.0`.

First live multi-family release, on Supabase (database and logins) and Vercel (website).
- **Accounts:** parents sign in with email and password; the second parent joins with an invite code. Children link their own device with a one-time code.
- **Weekly timesheets:** pay is worked out in the database, and parents approve, reject or edit entries.
- **Weekly schedule:** it goes up for the children at a set time (default Saturday 18:00). Children pick chores, the first tap wins, and parents can override.
- **Chores & pay:** chore hours and days, a rate from the monthly budget or a fixed rate, and currency and time-zone settings.
- **Balances:** approved pay plus bonuses, minus payments. The child confirms each payment.
- **Performance bonus:** metrics with a max %, rated Meets (0%), Good (25%) or Excelled (100%) of the max.
- **Team chores:** pay split equally between the children who did it together.
- **Re-send confirmation email** button on sign-in.

**Database steps:** `0001_init.sql`, then `0002_bonus_and_teams.sql`.

## 0.x (17 Nov 2026, prototype, retired)
Single-family prototype that ran as a claude.ai Artifact (`src/app.html`). Superseded by 1.0.0.
