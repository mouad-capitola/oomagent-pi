# Deze Pi + TUIOS op Windows

Gebruik **Windows Terminal → Ubuntu 24.04 of nieuwer (WSL2)**. Native PowerShell/Git Bash is niet het doel van deze installer; Lightpanda heeft geen native Windows-build.

## Eenmalig

In PowerShell als administrator, als WSL nog ontbreekt:

```powershell
wsl --install -d Ubuntu-24.04
```

Herstart indien gevraagd en maak je Ubuntu-gebruiker aan. Open daarna **Ubuntu** in Windows Terminal:

```bash
git clone https://github.com/mouad-capitola/oomagent-pi.git
cd oomagent-pi
bash setup.sh
./tuios
```

In een TUIOS-terminal typ je `pi`. Zonder TUIOS: `./pi` vanuit de clone.
Pi vraagt om projectvertrouwen; keur alleen configuratie goed die je vertrouwt.
Gebruik `/login` voor je eigen provider en zo nodig `/model` om een beschikbaar model te kiezen.

De clone mag overal in je **Linux-home** staan; geen `Projects`-map nodig. Vermijd `/mnt/c` voor deze Node/Python-installatie. De eerste installatie downloadt en bouwt meerdere tools, gebruikt enkele GB schijfruimte en vraagt `sudo` voor Ubuntu-pakketten. Internet is nodig; model-/GitHub-/Exa-accounts worden niet aangemaakt.

## Wat wordt meegenomen?

- Pi **1.5.2**, exact upstream-commit `b4afdddf44e059c67ccf5097e5317d913521b470`, plus de lokale chatframe/header-patch en bijbehorende regressietests.
- Jouw huidige extensies, startscherm, footer, thema, prompts en skills uit deze repository.
- TUIOS **0.12.1**, met `tiled = true` en `daemon = false`, zoals op de Mac. Overige TUIOS-instellingen blijven upstream-defaults.
- Node **25.6.1**, uv **0.12.23**, Python **3.13.16**, Serena **1.7.0**, documenttools en de hello-MCP-testserver.
- Lightpanda **1.0.4** (vaste stabiele release, in plaats van de veranderlijke nightly op de Mac).
- Playwright MCP **0.0.83** plus bijbehorende Chromium, in een apart profiel. Het zichtbare browservenster vereist WSLg; geen bestaande browsercookies worden overgenomen.
- ZAP **2.17.0**, MCP-add-on **0.4.0** en vastgelegde add-onafhankelijkheden. Alleen lokale, geauthenticeerde endpoints: MCP `127.0.0.1:8282` en proxy/API `127.0.0.1:18080`.
- Git, GitHub CLI, ripgrep, fd-find, Neovim en Java uit Ubuntu's pakketbeheer.

**Niet meegenomen:** applicatie-/klantrepos, je projectmappen, sessiegeschiedenis, browserprofielen, API-sleutels, macOS Keychain en providerlogins. Het aparte `oomagent-pi-upgrade`-experiment wordt niet gebruikt.

De optionele `/workspace`-projectbrowser blijft aanwezig; deze gebruikt momenteel `~/Projects`. Je hoeft die functie niet te gebruiken of die map aan te maken. Pi en TUIOS werken gewoon vanuit je huidige map.

## Persoonlijke accounts

- Pi: `/login` (abonnement/API-key); het gekozen model moet beschikbaar zijn voor jouw account.
- GitHub: `./tools gh auth login`.
- Exa/web_search: zet `EXA_API_KEY` in `.portable/state/local.env`, met een lokale editor. Dit bestand is privé en wordt niet gecommit. Zonder sleutel meldt de tool expliciet dat configuratie ontbreekt.
- ZAP: genereert lokaal nieuwe sleutels. Geen sleutel uit de Mac wordt gelezen of gekopieerd.
- Serena: taalservers zijn projectafhankelijk. Java/.NET/Go/Rust-toolchains voor je eigen projecten beheer je zelf; niet elke taalserver wordt vooraf geïnstalleerd.

`document_reader` gebruikt op Linux pypdf/python-docx, op macOS de bestaande systeemtools. Tekstextractie kan verschillen; geen OCR of exacte opmaakconversie.

## Gebruik en controles

```bash
./pi                         # start jouw Pi; start ZAP zonder te scannen
./tuios                      # vensters/terminals; pi staat daar op PATH
./tools doctor               # controleer binaries en Python-imports
./tools doctor --mcp         # controleer alle MCP-verbindingen, geen scan/modelcall
./tools zap status
./tools zap stop             # stop alleen de geauthenticeerde lokale ZAP-service
source ./activate.sh         # optioneel: pi/tuios/tools op PATH in deze Bash-shell
```

De launchers veranderen je werkmap niet. TUIOS, logins en sessies worden niet door Git gesynchroniseerd. ZAP blijft na het sluiten van Pi lokaal draaien, zodat resultaten behouden blijven; stoppen kan met het commando hierboven. **Een scan vereist altijd expliciete toestemming voor het doelwit.**

Bij een reeds gebruikte ZAP-poort met een andere sleutel stopt de launcher met een fout, zonder dat proces te vervangen. Je kunt Pi zonder MCP starten met `./pi --no-mcp`. Logbestanden onder `.portable/state/zap/` zijn privé en kunnen later scangegevens bevatten; deel ze niet blind.

## Bijwerken / opnieuw installeren

```bash
git pull --ff-only
bash setup.sh
```

Downloads worden gecontroleerd met SHA-256; npm gebruikt lockfiles zonder dependency-lifecyclescripts en Python gebruikt `uv.lock`. De gecontroleerde upstream Pi-build wordt expliciet uitgevoerd. Versies/hashwaarden staan in `portable/versions.sh` en `portable/zap-addons.txt`. Pi's standaard `pi update` is uitgeschakeld om de aangepaste build niet te vervangen.

Een herhaalde setup behoudt `.portable/agent/settings.json`, `mcp.json`, logins en lokale instellingen. Nieuwe defaults kun je vergelijken met `portable/configure.mjs`. Verplaats de clone na installatie niet zonder de lokale configuratiepaden opnieuw in te stellen.

Alle runtimes en Pi-state staan in de genegeerde `.portable/`-map; bestaande `~/.pi/agent`-installaties worden niet gewijzigd. Alleen een **ontbrekend** `~/.config/tuios/config.toml` wordt aangemaakt (of onder `XDG_CONFIG_HOME`). Bestaande TUIOS-instellingen blijven intact. Shellprofielen worden niet aangepast.

## Validatiegrens

Lokaal gecontroleerd in een schone Ubuntu 24.04 x86-64-container: volledige installatie én herinstallatie met behoud van configuratie, alle vijf MCP-verbindingen, echte Lightpanda/Playwright-aanroepen op een synthetische lokale pagina, Serena-symboolanalyse, een geauthenticeerde ZAP-versieaanroep, PDF/DOCX-extractie, chatframe-regressies en Pi/TUIOS in echte PTY's. De repositorysuite slaagt met 182 tests tegen de aangepaste Pi-runtime. De GitHub-workflow herhaalt de Linux-installatie en gerichte tests zonder modelaanroepen of scans.

Een Ubuntu-container is **geen volledige Windows/WSLg-test**. Echte Windows Terminal-rendering, toetsenbord/klembord en browservensters moeten op jouw computer bevestigd worden. Authenticatie wordt bewust niet automatisch getest met jouw credentials.

Upstreamdocumentatie: [Pi](https://github.com/earendil-works/pi), [TUIOS](https://github.com/Gaurav-Gosain/tuios), [Lightpanda](https://github.com/lightpanda-io/browser), [Serena](https://github.com/oraios/serena), [ZAP MCP](https://www.zaproxy.org/docs/desktop/addons/mcp-integration/).
