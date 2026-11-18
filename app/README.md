# Chores Manager (Supabase app)

The multi-family version of Chores Manager: React + TypeScript (Vite) on the front, Supabase (Postgres, Auth, Realtime) behind it. Any family can sign up; each family's data is kept separate by row-level security in the database.

## What's in here

| Path | What it is |
| --- | --- |
| `supabase/migrations/0001_init.sql` | Tables, access rules, triggers and the functions the app calls |
| `supabase/migrations/0002_bonus_and_teams.sql` | Performance bonus (metrics + weekly reviews) and team chores (split pay). Run after 0001 |
| `supabase/tests/rls.test.mjs` | 50 checks of the access rules against a real Postgres |
| `src/` | The app: sign-in, family set-up, timesheets, approvals, schedule, chores & pay, balances, family |

## How people sign in

- **Parents** use an email and password. The first parent creates the family. They invite the second parent from **Family → Invite a parent**, which gives a one-time code. The second parent creates their own account, then chooses **Join with a code**.
- **Children** don't need an email. A parent adds the child on **Family**, then taps **Device code**. On the child's phone or tablet, the child chooses **I'm a child** and types the code. That device gets its own anonymous login, linked to that child. If a phone is lost, use **Unlink** and make a new code.

## Performance bonus and team chores

- **Performance bonus:** parents set metrics on the **Bonus** page (e.g. School grades, max 10%), with what earns each level. When reviewing a week (on **Approvals** or **Bonus**), each metric is rated **Meets** (0% of its max), **Good** (25%) or **Excelled** (100%). The bonus is that % of the child's approved chore pay for the week, and it's added to their balance.
- **Team chores:** when logging time, a child can pick siblings who helped. Everyone gets the same time; the chore's pay is split equally. Only the child who logged it, or a parent, can change it, and approving it approves it for the whole team.

## What the database enforces

The app can't get around these, because the database checks them:

- **Families are separate:** a family can't see or change another family's data.
- **Children's limits:** a child sees their own timesheet and payments only. They can't log time for a sibling or for a future day, can't approve their own time, and can't change time once it's approved.
- **Pay comes from the database:** pay is always minutes × the chore's rate (or the family rate), worked out in the database. Each entry keeps the rate it was logged at.
- **Schedule picking:** children can pick only once that week's schedule is up (default Saturday 18:00 in the family's time zone). If two children tap the same slot, the first gets it. A child can't drop a chore a parent gave them.
- **Payments:** only parents record payments, only the child who was paid can confirm one, and a confirmed payment can't be deleted.

## Set up a Supabase project

1. Create a project at supabase.com. A region near your users is best (e.g. `eu-west-2` London or `me-central-1` UAE).
2. **SQL Editor** → paste `supabase/migrations/0001_init.sql` → Run. Then do the same with `0002_bonus_and_teams.sql`. If you use the Supabase CLI, run `supabase db push` instead.
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
PGURL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
```

The test creates a throwaway database and loads a small stand-in for Supabase's `auth` schema. It then acts as each kind of user: parent, second parent, each child's device, another family, and someone not signed in. It deletes the database at the end.

## Before selling it

- **Abuse protection:** turn on CAPTCHA protection for sign-ups and anonymous sign-ins (Authentication → Attack Protection). Anonymous sign-ins can otherwise be abused.
- **Privacy:** write a privacy policy and terms. Add account and data deletion for parents (a `delete_household` function).
- **Next steps:** push notifications, Stripe, then the Capacitor app-store builds (steps 2–3 of the plan).
