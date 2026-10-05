// Schermata Briefing di un giorno di volo: threat per aeroporto nella finestra oraria, rotta, alternati e NOTAM.
import { h, DOW_SHORT, dowOf, fmtDayShort } from './util.js';
import { state, actions, saveSettings } from './state.js';
import { bstate, buildBrief, refreshDay, importRules, setNotams, setExtraAlt } from './briefing-store.js';
import { fmtZ, fmtDZ, tokenLevel } from '../src/briefing.js';
import { pointLevel } from '../src/route-wx.js';
import { diffTaf } from '../src/metar.js';
import { times, timeEl } from './timefmt.js';

const sheet = () => document.getElementById('sheet');
const LV_TXT = { high: 'Attenzione', med: 'Da valutare', low: 'Nota', ok: 'Nessun problema' };
const MARK = { ok: '✅', marginal: '⚠️', no: '❌', nodata: '❓' };
const ST_TXT = { ok: 'idoneo', marginal: 'al limite', no: 'sotto le minime', nodata: 'senza dati' };

const dot = (lv) => h('span', { class: `bf-dot lv-${lv ?? 'none'}` });
const chip = (t) => h('span', { class: `bf-chip lv-${t.level}`, title: t.detail || null }, t.title);

// testo grezzo di METAR/TAF con i threat colorati
function rawText(raw) {
  return h('span', { class: 'bf-raw' }, raw.split(' ').flatMap((tok, i) => {
    const lv = tokenLevel(tok);
    return [i ? ' ' : null, lv ? h('mark', { class: `bf-tok lv-${lv}` }, tok) : tok];
  }));
}

function tafBlock(b) {
  const taf = b.taf;
  if (!taf) return h('div', { class: 'muted bf-small' }, 'TAF non disponibile.');
  const [from, to] = b.window;
  const rows = taf.periods.map((p) => {
    const inWin = p.to > from && p.from < to;
    const head = p.kind === 'BASE' ? 'BASE' : p.kind === 'PROB-TEMPO' ? `PROB${p.prob} TEMPO` : p.prob ? `PROB${p.prob}` : p.kind;
    const body = p.raw.split(' ').filter((t) => !(p.kind !== 'BASE' && (/^\d{4}\/\d{4}$/.test(t) || /^PROB\d\d$/.test(t) || t === 'TEMPO' || t === 'BECMG' || /^FM\d{6}$/.test(t)))).join(' ');
    return h('div', { class: `bf-grp${inWin ? ' in' : ''}` },
      h('div', { class: 'k' }, head, p.kind !== 'BASE' ? h('small', {}, p.kind === 'FM' ? `dal ${fmtDZ(p.from)}` : `${fmtDZ(p.from)} → ${fmtDZ(p.to)}`) : null),
      h('div', { class: 'v' }, rawText(body || '—')),
      inWin ? h('span', { class: 'bf-win' }, 'nella tua finestra') : null);
  });
  const diff = bstateDiff(b);
  return h('div', {},
    h('div', { class: 'muted bf-small' }, `${taf.station} · emesso ${fmtDZ(taf.issuedMs)} · valido ${fmtDZ(taf.validFrom)} → ${fmtDZ(taf.validTo)}`),
    rows, diff);
}

function bstateDiff(b) {
  const rec = bstate.stations[b.icao];
  if (!rec?.changedAt || !rec.prevTafRaw || Date.now() - rec.changedAt > 24 * 3600000) return null;
  const st = b.stationData;
  const d = st?.prevTaf && b.taf ? diffTaf(st.prevTaf, b.taf) : null;
  if (!d || (!d.added.length && !d.removed.length)) return null;
  return h('div', { class: 'bf-diff' }, h('b', {}, `TAF cambiato alle ${fmtZ(rec.changedAt)}`),
    d.added.map((g) => h('div', {}, '＋ ', rawText(g))),
    d.removed.map((g) => h('div', { class: 'muted' }, '− ', g)));
}

function metarBlock(b) {
  const m = b.metar;
  if (!m) return h('div', { class: 'muted bf-small' }, 'METAR non disponibile.');
  const age = Math.round((Date.now() - m.timeMs) / 60000);
  return h('div', {}, h('div', { class: 'muted bf-small' }, `METAR delle ${fmtZ(m.timeMs)} (${age < 90 ? `${age} min fa` : `${Math.round(age / 60)} h fa`})`), h('div', { class: 'v' }, rawText(m.raw)));
}

function airportSection(b, role, date, brief) {
  const [from, to] = b.window;
  const sunTxt = b.sun?.sunset != null && Math.abs(b.sun.sunset - b.ms) < 6 * 3600000 ? `tramonto ${fmtZ(b.sun.sunset)}` : b.sun?.sunrise != null && Math.abs(b.sun.sunrise - b.ms) < 4 * 3600000 ? `alba ${fmtZ(b.sun.sunrise)}` : null;
  const st = b.icao ? brief.wx[b.icao] : null;
  const view = { ...b, stationData: st };
  const important = b.threats.filter((t) => t.level !== 'ok');
  return h('div', { class: 'bf-sec' },
    h('div', { class: 'bf-sec-h' }, dot(b.level), h('b', {}, `${role === 'dep' ? 'Partenza' : 'Arrivo'} ${b.iata}`), h('span', { class: 'muted' }, b.icao ?? ''),
      h('span', { class: 'bf-when' }, timeEl(times(b.ms, b.iata, date)))),
    h('div', { class: 'muted bf-small' }, `Finestra ${fmtZ(from)}–${fmtZ(to)} (${role === 'dep' ? 'ETD' : 'ETA'} ±1 h)${sunTxt ? ` · ${sunTxt}` : ''}${b.dark ? ' · buio' : ''}`),
    important.length ? h('div', { class: 'bf-chips' }, important.map((t) => h('div', { class: 'bf-th' }, chip(t), t.detail ? h('div', { class: 'bf-det' }, t.detail) : null))) : h('div', { class: 'bf-ok' }, '✓ Nessun threat particolare nella finestra'),
    b.icao ? h('details', { class: 'bf-more' }, h('summary', {}, 'METAR e TAF'), metarBlock(view), tafBlock(view)) : null);
}

function routeSection(b, date) {
  const r = b.route.data;
  const strip = r?.points?.length
    ? h('div', {}, h('div', { class: 'bf-strip' }, r.points.map((p) => h('i', { class: `lv-${['ok', 'low', 'med', 'high'][pointLevel(p)]}`, title: `${fmtZ(p.ms)} · NM ${p.nm} · CAPE ${Math.round(p.cape ?? 0)}${p.code >= 95 ? ' · temporale' : ''}` }))),
      h('div', { class: 'bf-strip-l' }, h('span', {}, `${b.leg.dep} ${fmtZ(b.leg.depMs)}`), h('span', {}, `${b.leg.arr} ${fmtZ(b.leg.arrMs)}`)))
    : h('div', { class: 'muted bf-small' }, r === null || r === undefined ? 'Meteo di rotta non ancora scaricato.' : 'Meteo di rotta non disponibile.');
  const th = b.route.threats;
  const lvl = th.length ? th[0].level : 'ok';
  return h('div', { class: 'bf-sec' },
    h('div', { class: 'bf-sec-h' }, dot(r ? lvl : null), h('b', {}, 'Rotta diretta'), h('span', { class: 'muted' }, `${b.leg.dep} → ${b.leg.arr}`)),
    strip,
    th.length ? h('div', { class: 'bf-chips' }, th.map((t) => h('div', { class: 'bf-th' }, chip(t), t.detail ? h('div', { class: 'bf-det' }, t.detail) : null))) : r?.points?.length ? h('div', { class: 'bf-ok' }, '✓ Nessuna instabilità o SIGMET rilevanti sulla rotta diretta') : null,
    r ? h('div', { class: 'muted bf-small' }, 'Modello di previsione (CAPE) e SIGMET lungo la linea diretta: indicativo, non è la rotta del piano di volo.') : null);
}

function candidateRows(list) {
  if (!list.length) return h('div', { class: 'muted bf-small' }, 'Nessun aeroporto candidato in archivio.');
  return h('div', { class: 'bf-cands' },
    list.map((c) => h('div', { class: `bf-cand st-${c.status}` },
      h('span', {}, MARK[c.status]), h('b', {}, c.icao), h('span', { class: 'muted' }, `${c.iata !== c.icao ? c.iata + ' ' : ''}${c.nm ? c.nm + ' NM' : ''}${c.extra ? ' · da OFP' : ''}`),
      c.status !== 'ok' ? h('span', { class: 'st' }, `${ST_TXT[c.status]}${c.why ? ` (${c.why})` : ''}`) : null)),
    list.some((c) => c.assumedApproach && c.status !== 'nodata') ? h('div', { class: 'muted bf-small' }, 'Dove le regole non indicano l’approccio ipotizzo ILS CAT I: controlla sulla carta.') : null);
}

function extraAltInput(date, legIndex, rerender) {
  const list = bstate.extraAlt[date]?.[legIndex] ?? [];
  const input = h('input', { type: 'text', placeholder: 'ICAO da OFP (es. GCLP)', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off' });
  const add = async () => {
    const v = input.value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(v)) return actions.toast('Scrivi un codice ICAO di 4 lettere');
    setExtraAlt(date, legIndex, [...new Set([...list, v])]);
    actions.toast('Scarico il meteo dell’alternato…');
    await refreshDay(date, { force: false });
    rerender();
  };
  return h('div', { class: 'bf-extra' },
    list.map((x) => h('span', { class: 'chip' }, x, ' ', h('button', { 'aria-label': `Togli ${x}`, onclick: () => { setExtraAlt(date, legIndex, list.filter((y) => y !== x)); rerender(); } }, '✕'))),
    h('div', { class: 'bf-extra-row' }, input, h('button', { class: 'btn secondary', onclick: add }, 'Aggiungi alternato')));
}

function altSection(b, date, rerender) {
  if (!b.alt) return h('div', { class: 'bf-sec' }, h('div', { class: 'bf-sec-h' }, h('b', {}, 'Alternati')), h('div', { class: 'muted bf-small' }, bstate.rules ? 'Alternati non valutabili per questa tratta (aeroporto senza codice ICAO).' : 'Importa le regole di compagnia (in Altro → Briefing) per avere la valutazione degli alternati.'));
  const { toa, dest } = b.alt;
  const toaTxt = toa.need === true ? 'Alternato al decollo: SERVE' : toa.need === 'maybe' ? 'Alternato al decollo: possibile' : toa.need === false ? 'Alternato al decollo: non serve' : 'Alternato al decollo: da verificare';
  const toaLv = toa.need === true ? 'high' : toa.need === 'maybe' ? 'med' : toa.need === false ? 'ok' : 'low';
  const destLv = dest.need === 2 ? 'high' : dest.consider2 ? 'med' : dest.need === 1 ? 'low' : 'ok';
  const destTxt = dest.need === 0 ? `Destinazione ${b.leg.arr}: alternato non richiesto` : dest.need === 2 ? `Destinazione ${b.leg.arr}: DUE alternati` : `Destinazione ${b.leg.arr}: 1 alternato${dest.consider2 ? ' (valuta 2)' : ''}`;
  const warnNone = dest.okCount === 0 && dest.candidates.length && dest.need > 0;
  return h('div', { class: 'bf-sec' },
    h('div', { class: 'bf-sec-h' }, h('b', {}, 'Alternati'), h('span', { class: 'muted' }, 'minime di compagnia')),
    h('div', { class: `bf-verdict lv-${toaLv}` }, h('b', {}, toaTxt), h('div', { class: 'bf-det' }, toa.reasons[0]),
      h('details', { class: 'bf-more' }, h('summary', {}, `Dettagli e candidati entro ${toa.maxNm} NM`), toa.reasons.slice(1).map((r) => h('div', { class: 'bf-det' }, r)), candidateRows(toa.candidates), h('div', { class: 'muted bf-small' }, toa.refs.join(' · ')))),
    h('div', { class: `bf-verdict lv-${destLv}` }, h('b', {}, destTxt), dest.reasons.map((r) => h('div', { class: 'bf-det' }, r)),
      warnNone ? h('div', { class: 'bf-det bad' }, 'Nessun candidato vicino risulta idoneo con i dati disponibili: usa gli alternati dell’OFP.') : null,
      h('details', { class: 'bf-more' }, h('summary', {}, 'Candidati vicini e alternati dell’OFP'),
        h('div', { class: 'muted bf-small' }, 'Minime di pianificazione degli alternati:'), candidateRows(dest.candidates),
        dest.approach.assumed ? h('div', { class: 'muted bf-small' }, `${b.leg.arr}: approccio non indicato nelle regole, ipotizzo ${dest.approach.name}.`) : null,
        h('div', { class: 'muted bf-small', style: 'margin-top:8px' }, 'Alternati scelti dall’OFP: aggiungili per vedere se sono idonei.'),
        extraAltInput(date, b.leg.n, rerender),
        h('div', { class: 'muted bf-small' }, dest.refs.join(' · ')))));
}

function legCard(b, date, brief, rerender) {
  return h('div', { class: 'card bf-leg' },
    h('h2', {}, `${b.leg.dep} → ${b.leg.arr}`, b.leg.flight ? h('small', { class: 'muted' }, ` · ${b.leg.flight}`) : null, dot(b.level)),
    h('div', { class: 'bf-times' }, timeEl(times(b.leg.depMs, b.leg.dep, date)), h('span', { class: 'muted' }, ' → '), timeEl(times(b.leg.arrMs, b.leg.arr, date))),
    b.turn.length ? h('div', { class: 'bf-chips' }, b.turn.map((t) => h('div', { class: 'bf-th' }, chip(t), h('div', { class: 'bf-det' }, t.detail)))) : null,
    airportSection(b.dep, 'dep', date, brief),
    routeSection(b, date),
    airportSection(b.arr, 'arr', date, brief),
    altSection(b, date, rerender));
}

function notamCard(date, brief, rerender) {
  const ta = h('textarea', { rows: 6, placeholder: 'Incolla qui i NOTAM del pacchetto (OFP / Lido)…', spellcheck: 'false', autocapitalize: 'off' });
  ta.value = bstate.notams[date] ?? '';
  const n = brief.notams;
  const show = (items) => items.map((i) => h('div', { class: `bf-notam lv-${i.level}` }, h('div', {}, h('b', {}, i.title), ' ', h('span', { class: 'muted' }, `${i.id ? i.id + ' · ' : ''}${i.hits.length ? i.hits.join(' ') : i.locs.join(' ')}`)), h('div', { class: 'bf-det' }, i.text), h('div', { class: 'muted bf-small' }, `${i.fromMs ? fmtDZ(i.fromMs) : '—'} → ${i.permanent ? 'permanente' : i.toMs ? fmtDZ(i.toMs) : '—'}${i.schedule ? ` · orario: ${i.schedule}` : ''}`)));
  const rel = n?.items.filter((i) => i.relevant && i.active && i.level !== 'info') ?? [];
  const other = n?.items.filter((i) => !(i.relevant && i.active && i.level !== 'info')) ?? [];
  return h('div', { class: 'card' }, h('h2', {}, 'NOTAM'),
    ta,
    h('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => { setNotams(date, ta.value); rerender(); } }, ta.value.trim() || bstate.notams[date] ? 'Analizza / aggiorna' : 'Analizza'),
    n ? [
      h('div', { class: 'muted bf-small', style: 'margin-top:8px' }, `${n.total} NOTAM letti · ${rel.length} da guardare nella tua finestra`),
      rel.length ? show(rel) : h('div', { class: 'bf-ok' }, '✓ Nessun NOTAM importante (pista chiusa, ILS fuori servizio, carburante…) trovato per i tuoi aeroporti'),
      other.length ? h('details', { class: 'bf-more' }, h('summary', {}, `Altri ${other.length} (non attivi nella finestra, altri aeroporti, informativi)`), show(other)) : null,
    ] : h('p', { class: 'muted bf-small', style: 'margin-top:8px' }, 'I NOTAM non si scaricano da nessuna parte: li incolli tu dal pacchetto e l’app li legge sul telefono, evidenziando piste chiuse, aeroporto chiuso, ILS fuori servizio, carburante, luci e restrizioni.'));
}

function statusCard(date, rerender) {
  const on = state.settings.briefingOn;
  if (!on) {
    return h('div', { class: 'card' }, h('h2', {}, 'Briefing spento'),
      h('p', {}, 'Per preparare il briefing l’app scarica METAR, TAF e SIGMET da aviationweather.gov (NOAA, gratuito) e le previsioni di rotta da Open-Meteo.'),
      h('p', { class: 'muted bf-small', style: 'margin:6px 0 10px' }, 'Nelle richieste ci sono solo i codici ICAO e le coordinate degli aeroporti e della rotta: nessun dato del roster.'),
      h('button', { class: 'btn', onclick: async () => { state.settings.briefingOn = true; saveSettings(); actions.toast('Scarico i dati…'); await refreshDay(date, { force: true }); rerender(); } }, 'Attiva il briefing'));
  }
  const at = bstate.at;
  return h('div', { class: 'bf-status' },
    h('span', { class: 'muted' }, bstate.busy ? 'Aggiorno…' : at ? `Aggiornato alle ${fmtZ(at)} · ${Math.max(0, Math.round((Date.now() - at) / 60000))} min fa` : 'Ancora nessun dato scaricato'),
    bstate.error ? h('div', { class: 'bad bf-small' }, bstate.error) : null,
    !navigator.onLine ? h('div', { class: 'muted bf-small' }, 'Senza connessione: vedi l’ultimo briefing salvato.') : null);
}

function rulesCard(rerender) {
  if (bstate.rules) return null;
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      importRules(await f.text());
      actions.toast('Regole importate');
      rerender();
    } catch (e) {
      alert(e.message ?? String(e));
    }
  });
  return h('div', { class: 'card' }, h('h2', {}, 'Regole di compagnia non importate'),
    bstate.rulesError ? h('p', { class: 'bad bf-small' }, bstate.rulesError) : null,
    h('p', {}, 'Senza le regole vedi meteo e threat, ma l’app non decide alternato al decollo e doppio alternato.'),
    h('button', { class: 'btn secondary', style: 'margin-top:8px', onclick: () => file.click() }, 'Importa file regole (.json)'), file,
    h('p', { class: 'muted bf-small', style: 'margin-top:8px' }, 'Oppure incolla il testo delle regole in Altro → Briefing voli.'));
}

function summaryCard(brief) {
  const lv = brief.level;
  const nt = (brief.notams?.items ?? []).filter((i) => i.relevant && i.active && (i.level === 'high' || i.level === 'med')).slice(0, 4);
  return h('div', { class: `card bf-sum lv-${lv}` },
    h('div', { class: 'bf-sum-h' }, dot(lv), h('b', {}, LV_TXT[lv]), brief.fetchedAt ? h('span', { class: 'muted' }, `dati delle ${fmtZ(brief.fetchedAt)}`) : h('span', { class: 'muted' }, 'nessun dato')),
    brief.top.length ? brief.top.map((t) => h('div', { class: 'bf-th' }, chip(t), h('div', { class: 'bf-det' }, [t.apt ? `${t.apt}` : 'Rotta', t.detail].filter(Boolean).join(' · ')))) : h('div', { class: 'bf-ok' }, brief.fetchedAt ? '✓ Nessun threat importante rilevato' : 'Scarica i dati per vedere i threat'),
    nt.map((i) => h('div', { class: 'bf-th' }, chip({ level: i.level, title: `NOTAM: ${i.title}` }), h('div', { class: 'bf-det' }, `${i.hits.join(' ') || i.locs.join(' ')} · ${i.text.slice(0, 120)}`))),
    brief.legs.flatMap((l) => (l.alt ? [{ l, a: l.alt }] : [])).map(({ l, a }) => h('div', { class: 'bf-altline' }, `${l.leg.dep}→${l.leg.arr}: alternato dest. ${a.dest.need === 0 ? 'non richiesto' : a.dest.label}${a.dest.consider2 && a.dest.need === 1 ? ' (valuta 2)' : ''} · al decollo ${a.toa.need === true ? 'SERVE' : a.toa.need === 'maybe' ? 'possibile' : a.toa.need === false ? 'non serve' : '?'}`)));
}

function body(date, rerender) {
  const brief = buildBrief(date);
  if (!brief) return [h('p', { class: 'muted', style: 'text-align:center;margin-top:30px' }, 'Nessun volo in questo giorno.')];
  const parts = [statusCard(date, rerender)];
  if (state.settings.briefingOn) {
    parts.push(summaryCard(brief));
    const r = rulesCard(rerender);
    if (r) parts.push(r);
    brief.legs.forEach((b) => parts.push(legCard(b, date, brief, rerender)));
    parts.push(notamCard(date, brief, rerender));
    parts.push(h('p', { class: 'muted bf-small', style: 'margin:8px 4px' }, 'Gruppi e testi meteo originali sono mostrati sotto “METAR e TAF”. Le finestre usano il manuale: ETA ±1 ora.'));
  } else parts.push(rulesCard(rerender));
  return parts.filter(Boolean);
}

export function showBriefing(date) {
  const el = sheet();
  const render = () => {
    const bodyEl = el.querySelector('.body');
    const top = bodyEl?.scrollTop ?? 0;
    const open = [...el.querySelectorAll('details')].map((d) => d.open);
    const typed = [...el.querySelectorAll('textarea, .bf-extra-row input')].map((x) => x.value);
    const fresh = h('div', { class: 'body' }, body(date, render));
    if (bodyEl) bodyEl.replaceWith(fresh);
    else el.append(fresh);
    el.querySelectorAll('details').forEach((d, i) => (d.open = open[i] ?? false));
    el.querySelectorAll('textarea, .bf-extra-row input').forEach((x, i) => {
      if (typed[i] && !x.value) x.value = typed[i];
    });
    fresh.scrollTop = top;
  };
  el.hidden = false;
  el.replaceChildren(
    h('header', {},
      h('button', { onclick: async () => { showBriefing.current = null; (await import('./views-detail.js')).showDetail(date); }, 'aria-label': 'Torna al giorno' }, '‹ Giorno'),
      h('h1', {}, `Briefing ${DOW_SHORT[dowOf(date)]} ${fmtDayShort(date)}`),
      h('button', { disabled: !state.settings.briefingOn, 'aria-label': 'Aggiorna', onclick: async () => { actions.toast('Aggiorno…'); await refreshDay(date, { force: true }); render(); } }, '↻')),
    h('div', { class: 'body' }, body(date, render)));
  showBriefing.current = date;
  showBriefing.render = render;
}
showBriefing.current = null;
showBriefing.render = null;

