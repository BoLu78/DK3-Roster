# Piano di lavoro

Ogni fase finisce allo stesso modo: test, prova sull'iPhone, conferma dell'utente,
poi commit e push. Non si passa alla fase successiva senza conferma.

Legenda: ⬜ da fare · 🟡 in corso · ✅ fatto

## Fase 0 — Preparazione 🟡

- ✅ CLAUDE.md, .gitignore, questo piano
- ✅ PDF di esempio copiato in `samples/` (ottobre 2026)
- ⬜ Repository GitHub e GitHub Pages (serve l'accesso all'account `BoLu78`)

## Fase 1 — Lettura del PDF (parser) ✅

La fase più delicata: tutto il resto dipende da questa.

- Copiare pdf.js in `vendor/`
- Script di analisi che stampa testo e coordinate dei PDF di esempio,
  per capire la struttura reale (colonne, righe giorno, intestazioni, totali)
- Parser: pagina → due colonne (split x≈421) → righe → giorni → servizi
- Dati estratti: data, tipo di giornata (volo, riposo, standby, corso, ferie…),
  C/I, settori (numero volo, da/a, orari, AC), C/O, FT, DT, hotel, equipaggio per tratta
- Totali FT/DT stampati e scadenze Recurrent Training/Checks
- Test automatici sui valori attesi, verificati a mano con l'utente

Risultato: un comando che legge un PDF e mostra i turni estratti; test verdi.

## Fase 2 — Scheletro dell'app ✅

- Pagina principale, stile iPhone, tema chiaro/scuro
- Pulsante "Importa PDF" e salvataggio in IndexedDB
- Installabile su schermata Home, funzionante offline (manifest + service worker)
- Tabella aeroporti → fuso orario, per la conversione UTC → ora locale

Risultato: app installata sull'iPhone che importa un PDF e ricorda i dati.

## Fase 3 — Viste ✅

- Calendario mensile con colori per tipo di giornata
- Lista giorni
- Dettaglio servizio: C/I, settori, AC, C/O, FT, DT, hotel, equipaggio per tratta
- Orari sempre in UTC e locale

## Fase 4 — Statistiche ✅

- FT/DT per mese e per periodi mobili
- Confronto con i totali stampati nel PDF, con evidenza delle differenze

## Fase 5 — Scadenze ✅

- Elenco Recurrent Training/Checks con data di scadenza
- Avviso in app quando una scadenza si avvicina (soglie da decidere insieme)

## Fase 6 — Re-import e modifiche ✅

- Ogni import conserva la versione precedente
- Confronto: servizi aggiunti, tolti, con orari/tratte/equipaggio cambiati
- Riepilogo delle modifiche dopo l'import e segno sui giorni cambiati

## Fase 7 — Export calendario ✅

- File `.ics` da aprire nel Calendario dell'iPhone
- Scelta di cosa esportare (solo voli, tutto, un mese)

## Fase 8 — Rifiniture 🟡

- Icona, schermata di avvio, dettagli grafici
- Gestione errori (PDF non riconosciuto, formato cambiato)
- Backup/ripristino dei dati su file

## Fase 9 — Briefing voli ❌ provato e tolto (6 ott 2026)

Era stato scritto (METAR/TAF, alternati, NOTAM, rotta) ma l'utente ha deciso di toglierlo: troppo complesso per l'app
e il collegamento a aviationweather.gov non funzionava dal browser dell'iPhone. Codice rimosso con `git revert`;
si può ritrovare nella cronologia (commit 8f28f47, 6c2448e, b401827).

## Fase 10 — E_FDP e pallini delle modifiche ✅ (6 ott 2026, da provare sull'iPhone)

- Servizio con `E_FDP` nel roster = pianificato con estensione: il calcolo FDP usa il massimo esteso (tabella OMA 7.1.7.2,
  base + 1 h); niente discrezione sopra l'estensione; senza `E_FDP` un FDP oltre il base resta segnalato.
  Regole del cap. 7 applicate (OMA 7.1.7.2, 7.2.1): niente riposo in volo (si blocca la scelta dei piloti), settori massimi in base alla WOCL
  (5 / 4 / 2), massimo 2 estensioni in 7 giorni, riposo +2 h prima e dopo oppure +4 h dopo (tra due estese si sommano),
  discrezione del comandante calcolata sul massimo base. La notifica "Ext" 10 h prima non è verificabile dal PDF.
- Pallini: tasto "Togli i pallini" nel banner, "Visto" sul singolo giorno, scheda "Modifiche da vedere" in Altro;
  il segno "visto" vale per tutti gli import, non solo l'ultimo.

## Stato attuale (2 ott 2026)

Tutte le funzioni sono scritte e provate nel browser del Mac (formato iPhone, anche offline).
Mancano:

- **Prova sull'iPhone vera** (installazione su schermata Home, scelta del file da File/Mail).
- **Repository GitHub + GitHub Pages**: serve l'accesso all'account `BoLu78`.
- Il parser è verificato su tre PDF (ago, set, ott 2026): totali FT/DT/Off tornano tutti. Altri mesi
  con casi nuovi (corsi, ferie lunghe, altri aeroporti) possono richiedere piccoli aggiustamenti.

### Cose scoperte sul PDF reale

- Le pagine sono ruotate di 270°: le coordinate vanno corrette con la trasformazione della vista.
- I totali FT/DT/Off stampati ci sono (pagina 3, sotto i giorni) e coincidono con la somma dei giorni.
- L'equipaggio per tratta è elencato una volta per servizio (prima tratta): le altre tratte
  dello stesso giorno ereditano lo stesso equipaggio. Per alcuni voli (es. da BLQ) manca del tutto.
- I nomi lunghi nella tabella Recurrent sono tagliati dal PDF ("Operator Proficiency Chec"):
  l'app usa un nome completo per i codici noti (`src/recurrent.js`).
- La striscia in cima a ogni pagina (Off/Sby/FlD/Tsp/Sim) dà il tipo di giornata.
- Servizi riconosciuti: voli (NO), trasferimenti (`RMI-BLQ`, `IBT-MXP`), Pick Up,
  stand-by, reserve, simulatore (Briefing / `MXP_001` / Debriefing), E_FDP.

### Da decidere insieme

- Soglie avvisi scadenze: ora 90 giorni (avviso) e 30 (urgente), modificabili in Altro.
- Fusi orari: tabella in `src/tz.js`. Un aeroporto non in tabella e di un paese con più fusi
  mostra solo l'UTC; aggiungerlo è una riga.

### Aggiunto con i PDF di agosto e settembre

- Servizi notturni a cavallo della mezzanotte (C/I un giorno, voli e C/O il giorno dopo):
  gli eventi si leggono nell'ordine del PDF e i servizi si ricostruiscono da C/I a C/O (`buildDuties`).
- Giorni oltre la fine del periodo (es. 1 settembre nel PDF di agosto): tenuti a parte (`spill`).
- Ferie (HOL / "Vac"), "X" (riposo fuori sede o coda di un servizio), "Take-off, Landing" per tratta.
- "X" (confermato dall'utente): giorno "sporcato" dalla coda di un servizio iniziato il giorno prima
  (es. 18 set: il duty finisce alle 05:50Z). Senza eventi = nessun nuovo servizio.
- Da verificare: "Take-off, Landing" = decollo e/o atterraggio fatti dall'utente su quella tratta.

### Calendario in stile NetLine (2 ott 2026)

Vista mensile come l'"Interactive Duty Plan" di NetLine: settimane in riga, barra colorata per giorno
(OFF, HOL/ferie, stand-by, reserve, sim) e **rotazioni** da base a base come barra continua
(`src/trips.js`), 🛏 sui giorni di hotel, riquadro del giorno selezionato sotto il calendario.

### Mappa delle tratte (2 ott 2026)

Scheda **Mappa** (come RosterBuster): tratte come curve (cerchio massimo), aeroporti con codice,
filtro mese / anno / tutto, zoom con le dita, conteggi (settori, aeroporti, paesi, km) e mini-mappa nel dettaglio del giorno.
Tutto offline: contorni dei continenti in `js/worldmap.js` (Natural Earth, dominio pubblico, generato da
`tools/make-worldmap.mjs`), coordinate degli aeroporti in `src/airports-geo.js`. Un aeroporto senza coordinate
non viene disegnato e viene segnalato sotto la mappa: basta aggiungere una riga.

### Controllo FTL (2 ott 2026)

`src/ftl.js` confronta ogni servizio con le regole dell'OMA-A cap. 7 (solo i numeri, non il testo del manuale;
il PDF del manuale non è nel repository).

- FDP: effettivo (C/I → block-in ultimo volo), massimo da tabella (ora di riferimento, settori), estensione "Ext",
  stato di acclimatazione B/D/X, discrezione del comandante (+2 h, +3 h con equipaggio aumentato) solo come riferimento.
- Equipaggio cockpit scelto per servizio (2 standard, 3 o 4): sopra i 2 piloti si applica il riposo in volo
  (B737 classe 2: 15 h / 16 h; max 3 settori). La scelta resta sul telefono (impostazioni).
- Riposi minimi (a base 12 h, fuori base 10 h, 14 h con fuso ≥4 h), cumulativi duty 7/14/28 giorni (stand-by al 25%),
  giorni liberi (≥7 al mese), recuperi estesi (36 h con 2 notti locali, max 168 h), stand-by ≤16 h, reserve ≤3 giorni,
  servizi notte / presto / tardi.
- Verificato con lo screenshot dell'app EASA FTL: servizio 25 set (inizio 03:20Z) → massimo 12:15 e discrezione 14:15, identici.
- Non controllato: ritardi reali, discrezione effettiva, alloggio idoneo a base, compensazione fusi ≥4 h oltre la segnalazione.
- Da capire: il flag E_FDP del roster (l'8 ott ha FDP 12:00 con massimo 12:30, quindi dentro il limite).

### Rifiniture dopo la prova sull'iPhone (2 ott 2026)

- Dettaglio giorno: FDP cockpit e riposo in fondo alla pagina. Tolti equipaggio e codici a 3 lettere (restano nei dati, non si mostrano).
- Partenza da casa (presentazione alla base meno N minuti, default 90, impostabile in Altro): nel dettaglio e nella lista.

### Meteo (2 ott 2026)

Opzionale (interruttore in Altro, spento di default), da Open-Meteo: icona + temperatura alla partenza e all'arrivo di
ogni tratta (dettaglio) e alle destinazioni (lista); per i pernottamenti, il meteo del luogo. Previsioni fino a 15 giorni.
Si riscarica da solo se ha più di 3 ore; se per un'ora cambia il tipo di tempo mostra "prima: ...". Restano salvate sul telefono.
Codice: `src/weather.js` (testato con rete finta), `js/weather-ui.js`.

### Calendario per la famiglia (4 ott 2026)

Altro → "Per la famiglia": file `.ics` semplificato (src/family.js) da importare in un calendario iCloud "Turni"
condiviso con la moglie: "🏠 A casa", "✈ MXP → FUE → MXP" (dal decollo all'atterraggio, orari locali nella descrizione),
"🛏 Notte a Rimini", "⏳ Stand-by 10:00–19:00" / "⏳ Reserve" (reperibile, non "a casa"). Nessun dato di lavoro. UID stabili: al nuovo invio gli eventi
cambiati si aggiornano; quelli tolti dal roster vanno cancellati a mano. Se si rientra prima di mezzogiorno, l'ultimo giorno è "a casa".
Corretto anche l'escape del punto e virgola nei testi `.ics`.

- (4 ott) Altro semplificato: una sola scheda "Esporta nel Calendario (.ics)" con menu Formato (Completo / Famiglia).
  Modo che funziona su iPhone: Esporta → Mail a se stessi → aprire l'allegato → "Aggiungi tutti" → scegliere il calendario.
