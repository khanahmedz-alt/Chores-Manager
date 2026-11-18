// Tests the contact Edge Function's handler against a scratch Postgres database (same set-up as
// rls.test.mjs), with Resend replaced by a fake. Run with:
//   node --experimental-strip-types supabase/tests/contact.test.mjs
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { handleContact, DbError, EMAIL_FROM } from '../functions/contact/handler.ts';

const base = process.env.PGURL || 'postgres://postgres@127.0.0.1:54329/postgres';
const dbName = 'contact_test_' + Date.now();
const admin = new pg.Client({ connectionString: base }); await admin.connect();
await admin.query(`create database ${dbName}`);
const url = new URL(base); url.pathname = '/' + dbName;
const db = new pg.Client({ connectionString: url.toString() }); await db.connect();
const here = new URL('.', import.meta.url);
await db.query(readFileSync(new URL('supabase_stub.sql', here), 'utf8'));
for (const f of readdirSync(new URL('../migrations/', here)).filter(f => f.endsWith('.sql')).sort()) await db.query(readFileSync(new URL('../migrations/' + f, here), 'utf8'));

// A signed-in parent in a family, for the "who sent it" checks.
const PARENT = '9a9a9a9a-0000-4000-8000-000000000001', FAMILY = '9a9a9a9a-0000-4000-8000-0000000000f1';
await db.query(`insert into auth.users (id, email) values ($1, 'mum@example.com')`, [PARENT]);
await db.query(`insert into public.households (id, name) values ($1, 'Khan family')`, [FAMILY]);
await db.query(`select set_config('chores.trusted', 'on', false)`);
await db.query(`insert into public.members (household_id, user_id, display_name, role) values ($1, $2, 'Mother', 'parent')`, [FAMILY, PARENT]);

let sent = [], logs = [], failEmail = false, dbDown = false;
const deps = {
  async submit(m) {
    if (dbDown) throw new Error('connection refused');
    await db.query('begin'); await db.query('set local role service_role');
    try {
      const r = await db.query(`select public.submit_contact_message($1, $2, $3, $4, $5, $6) id`, [m.email, m.topic, m.message, m.userId, m.familyId, m.ipHash]);
      await db.query('commit'); return r.rows[0].id;
    } catch (e) { await db.query('rollback'); throw new DbError(e.message, e.hint || null); }
  },
  async getUser(token) { return token === 'parent-token' ? { id: PARENT } : null; },
  async familyFor(userId) { return (await db.query(`select household_id from public.members where user_id = $1`, [userId])).rows[0]?.household_id ?? null; },
  async sendEmail(e) { if (failEmail) throw new Error('Resend 403: domain not verified'); sent.push(e); },
  async markEmail(id, err) { await db.query(err ? `update public.contact_messages set email_error = $2 where id = $1` : `update public.contact_messages set email_sent_at = now() where id = $1`, err ? [id, err] : [id]); },
  async hashIp(ip) { return 'h:' + ip; },
  log: (m) => logs.push(m),
};
const call = (body, { ip = '203.0.113.7', token, method = 'POST' } = {}) => handleContact(new Request('https://x/functions/v1/contact', {
  method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip + ', 10.0.0.1', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: method === 'POST' ? JSON.stringify(body) : undefined,
}), deps);
const json = async r => ({ status: r.status, ...(await r.json()) });
const count = async (where = 'true', p = []) => Number((await db.query(`select count(*) n from public.contact_messages where ${where}`, p)).rows[0].n);
let passed = 0; const ok = l => { passed++; console.log('  ✓ ' + l); };
const good = { email: 'parent@example.com', topic: 'Support', message: 'The schedule does not show next week.' };

// Honeypot
let r = await json(await call({ ...good, website: 'http://spam.example' }));
assert.equal(r.status, 200); assert.equal(r.ok, true); assert.equal(await count(), 0); assert.equal(sent.length, 0);
ok('a filled honeypot gets a normal "success" reply, but nothing is saved or emailed');

// Missing and invalid fields
for (const [body, field] of [[{ ...good, email: '' }, 'email'], [{ ...good, email: 'no-at-sign' }, 'email'], [{ topic: 'Support', message: good.message }, 'email'],
  [{ ...good, topic: '' }, 'topic'], [{ ...good, topic: 'Pizza' }, 'topic'], [{ ...good, message: '' }, 'message'], [{ ...good, message: 'short' }, 'message'], [{ ...good, message: 'x'.repeat(5001) }, 'message']]) {
  r = await json(await call(body)); assert.equal(r.status, 400); assert.equal(r.field, field, JSON.stringify(body).slice(0, 60));
}
assert.equal(await count(), 0);
ok('missing or invalid email, topic or message is rejected with the field named, and nothing is saved');

// A good message
r = await json(await call(good));
assert.equal(r.status, 200); assert.equal(r.ok, true);
let row = (await db.query(`select * from public.contact_messages`)).rows[0];
assert.equal(row.email, good.email); assert.equal(row.topic, 'Support'); assert.equal(row.status, 'new'); assert.equal(row.user_id, null); assert.equal(row.ip_hash, 'h:203.0.113.7'); assert.ok(row.email_sent_at);
const e = sent[0];
assert.equal(e.from, EMAIL_FROM); assert.deepEqual(e.to, ['contact@mizala.ai']); assert.equal(e.reply_to, good.email); assert.equal(e.subject, '[Support] New contact message');
for (const part of [good.email, 'Support', good.message, 'not signed in']) assert.ok(e.text.includes(part), part);
assert.match(e.text, /Sent: \d{4}-\d{2}-\d{2}T/);
ok('a good message is saved (status "new", IP stored only as a hash) and emailed from noreply@mizala.ai to contact@mizala.ai, reply-to the sender, subject "[Support] New contact message"');

// Signed-in parent
r = await json(await call({ ...good, email: 'mum@example.com', topic: 'Billing' }, { token: 'parent-token', ip: '198.51.100.2' }));
row = (await db.query(`select user_id, family_id from public.contact_messages where email = 'mum@example.com'`)).rows[0];
assert.equal(row.user_id, PARENT); assert.equal(row.family_id, FAMILY);
assert.ok(sent[1].text.includes(PARENT) && sent[1].text.includes(FAMILY));
r = await json(await call({ ...good, email: 'guest@example.com' }, { token: 'the-anon-key', ip: '198.51.100.3' }));
assert.equal(r.status, 200); assert.equal((await db.query(`select user_id from public.contact_messages where email = 'guest@example.com'`)).rows[0].user_id, null);
ok('a signed-in parent’s user and family IDs are saved and in the email; the anon key counts as signed out');

// HTML is escaped
r = await json(await call({ ...good, email: 'x@example.com', message: '<script>alert(1)</script> please help' }, { ip: '198.51.100.4' }));
assert.ok(!sent.at(-1).html.includes('<script>') && sent.at(-1).html.includes('&lt;script&gt;'));
ok('message text is escaped in the HTML email');

// Email failure
failEmail = true; logs = [];
r = await json(await call({ ...good, email: 'when-email-fails@example.com' }, { ip: '198.51.100.5' }));
assert.equal(r.status, 200); assert.equal(r.ok, true);
row = (await db.query(`select email_sent_at, email_error from public.contact_messages where email = 'when-email-fails@example.com'`)).rows[0];
assert.equal(row.email_sent_at, null); assert.match(row.email_error, /domain not verified/); assert.ok(logs.some(l => /email to the team failed/.test(l)));
failEmail = false;
ok('if the email fails, the visitor still sees success, the message stays saved and the error is logged and recorded');

// Rate limit: 5 per email per hour, and 5 per IP per hour
for (let i = 0; i < 4; i++) assert.equal((await call({ ...good, message: `Follow-up number ${i} for you` }, { ip: `192.0.2.${i}` })).status, 200);
r = await json(await call({ ...good, message: 'This is the sixth one' }, { ip: '192.0.2.99' }));
assert.equal(r.status, 429); assert.equal(r.error, 'rate_limited');
for (let i = 0; i < 5; i++) assert.equal((await call({ ...good, email: `sib${i}@example.com` }, { ip: '192.0.2.200' })).status, 200);
r = await json(await call({ ...good, email: 'sib9@example.com' }, { ip: '192.0.2.200' }));
assert.equal(r.status, 429);
ok('the 6th message in an hour from the same email, or from the same IP, gets a 429 "rate_limited"');

// Server problems, methods, CORS
dbDown = true; r = await json(await call({ ...good, email: 'down@example.com' }, { ip: '192.0.2.250' })); dbDown = false;
assert.equal(r.status, 500); assert.equal(r.error, 'server');
ok('if the message cannot be saved, the visitor gets an error (not a false success)');
const opt = await call(null, { method: 'OPTIONS' });
assert.equal(opt.status, 200); assert.equal(opt.headers.get('access-control-allow-origin'), '*');
for (const h of ['authorization', 'x-client-info', 'apikey', 'content-type', 'x-region', 'traceparent']) assert.ok(opt.headers.get('access-control-allow-headers').includes(h), h);
assert.equal((await call(null, { method: 'GET' })).status, 405);
ok('browser pre-flight (CORS) is answered; methods other than POST are refused');

console.log(`\n${passed} contact checks passed`);
db.on('error', () => {}); await db.end();
await admin.query(`drop database ${dbName} with (force)`); await admin.end();
