// Codice compagnia (IATA, 2 caratteri) -> nome.
// Serve a riconoscere i voli non Neos (wet lease, ACMI) e i positioning (DH)
// su altre compagnie. Se un codice manca, l'app mostra solo il codice.

export const HOME_AIRLINE = 'NO';

const NAMES = {
  NO: 'Neos',
  // Israele
  IZ: 'Arkia', '6H': 'Israir', LY: 'El Al',
  // Low cost
  W6: 'Wizz Air', W4: 'Wizz Air Malta', W9: 'Wizz Air UK', '5W': 'Wizz Air Abu Dhabi',
  FR: 'Ryanair', RK: 'Ryanair UK', AL: 'Malta Air', U2: 'easyJet', EC: 'easyJet Europe', DS: 'easyJet Switzerland',
  VY: 'Vueling', V7: 'Volotea', PC: 'Pegasus', LS: 'Jet2',
  // Italia
  AZ: 'ITA Airways', EN: 'Air Dolomiti', XZ: 'Aeroitalia',
  // Europa
  LH: 'Lufthansa', AF: 'Air France', KL: 'KLM', LX: 'Swiss', OS: 'Austrian', SN: 'Brussels Airlines',
  IB: 'Iberia', TP: 'TAP Air Portugal', BA: 'British Airways', TK: 'Turkish Airlines', KM: 'KM Malta Airlines',
  DE: 'Condor', X3: 'TUI fly', BY: 'TUI Airways',
  // Medio Oriente e Africa
  EK: 'Emirates', QR: 'Qatar Airways', MS: 'EgyptAir', SM: 'Air Cairo', AT: 'Royal Air Maroc', '3O': 'Air Arabia Maroc',
  BJ: 'Nouvelair', TU: 'Tunisair',
};

export function airlineName(code) {
  return code ? NAMES[code] ?? null : null;
}

// "Arkia (IZ)", oppure solo "IZ" se il codice non è in tabella
export function airlineLabel(code) {
  const n = airlineName(code);
  return n ? `${n} (${code})` : code ?? '';
}

// Nota per le tratte su altre compagnie; null per i voli Neos e le altre attività
export function airlineNote(leg) {
  if (!leg?.airline || leg.airline === HOME_AIRLINE) return null;
  if (leg.kind === 'flight') return `Volo per ${airlineLabel(leg.airline)}`;
  if (leg.kind === 'transport') return `Positioning con ${airlineLabel(leg.airline)}`;
  return null;
}
