# Due nuove funzioni: Ricerca circolari e Analisi documento

## 1. Ricerca circolari (con pagina e riga precisa)

Nuova voce di menu **Ricerca circolari** con una pagina dedicata:

- campo di ricerca in linguaggio naturale (es. "detrazione spese mediche 2025");
- l'assistente cerca solo nell'archivio delle circolari e genera una risposta sintetica;
- sotto la risposta, l'elenco dei passaggi trovati: titolo della circolare, **pagina**, **righe** (es. "pagina 4, righe 12-18") e l'estratto di testo evidenziato;
- per ogni risultato: pulsante **Apri PDF alla pagina** e pulsante **Stampa**, che apre il PDF già posizionato sulla pagina e lancia la stampa.

Per avere la riga esatta, durante il caricamento di un PDF il testo viene salvato indicando anche il numero di riga iniziale e finale di ogni estratto. Le circolari già caricate mostreranno solo la pagina finché non vengono ricaricate; aggiungo in Amministrazione un pulsante **Re-indicizza** per aggiornarle senza ricaricare il file a mano.

## 2. Analizza un documento

Nuova pagina **Analizza documento**:

- l'operatore trascina o seleziona un PDF (es. un contratto di locazione);
- scrive la domanda (es. "in questo contratto c'è la cedolare secca?");
- l'assistente legge solo quel file e risponde con: esito immediato (Sì / No / Non chiaro), spiegazione, e le citazioni testuali trovate con pagina e riga;
- il file analizzato non entra nell'archivio: resta temporaneo e viene scartato a fine analisi (nessun salvataggio permanente), così i documenti dei clienti non vengono archiviati.
- domande successive sullo stesso file sono possibili senza ricaricarlo.

## Dettagli tecnici

- Database: aggiunta di `line_start` / `line_end` su `document_chunks` (migrazione con GRANT invariati).
- Estrazione PDF lato client con `pdfjs-dist`: raggruppo gli elementi di testo per coordinata Y per ricostruire le righe, numerandole per pagina; i chunk conservano l'intervallo di righe.
- `src/lib/rag.server.ts`: nuova funzione `searchCircolari()` (solo categoria `circolari`) che restituisce pagina + righe + estratto; riuso della logica esistente, nessuna duplicazione.
- Nuova route API `src/routes/api/circolari-search.ts`: risposta in streaming, stessa astrazione AI (`getAiProvider`) già usata dalla chat.
- Nuova route API `src/routes/api/analizza.ts`: riceve il testo estratto del file (con pagine/righe) + la domanda, prompt dedicato che impone citazioni con pagina/riga e risposta Sì/No/Non chiaro; nessuna scrittura su database o storage.
- Nuove pagine: `src/routes/_authenticated/circolari.tsx` e `src/routes/_authenticated/analizza.tsx`, con link nella sidebar.
- Utility condivisa `src/lib/pdf-extract.ts` per l'estrazione con righe, usata sia dall'upload in Amministrazione sia dall'analisi documento.
- Stampa: apertura del PDF firmato in una nuova scheda con `#page=N` e chiamata a `print()` quando il visualizzatore lo consente, con fallback al semplice download.
