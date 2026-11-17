# Chores Manager

A family app for tracking chore time and pocket-money pay.

> **Two versions live here.** `src/app.html` is the original single-family app (runs as a claude.ai Artifact). `app/` is the multi-family version on Supabase that any family can sign up to: see [`app/README.md`](app/README.md).

- **Parents (Mother, Father)** add chores, set hours per week, the days and who does them, and the rate of pay. They approve the time the children log and record payments.
- **Children (Mustafa, Ayesha, Aaminah, Mohammad)** fill in a weekly timesheet: choose a chore and the time spent. Pay is worked out from the rate, then sent for approval. They confirm when they've been paid.

## Pages

| Page | Who | What it does |
| --- | --- | --- |
| My week / Timesheets | Children / Parents | 7-day timesheet with the planned chores for each day, a "Log" button, and the pay for each entry |
| Approvals | Parents | Time waiting for approval, grouped by child. Approve, reject, edit, or approve all |
| Schedule | Everyone | Week-by-week chores × days grid. Next week's schedule goes up for the children every **Saturday at 18:00**; they tap **Take** on open slots to pick the chores they'll do (and can drop their own picks). Parents can assign, reassign or remove any slot at any time, including before it goes up; a child can't drop a chore a parent gave them |
| Chores & pay | Everyone (parents edit) | The chore list from the spreadsheet (Task, Hrs/wk, Wk payment, Activity) and the /month → /wk → /hr rate |
| Balance(s) | Everyone | Approved pay − payments = balance owed. Payment history with "Confirm received" for the child |

## How pay is worked out

The default matches the family spreadsheet:

```
SAR 1,500.00 / month × 12 ÷ 52  = SAR 346.15 / week
SAR 346.15 / week ÷ 40 budgeted hours = SAR 8.65 / hour
entry pay = hours logged × hourly rate
```

Under **Settings**, parents can change the budget or budgeted hours, switch to a fixed hourly rate, add a currency symbol, and set a parent PIN, and change when the next week's schedule goes up (default Saturday 18:00). Each chore can have its own rate. Every entry keeps the rate it was logged at, so changing the rate later doesn't change past pay.

## Running it

- `src/app.html` is the app: one file, no build step, no dependencies.
- **Shared (recommended):** it is published as a claude.ai Artifact with a shared database, so every family member's device sees the same data live.
- **Standalone:** `./scripts/build.sh` writes `index.html`. Open it in a browser or host it as a static site. Without the shared database, data is saved in that browser only (the footer shows "Saved on this device only").
