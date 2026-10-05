# Loginflow-testdemo

Lokale, dependencyvrije UI-demo met fictieve gegevens. Geen productie-authenticatie:
credentials staan bewust in de browsercode, er is geen backend-authenticatie of persistente sessie.

## Starten

Vanaf de repositoryroot:

```sh
node demos/login-flow/server.mjs
```

Open http://127.0.0.1:4173.
Testaccount: `demo@example.test` / `Demo123!`.
Stop de server met Ctrl+C.

## Regressietests

```sh
node --test demos/login-flow/auth.test.mjs
```

## Uitgevoerde tooltest

1. Bewuste bug: `password.toLowerCase() === 'Demo123!'`.
   Lightpanda vulde het juiste account in, klikte Inloggen en zag de foutmelding.
   Twee van vier Node-tests faalden.
2. Serena vond `authenticate` via `find_symbol(include_body=true)` en herstelde
   het symbool via `replace_symbol_body`: `password === 'Demo123!'`.
3. Een extra compatibiliteitsprobleem kwam aan het licht:
   Lightpanda implementeert hier geen `HTMLFormElement.reset()`.
   De app maakt nu beide inputwaarden expliciet leeg.
4. De volledige Lightpanda-flow is daarna geslaagd:
   beginscherm, verkeerd wachtwoord afwijzen, verkeerde hoofdletters in het
   wachtwoord afwijzen, correct inloggen na die fouten, dashboard tonen,
   uitloggen en velden leegmaken, opnieuw inloggen met een uppercase e-mailadres.
   Vier van vier Node-regressietests slagen.

Lightpanda kon de localhost-server niet bereiken. Voor de browsertests zijn de
ongewijzigde HTML en de scripts uit dezelfde bronbestanden samengevoegd en als
`data:text/html`-pagina geladen. Daarmee is de UI-flow getest, niet de HTTP-integratie.
De lokale HTTP-server is afzonderlijk bereikbaar via curl.
