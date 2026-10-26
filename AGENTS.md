# AGENTS.md - opencode-task-timer

Ein einzelnes TUI-Plugin für OpenCode 2. Klein genug, dass die Regeln kurz
bleiben können.

## Aufbau

- `src/laufzeit.ts` ist die reine Messlogik. Keine OpenCode- und keine
  Solid-Abhängigkeit, kein JSX. Nur so bleibt sie mit `node --test` prüfbar.
- `src/tui.tsx` verdrahtet die Ereignisse und rendert den Block. Hier steht
  keine Fachlogik, nur Übersetzung und Darstellung.
- `test/laufzeit.test.ts` prüft die Logik und nachgebildete Ereignisfolgen.

## Regeln

- Messverhalten ändern heißt zuerst `docs/messung.md` ändern. Der Vertrag ist die
  Quelle, nicht der Code.
- Neue oder geänderte Fachlogik gehört nach `src/laufzeit.ts` und bekommt einen
  Test. `src/tui.tsx` bleibt dünn.
- Nutzertexte sind deutsch, genderneutral mit `:in` / `:innen`, und enthalten
  niemals den Geviertstrich `—` (U+2014).
- Nie den vollen Prompt speichern. Gespeichert werden gekürzte Titel und
  Zeitpunkte.
- Ereignis-Payloads defensiv lesen: die Form kann zwischen OpenCode-Versionen
  wechseln. Fehlt ein Feld, wird das Ereignis übersprungen, nicht geraten.
- Keine neue Abhängigkeit ohne Grund. Laufzeit braucht nur `@opencode/plugin`
  und `solid-js`, beides stellt der Host.
- Vor jeder Veröffentlichung `npm test` grün und die Version in `package.json`
  und `CHANGELOG.md` zusammen hochziehen.
