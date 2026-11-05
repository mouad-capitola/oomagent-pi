# Tmux-werkplek

Start vanuit Terminal:

```sh
oomagent-workbench /pad/naar/project
# Of vanuit de huidige projectmap:
oomagent-workbench
```

Het commando start de `pi` en `nvim` die op je PATH staan.
De lokale `pi`-koppeling opent nu het OomAgent-startscherm: Esc kiest de upgrade,
`robot` + Enter deze werkplek met dezelfde upgrade rechts. Binnen tmux wordt het
startscherm overgeslagen. De oude managed Pi blijft bereikbaar als `pi-classic`.
De robot-route gebruikt een aparte `-upgrade`-sessie en vervangt geen oude sessies. Het bestaande
`oomagent`-commando (de aparte upgradeversie) wordt niet gewijzigd.
Er wordt een nieuwe Pi-chat gestart; je lopende chat wordt niet verplaatst.
Gebruik zo nodig `/resume` binnen Pi om een opgeslagen gesprek te kiezen.

## Indeling

- Venster 1 `editor`: Neovim links, Pi rechts, beide in dezelfde projectmap.
- Venster 2 `shell`: eigen interactieve shell in die projectmap.
- Venster 3 `logs`: extra shell voor een logcommando naar keuze. Er wordt niet
  automatisch een server, container of externe verbinding gestart.

Klik om een paneel te kiezen; sleep de scheiding om de breedte aan te passen.
Toetscombinaties betekenen: eerst Ctrl+b indrukken en loslaten, daarna de toets:

| Toets | Actie |
| --- | --- |
| pijl links/rechts | Ander paneel |
| 1 / 2 / 3 | Editor / shell / logs |
| c | Extra terminalvenster |
| z | Huidig paneel vergroten/verkleinen |
| d | Loskoppelen; programma's blijven draaien |

Start hetzelfde commando met dezelfde map opnieuw om terug te keren. Een andere
projectmap krijgt een eigen sessie. Open bij voorkeur rechtstreeks vanuit Terminal,
niet vanuit een bestaande tmux-sessie met dezelfde Ctrl+b-prefix.

Neovim opent de bestandslijst: Enter opent een bestand; `i` begint bewerken,
Escape stopt bewerken, `:w` slaat op, `:Ex` toont de bestandslijst en `:q` sluit.
Sla wijzigingen op voordat je Pi vraagt hetzelfde bestand aan te passen: Neovim
geeft niet-opgeslagen buffers niet door aan Pi. Er worden geen Neovim-plugins of
persoonlijke editorinstellingen geïnstalleerd of gewijzigd.

## Isolatie en bestanden

- Launcher: `scripts/oomagent-workbench.mjs`.
- Tmux-configuratie: `tmux/workbench.conf`; je `~/.tmux.conf` blijft ongemoeid.
- Lokale installatie: `~/.local/bin/oomagent-workbench` verwijst naar de launcher.
- Tmux 3.8 is via Homebrew geïnstalleerd. Neovim 0.12.6 is de officiële Intel-macOS-release,
  lokaal onder `~/.local/share/oomagent-workbench/neovim-v0.12.6/`, bereikbaar via
  `~/.local/bin/nvim`. De langlopende Homebrew-bronbouw van Neovim is afgebroken;
  reeds geïnstalleerde afhankelijkheden zijn niet verwijderd.
- Download: `https://github.com/neovim/neovim/releases/download/v0.12.6/nvim-macos-x86_64.tar.gz`.
  Gecontroleerde SHA-256: `481424f1dbc85f637d57e47d27d042aa9c883e5a4fe9ee64fc4ee9573b221998`.
- Tmux-server/socket: `oomagent-workbench`, los van andere tmux-sessies.
- Alleen het Pi-paneel krijgt `OOMAGENT_TMUX=1`: daarmee slaat de interne
  OomAgent-workspace-extensie haar eigen bestandseditor over. De nieuwe home-launcher
  gebruikt dezelfde marker om direct de upgrade te starten, in de projectmap.
  Authenticatie en configuratie blijven per Pi-installatie gescheiden.

`--detach` maakt de werkplek zonder aansluiten; `--help` toont hulp.
Bij een gedeeltelijk mislukte start blijven aangemaakte panelen behouden om geen
editorbuffers weg te gooien. Bekijk ze met `tmux -L oomagent-workbench list-sessions`
en sluit handmatig aan met `tmux -L oomagent-workbench attach -t SESSIENAAM`.
Gebruik geen `kill-server` als je nog andere werkplekken of niet-opgeslagen buffers hebt.

## Controles

```sh
node --check scripts/oomagent-workbench.mjs
PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 node --test tests/tmux-workbench.test.mjs tests/workspace.test.mjs
```

Resultaat lokaal: 25 tests geslaagd, geen skips. De tests gebruiken eigen tijdelijke
servers. Eén test controleert de indeling met testprogramma's; een tweede slaat echt
een bestand op in Neovim en controleert een echte offline Pi-start met geïsoleerde
configuratie, zonder MCP of modelaanvragen. De workspace-tests controleren ook dat
de interne editor alleen in de expliciete tmux-modus wordt overgeslagen.
Er is geen grafische muisklikcontrole of test met een betaald model uitgevoerd.
Dit configuratierepository heeft geen `npm run check`-script.
