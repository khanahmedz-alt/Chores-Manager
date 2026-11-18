import { useRef, useState, type FormEvent } from 'react';
import { supabase, errorText } from '../supabase';
import { LangToggle, Mark, Wave } from '../ui';
import { t } from '../i18n';

type Mode = 'signin' | 'signup' | 'child' | 'reset';

/* Bot trap for the forms that create something (a parent account, a child-device login, a reset email):
   two fields people never see or reach, which form-filling bots tend to fill in, and a minimum time a
   person needs to fill the form. Sign-in is left alone: it only works for existing accounts, and
   password managers fill it in instantly. This stops scripted form-fillers; Supabase's rate limits and
   the nightly clean-up of unlinked child-device logins cover anyone calling the API directly. */
const MIN_FILL_MS = 2500;
function Honeypot({ refs }: { refs: React.RefObject<HTMLInputElement | null>[] }) {
  const names = ['company_website', 'contact_fax'];
  return (
    <div className="hp" aria-hidden="true">
      {refs.map((r, i) => (
        <label key={names[i]}>{t('Leave this empty')}<input ref={r} type="text" name={names[i]} tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      ))}
    </div>
  );
}

/** Signed-out screen: parents sign in with email; children link their device with a code. */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const [canResend, setCanResend] = useState(false);
  const hp1 = useRef<HTMLInputElement>(null), hp2 = useRef<HTMLInputElement>(null);
  const shownAt = useRef(Date.now());
  const switchMode = (m: Mode) => { setMode(m); setMsg(null); shownAt.current = Date.now(); };
  /** True when the form looks bot-filled. Shows a gentle retry message instead of sending anything. */
  const trapped = () => {
    const filled = [hp1, hp2].some(r => (r.current?.value || '') !== '');
    const tooFast = Date.now() - shownAt.current < MIN_FILL_MS;
    if (!filled && !tooFast) return false;
    if (hp1.current) hp1.current.value = ''; if (hp2.current) hp2.current.value = '';
    shownAt.current = Date.now();
    setMsg({ kind: 'err', text: t('Something didn’t look right. Please check the details and try again.') });
    return true;
  };

  async function resend() {
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    setMsg(error ? { kind: 'err', text: errorText(error) } : { kind: 'ok', text: t('Sent again to {email}. Check the spam folder too.', { email: email.trim() }) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null); setCanResend(false);
    if (mode !== 'signin' && trapped()) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error(t('Use a password of at least 8 characters.'));
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) { setMsg({ kind: 'ok', text: t('We sent a link to {email}. Open it to confirm your email, then sign in.', { email: email.trim() }) }); setCanResend(true); }
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setMsg({ kind: 'ok', text: t('If {email} has an account, a reset link is on its way.', { email: email.trim() }) });
      } else {
        const c = code.replace(/\s+/g, '').toUpperCase();
        if (c.length < 6) throw new Error(t('Type the code a parent gave you.'));
        // Each child's device gets its own anonymous login, linked to their profile by the code.
        const { data: s } = await supabase.auth.getSession();
        if (!s.session) { const { error } = await supabase.auth.signInAnonymously(); if (error) throw error; }
        const { error } = await supabase.rpc('redeem_invite', { p_code: c });
        if (error) throw error;
        window.location.reload();
      }
    } catch (err) {
      const et = errorText(err);
      if (/email not confirmed/i.test(et)) { setMsg({ kind: 'err', text: t('Your email isn’t confirmed yet. Open the link we emailed you, or send it again.') }); setCanResend(true); return; }
      setMsg({ kind: 'err', text: /Anonymous sign-ins are disabled/i.test(et) ? t('Child devices are switched off for this app. The app owner needs to allow anonymous sign-ins in Supabase.') : et });
    } finally { setBusy(false); }
  }

  const tabs: [Mode, string][] = [['signin', 'Sign in'], ['signup', 'New family'], ['child', 'I’m a child']];
  return (
    <div className="auth">
      <div className="auth-top"><div className="wrap top-in"><div className="mark"><Mark /><div><b>{t('Chores Manager')}</b><span>{t('Family chores, hours & pay')}</span></div></div><LangToggle /></div></div>
      <main className="wrap auth-main">
        <section className="auth-card">
          <div className="seg auth-seg" role="tablist">
            {tabs.map(([m, l]) => <button key={m} role="tab" aria-pressed={mode === m || (m === 'signin' && mode === 'reset')} onClick={() => switchMode(m)}>{t(l)}</button>)}
          </div>
          <form onSubmit={submit} className="stack" style={{ gap: 14 }} noValidate>
            {mode === 'child' ? <>
              <div><h1>{t('Link this device')}</h1><p className="muted">{t('Ask a parent for your code. They make it on the Family page.')}</p></div>
              <label className="field"><span>{t('Your code')}</span>
                <input type="text" className="pin" value={code} onChange={e => setCode(e.target.value)} autoCapitalize="characters" autoComplete="one-time-code" maxLength={12} placeholder={t('ABCD2345')} /></label>
            </> : <>
              <div>
                <h1>{mode === 'signup' ? t('Start your family') : mode === 'reset' ? t('Reset your password') : t('Welcome back')}</h1>
                <p className="muted">{mode === 'signup' ? t('Create a parent account. You’ll add the children next.') : mode === 'reset' ? t('We’ll email you a link to set a new password.') : t('Parents sign in with their email.')}</p>
              </div>
              <label className="field"><span>{t('Email')}</span><input type="text" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
              {mode !== 'reset' && <label className="field"><span>{t('Password')}</span><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />{mode === 'signup' && <small>{t('At least 8 characters.')}</small>}</label>}
            </>}
            {mode !== 'signin' && <Honeypot refs={[hp1, hp2]} />}
            {msg && <p className={msg.kind === 'err' ? 'err' : 'okmsg'} role="alert">{msg.text}</p>}
            {canResend && email.trim() && <button type="button" className="btn ghost" onClick={resend} disabled={busy}>{t('Send the confirmation email again')}</button>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? t('Please wait…') : mode === 'signin' ? t('Sign in') : mode === 'signup' ? t('Create account') : mode === 'reset' ? t('Send reset link') : t('Link this device')}
            </button>
            {mode === 'signin' && <button type="button" className="link" onClick={() => switchMode('reset')}>{t('Forgot your password?')}</button>}
            {mode === 'reset' && <button type="button" className="link" onClick={() => switchMode('signin')}>{t('Back to sign in')}</button>}
          </form>
        </section>
      </main>
      <footer className="foot"><Wave /><div className="foot-bar"><div className="wrap foot-in"><span>{t('Track chores, hours and pocket money together.')}</span><span className="foot-right"><a className="foot-link" href="/contact">{t('Contact')}</a><span>v{__APP_VERSION__}</span></span></div></div></footer>
    </div>
  );
}

/** A password-recovery link opens the app signed in; let the parent choose a new password. */
export function NewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth"><main className="wrap auth-main"><section className="auth-card">
      <form className="stack" style={{ gap: 14 }} onSubmit={async e => {
        e.preventDefault(); setErr('');
        if (pw.length < 8) { setErr(t('Use at least 8 characters.')); return; }
        setBusy(true); const { error } = await supabase.auth.updateUser({ password: pw }); setBusy(false);
        if (error) setErr(errorText(error)); else onDone();
      }}>
        <h1>{t('Choose a new password')}</h1>
        <label className="field"><span>{t('New password')}</span><input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>{t('Save password')}</button>
      </form>
    </section></main></div>
  );
}
