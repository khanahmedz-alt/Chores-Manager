# How to test a new version before it goes live

New versions are built on the **test branch** (`claude/preview-bonus-teams`). Vercel turns that branch into a private **Preview** copy of the app. Your family keeps using the live app, from the **live branch** `claude/family-chore-pay-tracker-ii8q3v`, until you deploy.

Both copies use the **same Supabase database**, so anything you add while testing is real. Test with your own family and delete test entries afterwards.

---

## 1. Run any database steps first
`CHANGELOG.md` lists the SQL files each new version needs, under "Database steps". They're always safe to run while the current version is live.

1. Open the file on GitHub, on the **test branch**:
   `https://github.com/khanahmedz-alt/Chores-Manager/tree/claude/preview-bonus-teams/app/supabase/migrations`
2. Click the file → **Raw** → **Ctrl+A** → **Ctrl+C**.
3. In **Supabase → SQL Editor → New query**, paste and click **Run**. You should see **"Success. No rows returned."**
4. Run each new file once, in number order. If it says *"already exists"*, that file was already run, so move to the next one.

## 2. Open the Preview
**Option A: the bookmarkable address.** This always shows the newest version on the test branch:
```
https://chores-manager-git-claude-preview-bonus-teams-khan-z.vercel.app
```
If that address doesn't load, use Option B once and copy the address Vercel shows under **Domains**.

**Option B: through Vercel.**
1. Go to **vercel.com** → the **chores-manager** project → **Deployments**.
2. Find the newest row labelled **Preview** with branch `claude/preview-bonus-teams`. Its description is the latest change, e.g. "1.3.0 (in testing)…".
3. Wait for **Ready**, then click the row → **Visit**.

**Check you're on the test version:** the footer shows the new version number, e.g. **v1.3.0**, while the live app shows the old one.

## 3. Sign in and test
- Sign in as a parent with your normal email and password.
- To see a child's view, open the Preview in a **private / incognito window** and link it as a child, or use a spare device. Parents → Family → **Device code** for that child, then choose **I'm a child** in the Preview.
- Preview links are private to your Vercel login, so the children's own phones can't open them. Test the child view on your device.

## 4. Deploy when you're happy
Either tell Claude **"deploy"**, or do it on GitHub:
1. Go to the repo → **Pull requests** → **New pull request**.
2. Set **base** to `claude/family-chore-pay-tracker-ii8q3v` and **compare** to `claude/preview-bonus-teams`.
3. Click **Create pull request**, then **Merge pull request** → **Confirm merge**.

Vercel builds the live app in 1–2 minutes. Check your normal address shows the new version number in the footer.

**If the live address still shows the old version:** in Vercel → **Deployments**, find the newest **Production** row, then click **⋯ → Promote**. (This happens after a manual promote or rollback.)

---

## If something goes wrong

| What you see | Fix |
| --- | --- |
| **"Connect Supabase"** on the Preview | Vercel → **Settings → Environment Variables**. On both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, tick **Preview** as well as Production. Then **Deployments** → the preview row → **⋯ → Redeploy**. |
| Preview row says **Error** | Click it → **Build Logs** → screenshot the red lines and send them to Claude. |
| Saving fails with a database error | A database step from section 1 probably hasn't been run yet. |
| Need to go back to an older version | Each release is saved as a `release/vX.Y.Z` branch on GitHub. In Vercel → **Deployments**, find that version's Production build → **⋯ → Promote**. Then tell Claude, so the live branch can be fixed properly. |
