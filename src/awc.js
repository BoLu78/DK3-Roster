// Richieste a aviationweather.gov (NOAA, gratuito, senza account né chiave) per METAR, TAF e SIGMET.
// Nella richiesta ci sono solo i codici ICAO degli aeroporti: nessun dato del roster.
const BASE = 'https://aviationweather.gov/api/data';

export const metarUrl = (icaos) => `${BASE}/metar?ids=${icaos.join(',')}&format=json&hours=3`;
export const tafUrl = (icaos) => `${BASE}/taf?ids=${icaos.join(',')}&format=json`;
export const sigmetUrl = () => `${BASE}/isigmet?format=json`;

const secs = (v) => (typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(v));

// lista di METAR in JSON -> { ICAO: testo del più recente }
export function parseMetarJson(json) {
  if (!Array.isArray(json)) throw new Error('Risposta METAR non valida');
  const out = {};
  const at = {};
  for (const m of json) {
    const icao = m.icaoId ?? m.station_id;
    const raw = m.rawOb ?? m.raw_text;
    if (!icao || !raw) continue;
    const t = secs(m.obsTime ?? m.reportTime ?? 0) || 0;
    if (!(icao in out) || t >= at[icao]) {
      out[icao] = String(raw).replace(/\s+/g, ' ').trim();
      at[icao] = t;
    }
  }
  return out;
}

// lista di TAF in JSON -> { ICAO: testo del più recente }
export function parseTafJson(json) {
  if (!Array.isArray(json)) throw new Error('Risposta TAF non valida');
  const out = {};
  const at = {};
  for (const m of json) {
    const icao = m.icaoId ?? m.station_id;
    const raw = m.rawTAF ?? m.raw_text;
    if (!icao || !raw) continue;
    const t = secs(m.issueTime ?? m.bulletinTime ?? 0) || 0;
    if (!(icao in out) || t >= at[icao]) {
      out[icao] = String(raw).replace(/\s+/g, ' ').trim();
      at[icao] = t;
    }
  }
  return out;
}
