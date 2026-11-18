# Chores Manager: where things stand (18 Nov 2026)

Paste everything below the line into a new Claude chat to continue planning without code.
For a coding session, also point it at this repo and `app/README.md`.

---

I'm building **Chores Manager**, a family chores and pocket-money app, and I want to continue planning it with you (product, business, launch, pricing, legal, marketing, and what to build next). Here is where things stand.

## What the app does today (live, version 1.2.0)
**Who uses it**
- Each family has parents (managers and approvers) and children (do chores, log time).
- Parents sign in with email and password. The first parent creates the family and invites the other with a one-time code.
- Children have no email. A parent makes a one-time device code (valid 24 hours) to link each child's phone. Lost phones can be unlinked.

**Pay**
- Hourly rate from a monthly budget: monthly × 12 ÷ 52 ÷ budgeted hours. My family: SAR 1,500 → SAR 346.15/week → SAR 8.65/hr at 40 hrs.
- Parents can instead set a fixed rate, or a chore-specific rate.
- Pay is worked out by the database, and each entry keeps the rate it was logged at.

**Chores & pay page:** add, edit and archive chores (hours per week, days, frequency). A planned-cost-versus-weekly-budget meter.

**Weekly timesheet (children):** log a chore and the time spent, which goes to parents for approval. Children can't log future days, approve themselves, or edit approved time.

**Team chores:** children who did a chore together log it once. The pay is split equally, and edits and approvals apply to the whole team.

**Approvals (parents):** approve, reject, edit, or approve all.

**Weekly schedule**
- Next week's schedule goes up for the children at a set time (default Saturday 18:00 in the family's time zone).
- Children tap Take on open slots; the first tap wins. They can drop their own picks.
- Parents can assign, override or remove any slot, even before release.

**Performance bonus**
- Parents define metrics (e.g. school grades) with a max %, and describe what earns each tier.
- Each week a parent rates a child Meets (0% of max), Good (25%) or Excelled (100%).
- The bonus is that % of the child's approved chore pay for the week.

**Balances:** approved pay plus bonuses, minus payments. Parents record payments, and the child confirms receipt.

**Family page:** add children, colours, device codes, unlink, remove and restore members, and invite a parent.

**English / العربية switch** on every screen: full Arabic, right-to-left layout, Arabic dates. Each device remembers its choice.

**Contact page** (`/contact`, signed in or out)
- Email (filled in for parents), topic and message fields.
- Saved in the database and emailed to contact@mizala.ai through Resend.
- Spam protection: honeypot, and 5 per email or IP per hour.

**Security**
- Every family's data is separate, enforced in the database (58 automated access checks plus 9 Contact checks).
- Honeypot and timing checks on sign-up and child-device forms.
- A nightly clean-up of unused child-device logins.

**Backups:** a nightly encrypted database backup through GitHub Actions, kept 30 days. Restore was tested locally.

**Versions:** shown in the footer. Each release is saved as a `release/vX.Y.Z` branch (1.0.0, 1.1.0 and 1.2.0 so far), with a `CHANGELOG.md`.

## How it's built and hosted (for context)
- **Website:** React web app, hosted on **Vercel**.
- **Back end:** **Supabase** for the database, logins, live updates and one Edge Function. Free plan, Ireland region.
- **Email:** **Resend**, domain mizala.ai verified, Ireland region.
- **Code:** a private GitHub repo. Changes are tested on a separate preview branch, then merged to the live branch, which deploys automatically.
- **Design:** my **Mizala** design system (teal #41b883, navy #1e3a5f, Segoe UI, wave footer).
- **Owner:** Mizala is my company, registered in the UK and Saudi Arabia.
- **Users:** my family is using it now: 2 parents and 4 children (Mustafa, Ayesha, Aaminah, Mohammad).

## Lessons from setting it up
- **Vercel:** promoting an older build by hand stops Vercel moving the main address to new builds. Use ⋯ → Promote on the newest build to fix it.
- **Supabase secret names** are exact (e.g. `RESEND_API_KEY`, not `Resend_API-Key`).
- **Supabase function names** are case-sensitive (`contact`, not `Contact`).
- **Supabase's built-in email** only reliably reaches my own team's addresses, so real sign-up and password emails need my own email service.

## Outstanding: to check or finish
1. **Backup:** run GitHub → Actions → "Nightly database backup" → Run workflow once and confirm it's green. Check both secrets (`SUPABASE_DB_URL` as the Session pooler string, `BACKUP_PASSPHRASE`) and store the passphrase safely.
2. **Child-device clean-up:** confirm pg_cron is on, and that migration `0003_cleanup_unlinked_logins.sql` was run.
3. **Contact:** the test message was saved with `user_id` empty. Confirm whether I was signed in. If I was, signed-in parents aren't being recognised, and that needs a fix.
4. **Contact:** optionally set `ALLOWED_ORIGINS` (my app's address) so only my site can call the function.
5. **Sign-up and password emails:** connect Resend as Supabase's email sender (Authentication → Emails → SMTP). Until then, confirmation emails only reach team members. Then decide whether "Confirm email" stays on.
6. **Abuse limits:** lower "anonymous sign-ins per hour" in Supabase's rate limits to about 10.
7. **Arabic review:** have a native Arabic speaker check the wording, especially on the children's screens.
8. **Old prototype:** retire the claude.ai version so nobody logs time in the wrong place.
9. **Email domain:** tighten DMARC for mizala.ai from `p=none` to `p=quarantine` once email looks healthy.

## Small builds next (each roughly an hour or less)
- **Add to Home Screen:** app icon, name and full-screen, so it opens like an app on phones. Not built yet.
- **Delete account / delete family data:** needed for app stores and privacy laws.
- **Contact inbox inside the app (for me):** read messages, mark replied, closed or spam. Today they're only in the Supabase table and email.
- **CAPTCHA:** on Contact and sign-up. There's a ready-made hook in the code, e.g. Cloudflare Turnstile.
- **Error reporting:** Sentry, so I hear about crashes.
- **Data export:** CSV of timesheets and payments for parents.

## Before selling
- **Supabase Pro ($25/month):** the project never pauses, and it adds its own daily backups and point-in-time recovery.
- **My own domain** for the app, e.g. app.mizala.ai or a separate brand.
- **Privacy policy and terms:** the app stores children's data, so UK GDPR and the Children's Code apply, plus Saudi PDPL. Needs a lawyer check. Add parental consent wording.
- **Branding decision:** sell under Mizala, or under a separate consumer brand? It affects the store listing, icon and domain.

## Roadmap agreed earlier
- **Step 2:** push notifications ("Next week's schedule is up", "entries waiting for approval"). Subscriptions with Stripe: a free tier plus a paid family plan, launched on the web.
- **Step 3:** iPhone and Android apps from the same codebase (Capacitor), with RevenueCat for in-app subscriptions.
- **Principle:** the app tracks money owed and paid. It never holds or moves money, which avoids financial regulation.
- **Positioning:** unlike per-chore apps (BusyKid, Greenlight, OurHome), it budgets by the hour, uses parent-approved timesheets, and has a weekly schedule children pick from. It's like a first job.

## Feature ideas to consider
**Region and calendar**
- Option to start the week on Sunday (common in Saudi Arabia).
- Optional Hijri dates.

**Engagement and motivation**
- Reminders: "you have chores today" for children, "approvals waiting" for parents.
- Streaks, badges or a gentle family leaderboard.
- Savings goals: a child sets a target, e.g. a bike, and sees progress.

**Approvals and checking work**
- Photo proof of a finished chore, attached to the entry.
- Auto-approve for trusted chores or children, with parents able to undo.
- A parent's note on a rejected entry explaining why.

**Money and records**
- "Pay all balances" in one step at month end, plus a monthly statement for each child.
- Multiple currencies or families (e.g. grandparents, or a child in two homes).

**Fairness**
- Chore rotation suggestions so the schedule stays fair.

## What I want from you now
Help me prioritise the outstanding items and suggestions:
- What to finish this week.
- What matters before selling.
- What to validate with other families first.

Then help with the non-coding side: pricing and tiers, positioning and naming, go-to-market in the UK and Saudi Arabia, app-store rules for family apps, and a privacy and legal checklist. Ask me questions where you need my input, and give recommendations rather than long lists of options.
