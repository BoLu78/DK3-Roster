// Nomi mostrati per presentazione e fine servizio. Nel PDF sono "C/I" e "C/O".
export const CHECK_IN = 'Check-in';
export const CHECK_OUT = 'Check-out';

// label dal PDF: C/I, C/O, Briefing, Debriefing (gli ultimi due restano com'è)
export function eventName(label, fallback) {
  const l = label ?? fallback;
  return l === 'C/I' ? CHECK_IN : l === 'C/O' ? CHECK_OUT : l;
}
