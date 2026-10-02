// Calendario mensile con colori per tipo di giornata.
import { h, daysInMonth, dowOf, kindOf, todayIso, mmToHm } from './util.js';
import { state, actions, monthDays } from './state.js';
import { monthSummary } from '../src/stats.js';

const base = () => state.data.pilot?.base ?? 'MXP';

function cellLabel(day) {
  switch (day.kind) {
    case 'flight': {
      const dest = [];
      for (const l of day.legs) if (l.kind === 'flight' && l.arr !== base() && !dest.includes(l.arr)) dest.push(l.arr);
      return dest.length ? dest.join(' ') : day.legs[0]?.arr ?? 'VOLO';
    }
    case 'transport': return 'TSP';
    case 'vacation': return 'FER';
    case 'sim': return 'SIM';
    case 'standby': return day.code === 'RESERVE' ? 'RSV' : 'SBY';
    default: return '';
  }
}

export function renderCalendar(view) {
  const key = state.month;
  const today = todayIso();
  const days = monthDays(key);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = dowOf(`${key}-01`);
  const lead = (first + 6) % 7; // lunedì = 0
  const cal = h('div', { class: 'cal' }, ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((w) => h('div', { class: 'wd' }, w)));
  for (let i = 0; i < lead; i++) cal.append(h('div', { class: 'empty' }));
  const n = daysInMonth(key);
  for (let d = 1; d <= n; d++) {
    const date = `${key}-${String(d).padStart(2, '0')}`;
    const day = byDate.get(date);
    if (!day) {
      cal.append(h('button', { class: 'k-blank blank', disabled: true }, h('span', { class: 'n' }, d)));
      continue;
    }
    const k = kindOf(day);
    const has = !['off', 'blank', 'rest'].includes(day.kind);
    const sub = day.kind === 'flight' && day.ft && day.ft !== '00:00' ? day.ft.replace(/^0/, '') : '';
    cal.append(h('button', { class: [k.cls, day.kind, has ? 'has' : '', date === today ? 'today' : '', state.pending.has(date) ? 'changed' : ''].filter(Boolean).join(' '), onclick: () => actions.openDay(date), 'aria-label': date },
      h('span', { class: 'n' }, d),
      h('span', { class: 'lab' }, cellLabel(day)),
      day.hotel ? h('span', { class: 'hot' }, '🛏') : null,
      sub ? h('span', { class: 'sub' }, sub) : null));
  }
  const s = monthSummary(days);
  const legend = h('div', { class: 'legend' },
    [['k-flight', 'Volo'], ['k-transport', 'Trasferimento'], ['k-standby', 'Stand-by'], ['k-reserve', 'Reserve'], ['k-sim', 'Simulatore'], ['k-vac', 'Ferie'], ['k-off', 'Riposo']].map(([c, t]) => h('span', { class: c }, h('i'), t)),
    h('span', {}, '🛏 hotel'), h('span', {}, 'Numero sotto il giorno = FT'));
  const tot = h('div', { class: 'summary' },
    h('div', {}, h('b', {}, mmToHm(s.ft)), h('small', {}, 'FT')),
    h('div', {}, h('b', {}, mmToHm(s.dt)), h('small', {}, 'DT')),
    h('div', {}, h('b', {}, s.flightDays), h('small', {}, 'Giorni volo')),
    h('div', {}, h('b', {}, s.standbyDays + s.reserveDays), h('small', {}, 'Sby/Rsv')));
  view.replaceChildren(cal, tot, legend);
}
