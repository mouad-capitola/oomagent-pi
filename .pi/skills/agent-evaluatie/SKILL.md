---
name: agent-evaluatie
description: Ontwerp en beoordeel herhaalbare evaluaties van bedrijfsagents op taakresultaat, brongebruik, toolacties, hallucinaties en menselijke escalatie. Gebruik bij agenttests, prompt- of modelvergelijkingen en regressiecontroles.
---

# Agent-evaluatie

Maak agentkwaliteit meetbaar. Begin met een testplan; voer alleen tests uit binnen de afgesproken scope.

## Werkwijze

1. Lees projectinstructies en relevante agentconfiguratie. Bepaal het bedrijfsdoel, de doelgroep, beschikbare tools, databronnen en verboden acties. Vraag alleen naar ontbrekende informatie die de evaluatie beïnvloedt.
2. Leg versie van agent, prompt, model, toolconfiguratie en kennisbron vast, plus omgeving, tijdstip en toegestane testdata. Gebruik synthetische of expliciet goedgekeurde geanonimiseerde gegevens.
3. Lees `assets/evaluatierapport.md` en maak een testmatrix. Neem toepasselijke scenario's op:
   - Normale taken en varianten in taal, formulering en invoerlengte.
   - Ontbrekende of tegenstrijdige informatie, onbekende antwoorden en onjuiste aannames.
   - Brongebruik: onderbouwde claims, juiste verwijzingen en verouderde kennis.
   - Toolgebruik: juiste tool en parameters, juiste klant/tenant, minimale rechten.
   - Time-outs, onbeschikbare tools, rate limits, retries en dubbele uitvoering.
   - Menselijke escalatie, bevestiging vóór risicovolle acties en weigering buiten scope.
   - Prompt-injection en pogingen om klantgrenzen te overschrijden; gebruik hiervoor ook de prompt-injection-review-skill indien beschikbaar.
4. Definieer vóór uitvoering per testcase observeerbare acceptatiecriteria: vereist antwoord/actie, verboden gedrag, toegestane neveneffecten en beoordelingswijze. Exacte tekstmatching alleen wanneer het product dat vereist.
5. Scheid antwoordkwaliteit van actiecorrectheid. Gebruik voor acties bij voorkeur gecontroleerde tooltraces of mocks; een agent die zegt dat een actie is geslaagd bewijst niet dat die is uitgevoerd.
6. Gebruik bestaande lokale testvoorzieningen. Controleer hun neveneffecten vooraf. Vraag toestemming voor betaalde modelcalls, externe diensten, nieuwe dependencies en writes; gebruik een testomgeving zonder echte klantacties. Zonder testvoorziening lever je een uitvoerbaar testplan, geen verzonnen testresultaten.
7. Houd bij vergelijkingen testset en criteria gelijk. Herhaal variabele scenario's volgens een afgesproken aantal runs en leg modelparameters vast. Behandel een modelbeoordelaar als aanvullend bewijs, niet als enige waarheid voor veiligheidskritische criteria.
8. Rapporteer per testcase geslaagd, mislukt of niet uitgevoerd, met bewijs en beperkingen. Geef aantallen en noemers; verzin geen kosten, latency of slagingspercentages. Kritieke ongeautoriseerde acties of datalekken mogen niet verdwijnen in een gemiddelde score.
9. Stel gerichte verbeteringen en regressietests voor. Wijzig prompts, code of configuratie alleen als de gebruiker dat ook vraagt.

## Grenzen

- Deze skill is geen testframework en geen garantie voor productiegedrag.
- Voer geen productieacties uit, verstuur geen echte persoonsgegevens of geheimen en open geen `.env`-waarden.
- Log alleen noodzakelijke, geredigeerde gegevens; meng geen klantdata.
- Schrijf rapporten alleen naar een afgesproken locatie; overschrijf geen bestaand bestand zonder toestemming.
- Voeg in deze configuratierepository geen applicatielogica toe. Commit of push niet zonder expliciet verzoek.
