// Mini briefing di un giorno di volo: threat per aeroporto nella finestra oraria che interessa,
// e decisione su alternato al decollo / alternato (o doppio alternato) a destinazione.
// Applica le regole importate dall'utente (src/rules.js). Logica pura: i dati meteo arrivano già letti.
import { evaluateWindow, worst, isTs, isFog, isMist, isFreezing, isSnow, isRain, isDust, isHeavy } from './metar.js';
import { approachFor, landingMinima, planningMinima } from './rules.js';
import { icaoFor, iataFor, nearestAirports } from './icao.js';
import { coordsFor } from './airports-geo.js';
import { sunElevation, sunEvents } from './sun.js';
import { distanceKm } from './geo.js';

const HOUR = 3600000;
const MIN = 60000;
export const WINDOW_H = 1; // finestra del manuale: ETA ±1 ora
export const RANK = { ok: 0, info: 0, low: 1, med: 2, high: 3 };
const maxLevel = (list) => list.reduce((m, t) => (RANK[t.level] > RANK[m] ? t.level : m), 'ok');

const p2 = (n) => String(n).padStart(2, '0');
export const fmtZ = (ms) => `${p2(new Date(ms).getUTCHours())}:${p2(new Date(ms).getUTCMinutes())}Z`;
export const fmtDZ = (ms) => `${p2(new Date(ms).getUTCDate())} ${p2(new Date(ms).getUTCHours())}Z`;
const fmtRange = (a, b) => `${fmtDZ(a)} → ${fmtDZ(b)}`;

// ---------------------------------------------------------------- tratte del giorno
// Solo i voli veri (non i trasferimenti), con orari UTC completi.
export function flightLegs(tl) {
  return tl.legs
    .filter((e) => e.leg.kind === 'flight' && e.depMs != null && e.arrMs != null)
    .map((e, n) => ({ n, flight: `${e.leg.airline ?? ''} ${e.leg.number ?? ''}`.trim(), dep: e.leg.dep, arr: e.leg.arr, depMs: e.depMs, arrMs: e.arrMs, ac: e.leg.ac ?? null }));
}

// Stazioni (ICAO) da scaricare: partenza, arrivo, alternati candidati e quelli aggiunti a mano.
export function stationsNeeded(legs, rules, extraAlt = {}) {
  const set = new Set();
  const cands = legs.map((leg) => {
    const dest = nearestAirports(leg.arr, { maxNm: 400, count: 4 });
    const toa = nearestAirports(leg.dep, { maxNm: rules?.takeoffAlternate.maxDistanceNm ?? 0, count: 4 });
    const extra = (extraAlt[leg.n] ?? []).filter((x) => /^[A-Z]{4}$/.test(x));
    for (const a of [leg.dep, leg.arr]) if (icaoFor(a)) set.add(icaoFor(a));
    if (rules) {
      for (const c of [...dest, ...toa]) set.add(c.icao);
    }
    extra.forEach((x) => set.add(x));
    return { dest, toa, extra };
  });
  return { icaos: [...set].sort(), cands };
}

// ---------------------------------------------------------------- threat di un aeroporto nella sua finestra
const hardOf = (w, rules) => (!w?.prevailing ? null : rules?.tempoPolicy === 'ignore' ? w.prevailing : worst(w.prevailing, w.tempo));

function findGroup(w, pred) {
  return w?.groups.find((g) => g.inWindow && pred(g));
}

// Parola del TAF/METAR -> livello di attenzione (serve a evidenziare i threat dentro il testo)
export function tokenLevel(tok) {
  let m;
  if (/^(\+|-)?(VC)?(MI|PR|BC|DR|BL|SH)?TS/.test(tok) || /(CB|TCU)$/.test(tok)) return 'high';
  if (/^(\+|-)?FZ/.test(tok) || /^(\+|-)?(BC|MI|PR)?FG$/.test(tok)) return 'high';
  if (/^(\+|-)?(SH)?(SN|SG|PL|GR|GS|IC)/.test(tok)) return 'med';
  if (/^(\+|-)?(SH)?(RA|DZ)/.test(tok) || /^SH/.test(tok)) return tok.startsWith('+') ? 'med' : 'low';
  if (/^(DU|SA|SS|DS|VA)$/.test(tok.replace(/^[-+]|VC/g, ''))) return 'med';
  if (/^(BR|HZ)$/.test(tok)) return 'low';
  if (/^WS\d{3}\//.test(tok)) return 'med';
  if (/^\d{4}$/.test(tok)) return Number(tok) < 800 ? 'high' : Number(tok) < 1500 ? 'med' : Number(tok) < 5000 ? 'low' : null;
  if ((m = /^(BKN|OVC)(\d{3})/.exec(tok)) || (m = /^VV(\d{3})/.exec(tok))) {
    const ft = Number(m[m.length - 1]) * 100;
    return ft < 300 ? 'high' : ft < 500 ? 'med' : ft < 1000 ? 'low' : null;
  }
  if ((m = /^(?:\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(tok))) {
    const v = Number(m[2] ?? m[1]);
    return v >= 35 ? 'high' : v >= 25 ? 'med' : v >= 20 ? 'low' : null;
  }
  return null;
}

export function threatsForWindow({ role, iata, ms, w, metar, rules, nowMs }) {
  const out = [];
  const add = (level, id, title, detail, extra = {}) => out.push({ level, id, title, detail, apt: iata, role, ...extra });
  const hard = hardOf(w, rules);
  const when = (g) => (g ? `${g.raw} (${fmtRange(g.from, g.to)})` : '');

  if (hard) {
    // temporali / CB
    const tsPrev = w.prevailing.cb || isTs(w.prevailing.wx);
    const tsTempo = w.tempo && (w.tempo.cb || isTs(w.tempo.wx)) && !tsPrev;
    if (tsPrev) {
      const g = findGroup(w, (x) => x.kind !== 'PROB' && x.kind !== 'PROB-TEMPO' && /TS|CB/.test(x.raw));
      add('high', 'ts', 'Temporali / CB previsti', when(g) || 'previsti nelle condizioni prevalenti');
    } else if (tsTempo) {
      add('high', 'ts', 'Temporali / CB temporanei (TEMPO)', when(findGroup(w, (x) => x.kind === 'TEMPO' && /TS|CB/.test(x.raw))));
    }
    for (const [key, p] of [['prob40', 40], ['prob30', 30]]) {
      const s = w[key];
      if (s && (s.cb || isTs(s.wx)) && !tsPrev && !tsTempo) {
        add('med', 'ts', `Temporali / CB possibili (PROB${p})`, when(findGroup(w, (x) => x.prob === p && /TS|CB/.test(x.raw))), { prob: p });
        break;
      }
    }
    // visibilità
    const v = hard.visM;
    if (v != null && v < 5000) add(v < 800 ? 'high' : v < 1500 ? 'med' : 'low', 'vis', `Visibilità ridotta: ${v} m`, 'nella finestra, condizioni prevalenti o TEMPO');
    for (const s of [w.prob40, w.prob30]) {
      if (s && s.visM != null && s.visM < 1500 && (v == null || s.visM < v)) {
        add('med', 'vis', `Visibilità possibile ${s.visM} m (PROB)`, '');
        break;
      }
    }
    // nubi basse
    const c = hard.ceilingFt;
    if (c != null && c < 1000) add(c < 300 ? 'high' : c < 500 ? 'med' : 'low', 'ceil', `Nubi basse: ${c} ft`, 'base BKN/OVC o VV');
    // vento
    const wind = Math.max(hard.gustKt ?? 0, hard.windKt ?? 0);
    if (wind >= 20) add(wind >= 35 ? 'high' : wind >= 25 ? 'med' : 'low', 'wind', `Vento forte: ${hard.windDir != null ? String(hard.windDir).padStart(3, '0') + '° ' : ''}${hard.windKt ?? '?'}${hard.gustKt && hard.gustKt > (hard.windKt ?? 0) ? 'G' + hard.gustKt : ''} kt`, 'confronta con il vento al traverso del tuo limite');
    if (hard.ws) add('med', 'ws', 'Wind shear segnalato', `WS a ${hard.ws.heightFt} ft`);
    // fenomeni
    if (isFog(hard.wx)) add(v != null && v < 1000 ? 'high' : 'med', 'fog', 'Nebbia', hard.wx.join(' '));
    else if (isMist(hard.wx)) add('low', 'fog', 'Foschia', hard.wx.join(' '));
    if (isFreezing(hard.wx)) add('high', 'ice', 'Precipitazioni congelantesi', hard.wx.join(' '));
    if (isSnow(hard.wx)) add(isHeavy(hard.wx) ? 'high' : 'med', 'snow', 'Neve / ghiaccio', hard.wx.join(' '));
    if (isDust(hard.wx)) add(hard.wx.some((x) => /VA|SS|DS/.test(x)) ? 'high' : 'med', 'dust', 'Polvere / sabbia / foschia secca', hard.wx.join(' '));
    if (isRain(hard.wx) && !isTs(hard.wx)) add(isHeavy(hard.wx) ? 'med' : 'low', 'wet', 'Pista bagnata probabile', 'LDA ×1.15 se bagnata (OM A 8.1.2.4.6.2)');
    else if (!isRain(hard.wx) && (isRain(w.prob40?.wx) || isRain(w.prob30?.wx))) add('low', 'wet', 'Pista bagnata possibile (PROB)', '');
  }
  // dati
  if (!w || !w.partial) add('low', 'nodata', 'TAF non disponibile per la finestra', 'previsione assente o fuori validità: nessuna analisi');
  else if (!w.covered) add('low', 'partial', 'TAF copre solo in parte la finestra', 'riguarda di nuovo il TAF più tardi');
  // osservazione attuale (solo se l'ora di interesse è vicina)
  if (metar && nowMs != null && ms - nowMs < 3 * HOUR && ms - nowMs > -HOUR && nowMs - metar.timeMs < 2 * HOUR) {
    if (isTs(metar.wx) || metar.cb) add('high', 'ts-now', 'Temporale osservato adesso (METAR)', metar.raw);
    if (metar.visM != null && metar.visM < 1500) add('med', 'vis-now', `Visibilità osservata ${metar.visM} m (METAR)`, metar.raw);
  }
  // nebbia da irraggiamento: aria calma e T-Td piccola, di notte
  const co = coordsFor(iata);
  const dark = co ? sunElevation(co[0], co[1], ms) < -0.833 : null;
  if (metar && dark && metar.temp != null && metar.dew != null && metar.temp - metar.dew <= 3 && (metar.wind?.speed ?? 0) <= 6 && !isFog(hard?.wx ?? []) && nowMs - metar.timeMs < 12 * HOUR) {
    add(metar.temp - metar.dew <= 2 ? 'med' : 'low', 'fog-risk', 'Nebbia da irraggiamento possibile', `T/Td ${metar.temp}/${metar.dew} e vento ${metar.wind?.speed ?? 0} kt nel METAR delle ${fmtZ(metar.timeMs)}`);
  }
  if (dark) add('low', 'night', role === 'dep' ? 'Decollo di notte' : 'Atterraggio di notte', '');
  return { threats: out.sort((a, b) => RANK[b.level] - RANK[a.level]), dark };
}

// ---------------------------------------------------------------- minime e alternati
function describeBreach(s, min) {
  const r = [];
  if (s.visM != null && s.visM < min.visM) r.push(`visibilità ${s.visM} m < ${min.visM} m`);
  if (min.ceilingFt != null && s.ceilingFt != null && s.ceilingFt < min.ceilingFt) r.push(`nubi ${s.ceilingFt} ft < ${min.ceilingFt} ft`);
  return r.join(', ');
}

// ok / marginal (solo un PROB sotto le minime) / no / nodata
export function statusAgainst(w, min, rules) {
  if (!w || !w.partial || !w.prevailing) return { status: 'nodata', why: 'previsione non disponibile' };
  const hard = hardOf(w, rules);
  const breach = (s) => (s.visM != null && s.visM < min.visM) || (min.ceilingFt != null && s.ceilingFt != null && s.ceilingFt < min.ceilingFt);
  const partial = !w.covered;
  if (breach(hard)) return { status: 'no', why: describeBreach(hard, min), partial };
  const policy = rules?.probPolicy ?? 'marginal';
  if (policy !== 'ignore') {
    for (const s of [w.prob30, w.prob40]) {
      if (s && breach(worst(hard, s))) return { status: policy === 'worst' ? 'no' : 'marginal', why: `PROB: ${describeBreach(worst(hard, s), min)}`, partial };
    }
  }
  return { status: 'ok', why: '', partial };
}

const wxOf = (wx, icao) => wx[icao] ?? { taf: null, metar: null };
const winAt = (ms) => [ms - WINDOW_H * HOUR, ms + WINDOW_H * HOUR];

function evalCandidates(list, { wx, rules, windowOf, minimaOf }) {
  return list
    .map((c) => {
      const app = approachFor(rules, c.iata);
      const [a, b] = windowOf(c);
      const st = statusAgainst(evaluateWindow(wxOf(wx, c.icao).taf, a, b), minimaOf(app), rules);
      return { ...c, approach: app.name, assumedApproach: app.assumed, ...st };
    })
    .sort((x, y) => ['ok', 'marginal', 'nodata', 'no'].indexOf(x.status) - ['ok', 'marginal', 'nodata', 'no'].indexOf(y.status) || x.nm - y.nm);
}

// Alternato a destinazione (OM A 8.1.0.2.1, 8.1.0.3.1, 8.1.0.3.2, 8.1.0.4.2)
export function destAlternates({ leg, wx, rules, candidates, extra = [] }) {
  const icao = icaoFor(leg.arr);
  const app = approachFor(rules, leg.arr);
  const [a, b] = winAt(leg.arrMs);
  const w = evaluateWindow(wxOf(wx, icao).taf, a, b);
  const land = statusAgainst(w, landingMinima(app), rules);
  const plan = statusAgainst(w, planningMinima(rules, app), rules);
  const hard = hardOf(w, rules);
  const flightMin = Math.round((leg.arrMs - leg.depMs) / MIN);
  const reasons = [];
  let need;
  let consider2 = false;
  const refs = [];
  if (land.status === 'nodata') {
    need = 2;
    reasons.push('Nessuna previsione disponibile per la destinazione nella finestra ETA ±1 h.');
    refs.push('OM A 8.1.0.3.1');
  } else if (land.status === 'no') {
    need = 2;
    reasons.push(`Destinazione sotto le minime di atterraggio nella finestra ETA ±1 h: ${land.why}.`);
    refs.push('OM A 8.1.0.3.1', 'OM A 8.1.0.4');
  } else {
    const fails = [];
    if (flightMin > rules.noAlternate.maxFlightMin) fails.push(`volo di ${Math.floor(flightMin / 60)}h${p2(flightMin % 60)} (oltre ${rules.noAlternate.maxFlightMin / 60} h)`);
    if (!app.separateRunways) fails.push(`${leg.arr} ha una sola pista, o non risultano due piste separate utilizzabili`);
    if (hard.ceilingFt != null && hard.ceilingFt < rules.noAlternate.minCeilingFt) fails.push(`nubi ${hard.ceilingFt} ft sotto ${rules.noAlternate.minCeilingFt} ft`);
    if (hard.visM != null && hard.visM < rules.noAlternate.minVisM) fails.push(`visibilità ${hard.visM} m sotto ${rules.noAlternate.minVisM} m`);
    if (land.status === 'marginal') fails.push('condizioni PROB sotto le minime');
    refs.push('OM A 8.1.0.3.2');
    if (!fails.length) {
      need = 0;
      reasons.push(`Si può pianificare senza alternato: volo ≤ ${rules.noAlternate.maxFlightMin / 60} h, due piste separate, nubi ≥ ${rules.noAlternate.minCeilingFt} ft e visibilità ≥ ${rules.noAlternate.minVisM / 1000} km nella finestra. Servono 15 min di carburante addizionale (OM A 8.1.7.2.1).`);
    } else {
      need = 1;
      reasons.push(`Serve un alternato: ${fails.join('; ')}.`);
    }
    if (plan.status !== 'ok') {
      consider2 = true;
      reasons.push(`Destinazione al limite (sotto le minime di pianificazione degli alternati: ${plan.why}): il comandante può considerarla non idonea e scegliere due alternati.`);
      refs.push('OM A 8.1.0.4');
    }
    if (isTs(hard.wx) || w.tempo?.cb || w.prevailing.cb) reasons.push('Temporali nella finestra: tieni presente il carburante per attesa e deviazioni.');
  }
  const cands = evalCandidates([...candidates, ...extra], {
    wx,
    rules,
    windowOf: (c) => {
      const dt = Math.round(c.nm / 7) * MIN + 10 * MIN; // ~420 kt di ritorno + manovra
      return winAt(leg.arrMs + dt);
    },
    minimaOf: (ap) => planningMinima(rules, ap),
  });
  return { need, label: need === 0 ? 'Nessuno' : need === 1 ? '1 alternato' : '2 alternati', consider2, reasons, refs, approach: app, destStatus: land.status, candidates: cands, okCount: cands.filter((c) => c.status === 'ok').length };
}

// Alternato al decollo (OM A 8.1.0.4.1, 8.1.5.2.1)
export function takeoffAlternate({ leg, wx, rules, candidates, extra = [] }) {
  const icao = icaoFor(leg.dep);
  const app = approachFor(rules, leg.dep);
  const floor = rules.takeoffAlternate.floorVisM;
  const minima = (ap) => ({ visM: Math.max(landingMinima(ap).visM, floor), ceilingFt: landingMinima(ap).ceilingFt });
  const [a, b] = winAt(leg.depMs);
  const w = evaluateWindow(wxOf(wx, icao).taf, a, b);
  const st = statusAgainst(w, minima(app), rules);
  const refs = ['OM A 8.1.0.4.1', 'OM A 8.1.5.2.1'];
  let need;
  const reasons = [];
  if (st.status === 'nodata') {
    need = null;
    reasons.push('Previsione di partenza non disponibile: impossibile valutare.');
  } else if (st.status === 'no') {
    need = true;
    reasons.push(`Il tempo alla partenza è sotto le minime di atterraggio (non meno di CAT I): ${st.why}. Serve un alternato al decollo.`);
  } else if (st.status === 'marginal') {
    need = 'maybe';
    reasons.push(`Possibile (PROB) sotto le minime di atterraggio alla partenza: ${st.why}. Valuta un alternato al decollo.`);
  } else {
    need = false;
    reasons.push('Il tempo alla partenza è sopra le minime di atterraggio: rientro possibile per il meteo.');
  }
  reasons.push('Restano da valutare a parte: prestazioni con un motore, condizioni della pista e altri motivi che impediscano il rientro.');
  const cands = evalCandidates([...candidates, ...extra], { wx, rules, windowOf: () => winAt(leg.depMs + rules.takeoffAlternate.assumedReturnMin * MIN), minimaOf: minima });
  return { need, reasons, refs, approach: app, depStatus: st.status, maxNm: rules.takeoffAlternate.maxDistanceNm, candidates: cands, okCount: cands.filter((c) => c.status === 'ok').length };
}

// ---------------------------------------------------------------- rotta
export function routeThreats(route, leg) {
  const out = [];
  if (!route) return out;
  for (const s of route.segments ?? []) {
    const lvl = s.level >= 3 ? (s.thunder ? 'high' : 'med') : 'low';
    out.push({ level: lvl, id: 'route-cb', title: s.thunder ? 'Temporali previsti lungo la rotta' : s.level >= 3 ? 'Forte instabilità lungo la rotta' : 'Instabilità lungo la rotta', detail: `${fmtZ(s.fromMs)}–${fmtZ(s.toMs)} · NM ${s.fromNm}–${s.toNm} · CAPE max ${Math.round(s.maxCape)} J/kg (modello)`, apt: null, role: 'route' });
  }
  for (const s of route.sigmets ?? []) {
    const sev = /SEV|EMBD|FRQ/.test(s.qualifier) || /SEV/.test(s.raw);
    const lvl = s.hazard === 'VA' || (s.hazard === 'TURB' && sev) || s.hazard === 'TS' ? 'high' : 'med';
    out.push({ level: lvl, id: 'route-sigmet', title: `SIGMET ${s.hazard}${s.qualifier ? ' ' + s.qualifier : ''} sulla rotta`, detail: `${s.fir} ${s.id} · NM ${s.fromNm}–${s.toNm}${s.topFt ? ` · tops ${s.topFt} ft` : ''}`, apt: null, role: 'route', raw: s.raw });
  }
  if (route.error) out.push({ level: 'low', id: 'route-err', title: 'Meteo di rotta non disponibile', detail: route.error, apt: null, role: 'route' });
  return out.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

// ---------------------------------------------------------------- briefing del giorno
export function briefDay({ legs, wx, rules, route = {}, extraAlt = {}, nowMs = Date.now(), notams = null }) {
  const stations = stationsNeeded(legs, rules, extraAlt);
  const briefLegs = legs.map((leg, i) => {
    const depI = icaoFor(leg.dep);
    const arrI = icaoFor(leg.arr);
    const wDep = depI ? evaluateWindow(wxOf(wx, depI).taf, ...winAt(leg.depMs)) : null;
    const wArr = arrI ? evaluateWindow(wxOf(wx, arrI).taf, ...winAt(leg.arrMs)) : null;
    const dep = depI ? threatsForWindow({ role: 'dep', iata: leg.dep, ms: leg.depMs, w: wDep, metar: wxOf(wx, depI).metar, rules, nowMs }) : { threats: [{ level: 'low', id: 'noicao', title: `${leg.dep}: codice ICAO sconosciuto`, detail: 'briefing non disponibile per questo aeroporto', apt: leg.dep, role: 'dep' }], dark: null };
    const arr = arrI ? threatsForWindow({ role: 'arr', iata: leg.arr, ms: leg.arrMs, w: wArr, metar: wxOf(wx, arrI).metar, rules, nowMs }) : { threats: [{ level: 'low', id: 'noicao', title: `${leg.arr}: codice ICAO sconosciuto`, detail: 'briefing non disponibile per questo aeroporto', apt: leg.arr, role: 'arr' }], dark: null };
    const cand = stations.cands[i];
    const alt = rules && depI && arrI ? { dest: destAlternates({ leg, wx, rules, candidates: cand.dest, extra: extraCands(cand.extra, leg.arr) }), toa: takeoffAlternate({ leg, wx, rules, candidates: cand.toa, extra: extraCands(cand.extra, leg.dep) }) } : null;
    const rt = routeThreats(route[i], leg);
    // rotazione breve verso il tratto successivo
    const turn = [];
    const next = legs[i + 1];
    if (next && next.dep === leg.arr) {
      const turnMin = Math.round((next.depMs - leg.arrMs) / MIN);
      const wT = arrI ? evaluateWindow(wxOf(wx, arrI).taf, leg.arrMs - 30 * MIN, next.depMs + 30 * MIN) : null;
      const tsAny = wT?.partial && [wT.prevailing, wT.tempo, wT.prob40, wT.prob30].some((s) => s && (s.cb || isTs(s.wx)));
      if (turnMin < 60) turn.push({ level: tsAny ? 'high' : 'med', id: 'turn', title: `Rotazione breve a ${leg.arr}: ${turnMin} min`, detail: tsAny ? 'con temporali possibili: i fulmini fermano rampa e rifornimento' : 'poco margine per sbarco, rifornimento e imbarco', apt: leg.arr, role: 'turn' });
      else if (tsAny) turn.push({ level: 'med', id: 'turn-ts', title: `Temporali possibili durante la rotazione a ${leg.arr} (${turnMin} min)`, detail: 'i fulmini fermano rampa e rifornimento', apt: leg.arr, role: 'turn' });
    }
    const all = [...dep.threats, ...arr.threats, ...rt, ...turn];
    return {
      leg,
      dep: { iata: leg.dep, icao: depI, ms: leg.depMs, window: winAt(leg.depMs), w: wDep, metar: depI ? wxOf(wx, depI).metar : null, taf: depI ? wxOf(wx, depI).taf : null, threats: dep.threats, level: maxLevel(dep.threats), dark: dep.dark, sun: sunOf(leg.dep, leg.depMs) },
      arr: { iata: leg.arr, icao: arrI, ms: leg.arrMs, window: winAt(leg.arrMs), w: wArr, metar: arrI ? wxOf(wx, arrI).metar : null, taf: arrI ? wxOf(wx, arrI).taf : null, threats: arr.threats, level: maxLevel(arr.threats), dark: arr.dark, sun: sunOf(leg.arr, leg.arrMs) },
      route: { threats: rt, data: route[i] ?? null },
      turn,
      alt,
      level: maxLevel(all),
    };
  });
  const flat = briefLegs.flatMap((b) => [...b.dep.threats, ...b.arr.threats, ...b.route.threats, ...b.turn]).filter((t) => RANK[t.level] >= RANK.med);
  const seen = new Set();
  const top = [];
  for (const t of flat.sort((a, b) => RANK[b.level] - RANK[a.level])) {
    const key = `${t.id}|${t.apt}|${t.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top.push(t);
  }
  const needNotam = notams?.items?.filter((n) => n.relevant && n.active && RANK[n.level] >= RANK.med) ?? [];
  return { legs: briefLegs, top, level: maxLevel([...top, ...needNotam]), stations: stations.icaos, notams };
}

function sunOf(iata, ms) {
  const c = coordsFor(iata);
  return c ? sunEvents(c[0], c[1], ms) : null;
}

// Alternati aggiunti a mano (codici ICAO dell'OFP): distanza dall'aeroporto di riferimento se nota
function extraCands(icaos, fromIata) {
  const here = coordsFor(fromIata);
  return icaos.map((icao) => {
    const iata = iataFor(icao);
    const c = iata ? coordsFor(iata) : null;
    return { icao, iata: iata ?? icao, nm: here && c ? Math.round(distanceKm(here, c) / 1.852) : 0, extra: true };
  });
}
