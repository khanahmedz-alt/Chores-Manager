import { useState } from 'react';
import { supabase } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Empty } from '../ui';
import { EntryModal, EntryRow } from './Timesheet';
import type { Entry } from '../types';
import { dur, fmtDay, money, r2, weekOf } from '../lib/util';

export function Approvals() {
  const F = useFamily();
  const [edit, setEdit] = useState<Entry | null>(null);
  const pend = F.entries.filter(e => e.status === 'submitted');
  const groups = F.kids.map(k => ({ k, es: pend.filter(e => e.member_id === k.id) })).filter(g => g.es.length);
  const recent = F.entries.filter(e => e.status !== 'submitted' && e.reviewed_at)
    .sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at))).slice(0, 8);

  const approveAll = (ids: string[], name: string) =>
    F.run(['time_entries'], () => supabase.from('time_entries').update({ status: 'approved' }).in('id', ids),
      `Approved ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} for ${name}`);

  return (
    <>
      <div className="page-head"><div><h1>Approvals</h1><p className="muted">Check the time each child has logged. Approved time is added to their balance at the rate shown.</p></div></div>
      <div className="stack">
        {groups.length ? groups.map(({ k, es }) => {
          const total = r2(es.reduce((s, e) => s + e.amount, 0)), mins = es.reduce((s, e) => s + e.minutes, 0);
          return (
            <section className="panel" key={k.id}>
              <div className="panel-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar m={k} /><div><h2>{k.display_name}</h2>
                  <span className="cap num">{es.length} entr{es.length === 1 ? 'y' : 'ies'} · {dur(mins)} · {money(F.household, total)}</span></div></div>
                <button className="btn go" onClick={() => approveAll(es.map(e => e.id), k.display_name)}>Approve all ({es.length})</button>
              </div>
              <div className="entries">{es.map(e => (
                <div key={e.id}><span className="cap">{fmtDay(e.work_date)}</span><EntryRow e={e} onEdit={setEdit} /></div>
              ))}</div>
            </section>
          );
        }) : <Empty title="Nothing waiting for approval"><p className="muted">When a child logs chore time it shows up here for a parent to approve.</p></Empty>}
        {recent.length > 0 && <section className="panel flat"><div className="panel-head"><h2>Recently reviewed</h2></div>
          <div className="entries">{recent.map(e => (
            <div className="entry" key={e.id}>
              <span className="what">{F.member(e.member_id)?.display_name} · {e.chore_name}</span><span className="amt">{money(F.household, e.amount)}</span>
              <div className="meta"><span>{fmtDay(e.work_date)} · {dur(e.minutes)}</span>
                <span className={`pill ${e.status}`}>{e.status === 'approved' ? 'Approved' : 'Not approved'}</span>
                {e.reviewed_by && <span>by {F.member(e.reviewed_by)?.display_name}</span>}</div>
            </div>))}</div></section>}
      </div>
      {edit && <EntryModal childId={edit.member_id} week={weekOf(edit.work_date)} entry={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
