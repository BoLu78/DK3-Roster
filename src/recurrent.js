// Scadenze Recurrent Training / Checks.

// Il PDF taglia i nomi lunghi ("Operator Proficiency Chec"): per i codici che
// conosciamo si usa un nome completo, altrimenti il testo del PDF.
const NAMES = [
  [/^EST(\d+)_RT$/, (m) => `EST ${m[1]} Recurrent Training`],
  [/^LC(\d+)$/, (m) => `Line Check B7${m[1] === '78' ? '87' : '37'}`],
  [/^LICENCE_(\d+)$/, (m) => `Licenza B7${m[1] === '78' ? '87' : '37'}`],
  [/^OPC(\d+)$/, (m) => `OPC (Operator Proficiency Check) B7${m[1] === '78' ? '87' : '37'}`],
  [/^SIM(\d+)_RT$/, (m) => `Simulatore Recurrent B7${m[1] === '78' ? '87' : '37'}`],
  [/^Z2_(\d+)$/, (m) => `Pre-flight and ETOPS PDSC B7${m[1] === '78' ? '87' : '37'}`],
  [/^GRT(\d+)_A$/, () => 'Ground Recurrent Training'],
  [/^RAD$/, () => 'Medical Check - RAD D.lgs'],
  [/^MED_PIL$/, () => 'Pilot Medical Check'],
  [/^CRM_RT$/, () => 'CRM Recurrent Training'],
  [/^ESTPT_RT$/, () => 'EST Recurrent Practical Training'],
  [/^PSYSU_RT$/, () => 'Psychoactive Substances Recurrent'],
  [/^SEC965RT$/, () => 'Security Recurrent (965)'],
  [/^SECA15RT$/, () => 'Security Recurrent (A15)'],
  [/^ETOPS_RT$/, () => 'ETOPS Recurrent Training'],
  [/^DG_RT$/, () => 'Dangerous Goods Recurrent'],
  [/^SMS_RT$/, () => 'SMS Recurrent Training'],
  [/^FRM_RT$/, () => 'FRM Recurrent Training'],
];

export function prettyName(code, raw) {
  for (const [re, fn] of NAMES) {
    const m = re.exec(code);
    if (m) return fn(m);
  }
  return raw || code;
}

// B787 / B737 / generale, ricavato dal codice ("..._78", "OPC73").
export function aircraftOf(code) {
  if (/(^|[^0-9])78([^0-9]|$)/.test(code)) return 'B787';
  if (/(^|[^0-9])73([^0-9]|$)/.test(code)) return 'B737';
  return null;
}

export const DEFAULT_THRESHOLDS = { warn: 90, critical: 30 };

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
}

// status: expired | critical | warning | ok
export function statusFor(daysLeft, thresholds = DEFAULT_THRESHOLDS) {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= thresholds.critical) return 'critical';
  if (daysLeft <= thresholds.warn) return 'warning';
  return 'ok';
}

export function evaluateRecurrent(items, todayIso, thresholds = DEFAULT_THRESHOLDS) {
  return [...items]
    .map((it) => {
      const daysLeft = daysBetween(todayIso, it.expiry);
      return { ...it, name: prettyName(it.code, it.nameRaw), aircraft: aircraftOf(it.code), daysLeft, status: statusFor(daysLeft, thresholds) };
    })
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.code.localeCompare(b.code));
}
