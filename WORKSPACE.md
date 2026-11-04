# Pi Projects-werkplek

Terminalwerkplek voor Pi 1.2.0, zonder extra pakketten. Bij opstarten staat de lokale datum in blokletters met schaduw centraal. Typ `ready` en Enter; Escape opent gewone Pi.

## Gebruik

- Links staat `~/Projects`. Mappen worden pas ingelezen wanneer je ze opent.
- Rechts staat één bewerkbaar UTF-8-tekstbestand, met regelnummers.
- De bestaande Pi-chatgeschiedenis blijft erboven; het normale chatinvoerveld staat eronder.
- **F2** wisselt tussen bestandenboom, editor en chat. Op sommige Macs: **Fn+F2**.
- In de boom: pijltjes navigeren, Enter opent of klapt uit, links klapt in, F5 ververst. Live-markeringen: `+` nieuw, `~` gewijzigd, `−` verwijderd en `•` wijzigingen onder een map.
- Klikken opent mappen/bestanden in fullscreenmodus. Hover markeert klikbare items en vraagt via OSC 22 een muishandje aan. Alleen ondersteunende terminals tonen dat handje; Apple Terminal kan de tekstmuis behouden. Klikken rechts geeft de editor focus; plaats de tekstcursor met de pijltjes.
- In de editor: **Ctrl+S** opslaan, **Ctrl+Z** ongedaan maken (50 stappen), Enter nieuwe regel, Tab een echte tab. Home/End en PageUp/PageDown navigeren.
- **Escape** keert terug naar chat zonder het editorconcept weg te gooien.
- **Ctrl+O** vanuit de boom, of `/workspace-activate`, activeert het geselecteerde project na bevestiging. Pi sluit ordelijk af en start opnieuw in dat project; de normale projectvertrouwenscontrole blijft gelden. Alleen openen van een bestand verandert de werkmap niet.
- `/workspace` toont/verbergt de panelen.
- `/workspace-close` sluit het bestand, met bevestiging voordat een gewijzigd concept wordt weggegooid.
- `/workspace-recover` herstelt een concept dat bij normaal afsluiten of herladen lokaal is bewaard.

**Live:** iedere seconde en na tooluitvoering wordt het actieve project gecontroleerd, plus de uitgeklapte mappen in andere projecten. De boom en een ongewijzigde editor verversen automatisch. Een gewijzigd concept wordt nooit vervangen; de melding geeft een schijfwijziging aan. **F5** herlaadt alleen zonder gewijzigd concept.

**Vergelijken:** open een gewijzigd bestand voor een alleen-lezen vergelijking. **F4** wisselt tussen vergelijking en bewerkbare code; pijltjes, PageUp/PageDown en het muiswiel scrollen. Het nieuwe blok staat **groen bovenaan**, het oude **rood eronder**, met regelnummers. Ongewijzigde voor- en achterregels worden weggelaten; tussenliggende ongewijzigde regels kunnen in het blok staan. `/workspace-changes` toont de laatste 100 waargenomen gewijzigde paden, ook verwijderde bestanden. De statusregel toont waar iets is veranderd.

Vergelijkingen zijn lokaal en tijdelijk, tegen de vorige **waargenomen** versie, niet Git HEAD. Snelle opeenvolgende wijzigingen kunnen samenvallen; hernoemen wordt als verwijderd + nieuw getoond. Historie vervalt bij herstart. Gesloten andere projecten, `node_modules`, `vendor`, virtuele omgevingen en buildmappen worden niet recursief gelezen. Maximaal 256 mappen / 4000 items per controle en 16 MiB tekst per snapshot/historie; grenzen geven een melding. Binaire, te grote of afgeschermde bestanden krijgen geen tekstvergelijking. Het verbergen van de panelen pauzeert live-controle.

Het standaard Pi-opstartblok is nog niet afzonderlijk verborgen: Pi 1.2.0 biedt daarvoor geen publieke workspace-specifieke extensie-API. De gedeelde `quietStartup`-instelling blijft ongewijzigd, zodat gewone Pi hetzelfde blijft.

Opslaan vraagt geen model aan. Bij je volgende chatbericht krijgt Pi alleen het geopende bestandspad en of er niet-opgeslagen wijzigingen zijn. Pi kan de opgeslagen inhoud met zijn bestandstools bekijken; je onopgeslagen tekst wordt niet automatisch gedeeld.

## Bescherming en grenzen

- Alleen bestanden onder Projects; symlinks worden getoond maar niet gevolgd. Hardlinks zijn niet bewerkbaar.
- Bekende gevoelige namen zoals `.env*`, `auth.json`, sleutelbestanden en interne `.git`-paden zijn afgeschermd. Dit is geen volledige geheimendetector of sandbox.
- Maximaal 512 KiB per bestand; binair, ongeldige UTF-8 en terminalbesturingscodes worden geweigerd.
- Tabs, BOM en bestaande CRLF-regeleinden blijven behouden. Opslaan vervangt het bestand atomair en bewaart gewone Unix-permissies; speciale metadata zoals ACL's/xattrs worden niet overgenomen.
- Optimistische conflictcontrole vergelijkt schijfinhoud en bestandsidentiteit vlak voor opslaan. Een conflict laat het concept intact. Dit is geen filesystem-lock tegen gelijktijdige schrijvers.
- Bij normaal afsluiten/herladen worden gewijzigde concepten met rechten 0600 bewaard onder `~/.pi/agent/workspace-drafts/` (of de ingestelde Pi-agentmap). Deze bestanden bevatten lokaal de oorspronkelijke en gewijzigde tekst; ze worden niet automatisch verwijderd of naar een model gestuurd. Een crash of geforceerde kill kan recente wijzigingen verliezen.
- Project activeren gebruikt Node's `execve` na Pi's shutdown, zonder shell of geërfde prompts/sessieargumenten. Andere CLI-opties worden niet automatisch meegenomen. De vorige chatsessie kun je later in haar oorspronkelijke project hervatten.
- Dit is een eerste teksteditor, geen volledige VS Code: geen LSP/autocomplete voor code, debugger, tabbladen, selectie/knippen/plakken met de muis of syntaxkleuren. Terminalplakken en toetsenbordnavigatie werken wel.
- Minimaal 32 kolommen en 16 rijen voor de panelen; kleinere terminals vallen terug op chat. Muisklikken zijn alleen voor fullscreen; toetsenbord werkt ook in regular mode.

## Installatie en uitschakelen

De persoonlijke `~/.pi/agent/settings.json` verwijst naar:
`/Users/buurtkamer/Projects/oomagent-pi/.pi/extensions/oomagent-workspace.ts`.

Hierdoor wordt de werkplek in elk project geladen. Bestaande projectextensies blijven behouden. De kleine `oomagent:ui-ready`-melding in `.pi/extensions/oomagent-ui.ts` zorgt dat de bestaande branding de werkplekeditor niet verdringt.

Start Pi opnieuw om de werkplek te laden. Tijdelijk terug naar de gewone chat: `/workspace`. Permanent uitschakelen: verwijder alleen deze extensieverwijzing uit de persoonlijke settings. Verplaats de configuratierepository niet zonder dat pad bij te werken.

## Checks

- `node --test tests/workspace.test.mjs tests/workspace-changes.test.mjs`
- `node --test tests/oomagent-footer.test.ts` (controleert de gekozen donkere kleuren en afzonderlijke toolstatuskleuren)
- `python3 tests/workspace-terminal.py`

De workspace-tests gebruiken de daadwerkelijk geïnstalleerde managed Pi-versie. De PTY-test gebruikt een tijdelijke HOME, Projects en agentmap, zonder credentials, MCP of modelaanroepen. Hij doorloopt opstarten, ready, bestand openen/bewerken/opslaan, bevestigde projectherstart en het veilig bewaren van een concept bij afsluiten. Het is een terminalgedragstest, geen grafische screenshotcontrole.

Publicatiecontrole: vanuit een schone bronkopie zijn 114 tests geslaagd, met nul fouten en één bestaande overgeslagen renderer-integratietest wegens de oudere project-peer. De thematest controleert nu de gekozen donkere kleuren en onderscheid tussen pending/success/error; de vormgeving is daarbij niet gewijzigd. De offline PTY-flow slaagt inclusief live externe wijziging, F4-vergelijking met groen vóór rood, bestaande branding, opslaan, projectherstart, conceptherstel en resize. De PTY-flow gebruikt de geïnstalleerde Pi 1.5.0. Geen live modelaanroep, grafische screenshotcontrole, volledige typecheck of visuele muiscontrole uitgevoerd; geen dependencies bijgewerkt.
