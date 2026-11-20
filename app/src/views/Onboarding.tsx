import { useState } from 'react';
import { supabase, errorText } from '../supabase';
import { LangToggle, Mark, Wave } from '../ui';
import { t, lang, setLang, type Lang } from '../i18n';
import { COUNTRIES, countryName, guessCountry, weekStartFor } from '../lib/util';

const CURRENCIES = ['SAR', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'EGP', '£', '€', '$', 'CA$', 'A$', 'Rs', '₹', 'RM', ''];

/** A signed-in parent who isn't in a family yet: start one, or join with a code from the other parent. */
export function Onboarding({ onReady, onSignOut }: { onReady: (householdId: string) => void; onSignOut: () => void }) {
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const guessed = guessCountry();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [family, setFamily] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState(guessed);
  const [currency, setCurrency] = useState(COUNTRIES.find(c => c.code === guessed)?.currency || '');
  const [tz, setTz] = useState(COUNTRIES.find(c => c.code === guessed)?.tz || deviceTz);
  const pickCountry = (code: string) => {
    setCountry(code);
    const c = COUNTRIES.find(x => x.code === code);
    setCurrency(c ? c.currency : currency); setTz(c ? c.tz : deviceTz);
  };
  // Country names in the current language, sorted for the reader.
  const countryOptions = COUNTRIES.map(c => ({ code: c.code, label: countryName(c.code) })).sort((a, b) => a.label.localeCompare(b.label, lang()));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!name.trim()) { setErr(t('Add the name the children know you by, e.g. Mum or Father.')); return; }
    setBusy(true);
    try {
      if (mode === 'create') {
        if (!family.trim()) throw new Error(t('Give your family a name.'));
        if (!country) throw new Error(t('Choose your country.'));
        const { data, error } = await supabase.rpc('create_household', { p_name: family.trim(), p_display_name: name.trim(), p_currency: currency, p_timezone: tz });
        if (error) throw error;
        await supabase.from('households').update({ country }).eq('id', data as string);
        if (weekStartFor(country)) await supabase.from('households').update({ week_start_dow: weekStartFor(country) }).eq('id', data as string);
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
      <div className="auth-top"><div className="wrap top-in"><div className="mark"><Mark /><div><b>{t('Chores Manager')}</b><span>{t('Set up your family')}</span></div></div>
        <div className="top-actions"><LangToggle /><button className="me" onClick={onSignOut}><span>{t('Sign out')}</span></button></div></div></div>
      <main className="wrap auth-main">
        <section className="auth-card">
          <div className="seg auth-seg">
            <button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>{t('Start a family')}</button>
            <button aria-pressed={mode === 'join'} onClick={() => setMode('join')}>{t('Join with a code')}</button>
          </div>
          <form className="stack" style={{ gap: 14 }} onSubmit={go} noValidate>
            <div><h1>{mode === 'create' ? t('Start your family') : t('Join your family')}</h1>
              <p className="muted">{mode === 'create' ? t('You’ll be the first parent. You can invite the other parent and add the children next.') : t('Use the parent invite code from the other parent’s Family page.')}</p></div>
            {mode === 'create' && <label className="field"><span>{t('Family name')}</span><input type="text" value={family} onChange={e => setFamily(e.target.value)} placeholder={t('e.g. The Khan family')} maxLength={80} /></label>}
            {mode === 'join' && <label className="field"><span>{t('Parent invite code')}</span><input type="text" className="pin" value={code} onChange={e => setCode(e.target.value)} maxLength={12} /></label>}
            <label className="field"><span>{t('Your name in the app')}</span><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('e.g. Mother')} maxLength={40} /></label>
            <div className="row2">
              {mode === 'create' && <label className="field"><span>{t('Country')}</span>
                <select id="ob-country" value={country} onChange={e => pickCountry(e.target.value)}>
                  <option value="" disabled>{t('Choose your country')}</option>
                  {countryOptions.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  <option value="ZZ">{t('Other')}</option>
                </select></label>}
              <label className="field"><span>{t('Language')}</span>
                <select id="ob-lang" value={lang()} onChange={e => setLang(e.target.value as Lang)}>
                  <option value="en">English</option><option value="ar">العربية</option>
                </select></label>
            </div>
            {mode === 'create' && <div className="row2">
              <label className="field"><span>{t('Currency')}</span><select value={currency} onChange={e => setCurrency(e.target.value)}>{(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map(c => <option key={c} value={c}>{c || t('No symbol')}</option>)}</select></label>
              <label className="field"><span>{t('Time zone')}</span><input type="text" value={tz} readOnly aria-describedby="tzhelp" /><small id="tzhelp">{t('Set from your country. Change it later in Settings.')}</small></label>
            </div>}
            {err && <p className="err" role="alert">{err}</p>}
            <button className="btn primary" disabled={busy}>{busy ? t('Please wait…') : mode === 'create' ? t('Create family') : t('Join family')}</button>
          </form>
        </section>
      </main>
      <footer className="foot"><Wave /><div className="foot-bar"><div className="wrap foot-in"><span>{t('Track chores, hours and pocket money together.')}</span><span className="foot-right"><a className="foot-link" href="/contact">{t('Contact')}</a><span>v{__APP_VERSION__}</span></span></div></div></footer>
    </div>
  );
}
