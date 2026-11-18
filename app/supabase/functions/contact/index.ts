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
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { DbError, EMAIL_TO, handleContact, type OutgoingEmail } from './handler.ts';

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
