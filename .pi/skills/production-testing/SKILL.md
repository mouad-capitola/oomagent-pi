---
name: production-testing
description: Test applicatieruntime altijd in productiemodus, nooit via dev-servers, development-targets, hot-reload of een dev-fallback. Gebruik vóór API-, browser-, E2E-, smoke- en securitytests en bij testplanning of controle van de runtime. Productiemodus betekent lokaal testen met productie-artifacts, niet testen op live klantomgevingen.
---

# Altijd testen in productiemodus

Deze regel geldt naast andere ontwikkel- en testskills. Gebruik de echte productie-build en productie-startopdracht van het betrokken project; een draaiende lokale server is niet automatisch geschikt.

## Harde grenzen

- **Productiemodus is niet de live omgeving.** Test bij voorkeur lokaal en geïsoleerd, met goedgekeurde testdata; maak geen verbinding met klantinfrastructuur zonder expliciete toestemming.
- Gebruik geen dev-server, development Docker-target, hot-reload of broncodemount over de applicatieruntime. Ook een toevallig identiek `dev`-target is geen vervanging voor het beschikbare productie-target.
- Start de applicatie onder test niet met `npm run dev`, `bun run dev`, `vite dev`, `vite preview`, `fastapi dev`, Uvicorn `--reload` of een LiveKit-agent in `dev`-modus.
- Ontbreekt een veilige productie-build/runtime? **Meld runtimevalidatie als geblokkeerd. Geen dev-fallback.** Vraag naar de noodzakelijke vervolgstap; presenteer een dev-test niet als productietest.
- Deze skill geeft geen toestemming voor deploys, scans, betaalde acties, accountwijzigingen of het stoppen/vervangen van een bestaande stack.

## Werkwijze

1. **Lees de projectinstructies en bestaande tooling.** Inspecteer manifests, lockfiles, Dockerfiles, Compose-configuratie en testcommands. Volg ook [libraries-first](../libraries-first/SKILL.md). Gebruik bestaande runners en dependencies; installeer of upgrade niets zonder toestemming.
2. **Bepaal scope en impact.** Leg vast welke componenten en lokale doelen getest worden, welke productie-artifacts daarbij horen en welke mutaties uitgesloten zijn. Behoud bestaande projectnamen, volumes, accounts, sleutels en gebruikersgegevens. Vraag toestemming voordat een draaiende stack moet worden omgeschakeld.
3. **Bouw de juiste artifacts.** Gebruik het gedocumenteerde productie-target en de finale runtime-stage. Serveer gebouwde frontend-assets via de productie-webserver, niet via een development- of previewserver. Een build-stage met testtooling is niet de runtime die je met browser-/API-tests moet toetsen. Bouw opnieuw bij relevante broncode- of dependencywijzigingen; gebruik geen verouderde images als bewijs voor de huidige code.
4. **Controleer de effectieve runtime vóór testverkeer.** Verifieer build-herkomst, versie/image-ID, entrypoint/command, processen en mounts. Controleer alle onderdelen die een flow aanroept, inclusief de API achter een frontend. Een tag, ingestelde omgevingsvariabele, HTTP 200 of healthcheck alleen bewijst de modus niet. Geen applicatiebroncode-, host-venv- of host-node_modules-mounts; noodzakelijke config-/datamounts blijven expliciet en credentials waar mogelijk read-only.
5. **Scheid runtime en omgevingsinstellingen.** Gebruik alleen ondersteunde configuratiewaarden. Verzin geen `APP_ENV=production` en zet niet zomaar `APP_ENV=live` om een productie-image te testen. Als localhost-beveiliging een lokale omgevingsinstelling vereist, rapporteer de afwijkingen van de echte deployment. Schakel TLS-, origin-, CSRF-, MFA- of service-keycontroles nooit uit om een test te laten slagen.
6. **Voer de toepasselijke volledige suites uit.** Gebruik Docker wanneer het project dat voorschrijft. Unit-, lint-, type- en statische checks blijven verplicht, maar vervangen geen runtimevalidatie. Een unit-test-, lint- of typecheckrunner is geen dev-server: die kan in de geschikte build-/testomgeving draaien zonder een developmentserver te starten. Een unit-test die een environment-branch simuleert is geen dev-runtime. Test uiteindelijke applicatieflows uitsluitend tegen de gecontroleerde productie-runtime.
7. **Respecteer toegang en neveneffecten.** Controleer authenticatie vóór beschermde browserflows; neem geen persoonlijke cookies over en omzeil geen MFA. Laat persoonlijke OAuth/MFA bij de gebruiker. Vraag expliciete toestemming voor doel en scantype vóór securityscans en voor betaalde of externe provideracties. Toon geen secrets of volledige geïnterpoleerde configuraties in output, screenshots of rapporten.
8. **Rapporteer bewijs en beperkingen.** Benoem artifacts, startmodus, mounts, doelen, omgevingsverschillen en uitgevoerde commando's/flows. Scheid geslaagd, mislukt, geblokkeerd en niet uitgevoerd. Een geslaagde build of unit-testsuite bewijst geen werkende login, OAuth of AI-/audiosessie.
9. **Ruim gericht op.** Stop alleen voor deze opdracht gestarte testresources. Geen generieke `down -v`, prune of verwijdering van gebruikersdata. Herstel een bewust gewijzigde stack alleen volgens het vooraf afgesproken plan. Commit of push niet zonder expliciet verzoek.

## Status van deze regel

Dit is een instructieskill, geen technische sandbox of automatische runtimecontrole. Pi kiest skills op basis van de taak; laad zo nodig expliciet met `/skill:production-testing`. Een controle van frontmatter of instructietekst bewijst alleen dat de skill vindbaar en correct beschreven is, niet dat een applicatie al in productiemodus draait.
