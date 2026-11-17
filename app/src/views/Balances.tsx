import { useState, type FormEvent } from 'react';
import { supabase, errorText } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Confirm, Empty, Modal } from '../ui';
import type { Member, Payment } from '../types';
import { dur, fmtDate, fmtRange, money, r2, weekOf } from '../lib/util';

export function Balances() {
  const F = useFamily();
  const { household: h, isParent } = F;
  const [pay, setPay] = useState<Member | null>(null);
  const [del, setDel] = useState<Payment | null>(null);
  const kids = isParent ? F.kids : [F.me];
  const pays = F.payments.filter(p => kids.some(k => k.id === p.member_id));

  const totals = (id: string) => {
    const es = F.entries.filter(e => e.member_id === id);
    const s = (a: { amount: number }[]) => r2(a.reduce((x, y) => x + y.amount, 0));
    const ap = es.filter(e => e.status === 'approved');
    const earned = s(ap), paid = s(F.payments.filter(p => p.member_id === id));
    return { earned, paid, balance: r2(earned - paid), pending: s(es.filter(e => e.status === 'submitted')), mins: ap.reduce((x, e) => x + e.minutes, 0) };
  };

  const confirm = async (p: Payment) => {
    const { error } = await supabase.rpc('confirm_payment', { p_payment: p.id });
    if (error) F.toast(errorText(error)); else { await F.reload('payments'); F.toast('Thanks! Payment confirmed'); }
  };

  const weeks = new Map<string, { mins: number; amt: number; by: Map<string, number> }>();
  F.entries.filter(e => e.status === 'approved' && kids.some(k => k.id === e.member_id)).forEach(e => {
    const w = weekOf(e.work_date); const x = weeks.get(w) || { mins: 0, amt: 0, by: new Map() };
    x.mins += e.minutes; x.amt += e.amount; x.by.set(e.member_id, (x.by.get(e.member_id) || 0) + e.amount); weeks.set(w, x);
  });
  const wk = [...weeks.keys()].sort().reverse().slice(0, 8);

  return (
    <>
      <div className="page-head"><div><h1>{isParent ? 'Balances' : 'My balance'}</h1><p className="muted">Balance = approved chore pay minus payments made.{isParent ? ' Record each payment so the children can confirm it.' : ''}</p></div></div>
      <div className="stack">
        {kids.length ? <div className="kids">{kids.map(k => {
          const t = totals(k.id), unconf = pays.filter(p => p.member_id === k.id && !p.confirmed_at).length;
          return (
            <article className="kidcard" key={k.id}>
              <header><Avatar m={k} /><h2>{k.display_name}</h2>{unconf > 0 && <span className="pill submitted">{unconf} to confirm</span>}</header>
              <div className="owed"><span className="eyebrow">{t.balance < 0 ? 'Paid ahead' : 'Balance owed'}</span><b>{money(h, Math.abs(t.balance))}</b></div>
              <dl className="kv"><dt>Earned (approved)</dt><dd>{money(h, t.earned)}</dd><dt>Paid so far</dt><dd>{money(h, t.paid)}</dd>
                <dt>Awaiting approval</dt><dd>{money(h, t.pending)}</dd><dt>Approved time</dt><dd>{dur(t.mins)}</dd></dl>
              {isParent && <footer><button className="btn primary" onClick={() => setPay(k)}>Record payment</button></footer>}
            </article>);
        })}</div> : <Empty title="No children yet"><p className="muted">Add the children on the Family page.</p></Empty>}
        <section className="stack" style={{ gap: 10 }}><h2>Payments</h2>
          {pays.length ? <div className="tbl-wrap"><table>
            <thead><tr><th>Date</th>{isParent && <th>Child</th>}<th className="r">Amount</th><th>Method</th><th>Paid by</th><th>Status</th><th /></tr></thead>
            <tbody>{pays.map(p => (
              <tr key={p.id}><td>{fmtDate(p.paid_on)}</td>{isParent && <td>{F.member(p.member_id)?.display_name}</td>}
                <td className="r"><b>{money(h, p.amount)}</b></td><td>{p.method}{p.note && <><br /><span className="cap">{p.note}</span></>}</td>
                <td>{F.member(p.paid_by)?.display_name}</td>
                <td>{p.confirmed_at ? <span className="pill approved">Received</span> : <span className="pill submitted">Awaiting confirmation</span>}</td>
                <td className="r">{!p.confirmed_at && (p.member_id === F.me.id
                  ? <button className="btn go sm" onClick={() => confirm(p)}>Confirm received</button>
                  : isParent ? <button className="btn ghost sm" onClick={() => setDel(p)}>Remove</button> : null)}</td></tr>))}</tbody>
          </table></div> : <Empty title="No payments yet"><p className="muted">{isParent ? 'Use Record payment on a child’s card when you pay them. They confirm it here when they get it.' : 'When your parents pay you, it shows here so you can confirm you got it.'}</p></Empty>}
        </section>
        {wk.length > 0 && <section className="stack" style={{ gap: 10 }}><h2>Approved pay by week</h2><div className="tbl-wrap"><table>
          <thead><tr><th>Week</th>{isParent ? F.kids.map(k => <th key={k.id} className="r">{k.display_name}</th>) : <th className="r">Time</th>}<th className="r">Total</th></tr></thead>
          <tbody>{wk.map(w => { const x = weeks.get(w)!; return (
            <tr key={w}><td>{fmtRange(w)}</td>{isParent ? F.kids.map(k => <td key={k.id} className="r">{x.by.get(k.id) ? money(h, x.by.get(k.id)!) : <span className="muted">–</span>}</td>) : <td className="r">{dur(x.mins)}</td>}
              <td className="r"><b>{money(h, x.amt)}</b></td></tr>); })}</tbody></table></div></section>}
      </div>
      {pay && <PayModal kid={pay} owed={totals(pay.id).balance} onClose={() => setPay(null)} />}
      {del && <Confirm title="Remove this payment?" action="Remove" onClose={() => setDel(null)}
        text={`${money(h, del.amount)} to ${F.member(del.member_id)?.display_name} on ${fmtDate(del.paid_on)}. Their balance goes back up by this amount.`}
        onConfirm={() => F.run(['payments'], () => supabase.from('payments').delete().eq('id', del.id), 'Payment removed')} />}
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
    if (!(amt > 0)) { setErr('Enter an amount more than 0.'); return; }
    if (await F.run(['payments'], () => supabase.from('payments').insert({ household_id: F.household.id, member_id: kid.id, amount: amt, paid_on: date || F.today, method, note: note.trim() }),
      `Payment recorded. ${kid.display_name} can confirm it on their balance page.`)) onClose();
  }
  return (
    <Modal title="Record payment" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted"><Avatar m={kid} size="sm" /> <b style={{ color: 'var(--heading)' }}>{kid.display_name}</b> · balance owed <b className="num" style={{ color: 'var(--heading)' }}>{money(F.household, owed)}</b></p>
        <div className="row2">
          <label className="field"><span>Amount</span><input type="number" min={0.01} step={0.01} value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label className="field"><span>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>Method</span><select value={method} onChange={e => setMethod(e.target.value)}>{['Cash', 'Bank transfer', 'Savings account', 'Other'].map(m => <option key={m}>{m}</option>)}</select></label>
        <label className="field"><span>Note <small>(optional)</small></span><input type="text" maxLength={280} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Pay for weeks 46–47" /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="sheet-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Record payment</button></div>
      </form>
    </Modal>
  );
}
