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

## Stato attuale (2 ott 2026)

Tutte le funzioni sono scritte e provate nel browser del Mac (formato iPhone, anche offline).
Mancano:

- **Prova sull'iPhone vera** (installazione su schermata Home, scelta del file da File/Mail).
- **Repository GitHub + GitHub Pages**: serve l'accesso all'account `BoLu78`.
- **Più PDF di esempio** (altri mesi, con più casi: notti, cambi di fuso, hotel, corsi, ferie):
  il parser è stato verificato su un solo PDF (ottobre 2026).

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
