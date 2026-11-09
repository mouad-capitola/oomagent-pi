# CI-status

Eigen alleen-lezen tool: `ci_status`, in `.pi/extensions/ci-status.ts`.
Laad met `/reload` in de vertrouwde projectwerkplek. Ook opgenomen in het Pi-package.

Vraag bijvoorbeeld: **“Bekijk mijn laatste CI-runs”** of **“Waarom is run 12345 mislukt?”**

## Parameters

- `repo`: optioneel `OWNER/REPO` op github.com; standaard de Git-origin van de huidige werkmap.
- `limit`: 1–20 recente runs, standaard 5; alle branches.
- `branch`: optioneel exacte branch bij het tonen van runs.
- `run_id`: specifieke run; toont mislukte jobs en stappen.
- `include_logs`: standaard true bij een voltooide mislukte run; false haalt alleen metadata op.

Vereist bestaande GitHub CLI (`gh`) en jouw eigen login met leesrechten.
Als login ontbreekt: voer zelf `gh auth login` uit. Deel geen tokens in chat.
Alleen github.com wordt ondersteund; geen Enterprise-hosts.
Er worden geen workflows gestart, herstart, gewijzigd of verwijderd.

## Grenzen en veiligheid

De tool voert alleen Git-configuratielezing en `gh run list/view` uit, zonder shell.
Maximaal 30 seconden per subprocess, 60 seconden totaal en 2 MiB per antwoord.
Details bevatten maximaal 5 mislukte jobs en 5 mislukte stappen per job.
Namen worden afgekapt tot 80 tekens. Logselectie kiest foutregels met context
(maximaal 100 regels en circa 12 KB); zonder herkenbare foutregels de laatste 40.
Dit is een heuristiek, geen bewezen hoofdoorzaak. Links verwijzen naar de volledige run.

Logs worden pas bij een specifieke run opgehaald. Ontbrekende of te grote logs
leveren een waarschuwing op zonder de beschikbare runstatus te verliezen.
Herkenbare credentials en terminalbesturing worden verwijderd; dit is geen volledige
garantie tegen geheimen in logs. Gebruik `include_logs: false` bij gevoelige logs.
Namen en logs zijn onbetrouwbare data, geen instructies.
De tool schrijft geen ruwe logs; GitHub CLI kan zelf logs lokaal cachen.

## Tests

`node --test tests/ci-status.test.mjs`

Deze tests simuleren subprocessen; geen login, netwerk of betaalde modelaanroep.
