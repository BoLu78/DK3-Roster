// Lettura di METAR e TAF (testo grezzo -> dati) e valutazione di una finestra oraria.
// Logica pura: niente rete, niente interfaccia. Visibilità in metri, nubi in piedi, vento in nodi.

const MIN = 60000;
const HOUR = 3600000;

// ---------------------------------------------------------------- date dei gruppi
// "05" + "14" -> istante UTC. Il mese si sceglie in modo che l'istante sia il più vicino a refMs.
export function resolveDay(dd, hh, mm, refMs) {
  const ref = new Date(refMs);
  let best = null;
  for (const dm of [-1, 0, 1]) {
    const ms = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + dm, dd, hh, mm);
    if (new Date(ms).getUTCDate() !== dd && hh !== 24) continue; // giorno inesistente nel mese
    if (best == null || Math.abs(ms - refMs) < Math.abs(best - refMs)) best = ms;
  }
  return best;
}

// ---------------------------------------------------------------- elementi comuni
const WIND = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/;
const CLOUD = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/;
const VV = /^VV(\d{3}|\/\/\/)$/;
const WX = /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/;
const RVR = /^R(\d{2}[LCR]?)\/([PM])?(\d{4})(?:V([PM])?(\d{4}))?[UDN]?$/;

const kt = (v, unit) => (unit === 'MPS' ? Math.round(v * 1.944) : v);

// Legge i gruppi meteo di una lista di parole. Restituisce solo ciò che trova.
export function parseConditions(tokens) {
  const c = { wind: null, visM: null, cavok: false, nsw: false, wx: [], clouds: [], vvFt: null, nsc: false, ws: null, rvr: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let m;
    if ((m = WIND.exec(t))) {
      c.wind = { dir: m[1] === 'VRB' ? null : Number(m[1]), speed: kt(Number(m[2]), m[4]), gust: m[3] ? kt(Number(m[3]), m[4]) : null };
    } else if (t === 'CAVOK') {
      c.cavok = true;
      c.visM = 9999;
    } else if (t === 'NSW') c.nsw = true;
    else if (t === 'NSC' || t === 'NCD' || t === 'SKC' || t === 'CLR') c.nsc = true;
    else if (/^\d{4}$/.test(t) && c.visM == null) c.visM = Number(t);
    else if ((m = /^(P|M)?(\d+)(?:\/(\d+))?SM$/.exec(t))) {
      const whole = m[3] ? Number(m[2]) / Number(m[3]) : Number(m[2]);
      c.visM = m[1] === 'P' ? 9999 : Math.round(whole * 1609);
    } else if ((m = CLOUD.exec(t))) c.clouds.push({ cover: m[1], baseFt: Number(m[2]) * 100, cb: m[3] === 'CB', tcu: m[3] === 'TCU' });
    else if ((m = VV.exec(t))) c.vvFt = m[1] === '///' ? 0 : Number(m[1]) * 100;
    else if ((m = /^WS(\d{3})\/(\d{3})(\d{2,3})KT$/.exec(t))) c.ws = { heightFt: Number(m[1]) * 100, dir: Number(m[2]), speed: Number(m[3]) };
    else if ((m = RVR.exec(t))) c.rvr.push({ rwy: m[1], m: Number(m[3]) });
    else if (t.length >= 2 && t.length <= 8 && WX.test(t) && /[A-Z]{2}/.test(t) && !/^(TX|TN|RMK|NOSIG|AUTO|COR|AMD|NIL|CNL|BECMG|TEMPO|FM|PROB)/.test(t)) c.wx.push(t);
  }
  c.ceilingFt = ceilingOf(c);
  c.cb = c.clouds.some((x) => x.cb) || c.wx.some((w) => /TS/.test(w));
  return c;
}

// Base della nube più bassa BKN/OVC (o visibilità verticale); null se non c'è.
export function ceilingOf(c) {
  const bases = c.clouds.filter((x) => x.cover === 'BKN' || x.cover === 'OVC').map((x) => x.baseFt);
  if (c.vvFt != null) bases.push(c.vvFt);
  return bases.length ? Math.min(...bases) : null;
}

// ---------------------------------------------------------------- METAR
export function parseMetar(raw, refMs = Date.now()) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/=$/, '');
  if (!text) return null;
  const tokens = text.split(' ');
  let i = 0;
  let kind = 'METAR';
  if (tokens[i] === 'METAR' || tokens[i] === 'SPECI') kind = tokens[i++];
  if (tokens[i] === 'COR') i++;
  const station = tokens[i++];
  const tm = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] ?? '');
  if (!/^[A-Z]{4}$/.test(station ?? '') || !tm) return null;
  i++;
  const timeMs = resolveDay(Number(tm[1]), Number(tm[2]), Number(tm[3]), refMs);
  const rest = tokens.slice(i);
  const cut = rest.findIndex((t) => t === 'RMK');
  const body = cut >= 0 ? rest.slice(0, cut) : rest;
  const trendAt = body.findIndex((t) => t === 'NOSIG' || t === 'BECMG' || t === 'TEMPO');
  const main = trendAt >= 0 ? body.slice(0, trendAt) : body;
  const trend = trendAt >= 0 ? body.slice(trendAt) : [];
  const cond = parseConditions(main.filter((t) => t !== 'AUTO'));
  let temp = null;
  let dew = null;
  let qnh = null;
  for (const t of main) {
    const m = /^(M?\d{2})\/(M?\d{2})?$/.exec(t);
    if (m) {
      temp = Number(m[1].replace('M', '-'));
      dew = m[2] != null ? Number(m[2].replace('M', '-')) : null;
    }
    const q = /^Q(\d{4})$/.exec(t);
    if (q) qnh = Number(q[1]);
    const a = /^A(\d{4})$/.exec(t);
    if (a) qnh = Math.round((Number(a[1]) / 100) * 33.8639);
  }
  let trendCond = null;
  if (trend.length && trend[0] !== 'NOSIG') trendCond = { kind: trend[0], text: trend.join(' '), ...parseConditions(trend.slice(1)) };
  return { raw: text, kind, station, timeMs, ...cond, temp, dew, qnh, nosig: trend[0] === 'NOSIG', trend: trendCond };
}

// ---------------------------------------------------------------- TAF
const isFm = (t) => /^FM\d{6}$/.test(t);
const isRange = (t) => /^\d{4}\/\d{4}$/.test(t);
const isProb = (t) => /^PROB(30|40)$/.test(t);

export function parseTaf(raw, refMs = Date.now()) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/=$/, '');
  if (!text) return null;
  const tokens = text.split(' ');
  let i = 0;
  while (tokens[i] === 'TAF' || tokens[i] === 'AMD' || tokens[i] === 'COR') i++;
  const station = tokens[i++];
  const iss = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] ?? '');
  if (!/^[A-Z]{4}$/.test(station ?? '') || !iss) return null;
  i++;
  const issuedMs = resolveDay(Number(iss[1]), Number(iss[2]), Number(iss[3]), refMs);
  if (!isRange(tokens[i] ?? '')) return null;
  const range = (t, ref) => {
    const [a, b] = t.split('/');
    const from = resolveDay(Number(a.slice(0, 2)), Number(a.slice(2)), 0, ref);
    let to = resolveDay(Number(b.slice(0, 2)), Number(b.slice(2)), 0, ref);
    if (to <= from) to += 24 * HOUR; // salvaguardia: "0624" a fine mese
    return [from, to];
  };
  const [validFrom, validTo] = range(tokens[i++], issuedMs);

  // dividere in gruppi: BASE, FM, BECMG, TEMPO, PROB30/40 [TEMPO]
  const groups = [{ kind: 'BASE', prob: null, from: validFrom, to: validTo, tokens: [] }];
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'RMK' || t === 'NXT' || t === 'LAST') break;
    if (isFm(t)) {
      groups.push({ kind: 'FM', prob: null, from: resolveDay(Number(t.slice(2, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8)), validFrom), to: validTo, tokens: [t] });
    } else if ((t === 'BECMG' || t === 'TEMPO') && isRange(tokens[i + 1] ?? '')) {
      const [from, to] = range(tokens[i + 1], validFrom);
      groups.push({ kind: t, prob: null, from, to, tokens: [t, tokens[i + 1]] });
      i++;
    } else if (isProb(t)) {
      const prob = Number(t.slice(4));
      let kind = 'PROB';
      let used = 1;
      if (tokens[i + 1] === 'TEMPO') {
        kind = 'PROB-TEMPO';
        used = 2;
      }
      if (isRange(tokens[i + used] ?? '')) {
        const [from, to] = range(tokens[i + used], validFrom);
        groups.push({ kind, prob, from, to, tokens: tokens.slice(i, i + used + 1) });
        i += used;
      }
    } else if (/^T[XN]M?\d{2}\/\d{4}Z$/.test(t)) {
      /* temperature massime/minime: non servono */
    } else groups[groups.length - 1].tokens.push(t);
  }
  const periods = groups.map((g) => {
    const head = g.kind === 'BASE' ? [] : g.tokens.filter((t) => isFm(t) || t === 'BECMG' || t === 'TEMPO' || isProb(t) || isRange(t));
    const body = g.tokens.filter((t) => !head.includes(t));
    const cond = parseConditions(body);
    return { kind: g.kind, prob: g.prob, from: g.from, to: g.to, raw: g.tokens.join(' '), ...cond };
  });
  return { raw: text, station, issuedMs, validFrom, validTo, periods };
}

// ---------------------------------------------------------------- stato previsto
const emptyState = () => ({ visM: null, wind: null, wx: [], clouds: [], vvFt: null, ceilingFt: null, ws: null });

// Applica un gruppo a uno stato. FM sostituisce tutto; BECMG e BASE cambiano solo ciò che dicono.
function applyPeriod(state, p, { reset = false } = {}) {
  const s = reset ? emptyState() : { ...state, wx: [...state.wx], clouds: [...state.clouds] };
  if (p.wind) s.wind = p.wind;
  if (p.cavok) {
    s.visM = 9999;
    s.clouds = [];
    s.vvFt = null;
    s.wx = [];
  } else {
    if (p.visM != null) s.visM = p.visM;
    if (p.clouds.length || p.vvFt != null || p.nsc) {
      s.clouds = p.clouds.slice();
      s.vvFt = p.vvFt;
    }
  }
  if (p.nsw) s.wx = [];
  else if (p.wx.length) s.wx = p.wx.slice();
  if (p.ws) s.ws = p.ws;
  s.ceilingFt = ceilingOf(s);
  return s;
}

// Il peggiore tra due stati (visibilità minima, nube più bassa, vento più forte, fenomeni uniti).
export function worst(a, b) {
  if (!a) return b;
  if (!b) return a;
  const min = (x, y) => (x == null ? y : y == null ? x : Math.min(x, y));
  const max = (x, y) => (x == null ? y : y == null ? x : Math.max(x, y));
  return {
    visM: min(a.visM, b.visM),
    ceilingFt: min(a.ceilingFt, b.ceilingFt),
    windKt: max(a.windKt, b.windKt),
    gustKt: max(a.gustKt, b.gustKt),
    wx: [...new Set([...(a.wx ?? []), ...(b.wx ?? [])])],
    cb: !!(a.cb || b.cb),
    ws: a.ws || b.ws || null,
  };
}

export function summarize(s) {
  return {
    visM: s.visM,
    ceilingFt: s.ceilingFt ?? null,
    windKt: s.wind ? s.wind.speed : null,
    windDir: s.wind ? s.wind.dir : null,
    gustKt: s.wind ? (s.wind.gust ?? s.wind.speed) : null,
    wx: s.wx.slice(),
    cb: s.clouds.some((c) => c.cb) || s.wx.some((w) => /TS/.test(w)),
    ws: s.ws,
  };
}

// Segmenti di tempo con lo stato "prevalente" (base + FM + BECMG; durante un BECMG vale il peggiore dei due stati).
export function baseSegments(taf) {
  const base = taf.periods[0];
  let state = applyPeriod(emptyState(), base);
  const events = taf.periods.filter((p) => p.kind === 'FM' || p.kind === 'BECMG').sort((a, b) => a.from - b.from);
  const segs = [];
  let t = taf.validFrom;
  const push = (to, st, transition = null) => {
    if (to > t) segs.push({ from: t, to, state: st, transition });
    t = Math.max(t, to);
  };
  for (const p of events) {
    if (p.kind === 'FM') {
      push(p.from, state);
      state = applyPeriod(state, p, { reset: true });
    } else {
      push(p.from, state);
      const next = applyPeriod(state, p);
      const mixed = { ...next, visM: minNull(state.visM, next.visM), ceilingFt: minNull(state.ceilingFt, next.ceilingFt), wx: [...new Set([...state.wx, ...next.wx])], clouds: [...state.clouds, ...next.clouds], wind: strongest(state.wind, next.wind) };
      push(Math.max(p.to, p.from), mixed, p);
      state = next;
    }
  }
  push(taf.validTo, state);
  return segs;
}

function minNull(x, y) {
  return x == null ? y : y == null ? x : Math.min(x, y);
}
function strongest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (b.gust ?? b.speed) > (a.gust ?? a.speed) ? b : a;
}

// Valuta una finestra [fromMs, toMs]: condizioni prevalenti, TEMPO e PROB sovrapposti.
// Restituisce null se il TAF non copre la finestra.
export function evaluateWindow(taf, fromMs, toMs) {
  if (!taf) return null;
  const covered = fromMs >= taf.validFrom && toMs <= taf.validTo;
  const partial = toMs > taf.validFrom && fromMs < taf.validTo;
  if (!partial) return { covered: false, partial: false };
  const segs = baseSegments(taf).filter((s) => s.to > fromMs && s.from < toMs);
  let prevailing = null;
  for (const s of segs) prevailing = worst(prevailing, summarize(s.state));
  const out = { covered, partial, prevailing, tempo: null, prob30: null, prob40: null, groups: [] };
  const take = (field, st) => (out[field] = worst(out[field], st));
  for (const p of taf.periods) {
    const inWindow = p.to > fromMs && p.from < toMs;
    out.groups.push({ kind: p.kind, prob: p.prob, from: p.from, to: p.to, raw: p.raw, inWindow });
    if (!inWindow) continue;
    if (p.kind === 'TEMPO' || p.kind === 'PROB-TEMPO' || p.kind === 'PROB') {
      // la parte temporanea modifica lo stato prevalente solo negli elementi che nomina
      for (const s of baseSegments(taf)) {
        if (s.to <= Math.max(fromMs, p.from) || s.from >= Math.min(toMs, p.to)) continue;
        const st = summarize(applyPeriod(s.state, p));
        if (p.kind === 'TEMPO') take('tempo', st);
        else if (p.prob === 30) take('prob30', st);
        else take('prob40', st);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- fenomeni
export const isTs = (wx = []) => wx.some((w) => /TS/.test(w));
export const isFog = (wx = []) => wx.some((w) => /FG/.test(w) && !/^MI|^BC|^PR/.test(w.replace(/^[-+]/, '')) );
export const isMist = (wx = []) => wx.some((w) => /BR/.test(w));
export const isFreezing = (wx = []) => wx.some((w) => /FZ/.test(w));
export const isSnow = (wx = []) => wx.some((w) => /SN|SG|IC|PL|GR|GS/.test(w));
export const isRain = (wx = []) => wx.some((w) => /RA|DZ|SH/.test(w));
export const isDust = (wx = []) => wx.some((w) => /DU|SA|SS|DS|VA|HZ/.test(w));
export const isHeavy = (wx = []) => wx.some((w) => w.startsWith('+'));

// Differenze tra due versioni dello stesso TAF: gruppi comparsi e gruppi spariti (testo dei gruppi).
export function diffTaf(oldTaf, newTaf) {
  if (!oldTaf || !newTaf) return { added: [], removed: [] };
  const a = new Set(oldTaf.periods.map((p) => `${p.kind}${p.prob ?? ''} ${p.raw}`));
  const b = new Set(newTaf.periods.map((p) => `${p.kind}${p.prob ?? ''} ${p.raw}`));
  const label = (p) => p.raw;
  return {
    added: newTaf.periods.filter((p) => !a.has(`${p.kind}${p.prob ?? ''} ${p.raw}`)).map(label),
    removed: oldTaf.periods.filter((p) => !b.has(`${p.kind}${p.prob ?? ''} ${p.raw}`)).map(label),
  };
}
