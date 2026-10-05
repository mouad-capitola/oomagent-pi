---
description: Onderzoek een bug bewijsgericht en bepaal de kleinste veilige oplossing
argument-hint: "[probleem of foutmelding]"
---
Onderzoek het volgende probleem:
${@:-Gebruik het probleem uit de huidige gesprekscontext; vraag om verwacht en werkelijk gedrag als die ontbreken.}

Lees en gebruik de beschikbare skill debugging. Controleer projectinstructies en bestaande lokale wijzigingen.
Bepaal reproductiestappen, toets gerichte hypotheses en zoek de onderliggende oorzaak.
Dit verzoek is standaard alleen onderzoek: wijzig geen bestanden, tenzij de gebruiker ook expliciet om een oplossing vraagt.
Bij een toegestane fix: maak de kleinste wijziging en voeg passende regressiedekking toe.
Inspecteer testcommando's op neveneffecten voordat je ze uitvoert.
Rapporteer bewijs, oorzaak of resterende hypothese, exacte controles en beperkingen; verzin geen testresultaten.
Deel geen geheimen. Commit of push niet zonder expliciet verzoek.
