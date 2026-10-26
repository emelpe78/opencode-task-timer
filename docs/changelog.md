# Changelog-Regeln

Diese Datei ist der Vertrag für die Pflege von `CHANGELOG.md` im Projektstamm. Sie regelt Aufbau und Versionsgruppierung nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) und [Semantic Versioning](https://semver.org/lang/de/). Sprache und Zeichensetzung folgen den Regeln aus `AGENTS.md`: deutsch, genderneutral mit `:in` / `:innen`, niemals der Geviertstrich.

## Rollen der Versionsebenen

| Ebene                      | Beispiel | Rolle in `CHANGELOG.md`                                                                                                           |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Patch** (`x.y.z`, z ≥ 1) | `0.1.7`  | Eine zusammenhängende Lieferung aus Änderungen, Fehlerbehebungen oder kleinen Funktionen. Steht als eigener, datierter Abschnitt. |
| **Minor** (`x.y.0`)        | `0.2.0`  | Eigener Abschnitt, der das Produktthema dieser Minor-Linie und die zugehörige Patch-Arbeit zusammenfasst.                         |
| **Major** (`x.0.0`)        | selten   | Bruch in Produkt oder Plattform. Gleiches Abschnittsmuster, mit ausdrücklicher Bruch-Zusammenfassung.                             |

`[Unreleased]` ist die Ablage für Arbeit, die noch nicht in einen Versionsabschnitt geschnitten ist. Veröffentlichte Arbeit bleibt nicht nur unter `[Unreleased]` stehen.

## Patch-Fassungen (Regelfall)

1. Sinnvoll bündeln: ein Patch ist eine zusammenhängende Geschichte (zusammen ausgelieferte Änderungen), nicht eine Zeile je Commit und kein zusammenhangloses Sammelbecken.
2. Den Patch unter der laufenden Minor-Linie hochziehen (nach `0.1.0` folgen `0.1.1`, `0.1.2`, …).
3. Den neuen Abschnitt direkt unter `[Unreleased]` einfügen (neueste zuerst), über älteren Patches derselben Minor-Linie und über dem Minor-Abschnitt, sobald Patches existieren.
4. Mit einer einzeiligen Patch-Release-Zusammenfassung beginnen, danach die Gruppen aus Keep a Changelog (`Hinzugefügt` / `Geändert` / `Behoben` / `Entfernt` / `Sicherheit`).
5. Pro Zeile eine fette Einleitung bevorzugen (`**Thema:** …`).

Dokumentierte Form:

```markdown
## [Unreleased]

---

## [0.1.7] - YYYY-MM-DD

Patch-Release: **Kurzthema**.

### Behoben

- **…**
```

## Minor-Fassungen

1. Eine Minor schneiden, wenn das Produktthema eine neue `x.y.0` rechtfertigt (ein neues Fähigkeitsbündel, nicht nur angesammelte Patches).
2. Einen eigenen Minor-Release-Abschnitt für `x.y.0` schreiben, mit einer Zusammenfassungszeile, die die Themen dieser Minor-Linie benennt.
3. Dieser Minor-Abschnitt fasst die Patch-Fassungen seiner Linie zusammen: entweder über die Themen in der Zusammenfassung oder über die tragende Erzählung aus Hinzugefügt / Geändert / Behoben. Patches behalten ihre eigenen ausführlichen Abschnitte; die Minor ist Schlagzeile und Rollup, kein Ersatz für die Patch-Historie.
4. Nach einer Minor läuft die Arbeit als neue Patches weiter (`x.y.1` …) bis zur nächsten Minor.

Reihenfolge (neueste zuerst):

```text
[Unreleased]
[0.1.7]  ← Patch
[0.1.6]  ← Patch
…
[0.1.0]  ← Minor (Zusammenfassung der 0.1-Linie)
```

## Wann aktualisieren

`CHANGELOG.md` wird im selben Schritt wie die Änderung gepflegt, sobald diese für Nutzer:innen sichtbar oder betrieblich bedeutsam ist: Funktionen, Fehlerbehebungen, Vertragsänderungen, Messverhalten, Aufbewahrung, nennenswerte Dokumentation.

Reine Tippfehler- oder reine Zwischenstände dürfen bis zum nächsten Patch-Schnitt unter `[Unreleased]` bleiben.

Der Versionsabschnitt und die Version in `package.json` werden zusammen hochgezogen.
