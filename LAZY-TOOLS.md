# Lazy tools

Nieuwe sessies starten met alleen `tool_search` als tooldeclaratie. Pi's native
zoektool activeert de benodigde schema's vóór de volgende modelaanvraag.

- `.pi/extensions/lazy-tools.ts` registreert de zeven gebruikte basistools met
  `exposure: "deferred"`, met Pi's bestaande implementaties, renderers en regels.
  De huidige sessiemap, shellconfiguratie en image-resize-instelling blijven gelden.
- De vijftien eigen tools hebben eveneens `exposure: "deferred"`.
- `.pi/settings.json` kiest `defaultTools: ["tool_search"]`; `package.json` bevat
  de nieuwe extensie. Bij gebruik als pakket moet de host dezelfde `defaultTools`
  instellen: pakketinstallatie neemt projectinstellingen niet automatisch over.
- Op deze Windows-pc verwijst ook `~/.pi/agent/settings.json` naar de extensie en
  gebruikt die instelling alleen `tool_search`. De MCP-servers stonden daar al
  op `deferred` en zijn niet gewijzigd.

## Activeren

Voer `/reload` uit en begin met `/new` (of herstart Pi met een nieuwe sessie).
Een bestaande sessie kan eerder gedeclareerde tools in haar geschiedenis houden.
Gevonden tools blijven op die gespreksbranch beschikbaar; dit is geen automatische
unload na elke aanroep. Expliciete `--tools`-keuzes kunnen de startselectie overrulen.

Dit is **lazy modelcontext**, geen lazy import van extensiemodules of uitgesteld
starten van MCP-processen. Pi registreert metadata lokaal en verbindt ingeschakelde
MCP-servers nog op de achtergrond. Projectinstructies, skillbeschrijvingen en de
bestaande gespreksgeschiedenis kosten nog steeds contexttokens.

## Controle

Gebruik de reeds geïnstalleerde Pi SDK en Node's ingebouwde tests; geen extra
packages of betaalde modelaanvragen nodig:

```sh
node --test tests/lazy-tools.test.mjs
```

Als Pi alleen globaal geïnstalleerd is, wijs `PI_TEST_HOST` naar de directory van
`@earendil-works/pi-coding-agent` (de directory met `package.json` en `dist/`).

Gecontroleerd op deze pc: zeven SDK-tests geslaagd (initiële declaraties,
ontdekking van alle 22 tools, foutgevallen, behouden metadata, bestandsacties,
annulering en shellinstellingen), plus de aangepaste compacte-prompttest.
Geen live providerverzoek, echte tokenbesparing of interactieve TUI-flow gemeten.

De eerdere Windows-blokkades in de bredere suite zijn aangepakt: importfilters
accepteren LF en CRLF en `APPEND_SYSTEM.md` bevat nu de volledige prompt als
regulier bestand. De oude verwachting van direct geladen basistools is afgestemd
op native discovery; de SDK-tests blijven alle 22 tools daadwerkelijk laden en
hun gedrag controleren. Zie README.md voor de volledige testopdracht,
hergebruik van geïnstalleerde dependencies en expliciete Windows-platformskips.
