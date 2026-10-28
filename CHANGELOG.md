# Changelog

Alle nennenswerten Änderungen an diesem Plugin. Format angelehnt an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [Semantic Versioning](https://semver.org/lang/de/). Aufbau und Pflege sind in [docs/changelog.md](docs/changelog.md) beschrieben.

## [Unreleased]

---

## [0.1.11] - 2026-10-28

Patch-Release: **Build-Skript auf Englisch**.

### Geändert

- **Build-Skript:** heißt jetzt `compile` statt `bauen`. Weiterhin nicht `build`, damit npms Vorbereitung für Git-Abhängigkeiten nicht scheitert.

## [0.1.10] - 2026-10-28

Patch-Release: **Anwendungsfall LLM-Dauer**.

### Geändert

- **README:** Nennt den typischen Anwendungsfall, die Dauer zu messen, die ein LLM braucht, um eine Aufgabe abzuschließen.

## [0.1.9] - 2026-10-28

Patch-Release: **Öffentlich und auf npm**.

### Geändert

- **Open Source:** Repository ist öffentlich unter `emelpe78/opencode-task-timer`; das Paket liegt auf npm als `opencode-task-timer`.
- **Auffindbarkeit:** Beschreibung und Keywords für GitHub und npm geschärft, damit das Plugin leichter gefunden wird.

## [0.1.8] - 2026-10-26

Patch-Release: **Titel bleiben stehen, der Block spricht Englisch**.

### Behoben

- **Titel fehlte:** `session.inbox.enqueued` kommt vor `session.execution.started`. Der Prompt-Text wird jetzt schon beim Vormerken je Sitzung abgelegt und benennt den startenden Lauf, statt beim Start ins Leere zu greifen.
- **Zustand überschrieb sich:** Der Store schreibt asynchron und lieferte kurz danach noch den alten Stand. Ereignisse rechnen deshalb auf einem eigenen Stand mit Revision; der Store gilt nur, wenn er nicht älter ist. Zwei Prompts kurz hintereinander verlieren so keinen Titel mehr.
- **Befehle waren unauffindbar:** Die Tastenebene registrierte kein `mode` und lag damit im Standardmodus `base`, der nur bei leerem Eingabefeld greift. Befehlspalette und Slash-Vervollständigung laufen dagegen im globalen Modus und sahen weder `/laufzeiten-reset` noch `/ott-reset`. Die Ebene ist jetzt `mode: "global"`, beide Befehle erscheinen wieder in Palette und Vervollständigung.
- Ein abgebrochener Prompt (`session.inbox.cancelled`) wird entfernt und benennt keinen späteren Lauf.

### Geändert

- Der Block in der Seitenleiste ist englisch: Überschrift `Durations`, Status `error`, `aborted`, `superseded`, `ended`, `inactive`, `clock skew`, Hinweis `waiting for you`, Zusatz `20s waiting`, Summenzeile `2 tasks, 1m 57s, Ø 59s` und `untitled`. Befehle, Palettentitel, Dialoge und Toasts bleiben deutsch.
- Die beiden Befehle heißen jetzt `/ott-reset` und `/ott-reset-all` statt `/laufzeiten-reset` und `/laufzeiten-reset-alle`. Die alten Namen entfallen ersatzlos; Titel, Gruppe, Rückfrage und Toast bleiben deutsch.

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
