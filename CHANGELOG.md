# Changelog

Alle nennenswerten Änderungen an diesem Plugin. Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [Semantic Versioning](https://semver.org/lang/de/). Aufbau und Pflege sind in [docs/changelog.md](docs/changelog.md) beschrieben.

## [Unreleased]

---

## [0.1.7] - 2026-10-26

Patch-Release: **Die veröffentlichte Fassung lädt wieder**.

### Behoben

- Drei Ursachen nacheinander, die das Laden verhinderten:
  - JSX in `node_modules` wird nicht transformiert, deshalb fehlte ein vorgebautes `dist/` (`Cannot find package 'react'`).
  - `dist/tui.js` importierte `./laufzeit.ts`, die nicht im Paket lag (`Cannot find module './laufzeit.ts'`).
  - Ein `build`-Skript löste npms Vorbereitung für Git-Abhängigkeiten aus und ließ die Installation abbrechen (`git dep preparation failed`). Der Build heißt jetzt `bauen`.

### Hinzugefügt

- `scripts/build.mjs` baut `src/tui.tsx` und `src/measurement.ts` nach `dist/`.

## [0.1.0] - 2026-10-26

Minor-Release: **Erste Fassung**. Die Linie bringt den Laufzeiten-Block in der Seitenleiste, die Messung je Agentenlauf samt Wartezeit und die durable Ablage. Die Patches dieser Linie nach `0.1.0` beheben ausschließlich das Laden der veröffentlichten Fassung.

### Hinzugefügt

- Block `Laufzeiten` in der Seitenleiste, neueste Aufgabe oben, höchstens zehn Zeilen, mit Dauer, Titel und Status nur bei Abweichung.
- Laufender Eintrag mit sekündlichem Takt und Hinweis `wartet auf dich`.
- Wartezeit auf Freigaben und Rückfragen zählt zur Laufzeit und wird beim Abschluss als `· 20s warten` ausgewiesen.
- Summenzeile über alle abgeschlossenen Aufgaben der Sitzung.
- Zustände `Fehler`, `abgebrochen`, `verdrängt`, `beendet`, `inaktiv` und `Zeitsprung`.
- Messung je Agentenlauf statt je Prompt: `steer` und Fortsetzung nach einer Kompaktierung verlängern, Subagenten zählen nicht separat.
- Durable Ablage mit Aufbewahrung über 30 Tage und 200 Sitzungen.
- Liegengebliebene Läufe werden beim Start als `beendet` abgeschlossen.
- Befehle `/laufzeiten-reset` und `/laufzeiten-reset-alle`.
- Ausblenden bei sehr schmaler Seitenleiste.
- Tests für die Messlogik mit `node --test`.
