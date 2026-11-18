// Runs the migration against a scratch Postgres database and checks the access rules
// by acting as each kind of user. Usage:
//   PGURL=postgres://postgres@127.0.0.1:54329/postgres node supabase/tests/rls.test.mjs
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const base = process.env.PGURL || 'postgres://postgres@127.0.0.1:54329/postgres';
const dbName = 'chores_test_' + Date.now();
const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`create database ${dbName}`);
const url = new URL(base); url.pathname = '/' + dbName;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();

const here = new URL('.', import.meta.url);
await db.query(readFileSync(new URL('supabase_stub.sql', here), 'utf8'));
for (const f of readdirSync(new URL('../migrations/', here)).filter(f => f.endsWith('.sql')).sort()) {
  await db.query(readFileSync(new URL('../migrations/' + f, here), 'utf8'));
}

let passed = 0;
const users = {};
async function user(name, anonymous = false) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [id, anonymous ? null : `${name}@example.com`, anonymous]);
  users[name] = { id, anonymous };
  return users[name];
}
// Run fn as a signed-in user (role authenticated, JWT claims set), like a PostgREST request.
async function as(name, sql, params = []) {
  await db.query('begin');
  try {
    if (name === 'anon') {
      await db.query('set local role anon');
    } else if (name === 'service') {
      await db.query('set local role service_role');
    } else {
      const u = users[name];
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, role: 'authenticated', is_anonymous: u.anonymous })]);
      await db.query('set local role authenticated');
    }
    const r = await db.query(sql, params);
    await db.query('commit');
    return r;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
async function fails(name, sql, params, re) {
  await assert.rejects(() => as(name, sql, params), e => { if (re && !re.test(e.message)) { console.error('Unexpected error:', e.message); return false; } return true; });
}
function ok(label) { passed++; console.log('  ✓ ' + label); }

// ---------------------------------------------------------------- setup
await user('mother'); await user('father'); await user('outsider');
await user('mustafa_phone', true); await user('ayesha_phone', true);

const hh = (await as('mother', `select public.create_household('Khan family', 'Mother', 'SAR', 'Asia/Riyadh') as id`)).rows[0].id;
ok('a parent creates a family and becomes its first parent');

await fails('mustafa_phone', `select public.create_household('x', 'x')`, [], /email/);
ok('an anonymous device cannot create a family');

await fails('mother', `select public.create_household('x', 'x', '', 'Mars/Olympus')`, [], /time zone/);
ok('an unknown time zone is refused');

await as('mother', `update public.households set monthly_budget = 1500, budget_hours = 40 where id = $1`, [hh]);
const rate = Number((await as('mother', `select public.household_rate($1) r`, [hh])).rows[0].r);
assert.equal(rate.toFixed(4), '8.6538'); ok('budget rate = 1500 × 12 ÷ 52 ÷ 40 = 8.6538/hr');

const kids = (await as('mother', `insert into public.members (household_id, display_name, role, color) values
  ($1, 'Mustafa', 'child', '#41b883'), ($1, 'Ayesha', 'child', '#ff6b6d') returning id, display_name`, [hh])).rows;
const MUSTAFA = kids.find(k => k.display_name === 'Mustafa').id, AYESHA = kids.find(k => k.display_name === 'Ayesha').id;
const ch = (await as('mother', `insert into public.chores (household_id, name, hours_per_week, frequency, days) values
  ($1, 'Gardening', 8, 'Alternate day', '{0,2,4,6}'), ($1, 'Feed the cat', 3.5, 'Daily', '{0,1,2,3,4,5,6}') returning id, name`, [hh])).rows;
const GARDEN = ch.find(c => c.name === 'Gardening').id, CAT = ch.find(c => c.name === 'Feed the cat').id;
ok('a parent adds children and chores');

await fails('mother', `insert into public.members (household_id, user_id, display_name, role) values ($1, $2, 'Sneaky', 'child')`, [hh, users.outsider.id], /invite code/);
ok('a parent cannot attach someone else’s login directly');

// ---------------------------------------------------------------- invites
const code1 = (await as('mother', `select code from public.create_invite($1, 'child', $2)`, [hh, MUSTAFA])).rows[0].code;
assert.match(code1, /^[A-Z2-9]{8}$/);
await as('mustafa_phone', `select public.redeem_invite($1)`, [code1.toLowerCase()]);
ok('a child’s device links to their profile with a one-time code');
await fails('ayesha_phone', `select public.redeem_invite($1)`, [code1], /not valid/);
ok('a used code cannot be used again');
const code2 = (await as('mother', `select code from public.create_invite($1, 'child', $2)`, [hh, AYESHA])).rows[0].code;
await as('ayesha_phone', `select public.redeem_invite($1)`, [code2]);
const pcode = (await as('mother', `select code from public.create_invite($1, 'parent')`, [hh])).rows[0].code;
await fails('mustafa_phone', `select public.redeem_invite($1)`, [pcode], /email/);
ok('a parent code cannot be used by an anonymous device');
await as('father', `select public.redeem_invite($1, 'Father')`, [pcode]);
assert.equal((await as('father', `select public.is_parent($1) p`, [hh])).rows[0].p, true);
ok('a second parent joins with an invite code');
await fails('mustafa_phone', `select * from public.create_invite($1, 'child', $2)`, [hh, AYESHA], /Only a parent/);
ok('a child cannot make invite codes');
assert.equal((await as('mustafa_phone', `select count(*)::int n from public.invites`)).rows[0].n, 0);
ok('children cannot read invite codes');

// ---------------------------------------------------------------- isolation
const ohh = (await as('outsider', `select public.create_household('Other family', 'Dad') as id`)).rows[0].id;
for (const t of ['households', 'members', 'chores', 'time_entries', 'payments', 'schedule_slots']) {
  const n = (await as('outsider', `select count(*)::int n from public.${t} where ${t === 'households' ? 'id' : 'household_id'} = $1`, [hh])).rows[0].n;
  assert.equal(n, 0, t);
}
ok('another family sees nothing of this family');
await fails('outsider', `insert into public.chores (household_id, name, hours_per_week, days) values ($1, 'x', 1, '{0}')`, [hh], /row-level security/);
ok('another family cannot add chores here');
await fails('anon', `select * from public.households`, [], /permission denied/);
ok('someone not signed in cannot read anything');
assert.ok(ohh);

// ---------------------------------------------------------------- time entries
const today = (await db.query(`select public.household_today($1)::text d`, [hh])).rows[0].d;
const e1 = (await as('mustafa_phone', `insert into public.time_entries (household_id, member_id, chore_id, work_date, minutes, rate, amount, status)
  values ($1, $2, $3, $4, 120, 999, 999, 'approved') returning id, rate, amount, status, chore_name`, [hh, MUSTAFA, GARDEN, today])).rows[0];
assert.equal(e1.status, 'submitted'); assert.equal(Number(e1.amount), 17.31); assert.equal(e1.chore_name, 'Gardening');
ok('a child logs 2h gardening: pay worked out by the database (17.31), status forced to submitted');
await fails('mustafa_phone', `insert into public.time_entries (household_id, member_id, chore_id, work_date, minutes) values ($1, $2, $3, $4, 30)`, [hh, AYESHA, GARDEN, today], /own time/);
ok('a child cannot log time for a sibling');
await fails('mustafa_phone', `insert into public.time_entries (household_id, member_id, chore_id, work_date, minutes) values ($1, $2, $3, ($4::date + 3), 30)`, [hh, MUSTAFA, GARDEN, today], /arrived/);
ok('a child cannot log a future day');
assert.equal((await as('ayesha_phone', `select count(*)::int n from public.time_entries`)).rows[0].n, 0);
ok('a sibling cannot see another child’s timesheet');
await as('mustafa_phone', `update public.time_entries set status = 'approved', minutes = 90 where id = $1`, [e1.id]);
let row = (await db.query(`select status, amount from public.time_entries where id = $1`, [e1.id])).rows[0];
assert.equal(row.status, 'submitted'); assert.equal(Number(row.amount), 12.98);
ok('a child can edit their pending time but cannot approve it');
await as('father', `update public.time_entries set status = 'approved' where id = $1`, [e1.id]);
row = (await db.query(`select status, reviewed_by from public.time_entries where id = $1`, [e1.id])).rows[0];
assert.equal(row.status, 'approved'); assert.ok(row.reviewed_by);
ok('a parent approves it and is recorded as the reviewer');
const upd = await as('mustafa_phone', `update public.time_entries set minutes = 600 where id = $1`, [e1.id]);
const del = await as('mustafa_phone', `delete from public.time_entries where id = $1`, [e1.id]);
assert.equal(upd.rowCount, 0); assert.equal(del.rowCount, 0);
ok('a child cannot change or delete approved time');
await as('mother', `update public.households set rate_mode = 'manual', manual_rate = 20 where id = $1`, [hh]);
row = (await db.query(`select amount from public.time_entries where id = $1`, [e1.id])).rows[0];
assert.equal(Number(row.amount), 12.98);
const e2 = (await as('mother', `insert into public.time_entries (household_id, member_id, chore_id, work_date, minutes, status) values ($1, $2, $3, $4, 30, 'approved') returning amount, status`, [hh, AYESHA, CAT, today])).rows[0];
assert.equal(Number(e2.amount), 10); assert.equal(e2.status, 'approved');
ok('changing the rate leaves logged pay alone; new time uses the new rate (30 min × 20 = 10.00)');

// ---------------------------------------------------------------- schedule
const thisWeek = (await db.query(`select (date_trunc('week', $1::date))::date::text w`, [today])).rows[0].w;
const dayIdx = (await db.query(`select (extract(isodow from $1::date)::int - 1) d`, [today])).rows[0].d;
await fails('mustafa_phone', `select public.claim_slot($1, ($2::date + 14), 0)`, [CAT, thisWeek], /not up yet/);
ok('children cannot pick from a week before its schedule goes up');
await as('mustafa_phone', `select public.claim_slot($1, $2, $3)`, [CAT, thisWeek, dayIdx]);
await fails('ayesha_phone', `select public.claim_slot($1, $2, $3)`, [CAT, thisWeek, dayIdx], /already took/);
ok('first child to tap gets the slot; the second is told it is taken');
await fails('ayesha_phone', `select public.drop_slot($1, $2, $3)`, [CAT, thisWeek, dayIdx], /not yours/);
await as('mustafa_phone', `select public.drop_slot($1, $2, $3)`, [CAT, thisWeek, dayIdx]);
await as('ayesha_phone', `select public.claim_slot($1, $2, $3)`, [CAT, thisWeek, dayIdx]);
ok('a child can drop their own pick, and then a sibling can take it');
await fails('mustafa_phone', `insert into public.schedule_slots (household_id, week_start, chore_id, day, kind, member_id) values ($1, $2, $3, $4, 'kid', $5)`, [hh, thisWeek, GARDEN, dayIdx, MUSTAFA], /row-level security/);
ok('a child cannot write the schedule directly');
await as('mother', `insert into public.schedule_slots (household_id, week_start, chore_id, day, kind, member_id) values ($1, $2, $3, $4, 'kid', $5)
  on conflict (chore_id, week_start, day) do update set kind = excluded.kind, member_id = excluded.member_id`, [hh, thisWeek, CAT, dayIdx, MUSTAFA]);
await fails('mustafa_phone', `select public.drop_slot($1, $2, $3)`, [CAT, thisWeek, dayIdx], /parent gave you/);
ok('a parent can override any slot, and a child cannot drop one a parent gave them');
await fails('mother', `insert into public.schedule_slots (household_id, week_start, chore_id, day, kind, member_id) values ($1, $2, $3, 1, 'kid', $4)`, [hh, thisWeek, GARDEN, (await as('mother', `select id from public.members where household_id = $1 and role = 'parent' limit 1`, [hh])).rows[0].id], /only be given to a child/);
ok('slots can only be given to children');

// ---------------------------------------------------------------- payments
const p = (await as('mother', `insert into public.payments (household_id, member_id, amount, method, confirmed_at) values ($1, $2, 10, 'Cash', now()) returning id, confirmed_at, paid_by`, [hh, MUSTAFA])).rows[0];
assert.equal(p.confirmed_at, null); assert.ok(p.paid_by);
ok('a parent records a payment; it starts unconfirmed whatever the client sends');
assert.equal((await as('ayesha_phone', `select count(*)::int n from public.payments`)).rows[0].n, 0);
await fails('ayesha_phone', `select public.confirm_payment($1)`, [p.id], /not yours/);
await as('mustafa_phone', `select public.confirm_payment($1)`, [p.id]);
assert.ok((await db.query(`select confirmed_at from public.payments where id = $1`, [p.id])).rows[0].confirmed_at);
ok('only the child who was paid can see and confirm it');
await fails('mustafa_phone', `insert into public.payments (household_id, member_id, amount) values ($1, $2, 1000)`, [hh, MUSTAFA], /row-level security/);
ok('a child cannot record payments');
assert.equal((await as('mother', `delete from public.payments where id = $1`, [p.id])).rowCount, 0);
ok('a confirmed payment cannot be deleted');

// ---------------------------------------------------------------- team chores
const team = (await as('mustafa_phone', `select public.log_team_time($1, $2, $3, 120, 'together', $4) t`, [hh, GARDEN, today, [MUSTAFA, AYESHA]])).rows[0].t;
let rows = (await db.query(`select member_id, amount, split, status, team_members from public.time_entries where team_id = $1 order by member_id`, [team])).rows;
assert.equal(rows.length, 2);
for (const r of rows) { assert.equal(Number(r.amount), 20); assert.equal(r.status, 'submitted'); assert.equal(r.team_members.length, 2); }
ok('two children log 2h of gardening together at 20/hr: 40.00 split into 20.00 each, both awaiting approval');
assert.equal((await as('ayesha_phone', `select count(*)::int n from public.time_entries where team_id = $1`, [team])).rows[0].n, 1);
ok('each child sees their own share of the team chore');
await fails('mustafa_phone', `insert into public.time_entries (household_id, member_id, chore_id, work_date, minutes, team_id, split) values ($1, $2, $3, $4, 30, gen_random_uuid(), 0.1)`, [hh, MUSTAFA, GARDEN, today], /team option/);
ok('a child cannot fake a team share by writing the entry directly');
await fails('ayesha_phone', `update public.time_entries set minutes = 600 where team_id = $1`, [team], /whole team/);
assert.equal((await as('ayesha_phone', `delete from public.time_entries where team_id = $1`, [team])).rowCount, 0);
ok('a teammate cannot change or delete just their own share');
await fails('ayesha_phone', `select public.update_team_time($1, $2, $3, 60, '')`, [team, GARDEN, today], /logged it/);
ok('only the child who logged it (or a parent) can change a team chore');
await as('mustafa_phone', `select public.update_team_time($1, $2, $3, 60, 'shorter')`, [team, GARDEN, today]);
rows = (await db.query(`select amount from public.time_entries where team_id = $1`, [team])).rows;
assert.ok(rows.every(r => Number(r.amount) === 10));
ok('changing the team chore to 1h updates everyone’s share (10.00 each)');
await fails('mustafa_phone', `select public.log_team_time($1, $2, $3, 60, '', $4)`, [hh, GARDEN, today, [MUSTAFA]], /2 to 8/);
await fails('outsider', `select public.log_team_time($1, $2, $3, 60, '', $4)`, [hh, GARDEN, today, [MUSTAFA, AYESHA]], /Not a member/);
ok('a team needs at least two children, and outsiders cannot log one');
await as('father', `update public.time_entries set status = 'approved' where team_id = $1`, [team]);
assert.ok((await db.query(`select bool_and(status = 'approved') ok from public.time_entries where team_id = $1`, [team])).rows[0].ok);
await fails('mustafa_phone', `select public.delete_team_time($1)`, [team], /Approved/);
ok('a parent approves the whole team at once; children cannot delete it after that');

// ---------------------------------------------------------------- performance bonus
const metrics = (await as('mother', `insert into public.bonus_metrics (household_id, name, max_percent, good_text, excelled_text) values
  ($1, 'School grades', 10, 'Mostly Bs', 'Mostly As'), ($1, 'Room tidy', 5, '', '') returning id, name`, [hh])).rows;
const GRADES = metrics.find(m => m.name === 'School grades').id, TIDY = metrics.find(m => m.name === 'Room tidy').id;
ok('a parent adds bonus metrics with a max %');
await fails('mustafa_phone', `insert into public.bonus_metrics (household_id, name, max_percent) values ($1, 'Free money', 100)`, [hh], /row-level security/);
ok('a child cannot add bonus metrics');
const weekBase = Number((await db.query(`select sum(amount) s from public.time_entries where member_id = $1 and status = 'approved' and work_date between $2::date and $2::date + 6`, [MUSTAFA, thisWeek])).rows[0].s);
const rv = (await as('mother', `insert into public.performance_reviews (household_id, member_id, week_start, ratings, bonus_amount, base_amount)
  values ($1, $2, $3, $4, 999, 999) returning base_amount, bonus_percent, bonus_amount, ratings`,
  [hh, MUSTAFA, thisWeek, JSON.stringify([{ metric_id: GRADES, tier: 'excelled' }, { metric_id: TIDY, tier: 'good' }])])).rows[0];
assert.equal(Number(rv.base_amount), weekBase); assert.equal(Number(rv.bonus_percent), 11.25);
assert.ok(Math.abs(Number(rv.bonus_amount) - weekBase * 0.1125) <= 0.006);
assert.equal(rv.ratings[0].name, 'School grades');
ok(`grades Excelled (10% of 10%) + tidy Good (25% of 5%) = 11.25% of ${weekBase.toFixed(2)} approved pay = ${Number(rv.bonus_amount).toFixed(2)}, worked out by the database`);
await fails('mother', `insert into public.performance_reviews (household_id, member_id, week_start, ratings) values ($1, $2, ($3::date + 7), $4)`, [hh, MUSTAFA, thisWeek, JSON.stringify([{ metric_id: GRADES, tier: 'amazing' }])], /Meets, Good or Excelled/);
await fails('mother', `insert into public.performance_reviews (household_id, member_id, week_start, ratings) values ($1, $2, ($3::date + 7), $4)`, [hh, MUSTAFA, thisWeek, JSON.stringify([{ metric_id: GRADES, tier: 'good' }, { metric_id: GRADES, tier: 'good' }])], /only be rated once/);
ok('ratings must be Meets, Good or Excelled, once per metric');
const meets = (await as('mother', `update public.performance_reviews set ratings = $1 where member_id = $2 and week_start = $3 returning bonus_amount`, [JSON.stringify([{ metric_id: GRADES, tier: 'meets' }]), MUSTAFA, thisWeek])).rows[0];
assert.equal(Number(meets.bonus_amount), 0);
ok('Meets earns 0% of the metric’s max');
assert.equal((await as('mustafa_phone', `select count(*)::int n from public.performance_reviews`)).rows[0].n, 1);
assert.equal((await as('ayesha_phone', `select count(*)::int n from public.performance_reviews`)).rows[0].n, 0);
await fails('mustafa_phone', `insert into public.performance_reviews (household_id, member_id, week_start, ratings) values ($1, $2, ($3::date + 14), '[]')`, [hh, MUSTAFA, thisWeek], /row-level security/);
ok('a child sees only their own bonus and cannot award one');

// ---------------------------------------------------------------- unlinked child-device logins
const stale = randomUUID(), fresh = randomUUID();
await db.query(`insert into auth.users (id, is_anonymous, created_at) values ($1, true, now() - interval '2 days'), ($2, true, now())`, [stale, fresh]);
await db.query(`update auth.users set created_at = now() - interval '30 days' where id in ($1, $2, $3)`, [users.mother.id, users.ayesha_phone.id, users.mustafa_phone.id]);
await fails('mother', `select public.cleanup_unlinked_child_logins()`, [], /permission denied/);
ok('the app’s users cannot run the clean-up');
const removed = (await db.query(`select public.cleanup_unlinked_child_logins() n`)).rows[0].n;
const left = (await db.query(`select id from auth.users where id = any($1)`, [[stale, fresh, users.mother.id, users.ayesha_phone.id, users.mustafa_phone.id]])).rows.map(r => r.id);
assert.equal(removed, 1); assert.ok(!left.includes(stale));
assert.ok(left.includes(fresh) && left.includes(users.mother.id) && left.includes(users.ayesha_phone.id) && left.includes(users.mustafa_phone.id));
ok('the clean-up deletes only day-old child-device logins never linked to a child; parents and linked devices stay');

// ---------------------------------------------------------------- contact messages
const submit = (who, email, topic, message, ip = null) => as(who, `select public.submit_contact_message($1, $2, $3, null, null, $4) id`, [email, topic, message, ip]);
for (const who of ['anon', 'mother', 'mustafa_phone']) {
  await fails(who, `select * from public.contact_messages`, [], /permission denied/);
  await fails(who, `insert into public.contact_messages (email, topic, message) values ('a@b.co', 'Other', 'hello there friend')`, [], /permission denied/);
  await fails(who, `select public.submit_contact_message('a@b.co', 'Other', 'hello there friend')`, [], /permission denied/);
}
ok('signed-out visitors, parents and children cannot read, write or call the contact table directly');
await fails('service', `select public.submit_contact_message($1, 'Support', 'long enough message')`, [''], /valid email/);
await fails('service', `select public.submit_contact_message($1, 'Support', 'long enough message')`, ['not-an-email'], /valid email/);
await fails('service', `select public.submit_contact_message('a@b.co', $1, 'long enough message')`, [null], /Choose a topic/);
await fails('service', `select public.submit_contact_message('a@b.co', $1, 'long enough message')`, ['Pizza'], /Choose a topic/);
await fails('service', `select public.submit_contact_message('a@b.co', 'Other', $1)`, [null], /10 to 5,000/);
await fails('service', `select public.submit_contact_message('a@b.co', 'Other', $1)`, ['too short'], /10 to 5,000/);
await fails('service', `select public.submit_contact_message('a@b.co', 'Other', $1)`, ['x'.repeat(5001)], /10 to 5,000/);
ok('missing or invalid email, topic and message are rejected (message 10–5,000 characters)');
for (let i = 0; i < 5; i++) await submit('service', 'Parent@Example.com', 'Support', `Message number ${i} please help`, 'ip-a');
await fails('service', `select public.submit_contact_message('parent@example.com', 'Support', 'sixth message this hour', null, null, 'ip-b')`, [], /Too many/);
ok('the 6th message from the same email within an hour is refused (case-insensitive)');
for (let i = 0; i < 5; i++) await submit('service', `kid${i}@example.com`, 'Feedback', 'Same network message', 'ip-c');
await fails('service', `select public.submit_contact_message('new@example.com', 'Feedback', 'from the same IP again', null, null, 'ip-c')`, [], /Too many/);
await submit('service', 'other@example.com', 'Other', 'A different person entirely', 'ip-d');
ok('the 6th message from the same IP within an hour is refused; other senders are not affected');
await db.query(`update public.contact_messages set created_at = now() - interval '61 minutes' where lower(email) = 'parent@example.com'`);
await submit('service', 'parent@example.com', 'Support', 'An hour later this works', 'ip-a');
ok('after an hour the sender can write again');
const saved = (await db.query(`select status, email, user_id from public.contact_messages where email = 'other@example.com'`)).rows[0];
assert.equal(saved.status, 'new'); assert.equal(saved.user_id, null);
ok('saved messages start with status "new"');

// ---------------------------------------------------------------- members
await fails('mother', `update public.members set role = 'child' where user_id = $1`, [users.mother.id], /own role/);
ok('a parent cannot demote themselves');
assert.equal((await as('mustafa_phone', `update public.members set display_name = 'Boss' where id = $1`, [MUSTAFA])).rowCount, 0);
ok('a child cannot edit family members');
await as('mother', `update public.members set user_id = null where id = $1`, [MUSTAFA]);
assert.equal((await as('mustafa_phone', `select count(*)::int n from public.chores`)).rows[0].n, 0);
ok('a parent can unlink a lost device, which then loses access');

console.log(`\n${passed} checks passed`);
db.on('error', () => {});
await db.end();
await admin.query(`drop database ${dbName} with (force)`);
await admin.end();
