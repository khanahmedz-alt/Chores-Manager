import { useFamily } from '../data';
import { Chores } from './Chores';
import { Bonus } from './Bonus';
import { t } from '../i18n';

/** Everything about pay in one place: the rate, the chores and what each pays, and the performance bonus. */
export function Remuneration() {
  const F = useFamily();
  return (
    <>
      <div className="page-head"><div><h1>{t('Remuneration')}</h1>
        <p className="muted">{F.isParent
          ? t('How the family pays for chores: the hourly rate, each chore’s pay, and the performance bonus on top.')
          : t('What each chore pays, and how you can earn a performance bonus on top.')}</p></div>
        <nav className="jump" aria-label={t('On this page')}>
          <a href="#chores" onClick={e => { e.preventDefault(); document.getElementById('chores')?.scrollIntoView({ behavior: 'smooth' }); }}>{t('Chores & pay')}</a>
          <a href="#bonus" onClick={e => { e.preventDefault(); document.getElementById('bonus')?.scrollIntoView({ behavior: 'smooth' }); }}>{t('Performance bonus')}</a>
        </nav>
      </div>
      <div className="remuneration">
        <section className="rem-section"><Chores /></section>
        <section className="rem-section"><Bonus /></section>
      </div>
    </>
  );
}
