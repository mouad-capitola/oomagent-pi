---
description: Geef een bewijsgericht go/no-go-advies voor oplevering van een bedrijfsagent
argument-hint: "[agent, release of omgeving]"
---
Beoordeel de oplevergereedheid van:
${@:-Gebruik de agent en release uit de huidige context; vraag naar ontbrekende releasegegevens en acceptatiecriteria.}

Lees en gebruik de beschikbare skill opleverchecklist en het bijbehorende opleverrapport.
Controleer de toepasselijke criteria voor kwaliteit, veiligheid, privacy, configuratie, betrouwbaarheid, logging, kosten, beheer en rollback.
Markeer iedere controle als geslaagd, mislukt, onbekend of niet van toepassing met reden; geslaagd vereist actueel bewijs.
Lever het rapport in de chat. Wijzig geen bestanden en sla geen rapport op zonder afzonderlijk verzoek en afgesproken locatie.
Vraag toestemming voor externe, betaalde, muterende of productiecontroles. Deploy niet en wijzig geen rechten.
Geef een go-advies, voorwaardelijk advies of no-go met blokkades, eigenaren en benodigd bewijs; het besluit blijft bij de bevoegde verantwoordelijke.
Deel geen geheimen. Commit of push niet zonder expliciet verzoek.
