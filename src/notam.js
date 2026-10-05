// NOTAM incollati dall'utente (dal pacchetto del volo): l'app li legge sul telefono e mette in evidenza
// piste chiuse, aeroporto chiuso, ILS/approcci fuori uso, luci, carburante e restrizioni.
// Nessuna rete: i NOTAM non vengono scaricati da nessuna parte.

// "2610040600" (AAMMGGhhmm) -> ms UTC
export function notamTime(s) {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s ?? '').trim());
  return m ? Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
}

// Divide il testo incollato in singoli NOTAM.
export function splitNotams(text) {
  const t = String(text ?? '').replace(/\r/g, '');
  const marker = /^[ \t]*\(?[A-Z]\d{3,5}\/\d{2}[ \t]+NOTAM[NRC]/gm;
  const starts = [];
  for (let m; (m = marker.exec(t)); ) starts.push(m.index);
  if (starts.length) return starts.map((s, i) => t.slice(s, starts[i + 1] ?? t.length).trim());
  // senza intestazioni: un NOTAM per blocco separato da riga vuota, purché contenga i campi Q) o E)
  return t.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => /(^|\n)\s*[QE]\)/.test(b));
}

const FIELD = /(?:^|\s)([QABCDEFG])\)\s*/g;

// Campi Q) A) B) C) D) E) F) G) di un NOTAM
export function notamFields(block) {
  const marks = [];
  for (let m; (m = FIELD.exec(block)); ) marks.push({ k: m[1], at: m.index + m[0].length, start: m.index });
  const f = {};
  marks.forEach((mk, i) => {
    if (!(mk.k in f)) f[mk.k] = block.slice(mk.at, marks[i + 1]?.start ?? block.length).replace(/\s+/g, ' ').trim().replace(/\)$/, '').trim();
  });
  return f;
}

const RWY = '(\\d{2}[LCR]?(?:\\s*\\/\\s*\\d{2}[LCR]?)?)';

// Classificazione: livello high/med/low e categoria. Il codice Q ha la precedenza, poi le parole del testo.
export function classifyNotam(f, text) {
  const q = (f.Q ?? '').split('/')[1] ?? '';
  const subj = q.slice(1, 3);
  const cond = q.slice(3, 5);
  const E = (f.E ?? text ?? '').toUpperCase();
  const bad = /\b(U\/S|UNSERVICEABLE|NOT AVBL|NOT AVAILABLE|OUT OF SERVICE|UNUSABLE|WITHDRAWN|INOP|NOT AVAILABLE)\b/.test(E) || cond === 'AS' || cond === 'AU';
  const closed = /\b(CLSD|CLOSED)\b/.test(E) || cond === 'LC';
  let m;

  if (cond === 'AK' || cond === 'AO') return { level: 'info', cat: 'resumed', title: 'Ripristino del servizio' };
  if ((subj === 'FA' && closed) || /\b(AD|AERODROME|AIRPORT)\s+(IS\s+)?(CLSD|CLOSED)\b/.test(E) || /\bAD\s+CLSD\b/.test(E)) return { level: 'high', cat: 'ad-closed', title: 'Aeroporto chiuso' };
  if ((subj === 'MR' && cond === 'LC') || (m = new RegExp(`\\bRWY\\s*${RWY}\\s+(?:IS\\s+)?(?:CLSD|CLOSED)`).exec(E))) {
    const r = m ? m[1].replace(/\s+/g, '') : (E.match(new RegExp(`RWY\\s*${RWY}`)) ?? [])[1]?.replace(/\s+/g, '');
    return { level: 'high', cat: 'rwy-closed', title: `Pista ${r ?? ''} chiusa`.replace('  ', ' '), rwy: r ?? null };
  }
  if (/\b(PART OF )?RWY\b.*\b(CLSD|CLOSED)\b/.test(E) || (subj === 'MR' && closed)) return { level: 'high', cat: 'rwy-closed', title: 'Pista (o parte) chiusa' };
  if (/\bRWY\b.*\b(DECLARED DISTANCES?|TORA|TODA|ASDA|LDA|DISPLACED|THR DISPLACED|REDUCED|SHORTENED)\b/.test(E) || ['MT', 'MD'].includes(subj) || (subj === 'MR' && cond !== 'AK' && cond !== 'LC')) return { level: 'med', cat: 'rwy-limited', title: 'Pista con limitazioni (distanze/soglia)' };
  if ((subj.startsWith('I') && ['C', 'D', 'G', 'L', 'M', 'O', 'S', 'T', 'U', 'I', 'N', 'W', 'X'].includes(subj[1]) && bad) || /\b(ILS|LOC|LOCALI[ZS]ER|GLIDE\s?PATH|GP|GS)\b.*\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE|UNUSABLE|INOP|WITHDRAWN)\b/.test(E)) return { level: 'high', cat: 'ils-us', title: 'ILS / ausili di avvicinamento fuori servizio' };
  if (/\b(VOR|DME|NDB|RNAV|RNP|GNSS|LPV)\b.*\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE|UNUSABLE|INOP|WITHDRAWN)\b/.test(E) || (subj.startsWith('I') && bad) || (subj.startsWith('N') && bad)) return { level: 'med', cat: 'nav-us', title: 'Radioassistenza fuori servizio' };
  if (subj === 'PI' || /\bIAP\b|\bINSTRUMENT APCH\b|\bAPPROACH PROC/.test(E)) return { level: 'med', cat: 'proc', title: 'Procedura di avvicinamento modificata o non disponibile' };
  if (subj === 'FU' || /\b(FUEL|JET A-?1?|REFUEL(L)?ING)\b.*\b(NOT AVBL|NOT AVAILABLE|U\/S|UNAVAILABLE|LIMITED|SUSPENDED)\b/.test(E)) return { level: 'high', cat: 'fuel', title: 'Carburante non disponibile / limitato' };
  if (subj === 'FF' || /\b(RFF|RFFS|FIRE\s?FIGHT|CAT\s?\d+\s+RFF|FIRE CATEGORY)\b/.test(E)) return { level: 'med', cat: 'rffs', title: 'Categoria antincendio ridotta' };
  if (/\b(GPS|GNSS)\b.*\b(INTERFERENCE|JAMMING|SPOOFING|UNRELIABLE|OUTAGE|DEGRADED)\b/.test(E) || /\b(INTERFERENCE|JAMMING)\b.*\b(GPS|GNSS)\b/.test(E)) return { level: 'med', cat: 'gnss', title: 'Interferenze o malfunzionamenti GPS/GNSS' };
  if (/^L[A-Z]$/.test(subj) && bad) return { level: ['LA', 'LB', 'LC'].includes(subj) ? 'med' : 'med', cat: 'lights', title: 'Luci fuori servizio' };
  if (/\b(PAPI|VASI|APCH LIGHTS?|ALS|RCLL|TDZL|REDL|CENTRE ?LINE LIGHTS?|EDGE LIGHTS?)\b.*\b(U\/S|UNSERVICEABLE|NOT AVBL|INOP)\b/.test(E)) return { level: 'med', cat: 'lights', title: 'Luci fuori servizio' };
  if (/\b(CURFEW|NIGHT OPS|NIGHT OPERATIONS|NOT AVBL DURING|CLSD TO (ALL )?TFC|HOURS OF SERVICE|OPR HR|AD HR|OPERATING HOURS|PPR|PRIOR PERMISSION)\b/.test(E)) return { level: 'med', cat: 'hours', title: 'Orari o permessi (PPR / coprifuoco)' };
  if (subj.startsWith('R') || /\b(RESTRICTED AREA|DANGER AREA|PROHIBITED AREA|TRA|TSA|MILITARY EXERCISE|AIRSPACE RESERVATION|ROCKET|LASER|DRONE|UAS)\b/.test(E)) return { level: 'low', cat: 'airspace', title: 'Area o spazio aereo con restrizioni' };
  if (subj === 'MX' || /\bTWY\b.*\b(CLSD|CLOSED)\b/.test(E)) return { level: 'low', cat: 'twy', title: 'Via di rullaggio chiusa o con limitazioni' };
  if (subj === 'MN' || subj === 'MK' || /\b(APRON|STAND|PARKING)\b.*\b(CLSD|CLOSED|U\/S|LIMITED)\b/.test(E)) return { level: 'low', cat: 'apron', title: 'Piazzale o stand con limitazioni' };
  if (subj.startsWith('O') || /\b(CRANE|OBST|OBSTACLE|TOWER|MAST)\b/.test(E)) return { level: 'low', cat: 'obst', title: 'Ostacolo' };
  if (/\b(BIRD|WILDLIFE|SNOW|ICE|SLUSH|CONTAMINATED|WET|BRAKING)\b/.test(E)) return { level: 'med', cat: 'surface', title: 'Condizioni della pista' };
  return { level: 'info', cat: 'other', title: 'Altro NOTAM' };
}

// Legge e classifica un testo incollato. Restituisce solo gli elementi utili, ordinati per gravità.
export function analyzeNotams(text, { icaos = [], windows = {}, nowMs = Date.now() } = {}) {
  const items = [];
  for (const block of splitNotams(text)) {
    const f = notamFields(block);
    if (!f.E && !f.Q) continue;
    const id = (/([A-Z]\d{3,5}\/\d{2})/.exec(block) ?? [])[1] ?? '';
    const loc = (f.A ?? '').split(/\s+/).filter((x) => /^[A-Z]{4}$/.test(x));
    const cancel = /NOTAMC/.test(block.slice(0, 60));
    const cls = cancel ? { level: 'info', cat: 'cancel', title: 'NOTAM cancellato' } : classifyNotam(f, block);
    const from = notamTime(f.B);
    const permanent = /PERM/.test(f.C ?? '');
    const to = permanent ? null : notamTime((f.C ?? '').replace(/\s*EST\s*$/, ''));
    const hits = loc.filter((l) => icaos.includes(l));
    // attivo in almeno una delle finestre di interesse dell'aeroporto (altrimenti: attivo ora)
    const wins = hits.map((l) => windows[l]).filter(Boolean);
    const probes = wins.length ? wins : [[nowMs, nowMs]];
    const active = probes.some(([a, b]) => (from == null || from <= b) && (to == null || to >= a));
    items.push({ id, locs: loc, hits, level: cls.level, cat: cls.cat, title: cls.title, rwy: cls.rwy ?? null, fromMs: from, toMs: to, permanent, schedule: f.D ?? null, text: (f.E ?? block).replace(/\s+/g, ' ').trim(), active, relevant: hits.length > 0 || loc.length === 0 });
  }
  const rank = { high: 0, med: 1, low: 2, info: 3 };
  items.sort((a, b) => rank[a.level] - rank[b.level] || a.id.localeCompare(b.id));
  return { items, total: items.length };
}
