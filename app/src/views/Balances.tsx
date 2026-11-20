import { useState, type FormEvent } from 'react';
import { supabase, errorText } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Confirm, Empty, Modal, ScrollBox } from '../ui';
import type { Entry, Member, Payment } from '../types';
import { EntryModal, EntryRow } from './Timesheet';
import { addDays, dur, fmtDate, fmtDay, fmtRange, money, r2, weekOf } from '../lib/util';
import { t, count } from '../i18n';

export function Balances() {
  const F = useFamily();
  const { household: h, isParent } = F;
  const [pay, setPay] = useState<Member | null>(null);
  const [del, setDel] = useState<Payment | null>(null);
  const [edit, setEdit] = useState<Entry | null>(null);
  const kids = isParent ? F.kids : [F.me];
  const pays = F.payments.filter(p => kids.some(k => k.id === p.member_id));

  const totals = (id: string) => {
    const es = F.entries.filter(e => e.member_id === id);
    const s = (a: { amount: number }[]) => r2(a.reduce((x, y) => x + y.amount, 0));
    const ap = es.filter(e => e.status === 'approved');
    const bonus = r2(F.reviews.filter(r => r.member_id === id).reduce((x, r) => x + r.bonus_amount, 0));
    const chores = s(ap), earned = r2(chores + bonus), paid = s(F.payments.filter(p => p.member_id === id));
    return { chores, bonus, earned, paid, balance: r2(earned - paid), pending: s(es.filter(e => e.status === 'submitted')), mins: ap.reduce((x, e) => x + e.minutes, 0) };
  };

  const confirm = async (p: Payment) => {
    const { error } = await supabase.rpc('confirm_payment', { p_payment: p.id });
    if (error) F.toast(errorText(error)); else { await F.reload('payments'); F.toast(t('Thanks! Payment confirmed')); }
  };

  const weeks = new Map<string, { mins: number; amt: number; by: Map<string, number> }>();
  F.entries.filter(e => e.status === 'approved' && kids.some(k => k.id === e.member_id)).forEach(e => {
    const w = weekOf(e.work_date); const x = weeks.get(w) || { mins: 0, amt: 0, by: new Map() };
    x.mins += e.minutes; x.amt += e.amount; x.by.set(e.member_id, (x.by.get(e.member_id) || 0) + e.amount); weeks.set(w, x);
  });
  F.reviews.filter(r => kids.some(k => k.id === r.member_id) && r.bonus_amount > 0).forEach(r => {
    const x = weeks.get(r.week_start) || { mins: 0, amt: 0, by: new Map() };
    x.amt += r.bonus_amount; x.by.set(r.member_id, (x.by.get(r.member_id) || 0) + r.bonus_amount); weeks.set(r.week_start, x);
  });
  const wk = [...weeks.keys()].sort().reverse().slice(0, 8);

  return (
    <>
      <div className="page-head"><div><h1>{isParent ? t('Balances') : t('My balance')}</h1><p className="muted">{t('Balance = approved chore pay plus performance bonuses, minus payments made.')}{isParent ? ' ' + t('Record each payment so the children can confirm it.') : ''}</p></div></div>
      <div className="stack">
        {kids.length ? <div className="kids">{kids.map(k => {
          const tot = totals(k.id), unconf = pays.filter(p => p.member_id === k.id && !p.confirmed_at).length;
          return (
            <article className="kidcard" key={k.id}>
              <header><Avatar m={k} /><h2>{k.display_name}</h2>{unconf > 0 && <span className="pill submitted">{count('item', unconf)}</span>}</header>
              <div className="owed"><span className="eyebrow">{tot.balance < 0 ? t('Paid ahead') : t('Balance owed')}</span><b>{money(h, Math.abs(tot.balance))}</b></div>
              <dl className="kv"><dt>{t('Chore pay (approved)')}</dt><dd>{money(h, tot.chores)}</dd><dt>{t('Performance bonus')}</dt><dd>{money(h, tot.bonus)}</dd><dt>{t('Paid so far')}</dt><dd>{money(h, tot.paid)}</dd>
                <dt>{t('Awaiting approval')}</dt><dd>{money(h, tot.pending)}</dd><dt>{t('Approved time')}</dt><dd>{dur(tot.mins)}</dd></dl>
              {isParent && <footer><button className="btn primary" onClick={() => setPay(k)}>{t('Record payment')}</button></footer>}
            </article>);
        })}</div> : <Empty title={t('No children yet')}><p className="muted">{t('Add the children on the Family page.')}</p></Empty>}
        {!isParent && (() => {
          // A child's chores logged in the last two weeks: what's waiting for approval, and fixing a mistake.
          const since = addDays(F.today, -13);
          const mine = F.entries.filter(e => e.member_id === F.me.id && e.work_date >= since)
            .sort((a, b) => (b.done_at || b.work_date).localeCompare(a.done_at || a.work_date));
          return <section className="stack" style={{ gap: 10 }}><h2>{t('My logged chores')}</h2>
            {mine.length ? <div className="entries">{mine.map(e => <div key={e.id}><span className="cap">{fmtDay(e.work_date)}</span><EntryRow e={e} onEdit={setEdit} /></div>)}</div>
              : <p className="muted">{t('Nothing logged in the last two weeks. Log a chore from Today on the Schedule page.')}</p>}
          </section>;
        })()}
        <section className="stack" style={{ gap: 10 }}><h2>{t('Payments')}</h2>
          {pays.length ? <ScrollBox><table>
            <thead><tr><th>{t('Date')}</th>{isParent && <th>{t('Child')}</th>}<th className="r">{t('Amount')}</th><th>{t('Method')}</th><th>{t('Paid by')}</th><th>{t('Status')}</th><th /></tr></thead>
            <tbody>{pays.map(p => (
              <tr key={p.id}><td>{fmtDate(p.paid_on)}</td>{isParent && <td>{F.member(p.member_id)?.display_name}</td>}
                <td className="r"><b>{money(h, p.amount)}</b></td><td>{t(p.method)}{p.note && <><br /><span className="cap">{p.note}</span></>}</td>
                <td>{F.member(p.paid_by)?.display_name}</td>
                <td>{p.confirmed_at ? <span className="pill approved">{t('Received')}</span> : <span className="pill submitted">{t('Awaiting confirmation')}</span>}</td>
                <td className="r">{!p.confirmed_at && (p.member_id === F.me.id
                  ? <button className="btn go sm" onClick={() => confirm(p)}>{t('Confirm received')}</button>
                  : isParent ? <button className="btn ghost sm" onClick={() => setDel(p)}>{t('Remove')}</button> : null)}</td></tr>))}</tbody>
          </table></ScrollBox> : <Empty title={t('No payments yet')}><p className="muted">{isParent ? t('Use Record payment on a child’s card when you pay them. They confirm it here when they get it.') : t('When your parents pay you, it shows here so you can confirm you got it.')}</p></Empty>}
        </section>
        {wk.length > 0 && <section className="stack" style={{ gap: 10 }}><h2>{t('Approved pay and bonuses by week')}</h2><ScrollBox><table>
          <thead><tr><th>{t('Week')}</th>{isParent ? F.kids.map(k => <th key={k.id} className="r">{k.display_name}</th>) : <th className="r">{t('Time')}</th>}<th className="r">{t('Total')}</th></tr></thead>
          <tbody>{wk.map(w => { const x = weeks.get(w)!; return (
            <tr key={w}><td>{fmtRange(w)}</td>{isParent ? F.kids.map(k => <td key={k.id} className="r">{x.by.get(k.id) ? money(h, x.by.get(k.id)!) : <span className="muted">–</span>}</td>) : <td className="r">{dur(x.mins)}</td>}
              <td className="r"><b>{money(h, x.amt)}</b></td></tr>); })}</tbody></table></ScrollBox></section>}
      </div>
      {edit && <EntryModal childId={edit.member_id} week={weekOf(edit.work_date)} entry={edit} onClose={() => setEdit(null)} />}
      {pay && <PayModal kid={pay} owed={totals(pay.id).balance} onClose={() => setPay(null)} />}
      {del && <Confirm title={t('Remove this payment?')} action={t('Remove')} onClose={() => setDel(null)}
        text={t('{amount} to {name} on {date}. Their balance goes back up by this amount.', { amount: money(h, del.amount), name: F.member(del.member_id)?.display_name, date: fmtDate(del.paid_on) })}
        onConfirm={() => F.run(['payments'], () => supabase.from('payments').delete().eq('id', del.id), t('Payment removed'))} />}
    </>
  );
}

function PayModal({ kid, owed, onClose }: { kid: Member; owed: number; onClose: () => void }) {
  const F = useFamily();
  const [amount, setAmount] = useState(owed > 0 ? owed.toFixed(2) : '');
  const [date, setDate] = useState(F.today);
  const [method, setMethod] = useState('Cash');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const amt = r2(Number(amount));
    if (!(amt > 0)) { setErr(t('Enter an amount more than 0.')); return; }
    if (await F.run(['payments'], () => supabase.from('payments').insert({ household_id: F.household.id, member_id: kid.id, amount: amt, paid_on: date || F.today, method, note: note.trim() }),
      t('Payment recorded. {name} can confirm it on their balance page.', { name: kid.display_name }))) onClose();
  }
  return (
    <Modal title={t('Record payment')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted"><Avatar m={kid} size="sm" /> <b style={{ color: 'var(--heading)' }}>{kid.display_name}</b> · {t('balance owed')} <b className="num" style={{ color: 'var(--heading)' }}>{money(F.household, owed)}</b></p>
        <div className="row2">
          <label className="field"><span>{t('Amount')}</span><input type="number" min={0.01} step={0.01} value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label className="field"><span>{t('Date')}</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>{t('Method')}</span><select value={method} onChange={e => setMethod(e.target.value)}>{['Cash', 'Bank transfer', 'Savings account', 'Other'].map(m => <option key={m} value={m}>{t(m)}</option>)}</select></label>
        <label className="field"><span>{t('Note')} <small>{t('(optional)')}</small></span><input type="text" maxLength={280} value={note} onChange={e => setNote(e.target.value)} placeholder={t('e.g. Pay for weeks 46–47')} /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions"><button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="btn primary">{t('Record payment')}</button></div>
      </form>
    </Modal>
  );
}
