import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { LangToggle, Mark, Wave } from '../ui';
import { t } from '../i18n';

// Topic values are stored and emailed in English; the labels are translated.
const TOPICS = ['Support', 'Billing', 'Feedback', 'Privacy / Data request', 'Other'] as const;
const MIN = 10, MAX = 5000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isContactPath = () => window.location.pathname.replace(/\/+$/, '') === '/contact';

/** /contact — open to everyone, signed in or not. Sends through the "contact" Edge Function. */
export function Contact({ signedInEmail }: { signedInEmail?: string | null }) {
  const [email, setEmail] = useState(signedInEmail || '');
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<{ email?: string; topic?: string; message?: string }>({});
  const [formError, setFormError] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const emailTouched = useRef(false);
  const hp = useRef<HTMLInputElement>(null);

  // A signed-in parent's email arrives once the session has loaded; fill it in unless they've typed.
  useEffect(() => { if (signedInEmail && !emailTouched.current) setEmail(signedInEmail); }, [signedInEmail]);

  const len = message.trim().length;
  function check() {
    const e: typeof errors = {};
    if (!EMAIL_RE.test(email.trim()) || email.trim().length > 254) e.email = t('Enter a valid email address, e.g. name@example.com.');
    if (!topic) e.topic = t('Choose a topic.');
    if (len < MIN) e.message = t('Write at least {n} characters.', { n: MIN });
    else if (len > MAX) e.message = t('Keep it under {n} characters.', { n: MAX.toLocaleString('en-GB') });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault(); setFormError('');
    if (!check()) return;
    setSending(true);
    try {
      // TODO(captcha): when CAPTCHA is added, render the widget above the button and send its token as `captchaToken`.
      const { error } = await supabase.functions.invoke('contact', {
        body: { email: email.trim(), topic, message: message.trim(), website: hp.current?.value || '' },
      });
      if (!error) { setDone(true); return; }
      let code = 'server', field: string | undefined;
      if (error instanceof FunctionsHttpError) {
        try { const b = await error.context.json(); code = b.error || code; field = b.field; } catch { /* not JSON */ }
      } else if (error instanceof FunctionsFetchError) code = 'network';
      if (code === 'invalid' && (field === 'email' || field === 'topic' || field === 'message')) { check(); setFormError(t('Please check the highlighted field.')); }
      else if (code === 'rate_limited') setFormError(t('You’ve sent a few messages in the last hour. Please try again a little later.'));
      else if (code === 'network') setFormError(t('No connection. Check the internet and try again.'));
      else setFormError(t('We couldn’t send your message just now. Please try again in a few minutes, or email contact@mizala.ai.'));
    } catch {
      setFormError(t('No connection. Check the internet and try again.'));
    } finally { setSending(false); }
  }

  const reset = () => { setDone(false); setTopic(''); setMessage(''); setErrors({}); setFormError(''); };

  return (
    <div className="auth contact">
      <div className="auth-top"><div className="wrap top-in">
        <a className="mark mark-link" href="/"><Mark /><div><b>{t('Chores Manager')}</b><span>{t('Contact us')}</span></div></a>
        <LangToggle />
      </div></div>
      <main className="wrap auth-main">
        <section className="auth-card contact-card">
          {done ? (
            <div className="stack contact-done" style={{ gap: 14 }} role="status">
              <div className="done-badge" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#04281a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg></div>
              <h1>{t('Thanks, we’ll reply by email')}</h1>
              <p className="muted">{t('We’ve got your message and will answer at {email}.', { email: email.trim() })}</p>
              <div className="sheet-actions" style={{ justifyContent: 'flex-start' }}>
                <a className="btn primary" href="/">{t('Back to the app')}</a>
                <button type="button" className="btn ghost" onClick={reset}>{t('Send another message')}</button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="stack" style={{ gap: 16 }} noValidate>
              <div><h1>{t('Contact us')}</h1><p className="muted">{t('Questions, problems or ideas? Send us a message and we’ll reply by email.')}</p></div>
              <label className="field"><span>{t('Email')}</span>
                <input id="contact-email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={email}
                  aria-invalid={!!errors.email} aria-describedby={errors.email ? 'contact-email-err' : undefined}
                  onChange={e => { emailTouched.current = true; setEmail(e.target.value); }} />
                {errors.email && <small className="err" id="contact-email-err">{errors.email}</small>}
              </label>
              <label className="field"><span>{t('Topic')}</span>
                <select id="contact-topic" value={topic} aria-invalid={!!errors.topic} onChange={e => setTopic(e.target.value)}>
                  <option value="" disabled>{t('Choose a topic')}</option>
                  {TOPICS.map(x => <option key={x} value={x}>{t(x)}</option>)}
                </select>
                {errors.topic && <small className="err">{errors.topic}</small>}
              </label>
              <label className="field"><span>{t('Message')}</span>
                <textarea id="contact-message" rows={7} maxLength={MAX + 200} value={message} aria-invalid={!!errors.message}
                  aria-describedby="contact-count" onChange={e => setMessage(e.target.value)} placeholder={t('How can we help?')} />
                <span className="contact-meta">
                  {errors.message ? <small className="err">{errors.message}</small> : <small>{t('At least {n} characters.', { n: MIN })}</small>}
                  <small id="contact-count" className={`num ${len > MAX ? 'err' : ''}`}>{len.toLocaleString('en-GB')} / {MAX.toLocaleString('en-GB')}</small>
                </span>
              </label>
              {/* Honeypot: hidden from people; bots that fill it are silently dropped by the server. */}
              <div className="hp" aria-hidden="true"><label>{t('Leave this empty')}<input ref={hp} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label></div>
              {formError && <p className="err" role="alert">{formError}</p>}
              <button className="btn primary contact-send" type="submit" disabled={sending}>{sending ? t('Sending…') : t('Send message')}</button>
              <p className="cap">{t('We only use your email to reply to you.')} <a href="/">{t('Back to the app')}</a></p>
            </form>
          )}
        </section>
      </main>
      <footer className="foot"><Wave /><div className="foot-bar"><div className="wrap foot-in"><span>{t('Track chores, hours and pocket money together.')}</span><span>v{__APP_VERSION__}</span></div></div></footer>
    </div>
  );
}
