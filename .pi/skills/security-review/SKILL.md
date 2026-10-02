---
name: security-review
description: Beoordeel code en configuratie op concrete beveiligingsrisico's, zoals injectie, onjuiste toegangscontrole, blootstelling van geheimen en onveilige bestands- of netwerktoegang. Gebruik wanneer de gebruiker een beveiligingscontrole of security review vraagt.
---

# Security review

Onderzoek beveiligingsrisico's op basis van bewijs. Een review is standaard alleen-lezen.

## Werkwijze

1. Lees de projectinstructies en bepaal de scope. Bekijk de opgegeven bestanden of diff; gebruik lokale wijzigingen als niets is aangegeven. Vraag om verduidelijking als de scope niet vast te stellen is.
2. Lees relevante code en omliggende context. Bepaal welke gegevens onbetrouwbaar zijn, welke systeemgrenzen ze passeren en welke rechten of gevoelige gegevens bereikbaar zijn.
3. Controleer waar van toepassing:
   - Authenticatie, autorisatie en scheiding tussen gebruikers of tenants.
   - Command-, SQL- en template-injectie, XSS en onveilige deserialisatie.
   - Path traversal, symlinks en onbedoelde toegang buiten toegestane directories.
   - SSRF, redirects en toegang tot private netwerkadressen.
   - Geheimen in uitvoer, logs, broncode en configuratie, zonder geheimen of `.env`-waarden te openen of te tonen.
   - Onveilige standaardinstellingen, te ruime rechten en ontbrekende invoer- of groottelimieten.
   - Afhankelijkheden en bekende kwetsbaarheden, uitsluitend met passende bronverificatie; verzin geen advisories of CVE's.
   - Voor agentconfiguraties: onbetrouwbare inhoud die als instructie wordt behandeld, onveilige toolrechten en ontbrekende bevestiging voor riskante acties.
4. Toets vermoedens met gerichte, niet-destructieve lokale controles. Controleer vooraf mogelijke neveneffecten van tests en scripts. Scan geen externe systemen en voer geen exploits uit zonder expliciete toestemming en afgebakende scope. Verstuur geen private code of gegevens naar externe diensten zonder toestemming.
5. Rapporteer concrete bevindingen in volgorde van ernst. Vermeld per bevinding de locatie, het kwetsbare gedrag, benodigde voorwaarden, mogelijke impact en een gerichte oplossingsrichting. Toon nooit echte geheimen; gebruik placeholders.
6. Scheid bevestigde bevindingen van vermoedens en open vragen. Benoem welke controles zijn uitgevoerd en welke beperkingen blijven bestaan.
7. Als geen problemen zijn gevonden, zeg dat expliciet. Een review zonder bevindingen is geen garantie dat het systeem veilig is.

## Ernst

- Kritiek: bijvoorbeeld een direct exploiteerbare route naar systeemovername of grootschalig datalek.
- Hoog: een concreet risico op ernstige ongeautoriseerde toegang of blootstelling van gevoelige gegevens.
- Middel: een concreet risico met beperktere impact of aanvullende voorwaarden.
- Laag: een beperkt maar aantoonbaar beveiligingsprobleem.

Baseer ernst op impact en haalbaarheid binnen de werkelijke omgeving, niet alleen op het type probleem.

## Grenzen

- Wijzig geen bestanden tenzij de gebruiker ook om fixes vraagt.
- Respecteer bestaande wijzigingen en de projectscope; voeg geen applicatielogica toe aan een configuratierepository tenzij expliciet gevraagd.
- Installeer geen tools, wijzig geen rechten en voer geen destructieve acties uit zonder toestemming.
- Commit of push niet zonder expliciet verzoek.
