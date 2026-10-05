---
description: Beoordeel een diff op concrete bugs, veiligheidsrisico's en regressies
argument-hint: "[bestanden, diff of focus]"
---
Voer een code-review uit met deze scope of focus:
${@:-Bekijk de lokale staged en unstaged wijzigingen; vraag naar de scope als er geen wijzigingen zijn.}

Lees en gebruik de beschikbare skill code-review en de geldende projectinstructies.
De review is alleen-lezen: wijzig geen bestanden, tenzij de gebruiker afzonderlijk om fixes vraagt.
Onderzoek gewijzigde code, relevante aanroepers en tests. Inspecteer testcommando's op neveneffecten voordat je ze uitvoert.
Rapporteer alleen concrete bevindingen, op ernst gesorteerd, met bestand en regelnummer, scenario en impact.
Scheid open vragen van bewezen fouten. Benoem expliciet als je geen bevindingen hebt, met de beperkingen en uitgevoerde controles.
Deel geen geheimen. Commit of push niet zonder expliciet verzoek.
