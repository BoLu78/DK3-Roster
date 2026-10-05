// Posizione del sole: per sapere se si atterra di giorno o di notte, e l'ora del tramonto.
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mod = (x, m) => ((x % m) + m) % m;

// Altezza del sole sull'orizzonte (gradi) in un luogo e istante (UTC ms). Precisione ~0.1°.
export function sunElevation(lat, lon, ms) {
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = rad(mod(357.528 + 0.9856003 * n, 360));
  const lambda = rad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = rad(23.439 - 0.0000004 * n);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = mod(18.697374558 + 24.06570982441908 * n, 24) * 15;
  const h = rad(mod(gmst + lon, 360)) - ra;
  return deg(Math.asin(Math.sin(rad(lat)) * Math.sin(dec) + Math.cos(rad(lat)) * Math.cos(dec) * Math.cos(h)));
}

export const isDark = (lat, lon, ms) => sunElevation(lat, lon, ms) < -0.833;

// Alba e tramonto più vicini a ms (entro ±14 ore), con passo di 2 minuti; null se il sole non sorge o non tramonta.
export function sunEvents(lat, lon, ms) {
  const STEP = 120000;
  const out = { sunrise: null, sunset: null };
  let prev = sunElevation(lat, lon, ms - 14 * 3600000) + 0.833;
  for (let t = ms - 14 * 3600000 + STEP; t <= ms + 14 * 3600000; t += STEP) {
    const cur = sunElevation(lat, lon, t) + 0.833;
    if (prev < 0 && cur >= 0 && (out.sunrise == null || Math.abs(t - ms) < Math.abs(out.sunrise - ms))) out.sunrise = t;
    if (prev >= 0 && cur < 0 && (out.sunset == null || Math.abs(t - ms) < Math.abs(out.sunset - ms))) out.sunset = t;
    prev = cur;
  }
  return out;
}
