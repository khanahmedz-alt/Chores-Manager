// ONE-FILE VERSION of the "contact" Edge Function, for pasting into the Supabase dashboard
// (Edge Functions → Deploy a new function → Via Editor). It is contact/handler.ts + contact/index.ts
// joined together; regenerate it with:  node scripts/bundle-contact.mjs
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

// ---------- handler.ts ----------
// Contact form handler, kept free of Deno- and Supabase-specific code so it can be tested in Node.
// index.ts wires it to Supabase (database, auth) and Resend (email).

export const TOPICS = ['Support', 'Billing', 'Feedback', 'Privacy / Data request', 'Other'] as const;
export type Topic = (typeof TOPICS)[number];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 5000;

export interface ContactInput { email: string; topic: Topic; message: string }
export interface Sender { userId: string | null; familyId: string | null }

export interface Deps {
  /** Saves the message (with validation and the rate limit in the database). Throws a DbError on failure. */
  submit(input: ContactInput & Sender & { ipHash: string | null }): Promise<string>;
  /** The signed-in user for a bearer token, or null for the anon key / no token / invalid token. */
  getUser(token: string): Promise<{ id: string } | null>;
  /** The user's family, if they are in one. */
  familyFor(userId: string): Promise<string | null>;
  /** Sends the notification email. Throws on failure. */
  sendEmail(email: OutgoingEmail): Promise<void>;
  /** Records whether the email went out (error = null means sent). */
  markEmail(id: string, error: string | null): Promise<void>;
  /** Salted hash of the caller's IP, for the rate limit. */
  hashIp(ip: string): Promise<string>;
  /** TODO(captcha): verify a CAPTCHA token here (e.g. Cloudflare Turnstile or hCaptcha) and return false to reject. */
  verifyCaptcha?(token: string | null, ip: string | null): Promise<boolean>;
  allowedOrigins?: string[];
  log?: (msg: string, extra?: unknown) => void;
}

export class DbError extends Error {
  hint: string | null;
  constructor(message: string, hint: string | null) { super(message); this.hint = hint; }
}

export interface OutgoingEmail { from: string; to: string[]; reply_to: string; subject: string; text: string; html: string }

export const EMAIL_FROM = 'Mizala Contact <noreply@mizala.ai>';
export const EMAIL_TO = 'contact@mizala.ai';

/** Checks the fields. Returns the cleaned input, or the first field that is wrong. */
export function validate(body: unknown): { ok: true; value: ContactInput } | { ok: false; field: 'email' | 'topic' | 'message' } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  const topic = typeof b.topic === 'string' ? b.topic : '';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (email.length < 3 || email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, field: 'email' };
  if (!(TOPICS as readonly string[]).includes(topic)) return { ok: false, field: 'topic' };
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) return { ok: false, field: 'message' };
  return { ok: true, value: { email, topic: topic as Topic, message } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function buildEmail(m: ContactInput & Sender & { id: string; createdAt: string }, to = EMAIL_TO): OutgoingEmail {
  const rows: [string, string][] = [
    ['From', m.email],
    ['Topic', m.topic],
    ['Sent', m.createdAt],
    ['User ID', m.userId || 'not signed in'],
    ['Family ID', m.familyId || '—'],
    ['Message ID', m.id],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${m.message}\n`;
  const html = `<table style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;border-collapse:collapse">`
    + rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#35495e"><b>${esc(k)}</b></td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')
    + `</table><div style="margin-top:16px;padding:12px 14px;border-left:4px solid #41b883;background:#f2f2f2;font-family:Segoe UI,Arial,sans-serif;font-size:15px;white-space:pre-wrap">${esc(m.message)}</div>`;
  return { from: EMAIL_FROM, to: [to], reply_to: m.email, subject: `[${m.topic}] New contact message`, text, html };
}

function cors(req: Request, allowed?: string[]): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = !allowed || allowed.length === 0 || allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '').trim();
  return ip || null;
}

export async function handleContact(req: Request, deps: Deps): Promise<Response> {
  const headers = { ...cors(req, deps.allowedOrigins), 'Content-Type': 'application/json' };
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
  const log = deps.log || ((msg: string, extra?: unknown) => console.error(msg, extra ?? ''));

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: 'invalid', field: 'body' }); }

  // Honeypot: a field people never see. Anything in it means a bot; pretend it worked and drop it.
  const trap = [body.website, body.company_website].find(v => typeof v === 'string' && v.trim() !== '');
  if (trap) { log('contact: honeypot filled, dropped'); return reply(200, { ok: true }); }

  const ip = clientIp(req);
  if (deps.verifyCaptcha && !(await deps.verifyCaptcha(typeof body.captchaToken === 'string' ? body.captchaToken : null, ip))) {
    return reply(400, { ok: false, error: 'captcha' });
  }

  const v = validate(body);
  if (!v.ok) return reply(400, { ok: false, error: 'invalid', field: v.field });

  // Who is sending, if anyone is signed in. The anon key and bad tokens simply read as "not signed in".
  let userId: string | null = null, familyId: string | null = null;
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      const u = await deps.getUser(token);
      if (u) { userId = u.id; familyId = await deps.familyFor(u.id); }
    } catch (e) { log('contact: could not read the signed-in user', e); }
  }

  let id: string;
  try {
    id = await deps.submit({ ...v.value, userId, familyId, ipHash: ip ? await deps.hashIp(ip) : null });
  } catch (e) {
    const hint = e instanceof DbError ? e.hint : null;
    if (hint === 'rate_limited') return reply(429, { ok: false, error: 'rate_limited' });
    if (hint && hint.startsWith('invalid_')) return reply(400, { ok: false, error: 'invalid', field: hint.slice(8) });
    log('contact: could not save the message', e);
    return reply(500, { ok: false, error: 'server' });
  }

  // The message is saved. If the email fails we log it and keep going: the team can still see it in the table.
  try {
    await deps.sendEmail(buildEmail({ ...v.value, userId, familyId, id, createdAt: new Date().toISOString() }));
    await deps.markEmail(id, null);
  } catch (e) {
    log('contact: email to the team failed; the message is saved', e);
    try { await deps.markEmail(id, String((e as Error)?.message || e).slice(0, 500)); } catch (e2) { log('contact: could not record the email failure', e2); }
  }
  return reply(200, { ok: true });
}

// ---------- index.ts ----------
// Supabase Edge Function: contact
// Saves a Contact-page message to public.contact_messages and emails the team through Resend.
//
// Secrets (Supabase → Edge Functions → Secrets, or `supabase secrets set`):
//   RESEND_API_KEY       required to send the email. Never sent to the browser.
//   CONTACT_IP_SALT      recommended: any long random string, used to hash IPs for the rate limit.
//   CONTACT_TO           optional: where to send messages (default contact@mizala.ai).
//   ALLOWED_ORIGINS      optional: comma-separated site addresses allowed to call this function
//                        (default: any origin).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
// Deploy with JWT checking off, because signed-out visitors use the form too:
//   supabase functions deploy contact --no-verify-jwt

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const resendKey = Deno.env.get('RESEND_API_KEY') || '';
const salt = Deno.env.get('CONTACT_IP_SALT') || serviceKey.slice(-16);
const to = Deno.env.get('CONTACT_TO') || EMAIL_TO;
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(req => handleContact(req, {
  allowedOrigins,
  async submit(m) {
    const { data, error } = await admin.rpc('submit_contact_message', {
      p_email: m.email, p_topic: m.topic, p_message: m.message,
      p_user_id: m.userId, p_family_id: m.familyId, p_ip_hash: m.ipHash,
    });
    if (error) throw new DbError(error.message, error.hint || null);
    return data as string;
  },
  async getUser(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data?.user ? null : { id: data.user.id };
  },
  async familyFor(userId) {
    const { data } = await admin.from('members').select('household_id').eq('user_id', userId).eq('active', true).order('created_at').limit(1);
    return data?.[0]?.household_id ?? null;
  },
  async sendEmail(email: OutgoingEmail) {
    if (!resendKey) throw new Error('RESEND_API_KEY is not set');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...email, to: [to] }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  },
  async markEmail(id, err) {
    const { error } = await admin.from('contact_messages')
      .update(err ? { email_error: err } : { email_sent_at: new Date().toISOString(), email_error: null }).eq('id', id);
    if (error) throw error;
  },
  hashIp: ip => sha256(salt + ':' + ip),
  // TODO(captcha): to add CAPTCHA later, verify the token from the form here, e.g. Cloudflare Turnstile:
  //   const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
  //     body: new URLSearchParams({ secret: Deno.env.get('TURNSTILE_SECRET')!, response: token ?? '', remoteip: ip ?? '' }) });
  //   return (await r.json()).success === true;
  async verifyCaptcha() { return true; },
}));
