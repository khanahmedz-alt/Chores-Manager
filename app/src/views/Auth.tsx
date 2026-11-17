import { useState, type FormEvent } from 'react';
import { supabase, errorText } from '../supabase';
import { Mark, Wave } from '../ui';

type Mode = 'signin' | 'signup' | 'child' | 'reset';

/** Signed-out screen: parents sign in with email; children link their device with a code. */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const [canResend, setCanResend] = useState(false);

  async function resend() {
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    setMsg(error ? { kind: 'err', text: errorText(error) } : { kind: 'ok', text: `Sent again to ${email.trim()}. Check the spam folder too.` });
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null); setCanResend(false); setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) { setMsg({ kind: 'ok', text: `We sent a link to ${email.trim()}. Open it to confirm your email, then sign in.` }); setCanResend(true); }
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setMsg({ kind: 'ok', text: `If ${email.trim()} has an account, a reset link is on its way.` });
      } else {
        const c = code.replace(/\s+/g, '').toUpperCase();
        if (c.length < 6) throw new Error('Type the code a parent gave you.');
        // Each child's device gets its own anonymous login, linked to their profile by the code.
        const { data: s } = await supabase.auth.getSession();
        if (!s.session) { const { error } = await supabase.auth.signInAnonymously(); if (error) throw error; }
        const { error } = await supabase.rpc('redeem_invite', { p_code: c });
        if (error) throw error;
        window.location.reload();
      }
    } catch (err) {
      const t = errorText(err);
      if (/email not confirmed/i.test(t)) { setMsg({ kind: 'err', text: 'Your email isn’t confirmed yet. Open the link we emailed you, or send it again.' }); setCanResend(true); return; }
      setMsg({ kind: 'err', text: /Anonymous sign-ins are disabled/i.test(t) ? 'Child devices are switched off for this app. The app owner needs to allow anonymous sign-ins in Supabase.' : t });
    } finally { setBusy(false); }
  }

  const tabs: [Mode, string][] = [['signin', 'Sign in'], ['signup', 'New family'], ['child', 'I’m a child']];
  return (
    <div className="auth">
      <div className="auth-top"><div className="wrap top-in"><div className="mark"><Mark /><div><b>Chores Manager</b><span>Family chores, hours &amp; pay</span></div></div></div></div>
      <main className="wrap auth-main">
        <section className="auth-card">
          <div className="seg auth-seg" role="tablist">
            {tabs.map(([m, l]) => <button key={m} role="tab" aria-pressed={mode === m || (m === 'signin' && mode === 'reset')} onClick={() => { setMode(m); setMsg(null); }}>{l}</button>)}
          </div>
          <form onSubmit={submit} className="stack" style={{ gap: 14 }} noValidate>
            {mode === 'child' ? <>
              <div><h1>Link this device</h1><p className="muted">Ask a parent for your code. They make it on the Family page.</p></div>
              <label className="field"><span>Your code</span>
                <input type="text" className="pin" value={code} onChange={e => setCode(e.target.value)} autoCapitalize="characters" autoComplete="one-time-code" maxLength={12} placeholder="ABCD2345" /></label>
            </> : <>
              <div>
                <h1>{mode === 'signup' ? 'Start your family' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}</h1>
                <p className="muted">{mode === 'signup' ? 'Create a parent account. You’ll add the children next.' : mode === 'reset' ? 'We’ll email you a link to set a new password.' : 'Parents sign in with their email.'}</p>
              </div>
              <label className="field"><span>Email</span><input type="text" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
              {mode !== 'reset' && <label className="field"><span>Password</span><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />{mode === 'signup' && <small>At least 8 characters.</small>}</label>}
            </>}
            {msg && <p className={msg.kind === 'err' ? 'err' : 'okmsg'} role="alert">{msg.text}</p>}
            {canResend && email.trim() && <button type="button" className="btn ghost" onClick={resend} disabled={busy}>Send the confirmation email again</button>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Link this device'}
            </button>
            {mode === 'signin' && <button type="button" className="link" onClick={() => { setMode('reset'); setMsg(null); }}>Forgot your password?</button>}
            {mode === 'reset' && <button type="button" className="link" onClick={() => { setMode('signin'); setMsg(null); }}>Back to sign in</button>}
          </form>
        </section>
      </main>
      <footer className="foot"><Wave /><div className="foot-bar"><div className="wrap foot-in"><span>Track chores, hours and pocket money together.</span></div></div></footer>
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
        if (pw.length < 8) { setErr('Use at least 8 characters.'); return; }
        setBusy(true); const { error } = await supabase.auth.updateUser({ password: pw }); setBusy(false);
        if (error) setErr(errorText(error)); else onDone();
      }}>
        <h1>Choose a new password</h1>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>Save password</button>
      </form>
    </section></main></div>
  );
}
