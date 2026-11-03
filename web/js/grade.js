import { GRADES, suggestGrade } from './schema.js';
import { h, fill } from './ui.js';

// Grade buttons: the suggested grade is selected automatically; picking another one sticks.
// get() returns the current record; update(patch) applies and saves it.
export function gradePicker(get, update) {
  const wrap = h('div', { class: 'stack', style: { gap: '6px' } });
  const set = async (patch) => { await update(patch); draw(); };
  const draw = () => {
    const rec = get();
    const sug = suggestGrade(rec);
    const manual = !!rec.gradeManual;
    fill(wrap,
      h('div', { class: 'grades' }, GRADES.map(([g, label]) => h('button', {
        title: label, 'aria-pressed': String(rec.grade === g), 'data-auto': String(!manual && rec.grade === g),
        onclick: () => (manual && rec.grade === g ? set({ gradeManual: false }) : set({ gradeManual: true, grade: g })),
      }, g))),
      h('div', { class: 'muted small' },
        manual
          ? ['Set by you. ', sug ? h('button', { class: 'linkbtn', onclick: () => set({ gradeManual: false }) }, `Use the suggestion (${sug})`) : null]
          : sug ? 'Suggested from the tests and defects recorded. Pick another grade to override it.' : 'A grade is suggested once something is tested or a defect is noted.'));
  };
  draw();
  wrap.refresh = draw;
  return wrap;
}
