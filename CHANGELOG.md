# Changelog

Alle nennenswerten Änderungen an diesem Plugin. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach
[Semantic Versioning](https://semver.org/lang/de/).

## [0.1.0] - 2026-10-26

Erste Fassung.

### Hinzugefügt

- Block `Laufzeiten` in der Seitenleiste, neueste Aufgabe oben, höchstens zehn
  Zeilen, mit Dauer, Titel und Status nur bei Abweichung.
- Laufender Eintrag mit sekündlichem Takt und Hinweis `wartet auf dich`.
- Wartezeit auf Freigaben und Rückfragen zählt zur Laufzeit und wird beim
  Abschluss als `· 20s warten` ausgewiesen.
- Summenzeile über alle abgeschlossenen Aufgaben der Sitzung.
- Zustände `Fehler`, `abgebrochen`, `verdrängt`, `beendet`, `inaktiv` und
  `Zeitsprung`.
- Messung je Agentenlauf statt je Prompt: `steer` und Fortsetzung nach einer
  Kompaktierung verlängern, Subagenten zählen nicht separat.
- Durable Ablage mit Aufbewahrung über 30 Tage und 200 Sitzungen.
- Liegengebliebene Läufe werden beim Start als `beendet` abgeschlossen.
- Befehle `/laufzeiten-reset` und `/laufzeiten-reset-alle`.
- Ausblenden bei sehr schmaler Seitenleiste.
- Tests für die Messlogik mit `node --test`.
