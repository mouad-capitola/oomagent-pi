---
name: tijdsinschatting
description: Geef bij iedere nieuwe taak vooraf een korte, eerlijke schatting van de benodigde tijd en werk die bij wanneer de scope verandert of vertraging ontstaat. Gebruik voor onderzoek, uitleg, codewijzigingen, configuratie, tests en andere opdrachten, ook wanneer de gebruiker niet naar de duur vraagt.
---

# Tijdsinschatting

## Bij iedere nieuwe taak

- Geef vóór het eerste onderzoek of de eerste toolactie een korte tijdsinschatting in de taal van de gebruiker. Combineer dit met de aankondiging van wat je gaat doen.
- Gebruik een grove bandbreedte die past bij omvang, onzekerheid en verwachte controles, bijvoorbeeld: “Dit duurt naar verwachting 2–5 minuten. Ik controleer eerst de configuratie.” Kies de bandbreedte per taak; gebruik niet automatisch hetzelfde getal.
- Voor een direct te beantwoorden vraag zonder tools volstaat een korte aanduiding in het antwoord, bijvoorbeeld “Geschatte duur: minder dan een minuut.” Voor een begroeting of bedankje zonder opdracht is geen schatting nodig.
- Is de omvang nog onbekend, schat alleen de eerste onderzoeksstap en zeg dat de totale duur nog onzeker is. Geef na die stap een nieuwe inschatting voor het vervolg.
- Houd rekening met uitvoering, noodzakelijke tests en verificatie. Onderscheid eigen actieve werktijd van wachttijd op downloads, builds, externe diensten of de gebruiker. Verzin voor onvoorspelbare wachttijd geen exacte duur.

## Tijdens de uitvoering

- Geef bij een wezenlijke scopewijziging, blokkade of dreigende overschrijding een korte update: wat klaar is, wat nog nodig is en een herziene schatting van de resterende tijd.
- Maak duidelijk of een nieuwe bandbreedte de resterende tijd of de totale tijd betreft. Geef geen voortgangsbericht na iedere toolactie.
- Als je op toestemming, login of informatie wacht, meld dat het werk daarop wacht; suggereer niet dat je zelfstandig blijft doorwerken.
- Bij langdurige taken: geef waar mogelijk bij een afgeronde werkstap een beknopte voortgangsupdate. Beloof geen timerupdates tijdens een blokkerende toolaanroep of nadat de beurt is afgelopen.

## Eerlijkheid en grenzen

- Een tijdsinschatting is geen garantie. Vermijd exacte eindtijden, ongefundeerde percentages en schijnprecisie.
- Rapporteer werkelijk verstreken tijd alleen als die met betrouwbare begin- en eindtijd is gemeten; presenteer een eerdere schatting niet als gemeten duur.
- Sla geen controles of toestemmingsvragen over om binnen de schatting te blijven. Rek werk niet op om een schatting te laten kloppen.
- Houd het kort: doorgaans één zin vooraf, plus alleen noodzakelijke updates. Respecteer expliciete uitvoerformaten en hogere instructies; voeg bij een strikt antwoordformaat geen ongevraagde velden toe.

## Activering

Pi laadt skills op basis van relevantie; een skill alleen garandeert geen toepassing bij iedere taak. Een vaste gebruikersinstructie in ~/.pi/agent/AGENTS.md moet daarom deze werkwijze voor iedere nieuwe taak voorschrijven. Dit zijn gedragsinstructies, geen automatische timer of technische afdwinging.
