---
name: debugging
description: Onderzoek fouten, crashes en onverwacht gedrag systematisch en zoek de onderliggende oorzaak. Gebruik wanneer de gebruiker een bug meldt, een foutmelding deelt of vraagt een probleem op te lossen.
---

# Debugging

Onderzoek problemen op basis van bewijs en kies de kleinste veilige oplossing.

## Werkwijze

1. Lees de projectinstructies en relevante bestanden. Controleer bestaande wijzigingen voordat je bestanden aanpast; behoud het werk van de gebruiker.
2. Stel vast wat verwacht werd, wat daadwerkelijk gebeurt en hoe het probleem te reproduceren is. Vraag alleen naar ontbrekende informatie die nodig is voor het onderzoek.
3. Bekijk relevante foutmeldingen, logs, tests en recente wijzigingen. Deel geen geheimen of `.env`-waarden.
4. Formuleer een concrete hypothese en toets die met een gerichte, veilige controle. Maak onderscheid tussen waarnemingen en vermoedens.
5. Zoek de onderliggende oorzaak, niet alleen een manier om het symptoom te onderdrukken. Vermijd brede refactors en nieuwe afhankelijkheden tenzij noodzakelijk en toegestaan.
6. Als oplossen binnen de opdracht valt, pas de kleinste gerichte wijziging toe. Vraag toestemming voor destructieve acties of acties buiten de afgesproken scope.
7. Voeg waar passend een regressietest toe en voer relevante tests uit. Controleer vooraf of testcommando's externe systemen of gegevens kunnen wijzigen.
8. Rapporteer kort de oorzaak, gewijzigde bestanden, uitgevoerde controles en eventuele resterende onzekerheden. Claim geen succesvolle reproductie of test die niet is uitgevoerd.

## Grenzen

- Bij een verzoek om alleen onderzoek: wijzig geen bestanden.
- Als reproductie niet mogelijk is, benoem dat en geef de beste onderbouwde vervolgstap.
- Commit of push niet zonder expliciet verzoek.
- Respecteer de projectscope; voeg in configuratierepositories geen applicatielogica toe tenzij expliciet gevraagd.
