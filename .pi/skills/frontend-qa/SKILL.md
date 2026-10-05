---
name: frontend-qa
description: Test frontend flows en UI gedrag met Lightpanda en gebruik Serena bij fouten.
---

# Frontend QA

Gebruik deze skill wanneer een webinterface, formulier of gebruikersflow getest moet worden.

## Werkwijze

1. Open de applicatie met Lightpanda.
2. Controleer of de pagina correct laadt.
3. Test de belangrijkste gebruikersflow.
4. Test lege invoer.
5. Test foutieve invoer.
6. Test geldige invoer.
7. Controleer succes- en foutmeldingen.
8. Controleer navigatie en state changes.
9. Controleer consolefouten indien beschikbaar.
10. Als iets faalt:
   - reproduceer het probleem;
   - gebruik Serena om de relevante code te vinden;
   - bepaal eerst de root cause;
   - wijzig alleen wat nodig is;
   - test daarna opnieuw met Lightpanda.

## Output

Rapporteer kort:
- welke flow is getest
- welke checks zijn geslaagd
- welke checks zijn mislukt
- gevonden oorzaak
- eventuele fix
- resultaat van de hertest