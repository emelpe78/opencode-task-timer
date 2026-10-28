# AGENTS.md - opencode-task-timer

Ein einzelnes TUI-Plugin für OpenCode 2. Klein genug, dass die Regeln kurz bleiben können.

## Aufbau

- `src/measurement.ts` ist die reine Messlogik. Keine OpenCode- und keine Solid-Abhängigkeit, kein JSX. Nur so bleibt sie mit `node --test` prüfbar.
- `src/tui.tsx` verdrahtet die Ereignisse und rendert den Block. Hier steht keine Fachlogik, nur Übersetzung und Darstellung.
- `test/measurement.test.ts` prüft die Logik und nachgebildete Ereignisfolgen.
- `docs/measurement.md` ist der Vertrag für die Messung, `docs/changelog.md` der Vertrag für Aufbau und Pflege der `CHANGELOG.md`.

## Regeln

- Messverhalten ändern heißt zuerst `docs/measurement.md` ändern. Der Vertrag ist die Quelle, nicht der Code.
- Freigabewürdige Arbeit wird im selben Schritt in `CHANGELOG.md` eingetragen, nach den Regeln in `docs/changelog.md`.
- Neue oder geänderte Fachlogik gehört nach `src/measurement.ts` und bekommt einen Test. `src/tui.tsx` bleibt dünn.
- Bezeichner, Variablen, Funktionen, Typen, Properties und Dateinamen sind englisch, ebenso interne Literale wie Ereignisarten und Lauf-Status.
- Nutzertexte, Kommentare und Dokumentation bleiben deutsch. Nutzertexte sind genderneutral mit `:in` / `:innen` und enthalten niemals den Geviertstrich `—` (U+2014).
- Nie den vollen Prompt speichern. Gespeichert werden gekürzte Titel und Zeitpunkte.
- Ereignis-Payloads defensiv lesen: die Form kann zwischen OpenCode-Versionen wechseln. Fehlt ein Feld, wird das Ereignis übersprungen, nicht geraten.
- Keine neue Abhängigkeit ohne Grund. Laufzeit braucht nur `@opencode/plugin` und `solid-js`, beides stellt der Host.
- Vor jeder Veröffentlichung `npm test` grün, `npm run compile` ausgeführt und die Version in `package.json` und `CHANGELOG.md` zusammen hochziehen.
- `package.json` darf keines der Skripte `build`, `prepare`, `prepack`, `install`, `preinstall` oder `postinstall` nennen: npms pacote löst dann bei einer Git-Abhängigkeit eine Vorbereitung aus, die scheitert.
- `dist/` ist eingecheckt und muss die Messlogik mitliefern. Ein Import in `dist/tui.js` darf nicht auf `src/` zeigen, weil `src/` nicht im Paket liegt.
- Markdown wird nicht umbrochen: ein Absatz, ein Listeneintrag und eine Tabellenzeile stehen jeweils in einer einzigen Zeile, egal wie lang. Feste Zeilenumbrüche gehören nur in Codeblöcke, in Tabellen ist die Zeilenlänge ohnehin egal.
