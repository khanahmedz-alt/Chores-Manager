import { useState } from 'react';
import { supabase } from '../supabase';
import { useFamily } from '../data';
import { Avatar, Empty } from '../ui';
import { EntryModal, EntryRow } from './Timesheet';
import { AwardModal } from './Bonus';
import type { Entry, Member } from '../types';
import { addDays, dur, fmtDay, fmtRange, money, pct, r2, weekOf } from '../lib/util';
import { t, count } from '../i18n';

export function Approvals() {
  const F = useFamily();
  const [edit, setEdit] = useState<Entry | null>(null);
  const [award, setAward] = useState<{ kid: Member; week: string } | null>(null);
  const cw = weekOf(F.today), lw = addDays(cw, -7);
  const hasMetrics = F.metrics.some(m => m.active);
  const pend = F.entries.filter(e => e.status === 'submitted');
  const groups = F.kids.map(k => ({ k, es: pend.filter(e => e.member_id === k.id) })).filter(g => g.es.length);
  const recent = F.entries.filter(e => e.status !== 'submitted' && e.reviewed_at)
    .sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at))).slice(0, 8);

  // Team chores are approved for the whole team, so every teammate is paid together.
  const approveAll = (es: Entry[], name: string) => {
    const ids = es.filter(e => !e.team_id).map(e => e.id), teams = [...new Set(es.filter(e => e.team_id).map(e => e.team_id as string))];
    return F.run(['time_entries'], async () => {
      if (ids.length) { const r = await supabase.from('time_entries').update({ status: 'approved' }).in('id', ids); if (r.error) return r; }
      if (teams.length) return await supabase.from('time_entries').update({ status: 'approved' }).in('team_id', teams);
      return { error: null };
    }, t('Approved {count} for {name}', { count: count('entry', es.length), name }) + (teams.length ? ' ' + t('(team chores for the whole team)') : ''));
  };

  return (
    <>
      <div className="page-head"><div><h1>{t('Approvals')}</h1><p className="muted">{t('Check the time each child has logged. Approved time is added to their balance at the rate shown.')}</p></div></div>
      <div className="stack">
        {groups.length ? groups.map(({ k, es }) => {
          const total = r2(es.reduce((s, e) => s + e.amount, 0)), mins = es.reduce((s, e) => s + e.minutes, 0);
          return (
            <section className="panel" key={k.id}>
              <div className="panel-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar m={k} /><div><h2>{k.display_name}</h2>
                  <span className="cap num">{count('entry', es.length)} · {dur(mins)} · {money(F.household, total)}</span></div></div>
                <button className="btn go" onClick={() => approveAll(es, k.display_name)}>{t('Approve all ({n})', { n: es.length })}</button>
              </div>
              <div className="entries">{es.map(e => (
                <div key={e.id}><span className="cap">{fmtDay(e.work_date)}</span><EntryRow e={e} onEdit={setEdit} /></div>
              ))}</div>
            </section>
          );
        }) : <Empty title={t('Nothing waiting for approval')}><p className="muted">{t('When a child logs chore time it shows up here for a parent to approve.')}</p></Empty>}
        {F.kids.length > 0 && <section className="panel">
          <div className="panel-head"><div><h2>{t('Performance bonus')}</h2><span className="cap">{t('A % of each child’s approved pay for the week, based on the Bonus metrics.')}</span></div></div>
          {hasMetrics ? <div className="members">{F.kids.map(k => {
            const rv = (w: string) => F.reviews.find(r => r.member_id === k.id && r.week_start === w);
            const cur = rv(cw), last = rv(lw);
            return (
              <div className="member" key={k.id}><Avatar m={k} />
                <div className="member-main"><b>{k.display_name}</b>
                  <span className="cap">{t('Last week')}: {last ? `${money(F.household, last.bonus_amount)} (${pct(last.bonus_percent)})` : t('not reviewed')} · {t('This week')}: {cur ? `${money(F.household, cur.bonus_amount)} (${pct(cur.bonus_percent)})` : t('not reviewed')}</span></div>
                <div className="member-acts">
                  <button className="btn ghost sm" onClick={() => setAward({ kid: k, week: lw })}>{last ? t('Edit last week') : t('Review last week')}</button>
                  <button className="btn go sm" onClick={() => setAward({ kid: k, week: cw })}>{cur ? t('Edit this week') : t('Award this week')}</button>
                </div>
              </div>);
          })}</div>
            : <p className="empty-note">{t('First set up what you reward (school grades, homework…) on the Remuneration page.')} <a href="#remuneration">{t('Open Remuneration')}</a></p>}
          {hasMetrics && <p className="cap" style={{ marginTop: 10 }}>{t('Last week')}: {fmtRange(lw)} · {t('This week')}: {fmtRange(cw)}</p>}
        </section>}
        {recent.length > 0 && <section className="panel flat"><div className="panel-head"><h2>{t('Recently reviewed')}</h2></div>
          <div className="entries">{recent.map(e => (
            <div className="entry" key={e.id}>
              <span className="what">{F.member(e.member_id)?.display_name} · {e.chore_name}</span><span className="amt">{money(F.household, e.amount)}</span>
              <div className="meta"><span>{fmtDay(e.work_date)} · {dur(e.minutes)}</span>
                <span className={`pill ${e.status}`}>{e.status === 'approved' ? t('Approved') : t('Not approved')}</span>
                {e.reviewed_by && <span>{t('by {name}', { name: F.member(e.reviewed_by)?.display_name })}</span>}</div>
            </div>))}</div></section>}
      </div>
      {award && <AwardModal kid={award.kid} week={award.week} onClose={() => setAward(null)} />}
      {edit && <EntryModal childId={edit.member_id} week={weekOf(edit.work_date)} entry={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
