# Version history

Every release of Chores Manager, newest first. Each version is saved on GitHub as a `release/vX.Y.Z` branch, so any version can be looked at or restored.

**How versions are numbered**
- **X (major):** big changes that need families to do something differently.
- **Y (minor):** new features.
- **Z (patch):** fixes and small changes.

**Database steps:** some releases need a SQL file run in Supabase (SQL Editor → paste → Run) *before* the new app goes live. They're listed under each version, and every file is safe to run while the previous version is live.

The version number shows in the app's footer, so you can always check which one a device is running.

---

## 1.1.0 (in testing)
Branch: `claude/preview-bonus-teams`, not live yet.

**New**
- **English / العربية switch** in the header of every screen, including sign-in. The whole app, dates and layout switch to Arabic (right-to-left), and each device remembers its choice.
- **Bot protection (honeypot):** hidden fields and a minimum fill time on the New family, I'm a child and password-reset forms.
- **Nightly clean-up** of child-device logins that were never linked to a child.
- **Version number** shown in the footer.

**Database steps**
1. Database → Extensions → switch on **pg_cron**.
2. Run `app/supabase/migrations/0003_cleanup_unlinked_logins.sql`.

## 1.0.0 (18 Nov 2026, live)
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
