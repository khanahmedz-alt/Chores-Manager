import { useState } from 'react';
import { supabase, errorText } from '../supabase';
import { Mark } from '../ui';

const CURRENCIES = ['SAR', '£', '$', '€', 'AED', ''];

/** A signed-in parent who isn't in a family yet: start one, or join with a code from the other parent. */
export function Onboarding({ onReady, onSignOut }: { onReady: (householdId: string) => void; onSignOut: () => void }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [family, setFamily] = useState('');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(tz === 'Asia/Riyadh' ? 'SAR' : tz.startsWith('Europe/London') ? '£' : '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!name.trim()) { setErr('Add the name the children know you by, e.g. Mum or Father.'); return; }
    setBusy(true);
    try {
      if (mode === 'create') {
        if (!family.trim()) throw new Error('Give your family a name.');
        const { data, error } = await supabase.rpc('create_household', { p_name: family.trim(), p_display_name: name.trim(), p_currency: currency, p_timezone: tz });
        if (error) throw error;
        onReady(data as string);
      } else {
        const { data: memberId, error } = await supabase.rpc('redeem_invite', { p_code: code.replace(/\s+/g, '').toUpperCase(), p_display_name: name.trim() });
        if (error) throw error;
        const { data: row, error: e2 } = await supabase.from('members').select('household_id').eq('id', memberId as string).single();
        if (e2) throw e2;
        onReady(row.household_id as string);
      }
    } catch (e2) { setErr(errorText(e2)); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-top"><div className="wrap top-in"><div className="mark"><Mark /><div><b>Chores Manager</b><span>Set up your family</span></div></div>
        <button className="me" onClick={onSignOut}><span>Sign out</span></button></div></div>
      <main className="wrap auth-main">
        <section className="auth-card">
          <div className="seg auth-seg">
            <button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Start a family</button>
            <button aria-pressed={mode === 'join'} onClick={() => setMode('join')}>Join with a code</button>
          </div>
          <form className="stack" style={{ gap: 14 }} onSubmit={go} noValidate>
            <div><h1>{mode === 'create' ? 'Start your family' : 'Join your family'}</h1>
              <p className="muted">{mode === 'create' ? 'You’ll be the first parent. You can invite the other parent and add the children next.' : 'Use the parent invite code from the other parent’s Family page.'}</p></div>
            {mode === 'create' && <label className="field"><span>Family name</span><input type="text" value={family} onChange={e => setFamily(e.target.value)} placeholder="e.g. The Khan family" maxLength={80} /></label>}
            {mode === 'join' && <label className="field"><span>Parent invite code</span><input type="text" className="pin" value={code} onChange={e => setCode(e.target.value)} maxLength={12} /></label>}
            <label className="field"><span>Your name in the app</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mother" maxLength={40} /></label>
            {mode === 'create' && <div className="row2">
              <label className="field"><span>Currency</span><select value={currency} onChange={e => setCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c} value={c}>{c || 'No symbol'}</option>)}</select></label>
              <label className="field"><span>Time zone</span><input type="text" value={tz} readOnly aria-describedby="tzhelp" /><small id="tzhelp">From this device. Change it later in Settings.</small></label>
            </div>}
            {err && <p className="err" role="alert">{err}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'create' ? 'Create family' : 'Join family'}</button>
          </form>
        </section>
      </main>
    </div>
  );
}
