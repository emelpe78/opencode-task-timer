# Was gemessen wird

Dieser Text ist der Vertrag für die Messung. Wer die Messung ändert, ändert zuerst hier. Die Umsetzung liegt in `src/measurement.ts` und ist dort durch Tests belegt.

## Start und Ende

- Die Uhr startet bei `session.execution.started`, also wenn der Agent wirklich zu arbeiten beginnt, nicht wenn der Prompt abgeschickt wird.
- Die Uhr stoppt bei `session.execution.succeeded`, `.failed` oder `.interrupted`.
- Zeitstempel kommen aus dem Ereignis selbst, nicht aus der lokalen Uhr. Damit messen zwei parallele Instanzen dasselbe.

## Was eine Aufgabe verlängert

- Ein `steer`-Prompt wird in die laufende Arbeit geschoben. Er verlängert den laufenden Eintrag und ergänzt dessen Titel, statt eine neue Zeile zu öffnen.
- Eine automatische Fortsetzung nach einer Kompaktierung ist derselbe Auftrag und verlängert den Eintrag ebenfalls.
- Ein `queue`-Prompt wartet auf eine neue Ausführung. Er benennt einen laufenden Eintrag nicht um; seine Zeit erscheint in der neuen Zeile.

## Was nicht gemessen wird

- Kind-Sitzungen, also Subagenten. Ihre Zeit steckt bereits in der Laufzeit des Hauptlaufs; sie separat zu zählen wäre doppelt. In einer Kind-Sitzung bleibt der Block unsichtbar.
- Eine Ausführung, die schon lief, als das Plugin geladen wurde. Eine zu kurze Zahl wäre schlechter als eine fehlende.

## Wartezeit

- Warten auf eine Berechtigungsanfrage oder eine Rückfrage zählt zur Laufzeit und wird beim Abschluss zusätzlich ausgewiesen, etwa `1m 23s · 20s waiting`.
- Im laufenden Eintrag steht nur `waiting for you`, ohne zweite tickende Zahl.
- Wartezeit durch einen Wiederholungsversuch nach einem Anbieterfehler zählt zur Laufzeit, aber nicht als Warten auf dich: der Lauf ist offen, du hast nichts zu tun.

## Endzustände

| Ursache                        | Anzeige      |
| ------------------------------ | ------------ |
| erfolgreich beendet            | (nichts)     |
| Fehler                         | `error`      |
| `interrupted` mit `user`       | `aborted`    |
| `interrupted` mit `shutdown`   | `ended`      |
| `interrupted` mit `superseded` | `superseded` |
| `interrupted` mit `inactivity` | `inactive`   |
| Systemuhr zurückgestellt       | `clock skew` |

Erfolgreiche Zeilen bleiben schlicht; nur Abweichungen tragen einen Status. Die Anzeige ist englisch, weil sie neben den englischen Texten des Hosts steht.

## Titel

- Erste nicht leere Zeile des Prompts, auf 40 Zeichen gekürzt, sonst `untitled`.
- Quelle ist der vorgemerkte Prompt. Fehlt er, dient der zuletzt gesehene Prompt der Sitzung als Rückfall.
- Gespeichert wird nur der gekürzte Titel, nie der volle Prompt.
- Je Zustellvorgang treffen drei Ereignisse ein: `session.inbox.enqueued` mit `data.item.payload.text`, dann `session.execution.started`, dann `session.inbox.delivered` mit `data.inboxID`. Der Text wird beim Vormerken abgelegt, beim Start als Rückfall benutzt und beim Zustellen zum Titel. Diese drei Ereignisse gehören zusammen und dürfen sich nicht überschreiben.

## Anzeige

- Überschrift `Durations`, neueste zuerst, höchstens zehn Zeilen.
- Summenzeile `12 tasks, 42m 18s, Ø 3m 31s` über alle abgeschlossenen Einträge der Sitzung, auch über die aus der Anzeige gefallenen. Der laufende Eintrag bleibt außen vor.
- Format `42s`, `1m 23s`, ab einer Stunde `1h 02m`.
- Rein lesend. Kein Keybind, nur Befehle.

## Aufbewahrung

- Ablage im durabelen Store des Hosts unter dem Schlüssel `laufzeiten`.
- Beim Start werden liegengebliebene Läufe als `ended` abgeschlossen, mit der Dauer bis zum letzten Lebenszeichen.
- Aufgeräumt wird nach Alter (30 Tage) und Anzahl (200 Sitzungen). Gelöschte Sitzungen verschwinden sofort.

## Befehle

- `/ott-reset` leert die aktuelle Sitzung.
- `/ott-reset-all` leert alles, nach einer Rückfrage.
