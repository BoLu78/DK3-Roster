// Controllo dei limiti FTL (tempi di volo e di servizio) sui servizi del roster.
//
// Le regole sono quelle dell'OMA-A cap. 7 (che applica EASA ORO.FTL): qui ci sono solo i
// numeri, non il testo del manuale. Il risultato è un'indicazione: l'ultima parola è del manuale.
import { buildDuties, localTime, utcOffsetHours } from './timeline.js';
import { buildTrips } from './trips.js';
import { timezoneFor } from './tz.js';

const MIN = 60000;
const HOUR = 3600000;
export const WARN_MARGIN_MIN = 30; // sotto questo margine il servizio è "al limite"

const t = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

// ---------------------------------------------------------------- tabelle FDP
// Inizio FDP (ora di riferimento) -> massimo FDP per 1-2, 3, 4 ... 9, 10+ settori. OMA 7.1.7.1
const BASIC = [
  [360, 809, '13:00 12:30 12:00 11:30 11:00 10:30 10:00 09:30 09:00'],
  [810, 839, '12:45 12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00'],
  [840, 869, '12:30 12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00'],
  [870, 899, '12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00 09:00'],
  [900, 929, '12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00 09:00'],
  [930, 959, '11:45 11:15 10:45 10:15 09:45 09:15 09:00 09:00 09:00'],
  [960, 989, '11:30 11:00 10:30 10:00 09:30 09:00 09:00 09:00 09:00'],
  [990, 1019, '11:15 10:45 10:15 09:45 09:15 09:00 09:00 09:00 09:00'],
  [1020, 1439, '11:00 10:30 10:00 09:30 09:00 09:00 09:00 09:00 09:00'],
  [0, 299, '11:00 10:30 10:00 09:30 09:00 09:00 09:00 09:00 09:00'],
  [300, 314, '12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00 09:00'],
  [315, 329, '12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00 09:00'],
  [330, 344, '12:30 12:00 11:30 11:00 10:30 10:00 09:30 09:00 09:00'],
  [345, 359, '12:45 12:15 11:45 11:15 10:45 10:15 09:45 09:15 09:00'],
].map(([a, b, v]) => [a, b, v.split(' ').map(t)]);

// Stato di acclimatazione sconosciuto (X): 1-2, 3, 4, 5, 6, 7, 8 settori. OMA 7.1.7.1
const UNKNOWN = '11:00 10:30 10:00 09:30 09:00 09:00 09:00'.split(' ').map(t);

// Estensione pianificata (+1 h, solo con "Ext" nel roster): 1-2, 3, 4, 5 settori. OMA 7.1.7.2
const EXT = [
  [360, 374, null],
  [375, 389, '13:15 12:45 12:15 11:45'],
  [390, 404, '13:30 13:00 12:30 12:00'],
  [405, 419, '13:45 13:15 12:45 12:15'],
  [420, 809, '14:00 13:30 13:00 12:30'],
  [810, 839, '13:45 13:15 12:45 -'],
  [840, 869, '13:30 13:00 12:30 -'],
  [870, 899, '13:15 12:45 12:15 -'],
  [900, 929, '13:00 12:30 12:00 -'],
  [930, 959, '12:45 - - -'],
  [960, 989, '12:30 - - -'],
  [990, 1019, '12:15 - - -'],
  [1020, 1049, '12:00 - - -'],
  [1050, 1079, '11:45 - - -'],
  [1080, 1109, '11:30 - - -'],
  [1110, 1139, '11:15 - - -'],
].map(([a, b, v]) => [a, b, v ? v.split(' ').map((x) => (x === '-' ? null : t(x))) : [null, null, null, null]]);

// Acclimatazione per fusi diversi (OMA 7.1.4): righe = differenza oraria, colonne = ore dalla presentazione
const ACCL = [
  [4, ['B', 'D', 'D', 'D', 'D']],
  [6, ['B', 'X', 'D', 'D', 'D']],
  [9, ['B', 'X', 'X', 'D', 'D']],
  [12, ['B', 'X', 'X', 'X', 'D']],
];
const acclColumn = (hours) => (hours < 48 ? 0 : hours < 72 ? 1 : hours < 96 ? 2 : hours < 120 ? 3 : 4);

const sectorIndex = (n) => Math.min(Math.max(n, 1) <= 2 ? 0 : n - 2, 8);

function row(table, minute) {
  return table.find(([a, b]) => minute >= a && minute <= b)?.[2] ?? null;
}

export function basicFdpMax(refMinute, sectors) {
  return row(BASIC, refMinute)?.[sectorIndex(sectors)] ?? null;
}
export function unknownFdpMax(sectors) {
  return UNKNOWN[Math.min(sectorIndex(sectors), 6)];
}
export function extFdpMax(refMinute, sectors) {
  if (sectors > 5) return null;
  return row(EXT, refMinute)?.[sectorIndex(sectors)] ?? null;
}

// Riposo in volo (equipaggio aumentato), max 3 settori. Classe 2 sul B737, classe 1 sul B787. OMA 7.1.7.3
export function inflightRestMax(crew, sectors, restClass, longSector) {
  if (crew < 3 || sectors > 3) return null;
  let h = crew >= 4 ? (restClass === 1 ? 17 : 16) : restClass === 1 ? 16 : 15;
  if (longSector && sectors <= 2) h += 1;
  return h * 60;
}

// ---------------------------------------------------------------- orari locali
function makeCtx(base, airports) {
  const baseTz = timezoneFor(base, airports);
  return {
    base,
    airports,
    baseTz,
    offset: (ms, apt) => utcOffsetHours(ms, apt, airports) ?? utcOffsetHours(ms, base, airports) ?? 0,
    minuteOfDay(ms, apt) {
      const l = localTime(ms, apt, airports, null) ?? localTime(ms, base, airports, null);
      if (!l) return Math.floor((ms % 86400000) / MIN); // senza fuso si usa l'UTC
      return t(l.time);
    },
    tzKnown: (apt) => !!timezoneFor(apt, airports),
  };
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const fmtHM = (min) => `${Math.floor(min / 60)}:${String(Math.abs(min) % 60).padStart(2, '0')}`;
export { fmtHM };

// ---------------------------------------------------------------- analisi di un servizio
export const dutyKey = (d) => `${d.startMs}`;

function analyzeDuty(duty, trip, ctx, crew, extFlag = false) {
  const legs = duty.legs.map((l) => l.leg);
  const flights = duty.legs.filter((l) => l.leg.kind === 'flight');
  const ciApt = duty.ci?.airport ?? legs[0]?.dep ?? ctx.base;
  const coApt = duty.co?.airport ?? legs.at(-1)?.arr ?? ctx.base;
  const startMs = duty.ci?.ms ?? duty.startMs;
  const endMs = duty.co?.ms ?? duty.endMs;
  const out = { key: dutyKey(duty), duty, startMs, endMs, dutyMin: Math.round((endMs - startMs) / MIN), ciApt, coApt, dates: duty.dates, crew, tags: [], notes: [], status: null };

  // ---- classificazione notte / presto / tardi (ora dell'acclimatazione = base per i fusi vicini)
  const farStart = Math.abs(ctx.offset(startMs, ciApt) - ctx.offset(startMs, ctx.base)) > 2;
  const startLocal = ctx.minuteOfDay(startMs, farStart ? ctx.base : ciApt);
  const endLocal = ctx.minuteOfDay(endMs, farStart ? ctx.base : coApt);
  if (startLocal >= 300 && startLocal <= 359) out.tags.push('presto');
  if (endLocal >= 1380 || endLocal <= 119) out.tags.push('tardi');
  const encroaches = (a, b) => {
    // il servizio tocca 02:00-04:59 locali?
    const len = Math.round((b - a) / MIN);
    for (let m = 0; m <= len; m += 15) if (((startLocal + m) % 1440) >= 120 && ((startLocal + m) % 1440) <= 299) return true;
    return false;
  };
  if (encroaches(startMs, endMs)) out.tags.push('notte');

  if (!flights.length) return out; // trasferimento o simulatore: nessun FDP

  // ---- FDP: dalla presentazione al block-in dell'ultimo volo
  const fdpEndMs = flights.at(-1).arrMs;
  const fdpMin = Math.round((fdpEndMs - startMs) / MIN);
  const sectors = flights.length;
  out.fdp = { startMs, endMs: fdpEndMs, min: fdpMin, sectors };

  // ---- acclimatazione (OMA 7.1.4)
  const diff = Math.abs(ctx.offset(startMs, ciApt) - ctx.offset(startMs, ctx.base));
  const elapsedH = Math.max(0, (startMs - (trip?.startMs ?? startMs)) / HOUR);
  let state = 'local';
  if (diff > 2) {
    const r = ACCL.find(([lim]) => diff <= lim) ?? ACCL.at(-1);
    state = r[1][acclColumn(elapsedH)];
  }
  const refMin = state === 'B' ? ctx.minuteOfDay(startMs, ctx.base) : ctx.minuteOfDay(startMs, ciApt);
  out.acclimatisation = { state, diffH: Math.round(diff * 10) / 10, elapsedH: Math.round(elapsedH) };
  out.refMinute = refMin;
  out.tzUnknown = !ctx.tzKnown(ciApt);

  // ---- limiti
  const basic = state === 'X' ? unknownFdpMax(sectors) : basicFdpMax(refMin, sectors);
  const ext = state === 'X' ? null : extFdpMax(refMin, sectors);
  const longSector = flights.some((l) => (l.arrMs - l.depMs) / MIN > 540);
  const restClass = flights.every((l) => /787/.test(l.leg.ac ?? '')) ? 1 : 2;
  const inflight = inflightRestMax(crew, sectors, restClass, longSector);
  out.limits = { basic, ext, inflight, restClass };

  // E_FDP nel roster = servizio pianificato con estensione: vale il massimo con estensione (OMA 7.1.7.2)
  const extPlanned = extFlag && ext != null;
  if (extFlag && ext == null) out.notes.push('E_FDP nel roster, ma la tabella dell’estensione non prevede questo orario o questo numero di settori: uso il massimo base');
  const used = extPlanned ? (inflight ? Math.max(ext, inflight) : ext) : inflight ? Math.max(basic ?? 0, inflight) : basic;
  // con l'estensione già pianificata non mostro la discrezione del comandante: non è prevista sopra il massimo esteso
  const discretion = used != null && !extPlanned ? used + (inflight ? 180 : 120) : null;
  out.limits.discretion = discretion;
  out.limits.used = used;
  if (extPlanned) {
    out.extPlanned = true;
    out.notes.push(`Estensione pianificata (E_FDP): massimo base ${fmtHM(basic)} + 1 h = ${fmtHM(ext)}${fdpMin <= basic ? ' (l’FDP è comunque entro il massimo base)' : ''}`);
  }
  if (crew >= 3 && sectors > 3) out.notes.push('Riposo in volo non applicabile: massimo 3 settori');

  if (used == null) return out;
  if (fdpMin <= used) {
    out.gapMin = used - fdpMin;
    out.status = out.gapMin <= WARN_MARGIN_MIN ? 'warn' : 'ok';
    out.limitKind = extPlanned && !(inflight && used === inflight) ? 'ext' : inflight && used === inflight && inflight > (basic ?? 0) ? 'inflight' : 'basic';
    out.usedInflight = out.limitKind === 'inflight' && fdpMin > (basic ?? 0); // serve davvero il riposo in volo
    if (out.usedInflight) out.notes.push('Entro il limite solo con riposo in volo (equipaggio aumentato)');
  } else if (ext != null && fdpMin <= ext) {
    out.gapMin = ext - fdpMin;
    out.status = 'ext';
    out.limitKind = 'ext';
    out.notes.push('Oltre il massimo base: serve l’estensione pianificata (“Ext” nel roster)');
  } else {
    out.gapMin = used - fdpMin;
    out.status = 'over';
    out.limitKind = extPlanned ? 'ext' : 'basic';
    if (discretion != null && fdpMin <= discretion) out.notes.push('Entro la discrezione del comandante (solo riferimento)');
  }
  return out;
}

// ---------------------------------------------------------------- riposi
function restBetween(prev, next, ctx) {
  const from = prev.endMs;
  const to = next.startMs;
  if (to <= from) return null;
  const restMin = Math.round((to - from) / MIN);
  const atBase = next.ciApt === ctx.base;
  let need = Math.max(prev.dutyMin, atBase ? 720 : 600);
  const why = [atBase ? 'a base: max(duty precedente, 12 h)' : 'fuori base: max(duty precedente, 10 h)'];
  // fuso: servizio con 4 h o più di differenza -> fuori base almeno 14 h
  const tzDiff = Math.abs(ctx.offset(prev.startMs, prev.ciApt) - ctx.offset(prev.endMs, prev.coApt));
  if (!atBase && tzDiff >= 4) {
    need = Math.max(need, 840);
    why.push('fuso ≥4 h: 14 h');
  }
  // riposo in volo usato: 14 h
  if (prev.usedInflight && !atBase) need = Math.max(need, 840);
  // fine tardi / notte seguita da inizio presto a base: serve 1 notte locale
  let localNightNeeded = atBase && (prev.tags.includes('tardi') || prev.tags.includes('notte')) && next.tags.includes('presto');
  let hasNight = true;
  if (localNightNeeded) {
    hasNight = containsLocalNight(from, to, ctx);
    why.push('da fine tardi/notte a inizio presto: 1 notte locale');
  }
  const status = restMin < need || !hasNight ? 'over' : restMin - need < 60 ? 'warn' : 'ok';
  return { fromMs: from, toMs: to, restMin, needMin: need, status, why, atBase, hasNight, dates: [isoDate(to)] };
}

// "Notte locale" = 8 ore comprese tra le 22:00 e le 08:00 (ora di base): per contarla basta che il
// periodo di riposo copra almeno 8 ore di quella fascia.
function countLocalNights(fromMs, toMs, ctx) {
  const off = ctx.offset(fromMs, ctx.base) * HOUR;
  const startDay = Math.floor((fromMs + off) / 86400000) - 1;
  let n = 0;
  for (let d = startDay; d <= startDay + 30; d++) {
    const a = d * 86400000 + 22 * HOUR - off;
    const overlap = Math.min(a + 10 * HOUR, toMs) - Math.max(a, fromMs);
    if (overlap >= 8 * HOUR) n++;
  }
  return n;
}
const containsLocalNight = (fromMs, toMs, ctx) => countLocalNights(fromMs, toMs, ctx) >= 1;

// ---------------------------------------------------------------- intervalli occupati (duty, stand-by, reserve)
function busyIntervals(days, duties, ctx) {
  const out = duties.map((d) => ({ from: d.startMs, to: d.endMs, kind: 'duty' }));
  for (const day of days) {
    if (day.kind !== 'standby') continue;
    if (day.window) {
      const base = Date.parse(day.date + 'T00:00:00Z');
      const [h1, m1] = [Number(day.window.start.slice(0, 2)), Number(day.window.start.slice(2))];
      const [h2, m2] = [Number(day.window.end.slice(0, 2)), Number(day.window.end.slice(2))];
      const from = base + (h1 * 60 + m1) * MIN;
      let to = base + (h2 * 60 + m2) * MIN;
      if (to < from) to += 86400000;
      out.push({ from, to, kind: 'standby', date: day.date });
    } else {
      // reserve: tutto il giorno locale
      const off = ctx.offset(Date.parse(day.date + 'T12:00:00Z'), ctx.base) * HOUR;
      const from = Date.parse(day.date + 'T00:00:00Z') - off;
      out.push({ from, to: from + 86400000, kind: 'reserve', date: day.date });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

// minuti di duty (+25% dello stand-by) che cadono nella finestra [fromMs, toMs)
function dutyInWindow(busy, fromMs, toMs) {
  let total = 0;
  for (const b of busy) {
    if (b.kind === 'reserve') continue; // la reserve non conta come duty
    const a = Math.max(b.from, fromMs);
    const z = Math.min(b.to, toMs);
    if (z > a) total += ((z - a) / MIN) * (b.kind === 'standby' ? 0.25 : 1);
  }
  return Math.round(total);
}

export const LIMITS = { duty7: 3600, duty14: 6600, duty28: 11400, dutyYear: 120000, ft28: 6000, ftYear: 54000, ft12m: 60000 };

// ---------------------------------------------------------------- analisi completa
// days: tutti i giorni (ordinati). options: { base, airports, crewByDuty: {key: 2|3|4} }
export function analyze(days, options) {
  const { base = 'MXP', airports = {}, crewByDuty = {} } = options;
  const ctx = makeCtx(base, airports);
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const trips = buildTrips(sorted, base);
  const tripOf = new Map();
  for (const tr of trips) for (const d of tr.duties) tripOf.set(d, tr);
  const extDates = new Set(sorted.filter((d) => d.flags?.includes('E_FDP')).map((d) => d.date));
  const duties = buildDuties(sorted).map((d) => analyzeDuty(d, tripOf.get(d), ctx, crewByDuty[dutyKey(d)] ?? 2, d.dates.some((x) => extDates.has(x))));
  const issues = [];
  const add = (severity, date, text, extra = {}) => issues.push({ severity, date, text, ...extra });

  for (const d of duties) {
    const date = isoDate(d.startMs);
    if (d.status === 'over') add('bad', date, `FDP ${fmtHM(d.fdp.min)} sopra il massimo ${fmtHM(d.limits.used)} (${d.fdp.sectors} settori)`);
    else if (d.status === 'ext') add('warn', date, `FDP ${fmtHM(d.fdp.min)} oltre il massimo base ${fmtHM(d.limits.basic)}: richiede estensione (Ext), ma nel roster non c’è E_FDP`);
    else if (d.status === 'warn') add('warn', date, `FDP ${fmtHM(d.fdp.min)} al limite (massimo ${fmtHM(d.limits.used)})`);
    if (d.extPlanned && d.fdp.min > d.limits.basic && d.status !== 'over') add('info', date, `FDP ${fmtHM(d.fdp.min)} con estensione pianificata (E_FDP): massimo ${fmtHM(d.limits.used)}`);
    if (d.acclimatisation?.state === 'X') add('info', date, 'Stato di acclimatazione sconosciuto (X): uso la tabella più restrittiva');
    if (d.tzUnknown) add('info', date, `Fuso di ${d.ciApt} non noto: uso l’ora di base`);
  }

  // riposi: dalla fine del servizio o dello stand-by precedente alla presentazione del servizio successivo.
  // La reserve non si considera (senza orari: non si sa quando finisce) e non genera un riposo da rispettare.
  const standbyItems = [];
  for (const day of sorted) {
    if (day.kind !== 'standby' || !day.window) continue;
    const base0 = Date.parse(day.date + 'T00:00:00Z');
    const toMs = (hhmm) => base0 + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2))) * MIN;
    const startMs = toMs(day.window.start);
    let endMs = toMs(day.window.end);
    if (endMs < startMs) endMs += 86400000;
    standbyItems.push({ standby: true, startMs, endMs, dutyMin: 0, ciApt: day.airport ?? base, coApt: day.airport ?? base, tags: [], dates: [day.date] });
  }
  const timeline = [...duties, ...standbyItems].sort((a, b) => a.startMs - b.startMs);
  const rests = [];
  for (let i = 1; i < timeline.length; i++) {
    const next = timeline[i];
    if (next.standby) continue; // il riposo che conta è quello prima di un servizio
    const prev = timeline.slice(0, i).reduce((a, b) => (b.endMs > a.endMs ? b : a)); // ciò che finisce per ultimo
    const r = restBetween(prev, next, ctx);
    if (!r) continue;
    if (prev.standby) r.why.unshift('dopo stand-by');
    rests.push(r);
    if (r.status === 'over') add('bad', isoDate(r.toMs), `Riposo ${fmtHM(r.restMin)} sotto il minimo ${fmtHM(r.needMin)} (${r.why.join('; ')})${r.hasNight ? '' : ' — manca la notte locale'}`);
    else if (r.status === 'warn') add('warn', isoDate(r.toMs), `Riposo ${fmtHM(r.restMin)} appena sopra il minimo ${fmtHM(r.needMin)}`);
  }

  const busy = busyIntervals(sorted, duties, ctx);

  // stand-by e reserve
  let reserveRun = 0;
  let prevReserve = null;
  for (const b of busy) {
    if (b.kind === 'standby' && (b.to - b.from) / HOUR > 16) add('bad', b.date, `Stand-by di ${fmtHM(Math.round((b.to - b.from) / MIN))}: massimo 16 h`);
    if (b.kind === 'reserve') {
      reserveRun = prevReserve && b.date === addDay(prevReserve) ? reserveRun + 1 : 1;
      prevReserve = b.date;
      if (reserveRun > 3) add('bad', b.date, `${reserveRun} giorni di reserve consecutivi: massimo 3`);
    }
  }

  // limiti cumulativi: valore massimo raggiunto e data
  const cumulative = {};
  const dates = sorted.map((d) => d.date);
  const peak = (n, key, limit, label) => {
    let best = { min: 0, date: null };
    for (const date of dates) {
      const end = Date.parse(date + 'T00:00:00Z') + 86400000;
      const v = dutyInWindow(busy, end - n * 86400000, end);
      if (v > best.min) best = { min: v, date };
    }
    cumulative[key] = { ...best, limit };
    if (best.min > limit) add('bad', best.date, `Duty ${label}: ${fmtHM(best.min)} sopra ${fmtHM(limit)}`);
    else if (best.min > limit * 0.92) add('warn', best.date, `Duty ${label}: ${fmtHM(best.min)} su ${fmtHM(limit)}`);
  };
  peak(7, 'duty7', LIMITS.duty7, 'in 7 giorni');
  peak(14, 'duty14', LIMITS.duty14, 'in 14 giorni');
  peak(28, 'duty28', LIMITS.duty28, 'in 28 giorni');

  // giorni liberi da servizio, stand-by e reserve (giorno locale di base)
  const freeByMonth = {};
  for (const day of sorted) {
    if (day.spill) continue;
    const off = ctx.offset(Date.parse(day.date + 'T12:00:00Z'), ctx.base) * HOUR;
    const from = Date.parse(day.date + 'T00:00:00Z') - off;
    const to = from + 86400000;
    const free = !busy.some((b) => b.from < to && b.to > from);
    const key = day.date.slice(0, 7);
    freeByMonth[key] ??= { free: 0, days: 0 };
    freeByMonth[key].days++;
    if (free) freeByMonth[key].free++;
  }
  for (const [month, v] of Object.entries(freeByMonth)) {
    const complete = v.days >= 28;
    if (complete && v.free < 7) add('bad', `${month}-01`, `Giorni liberi nel mese: ${v.free} (minimo 7)`);
  }

  // recupero esteso: almeno 36 h con 2 notti locali, e non più di 168 h tra uno e l'altro
  const recoveries = [];
  for (let i = 1; i < busy.length; i++) {
    const from = Math.max(...busy.slice(0, i).map((b) => b.to));
    const to = busy[i].from;
    if (to - from >= 36 * HOUR && countLocalNights(from, to, ctx) >= 2) recoveries.push({ fromMs: from, toMs: to });
  }
  const merged = [];
  for (const r of recoveries) {
    const last = merged.at(-1);
    if (last && r.fromMs <= last.toMs) last.toMs = Math.max(last.toMs, r.toMs);
    else merged.push({ ...r });
  }
  for (let i = 1; i < merged.length; i++) {
    const gap = (merged[i].fromMs - merged[i - 1].toMs) / HOUR;
    if (gap > 168) add('bad', isoDate(merged[i].fromMs), `${Math.round(gap)} h tra due recuperi estesi: massimo 168 h`);
    // 4 o più notti/presto/tardi tra due recuperi: il secondo recupero sale a 60 h
    const between = duties.filter((d) => d.startMs >= merged[i - 1].toMs && d.startMs < merged[i].fromMs);
    const disruptive = between.filter((d) => d.tags.some((x) => ['notte', 'presto', 'tardi'].includes(x))).length;
    if (disruptive >= 4 && (merged[i].toMs - merged[i].fromMs) / HOUR < 60) add('warn', isoDate(merged[i].fromMs), `${disruptive} servizi notte/presto/tardi: il recupero successivo dovrebbe essere di 60 h`);
  }

  issues.sort((a, b) => a.date.localeCompare(b.date) || (a.severity === 'bad' ? -1 : 1));
  return { duties, rests, cumulative, freeByMonth, recoveries: merged, issues, byDate: indexByDate(duties, rests) };
}

function addDay(iso) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
}

function indexByDate(duties, rests) {
  const map = new Map();
  for (const d of duties) for (const date of d.dates) (map.get(date) ?? map.set(date, { duties: [], rests: [] }).get(date)).duties.push(d);
  for (const r of rests) {
    const date = isoDate(r.toMs);
    (map.get(date) ?? map.set(date, { duties: [], rests: [] }).get(date)).rests.push(r);
  }
  return map;
}
