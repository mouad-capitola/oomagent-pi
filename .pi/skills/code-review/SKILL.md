---
name: code-review
description: Beoordeel codewijzigingen op concrete bugs, veiligheidsrisico's, regressies en ontbrekende tests. Gebruik wanneer de gebruiker om een code review, beoordeling van een diff of controle vóór een commit vraagt.
---

# Code review

Geef een gerichte, onderbouwde beoordeling. Een review is standaard alleen-lezen.

## Werkwijze

1. Lees de projectinstructies en bepaal de reviewscope. Gebruik de aangegeven bestanden of diff; als niets is aangegeven, bekijk lokale wijzigingen. Vraag om verduidelijking als de scope niet vast te stellen is.
2. Lees de gewijzigde code en voldoende omliggende context om gedrag, aanroepers en tests te begrijpen. Beoordeel wijzigingen tegenover het bedoelde gedrag.
3. Zoek vooral naar concrete fouten: onjuiste logica, onveilige invoer, blootstelling van geheimen, ontbrekende foutafhandeling, lifecycleproblemen, compatibiliteitsbreuken en regressies.
4. Controleer of tests de relevante scenario's afdekken. Voer alleen passende, veilige controles uit; controleer vooraf mogelijke neveneffecten en rapporteer wat wel en niet is uitgevoerd.
5. Rapporteer bevindingen in volgorde van ernst. Geef per bevinding een korte titel, bestand en regelnummer, het concrete probleem, de omstandigheden waarin het optreedt en de impact. Geef waar nuttig een beknopte oplossingsrichting.
6. Scheid aantoonbare bevindingen van open vragen. Vermijd speculatieve waarschuwingen, cosmetische voorkeuren en algemene adviezen zonder concrete aanleiding.
7. Als je geen problemen vindt, zeg dat expliciet en vermeld eventuele beperkingen van de review. Een review zonder bevindingen is geen garantie dat de code foutloos is.

## Ernst

- Kritiek: bijvoorbeeld gegevensverlies of een direct exploiteerbaar ernstig veiligheidsprobleem.
- Hoog: belangrijk gedrag is kapot of een waarschijnlijke ernstige regressie.
- Middel: een concrete fout in een beperkter scenario.
- Laag: een klein maar aantoonbaar probleem.

## Grenzen

- Wijzig geen bestanden tenzij de gebruiker ook om fixes vraagt.
- Deel geen geheimen of `.env`-waarden in bevindingen of uitvoer.
- Commit of push niet zonder expliciet verzoek.
- Respecteer de projectscope en bestaande wijzigingen van de gebruiker.
