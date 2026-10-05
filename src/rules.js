// Regole di pianificazione (minime, alternati) lette da un file che l'utente importa nell'app.
// I numeri della compagnia NON stanno nel codice né nel repository: arrivano dal file importato
// (conservato solo sul telefono). Senza il file il briefing mostra meteo e threat, ma non decide gli alternati.

export const RULES_FORMAT = 'dk3-rules';

const num = (v, name, { min = 0, max = 100000 } = {}) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Regole: “${name}” non è un numero valido`);
  return v;
};

// Controlla il file e lo completa. Lancia un errore con messaggio in italiano se qualcosa non va.
export function normalizeRules(json) {
  if (!json || json.format !== RULES_FORMAT) throw new Error('Questo file non è un file di regole di DK3 Roster.');
  const pm = json.planningMinima ?? {};
  const planning = {};
  for (const k of ['B', 'A', 'circling']) {
    planning[k] = { ceilingAdd: num(pm[k]?.ceilingAdd, `planningMinima.${k}.ceilingAdd`), visAdd: num(pm[k]?.visAdd, `planningMinima.${k}.visAdd`) };
  }
  const approaches = {};
  for (const [name, a] of Object.entries(json.approaches ?? {})) {
    if (!['B', 'A', 'circling'].includes(a.type)) throw new Error(`Regole: approccio “${name}” con tipo non valido`);
    approaches[name] = { type: a.type, dh: a.dh ?? a.mdh ?? null, vis: num(a.rvr ?? a.vis, `approaches.${name}.rvr`) };
    if (a.type !== 'B') num(approaches[name].dh, `approaches.${name}.mdh`);
    else if (approaches[name].dh != null) num(approaches[name].dh, `approaches.${name}.dh`);
  }
  if (!approaches[json.defaultApproach]) throw new Error('Regole: manca l’approccio predefinito (defaultApproach)');
  const na = json.noAlternate ?? {};
  const ta = json.takeoffAlternate ?? {};
  const airports = {};
  for (const [iata, a] of Object.entries(json.airports ?? {})) {
    if (a.approach && !approaches[a.approach]) throw new Error(`Regole: aeroporto ${iata} usa un approccio che non esiste (${a.approach})`);
    airports[iata] = { approach: a.approach ?? null, separateRunways: !!a.separateRunways, runways: a.runways ?? null };
  }
  return {
    company: String(json.company ?? ''),
    fleet: String(json.fleet ?? ''),
    note: String(json.note ?? ''),
    planning,
    approaches,
    defaultApproach: json.defaultApproach,
    noAlternate: {
      maxFlightMin: num(na.maxFlightMin, 'noAlternate.maxFlightMin'),
      minCeilingFt: num(na.minCeilingFt, 'noAlternate.minCeilingFt'),
      minVisM: num(na.minVisM, 'noAlternate.minVisM'),
    },
    takeoffAlternate: {
      maxDistanceNm: num(ta.maxDistanceNm, 'takeoffAlternate.maxDistanceNm'),
      floorVisM: num(ta.floorVisM, 'takeoffAlternate.floorVisM'),
      assumedReturnMin: num(ta.assumedReturnMin, 'takeoffAlternate.assumedReturnMin'),
    },
    tempoPolicy: json.tempoPolicy === 'ignore' ? 'ignore' : 'worst',
    probPolicy: ['ignore', 'marginal', 'worst'].includes(json.probPolicy) ? json.probPolicy : 'marginal',
    airports,
  };
}

// Approccio previsto per un aeroporto. `assumed` = non indicato nel file: si usa quello predefinito.
export function approachFor(rules, iata) {
  const cfg = rules.airports[iata];
  const name = cfg?.approach ?? rules.defaultApproach;
  return { name, ...rules.approaches[name], assumed: !cfg?.approach, separateRunways: !!cfg?.separateRunways };
}

// Minime di atterraggio dell'approccio: visibilità (m) e, se serve, nube minima (ft)
export function landingMinima(app) {
  return { visM: app.vis, ceilingFt: app.type === 'B' ? null : app.dh };
}

// Minime di pianificazione per alternati (tabella 8.1.0.4.2 del manuale)
export function planningMinima(rules, app) {
  const add = rules.planning[app.type];
  const dh = app.dh ?? 0;
  return { visM: app.vis + add.visAdd, ceilingFt: dh + add.ceilingAdd };
}
