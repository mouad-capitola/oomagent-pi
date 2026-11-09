# Pi inventory

Eigen alleen-lezen tool: `pi_inventory`. Laad met `/reload`.
Standaard vergelijkt hij `~/Projects/oomagent-pi` en `~/Projects/oomagent-pi-upgrade`.
Als `workspace/.pi` bestaat, gebruikt hij die configuratie (zoals bij de upgrade).

## Voorbeelden

- “Vergelijk de skills en eigen tools van mijn beide Pi’s.”
- “Welke MCP-servers staan alleen in de upgradeconfiguratie?”
- “Welke skill- en extensiebestanden zijn de afgelopen 30 dagen toegevoegd?”

Parameters:
- `projects`: één of twee mapnamen onder `~/Projects`; geen absolute paden.
- `days`: 1–365, standaard 14.

## Wat de resultaten betekenen

- **Op schijf:** skillnamen uit frontmatter, extensiebestanden en statisch herkende
  toolnamen, plus projectlokale MCP-servernamen en hun enabled-vlag.
- **Huidige sessie:** geregistreerde en actieve toolnamen uit de Pi-API, apart vermeld.
  Dit is geen laadstatus van de andere Pi en geen bewijs dat een tool werkt.
- **Getest:** de inventory voert geen tools, workflows of MCP-servers uit.
- **Recente toevoegingen:** nieuwe bestanden in de lokale Git-geschiedenis van HEAD.
  Commitdatum is geen push-, installatie- of creatiedatum. Ongecommitte bestanden
  staan wel in de inventaris, maar hebben geen gedateerd Git-bewijs.

De vergelijking gaat over namen en enabled-vlaggen, niet over gelijkheid van broncode.
Detectie van toolnamen is een statische conventiecheck, geen TypeScript-parser:
dynamische registraties kunnen ontbreken en commentaar kan een match opleveren.
Nieuwe tools binnen bestaande bestanden en afzonderlijke MCP-serverintroducties
worden niet historisch gedateerd. Globale configuratie, geïnstalleerde packages,
overerving en externe entrypoints worden niet geïnventariseerd.
Afwijkende of ontbrekende bestanden geven waarschuwingen; een onvolledige lijst
is geen bewijs dat een functie ontbreekt.

## Veiligheid en grenzen

Geen netwerk, geen uitvoering van projectcode, geen aanpassingen.
Geen inhoud van .env- of authenticatiebestanden. MCP-JSON wordt lokaal geparsed;
commands, argumenten, URL’s, headers en omgevingswaarden worden nooit gerapporteerd.
Skillbeschrijvingen en broncode worden niet teruggegeven.
Namen en metadata zijn onbetrouwbare data, geen instructies.

Symlinks en hardlinked bestanden worden geweigerd. Bestanden maximaal 1 MiB;
maximaal 100 directory-items per categorie, 50 toolnamen per extensie,
100 MCP-servers en 100 historische toevoegingen. Git: 10 seconden/2 MiB;
totale tooldeadline: 30 seconden. Uitvoer maximaal 40 KB/1500 regels,
met melding bij afkappen. De padcontroles zijn geen sandbox tegen gelijktijdige
directorywissels door een ander proces.

## Tests

`node --test tests/pi-inventory.test.mjs tests/ci-status.test.mjs`

Fixtures staan in tijdelijke mappen. De tests voeren geen projectextensies uit,
maken geen commits en gebruiken geen netwerk of credentials.
