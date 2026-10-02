// Orari mostrati sempre in UTC (con Z) e in ora locale (LT).
import { h } from './util.js';
import { fmtUtc, localTime } from '../src/timeline.js';
import { state } from './state.js';

const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

// {utc:"05:30", utcDelta:0, loc:"07:30"|null, locDelta:0}
export function times(ms, apt, refDate) {
  if (ms == null) return null;
  const l = localTime(ms, apt, state.data.airports, refDate);
  return { utc: fmtUtc(ms), utcDelta: l ? l.utcDayDelta : Math.round((Date.parse(new Date(ms).toISOString().slice(0, 10) + 'T00:00:00Z') - Date.parse(refDate + 'T00:00:00Z')) / 86400000), loc: l?.time ?? null, locDelta: l?.dayDelta ?? 0 };
}

// "05:30Z"
export function utcText(t) {
  return t ? `${t.utc}Z${t.utcDelta ? sign(t.utcDelta) : ''}` : '';
}
// "07:30 LT"
export function locText(t) {
  return t?.loc ? `${t.loc}${t.locDelta ? sign(t.locDelta) : ''} LT` : '';
}

// elemento con UTC in evidenza e locale in grigio
export function timeEl(t, cls = '') {
  if (!t) return h('span', {}, '—');
  return h('span', { class: cls }, h('b', {}, t.utc + 'Z'), t.utcDelta ? h('span', { class: 'sup' }, sign(t.utcDelta)) : null, t.loc ? h('span', { class: 'loc' }, ` ${t.loc}`) : h('span', { class: 'loc' }, ' (fuso n.d.)'), t.loc && t.locDelta ? h('span', { class: 'sup' }, sign(t.locDelta)) : null);
}
