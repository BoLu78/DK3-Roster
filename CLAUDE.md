# DK3 Roster

PWA per iPhone, stile RosterBuster, per leggere i turni Neos a partire dal PDF
"Individual duty plan" esportato da NetLine/Crew.

## Con chi lavori

L'utente è un comandante B737 Neos, base MXP. **Non è un programmatore.**

- Spiega le scelte in modo semplice, senza gergo; rispondi in italiano.
- **Chiedi sempre conferma prima di `git commit` e prima di `git push`.**
- Mostra il piano prima di scrivere codice per una nuova fase (vedi PIANO.md).
- I termini di dominio (C/I, C/O, FT, DT, settore, AC, recurrent) non vanno spiegati a lui.

## Vincoli tecnici (non negoziabili)

- HTML/CSS/JS puro. **Nessun build step**, nessun framework, nessun bundler.
  I file nel repository sono esattamente quelli serviti da GitHub Pages.
- Hosting: GitHub Pages (repo pubblico, account `BoLu78`).
- **Nessun backend, nessun token, nessuna chiamata di rete con dati dell'utente.**
  I turni restano solo sul dispositivo, in IndexedDB.
  **Unica eccezione, approvata dall'utente (2 ott 2026): il meteo**, opzionale e spento di default,
  da Open-Meteo (gratuito, senza account né chiave). Nella richiesta vanno solo le coordinate
  degli aeroporti e le date, mai dati del roster. Nessun'altra chiamata di rete.
- Le librerie esterne (pdf.js) si copiano in `vendor/`, non si caricano da CDN:
  l'app deve funzionare offline.
- Target principale: Safari iOS, installata su schermata Home.

## Privacy

Il repository è pubblico. Non devono mai finire in git:

- i PDF dei turni (`samples/` è in .gitignore);
- nomi di colleghi, matricole, o valori attesi ricavati da turni reali.
  I valori attesi dei test stanno in `samples/expected/`, quindi fuori da git.

## Il PDF

- Sorgente: "Individual duty plan" NetLine/Crew, A4 orizzontale (842 pt di larghezza),
  con le pagine **ruotate di 270°**: le coordinate si leggono con la trasformazione della vista di pdf.js.
- Ogni pagina ha **due colonne**: split a circa x=421. Leggere prima tutta la
  colonna sinistra, poi la destra.
- Il parsing va fatto **per coordinate** (x/y di ogni frammento di testo da pdf.js),
  non sul testo concatenato: l'ordine del testo estratto non è affidabile.
- **Tutti gli orari nel PDF sono UTC.** L'app mostra sempre UTC e ora locale
  (dell'aeroporto per i voli, di MXP per il resto).
- Il PDF contiene anche i totali FT/DT/Off stampati (pagina 3) e le scadenze
  Recurrent Training/Checks (pagina 4): vanno letti e confrontati con i valori calcolati.

## Funzioni richieste

- Import PDF con pdf.js.
- Viste: calendario mensile, lista giorni, dettaglio servizio
  (C/I, settori, AC, C/O, FT, DT, hotel, equipaggio per tratta).
- Statistiche FT/DT e confronto con i totali stampati nel PDF.
- Scadenze Recurrent Training/Checks con avviso.
- Al re-import: evidenziare cosa è cambiato rispetto alla versione precedente.
- Export `.ics`.

## Test

- I PDF di esempio stanno in `samples/` (escluso da git). Usali per verificare il parser.
- Test automatici con il test runner integrato di Node: `node --test`
  (con Node 24 non usare `node --test tests/`)
  (nessuna dipendenza da installare).
- Se `samples/` è vuota i test del parser vengono saltati, non falliscono.
- Dopo ogni modifica al parser, rilancia i test prima di proporre un commit.

## Struttura

- `src/` logica pura (parser, fusi orari, timeline UTC/locale, scadenze, diff, stats, ics): testata con `node --test`.
- `js/` interfaccia e archivio (IndexedDB). `css/`, `index.html`, `sw.js`, `manifest.webmanifest`.
- `vendor/pdfjs/` pdf.js (build legacy, per compatibilità Safari).
- `tools/serve.mjs` server locale di prova (`node tools/serve.mjs`); su localhost il service worker è spento (si prova con `?sw`).
- `tools/make-icons.mjs` rigenera le icone.
- Quando cambia un file da mettere in cache: aggiornare `FILES` e `VERSION` in `sw.js` (e `js/version.js`).

## Autonomia

L'utente ha chiesto di procedere in autonomia: non chiedere conferma per ogni passo.
Chiedere solo se servono file (PDF di esempio) o accessi (GitHub). Per `git push` serve comunque l'accesso all'account.

## Stato del lavoro

Il piano a fasi e l'avanzamento sono in [PIANO.md](PIANO.md). Aggiornalo a fine fase.
