import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured, errorText } from './supabase';
import { FamilyProvider, useFamily } from './data';
import { Avatar, Confirm, LangToggle, Mark, Wave } from './ui';
import { AuthScreen, NewPassword } from './views/Auth';
import { Onboarding } from './views/Onboarding';
import { MyWeek, Timesheets } from './views/Timesheet';
import { Approvals } from './views/Approvals';
import { Schedule } from './views/Schedule';
import { Balances } from './views/Balances';
import { Family } from './views/Family';
import { Remuneration } from './views/Remuneration';
import { Contact, isContactPath } from './views/Contact';
import { addDays, isOpen, kidLoad, openSlots, weekOf } from './lib/util';
import { t, locale, useLang } from './i18n';

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

interface Membership { household_id: string; role: string; households: { name: string } | null }

export default function App() {
  useLang(); // re-render everything when the language changes
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [hh, setHh] = useState<string | null>(lsGet('cm-household'));
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    if (!configured) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const loadMemberships = async () => {
    if (!uid) return;
    setLoadErr('');
    const { data, error } = await supabase.from('members').select('household_id, role, households(name)').eq('user_id', uid).eq('active', true);
    if (error) { setLoadErr(errorText(error)); return; }
    setMemberships((data || []) as unknown as Membership[]);
  };
  useEffect(() => { setMemberships(null); if (uid) void loadMemberships(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [uid]);

  const signOut = async () => { lsSet('cm-household', null); setHh(null); await supabase.auth.signOut(); };

  if (isContactPath()) return <Contact signedInEmail={session?.user?.is_anonymous ? null : session?.user?.email} />;
  if (!configured) return <Setup />;
  if (session === undefined) return <Loading />;
  if (recovering && session) return <NewPassword onDone={() => setRecovering(false)} />;
  if (!session) return <AuthScreen />;
  if (loadErr) return <Problem text={loadErr} retry={loadMemberships} signOut={signOut} />;
  if (!memberships) return <Loading />;
  if (!memberships.length) {
    if (session.user.is_anonymous) return <Problem text={t('This device isn’t linked to anyone in a family. Ask a parent for a new device code.')} signOut={signOut} action={t('Enter a code')} />;
    return <Onboarding onSignOut={signOut} onReady={async id => { lsSet('cm-household', id); setHh(id); await loadMemberships(); }} />;
  }
  const current = memberships.find(m => m.household_id === hh)?.household_id || memberships[0].household_id;

  return (
    <FamilyProvider key={current} householdId={current} userId={session.user.id}
      fallback={({ error, retry }) => error ? <Problem text={error} retry={retry} signOut={signOut} /> : <Loading />}>
      <Shell memberships={memberships} anonymous={!!session.user.is_anonymous} signOut={signOut}
        switchTo={id => { lsSet('cm-household', id); setHh(id); }} />
    </FamilyProvider>
  );
}

const VIEWS = {
  parent: [['approvals', 'Approvals'], ['timesheets', 'Timesheets'], ['schedule', 'Schedule'], ['remuneration', 'Remuneration'], ['balances', 'Balances'], ['family', 'Family']] /* labels go through t() when shown */,
  child: [['my-week', 'My week'], ['schedule', 'Schedule'], ['remuneration', 'Remuneration'], ['balance', 'My balance']],
} as const;

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  useEffect(() => { const f = () => { setHash(window.location.hash.slice(1)); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return hash;
}

function Shell({ memberships, anonymous, signOut, switchTo }: { memberships: Membership[]; anonymous: boolean; signOut: () => void; switchTo: (id: string) => void }) {
  const F = useFamily();
  const hash = useHash();
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [schedWeek, setSchedWeek] = useState<string | undefined>();
  const list = VIEWS[F.me.role];
  const wanted = hash === 'chores' || hash === 'bonus' ? 'remuneration' : hash; // old links
  const view = list.some(v => v[0] === wanted) ? wanted : list[0][0];
  const pending = F.entries.filter(e => e.status === 'submitted').length;
  const nw = addDays(weekOf(F.today), 7);
  const newWeek = !F.isParent && isOpen(F.household, nw) && openSlots(F.activeChores, F.slotIndex, nw, F.today) > 0 && kidLoad(F.household, F.activeChores, F.slotIndex, nw, F.me.id).mins === 0;
  const go = (v: string, week?: string) => { setSchedWeek(week); window.location.hash = v; };

  return (
    <>
      <header className="top">
        <div className="wrap top-in">
          <div className="mark"><Mark /><div><b>{F.household.name}</b><span>{t('Chores Manager')}</span></div></div>
          <div className="top-actions"><LangToggle />
          <div className="menu-wrap">
            <button className="me" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu"><Avatar m={F.me} /><span>{F.me.display_name}</span></button>
            {menu && <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {memberships.length > 1 && memberships.map(m => (
                <button key={m.household_id} role="menuitem" className="menu-item" aria-current={m.household_id === F.household.id} onClick={() => { setMenu(false); switchTo(m.household_id); }}>
                  {m.households?.name || t('Family')}{m.household_id === F.household.id ? ' ✓' : ''}</button>))}
              <a role="menuitem" className="menu-item" href="/contact">{t('Contact')}</a>
              <button role="menuitem" className="menu-item" onClick={() => { setMenu(false); if (anonymous) setLeaving(true); else signOut(); }}>{t('Sign out')}</button>
            </div>}
          </div></div>
        </div>
        <nav className="wrap tabs" aria-label={t('Sections')}>
          {list.map(([id, label]) => (
            <a key={id} className="tab" href={`#${id}`} aria-current={id === view ? 'page' : undefined}>{t(label)}
              {id === 'approvals' && pending > 0 && <span className="count">{pending}</span>}
              {id === 'schedule' && newWeek && <span className="count">{t('New')}</span>}</a>))}
        </nav>
      </header>
      <main className="wrap">
        {view === 'my-week' && <MyWeek go={go} />}
        {view === 'timesheets' && <Timesheets />}
        {view === 'approvals' && <Approvals />}
        {view === 'schedule' && <Schedule key={schedWeek || 'default'} initialWeek={schedWeek} />}
        {view === 'remuneration' && <Remuneration />}
        {(view === 'balances' || view === 'balance') && <Balances />}
        {view === 'family' && <Family />}
      </main>
      <footer className="foot"><Wave /><div className="foot-bar"><div className="wrap foot-in">
        <span>{new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: F.household.timezone })}</span>
        <span className="foot-right"><a className="foot-link" href="/contact">{t('Contact')}</a><span className="sync"><i />{t('Shared with your family · updates live')} · v{__APP_VERSION__}</span></span></div></div></footer>
      {leaving && <Confirm title={t('Sign out of this device?')} action={t('Sign out')} onClose={() => setLeaving(false)} onConfirm={signOut}
        text={t('This device will need a new code from a parent to link again. Your timesheets and balance are kept.')} />}
    </>
  );
}

function Loading() {
  return <div className="loading"><div className="spin" aria-hidden="true" /><p>{t('Loading…')}</p></div>;
}

function Problem({ text, retry, signOut, action }: { text: string; retry?: () => void; signOut: () => void; action?: string }) {
  return (
    <div className="auth"><main className="wrap auth-main"><section className="auth-card stack" style={{ gap: 14 }}>
      <h1>{t('Something needs attention')}</h1><p>{text}</p>
      <p className="cap"><a href="/contact">{t('Contact us')}</a></p>
      <div className="sheet-actions">{retry && <button className="btn ghost" onClick={retry}>{t('Try again')}</button>}<button className="btn primary" onClick={signOut}>{action || t('Sign out')}</button></div>
    </section></main></div>
  );
}

function Setup() {
  return (
    <div className="auth"><main className="wrap auth-main"><section className="auth-card stack" style={{ gap: 12 }}>
      <h1>{t('Connect Supabase')}</h1>
      <p>{t('This build doesn’t know which Supabase project to use yet.')}</p>
      <p><b>{t('On Vercel:')}</b> {t('Project → Settings → Environment Variables. Add')} <code>{t('VITE_SUPABASE_URL')}</code> {t('and')} <code>{t('VITE_SUPABASE_ANON_KEY')}</code> {t('(the anon or publishable key from Supabase’s Connect button), then Deployments → ⋯ → Redeploy.')}</p>
      <p className="cap">{t('On your own computer: put the same two values in')} <code>{t('app/.env')}</code> {t('and restart')} <code>{t('npm run dev')}</code>.</p>
    </section></main></div>
  );
}
