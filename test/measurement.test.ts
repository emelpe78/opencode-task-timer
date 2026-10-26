import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ENTRIES,
  MAX_TITLE,
  RETENTION_DAYS,
  UNTITLED,
  apply,
  durationMs,
  emptyState,
  formatDuration,
  prune,
  runningEntry,
  shortenTitle,
  statusFromReason,
  statusLabel,
  summaryLine,
  visibleEntries,
  waitingNote,
  closeStaleRuns,
  stats,
  type Event,
  type State,
} from "../src/measurement.ts";

const T0 = 1_700_000_000_000;

function play(state: State, events: Event[]): State {
  return events.reduce((current, event) => apply(current, event), state);
}

function start(id: string, session: string, time: number): Event {
  return { kind: "run-started", id, session, time };
}

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

test("formatDuration deckt Sekunden, Minuten und Stunden ab", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(999), "1s");
  assert.equal(formatDuration(42_000), "42s");
  assert.equal(formatDuration(83_000), "1m 23s");
  assert.equal(formatDuration(3_723_000), "1h 02m");
});

test("formatDuration begrenzt negative Werte auf null", () => {
  assert.equal(formatDuration(-5_000), "0s");
});

test("shortenTitle nimmt die erste nicht leere Zeile", () => {
  assert.equal(shortenTitle("\n\n  Zweite Zeile  \nDritte"), "Zweite Zeile");
  assert.equal(shortenTitle("   "), UNTITLED);
  assert.equal(shortenTitle(undefined), UNTITLED);
  assert.equal(shortenTitle(""), UNTITLED);
});

test("shortenTitle kuerzt auf die Hoechstlaenge mit Auslassungszeichen", () => {
  const long = "a".repeat(120);
  const short = shortenTitle(long);
  assert.equal(short.length, MAX_TITLE);
  assert.ok(short.endsWith("…"));
});

test("shortenTitle laesst Titel auf Hoechstlaenge unveraendert", () => {
  const exact = "b".repeat(MAX_TITLE);
  assert.equal(shortenTitle(exact), exact);
});

test("shortenTitle normalisiert inneren Leerraum", () => {
  assert.equal(shortenTitle("viel    Leerraum\thier"), "viel Leerraum hier");
});

test("statusLabel laesst erfolgreiche Laeufe schlicht", () => {
  assert.equal(statusLabel("done"), undefined);
  assert.equal(statusLabel("error"), "error");
  assert.equal(statusLabel("aborted"), "aborted");
  assert.equal(statusLabel("superseded"), "superseded");
  assert.equal(statusLabel("ended"), "ended");
  assert.equal(statusLabel("inactive"), "inactive");
  assert.equal(statusLabel("clockSkew"), "clock skew");
});

test("statusFromReason bildet alle vier Abbruchgruende ab", () => {
  assert.equal(statusFromReason("user"), "aborted");
  assert.equal(statusFromReason("shutdown"), "ended");
  assert.equal(statusFromReason("superseded"), "superseded");
  assert.equal(statusFromReason("inactivity"), "inactive");
});

// ---------------------------------------------------------------------------
// Messvertrag
// ---------------------------------------------------------------------------

test("ein Lauf von Start bis Ende ergibt genau einen Eintrag", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 83_000, result: "done" },
  ]);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]!.status, "done");
  assert.equal(durationMs(state.entries[0]!, T0 + 999_999), 83_000);
});

test("doppelte Zustellung desselben Starts erzeugt keinen zweiten Eintrag", () => {
  const state = play(emptyState(), [start("e1", "s1", T0), start("e1", "s1", T0)]);
  assert.equal(state.entries.length, 1);
});

test("Kind-Sitzungen werden vollstaendig ignoriert", () => {
  const state = play(emptyState(), [
    { kind: "run-started", id: "k1", session: "kind", time: T0, isChild: true },
    { kind: "run-ended", session: "kind", time: T0 + 5_000, result: "done", isChild: true },
    start("e1", "s1", T0),
  ]);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]!.session, "s1");
});

test("ein Fehlerlauf wird mit Status error aufgenommen", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 4_000, result: "error" },
  ]);
  assert.equal(state.entries[0]!.status, "error");
});

test("Abbruch durch die nutzende Person heisst abgebrochen", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-interrupted", session: "s1", time: T0 + 7_000, reason: "user" },
  ]);
  assert.equal(state.entries[0]!.status, "aborted");
  assert.equal(durationMs(state.entries[0]!, T0 + 7_000), 7_000);
});

test("superseded schliesst die alte Aufgabe und der neue Lauf startet neu", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-interrupted", session: "s1", time: T0 + 10_000, reason: "superseded" },
    start("e2", "s1", T0 + 10_000),
    { kind: "run-ended", session: "s1", time: T0 + 20_000, result: "done" },
  ]);
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries[0]!.status, "superseded");
  assert.equal(state.entries[1]!.status, "done");
});

test("ein zweiter Start ohne Ende verlaengert die laufende Aufgabe", () => {
  const state = play(emptyState(), [start("e1", "s1", T0), start("e2", "s1", T0 + 30_000)]);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]!.id, "e1");
});

test("ein Ende ohne laufenden Eintrag aendert nichts", () => {
  const state = play(emptyState(), [
    { kind: "run-ended", session: "s1", time: T0, result: "done" },
  ]);
  assert.equal(state.entries.length, 0);
});

// ---------------------------------------------------------------------------
// Titel
// ---------------------------------------------------------------------------

test("der zugestellte Prompt benennt den laufenden Eintrag", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "Baue das Plugin\nzweite Zeile", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0 + 20),
  ]);
  assert.equal(state.entries[0]!.title, "Baue das Plugin");
});

test("ohne Zustellung faellt der Titel auf den letzten Prompt zurueck", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "Erster Auftrag", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 1_000, result: "done" },
    start("e2", "s1", T0 + 2_000),
  ]);
  assert.equal(state.entries[1]!.title, "Erster Auftrag");
});

test("ein steer-Prompt verlaengert den Titel statt ihn zu ersetzen", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "Erster Teil", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0),
    { kind: "prompt-queued", deliveryID: "z2", session: "s1", text: "Nachtrag", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z2", session: "s1", time: T0 + 5_000, delivery: "steer" },
  ]);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]!.title, "Erster Teil + Nachtrag");
});

test("ein queue-Prompt benennt einen laufenden Eintrag nicht um", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "Erster Auftrag", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0),
    { kind: "prompt-queued", deliveryID: "z2", session: "s1", text: "Wartet in der Schlange", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z2", session: "s1", time: T0 + 2_000, delivery: "queue" },
  ]);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]!.title, "Erster Auftrag");
  // Der vorgemerkte Text ist verbraucht und wird zum Rueckfall fuer den
  // naechsten Lauf.
  assert.equal(state.texts["z2"], undefined);
  assert.equal(state.lastPrompt["s1"], "Wartet in der Schlange");

  const next = play(state, [
    { kind: "run-interrupted", session: "s1", time: T0 + 3_000, reason: "superseded" },
    start("e2", "s1", T0 + 3_000),
  ]);
  assert.equal(visibleEntries(next, "s1")[0]!.title, "Wartet in der Schlange");
});

test("ein steer-Prompt sprengt die Titellaenge nicht", () => {
  const long = "x".repeat(MAX_TITLE);
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: long, delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0),
    { kind: "prompt-queued", deliveryID: "z2", session: "s1", text: "Nachtrag", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z2", session: "s1", time: T0 + 1_000, delivery: "steer" },
  ]);
  assert.ok(state.entries[0]!.title.length <= MAX_TITLE);
});

test("ein Slash-Befehl ohne Text heisst ohne Titel", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0),
  ]);
  assert.equal(state.entries[0]!.title, UNTITLED);
});

test("ein Titelrueckfall wird durch den echten Prompt ersetzt", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "Alter Auftrag", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 500, result: "done" },
    { kind: "prompt-queued", deliveryID: "z2", session: "s1", text: "Neuer Auftrag", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z2", session: "s1", time: T0 + 1_000, delivery: "queue" },
    start("e2", "s1", T0 + 1_100),
  ]);
  assert.equal(state.entries[1]!.title, "Neuer Auftrag");
});

test("der Lauf kennt seinen Titel schon beim Start, bevor er zugestellt ist", () => {
  // So liefert es der Host wirklich: erst `enqueued`, dann `execution.started`,
  // dann `delivered`. Der Titel darf nicht am fehlenden Rueckfall scheitern.
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "m1", session: "s1", text: "Prüfe die Seitenleiste", delivery: "steer" },
    start("e1", "s1", T0),
    { kind: "prompt-delivered", deliveryID: "m1", session: "s1", time: T0 + 9, delivery: "steer" },
  ]);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0]!.title, "Prüfe die Seitenleiste");
  // Der Text ist zugestellt und damit nicht mehr vorgemerkt.
  assert.equal(state.pending["s1"], undefined);
});

test("der erste queue-Prompt benennt den gerade gestarteten Lauf", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "m1", session: "s1", text: "Erster Auftrag", delivery: "queue" },
    start("e1", "s1", T0),
    { kind: "prompt-delivered", deliveryID: "m1", session: "s1", time: T0 + 9, delivery: "queue" },
  ]);
  assert.equal(state.entries[0]!.title, "Erster Auftrag");
});

test("ein vorgemerkter Prompt geht nicht in eine fremde Sitzung", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "m1", session: "s1", text: "Gehört zu s1", delivery: "queue" },
    start("e2", "s2", T0),
  ]);
  assert.equal(state.entries[0]!.session, "s2");
  assert.equal(state.entries[0]!.title, UNTITLED);
});

test("ein verworfener Prompt benennt den nächsten Lauf nicht", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "m1", session: "s1", text: "Doch verworfen", delivery: "queue" },
    { kind: "prompt-cancelled", deliveryID: "m1", session: "s1" },
    start("e1", "s1", T0),
  ]);
  assert.equal(state.entries[0]!.title, UNTITLED);
  assert.equal(state.texts["m1"], undefined);
  assert.equal(state.pending["s1"], undefined);
});

// ---------------------------------------------------------------------------
// Wartezeit
// ---------------------------------------------------------------------------

test("Wartezeit zaehlt zur Laufzeit und wird ausgewiesen", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "waiting-started", session: "s1", time: T0 + 2_000 },
    { kind: "waiting-ended", session: "s1", time: T0 + 22_000 },
    { kind: "run-ended", session: "s1", time: T0 + 23_000, result: "done" },
  ]);
  const entry = state.entries[0]!;
  assert.equal(durationMs(entry, T0 + 99_999), 23_000);
  assert.equal(waitingNote(entry, T0 + 99_999), "20s waiting");
});

test("eine laufende Wartezeit wird beim Abschluss mitgerechnet", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "waiting-started", session: "s1", time: T0 + 1_000 },
    { kind: "run-ended", session: "s1", time: T0 + 6_000, result: "done" },
  ]);
  assert.equal(waitingNote(state.entries[0]!, T0 + 6_000), "5s waiting");
});

test("verschachtelte Wartestarts zaehlen nur einmal", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "waiting-started", session: "s1", time: T0 + 1_000 },
    { kind: "waiting-started", session: "s1", time: T0 + 2_000 },
    { kind: "waiting-ended", session: "s1", time: T0 + 3_000 },
    { kind: "run-ended", session: "s1", time: T0 + 4_000, result: "done" },
  ]);
  assert.equal(waitingNote(state.entries[0]!, T0 + 4_000), "2s waiting");
});

test("der laufende Eintrag zeigt keine Wartezeit an", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "waiting-started", session: "s1", time: T0 + 1_000 },
  ]);
  assert.equal(waitingNote(state.entries[0]!, T0 + 20_000), undefined);
});

test("kurze Wartezeiten unter einer Sekunde werden nicht ausgewiesen", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "waiting-started", session: "s1", time: T0 + 100 },
    { kind: "waiting-ended", session: "s1", time: T0 + 600 },
    { kind: "run-ended", session: "s1", time: T0 + 700, result: "done" },
  ]);
  assert.equal(waitingNote(state.entries[0]!, T0 + 700), undefined);
});

// ---------------------------------------------------------------------------
// Kennzahlen
// ---------------------------------------------------------------------------

test("die Statistik laesst den laufenden Eintrag aussen vor", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 10_000, result: "done" },
    start("e2", "s1", T0 + 11_000),
  ]);
  const numbers = stats(state.entries, T0 + 60_000);
  assert.equal(numbers.count, 1);
  assert.equal(numbers.totalMs, 10_000);
  assert.equal(numbers.averageMs, 10_000);
});

test("die Statistik zaehlt abgebrochene Laeufe mit", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 10_000, result: "done" },
    start("e2", "s1", T0 + 20_000),
    { kind: "run-interrupted", session: "s1", time: T0 + 30_000, reason: "user" },
  ]);
  const numbers = stats(state.entries, T0 + 30_000);
  assert.equal(numbers.count, 2);
  assert.equal(numbers.totalMs, 20_000);
  assert.equal(numbers.averageMs, 10_000);
});

test("die Summenzeile nennt Anzahl, Summe und Durchschnitt", () => {
  assert.equal(summaryLine({ count: 1, totalMs: 83_000, averageMs: 83_000 }), "1 task, 1m 23s, Ø 1m 23s");
  // 2_538_000 ms / 12 = 211_500 ms = 3m 31,5s, gerundet auf ganze Sekunden.
  assert.equal(
    summaryLine({ count: 12, totalMs: 2_538_000, averageMs: 211_500 }),
    "12 tasks, 42m 18s, Ø 3m 32s",
  );
  assert.equal(summaryLine({ count: 0, totalMs: 0, averageMs: 0 }), undefined);
});

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------

test("die sichtbare Liste ist auf zehn Eintraege begrenzt, neueste zuerst", () => {
  let state = emptyState();
  const events: Event[] = [];
  for (let i = 0; i < 12; i += 1) {
    events.push(start(`e${i}`, "s1", T0 + i * 1_000));
    events.push({
      kind: "run-ended",
      session: "s1",
      time: T0 + i * 1_000 + 500,
      result: "done",
    });
  }
  state = play(state, events);
  const visible = visibleEntries(state, "s1");
  assert.equal(visible.length, MAX_ENTRIES);
  assert.equal(visible[0]!.id, "e11");
  assert.equal(visible[MAX_ENTRIES - 1]!.id, "e2");
});

test("die Statistik umfasst auch die aus der Anzeige gefallenen Eintraege", () => {
  let state = emptyState();
  const events: Event[] = [];
  for (let i = 0; i < 12; i += 1) {
    events.push(start(`e${i}`, "s1", T0 + i * 1_000));
    events.push({
      kind: "run-ended",
      session: "s1",
      time: T0 + i * 1_000 + 1_000,
      result: "done",
    });
  }
  state = play(state, events);
  const numbers = stats(state.entries, T0 + 100_000);
  assert.equal(numbers.count, 12);
  assert.equal(visibleEntries(state, "s1").length, MAX_ENTRIES);
});

test("nur die angefragte Sitzung wird angezeigt", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 1_000, result: "done" },
    start("e2", "s2", T0 + 2_000),
    { kind: "run-ended", session: "s2", time: T0 + 3_000, result: "done" },
  ]);
  assert.equal(visibleEntries(state, "s1").length, 1);
  assert.equal(visibleEntries(state, "s2").length, 1);
  assert.equal(visibleEntries(state, "s3").length, 0);
});

test("der laufende Eintrag ist auffindbar", () => {
  const state = play(emptyState(), [start("e1", "s1", T0)]);
  assert.equal(runningEntry(state, "s1")!.id, "e1");
  assert.equal(runningEntry(state, "s2"), undefined);
});

// ---------------------------------------------------------------------------
// Neustart, Uhr, Aufraeumen
// ---------------------------------------------------------------------------

test("ein liegengebliebener Lauf wird beim Neustart als beendet abgeschlossen", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "heartbeat", session: "s1", time: T0 + 40_000 },
  ]);
  const after = closeStaleRuns(state);
  assert.equal(after.entries[0]!.status, "ended");
  assert.equal(durationMs(after.entries[0]!, T0 + 99_999_999), 40_000);
});

test("ohne Lebenszeichen endet ein liegengebliebener Lauf bei seiner Startzeit", () => {
  const state = play(emptyState(), [start("e1", "s1", T0)]);
  const after = closeStaleRuns(state);
  assert.equal(durationMs(after.entries[0]!, T0 + 500_000), 0);
});

test("eine zurueckgestellte Uhr erzeugt keine negative Laufzeit", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 - 5_000, result: "done" },
  ]);
  const entry = state.entries[0]!;
  assert.equal(entry.status, "clockSkew");
  assert.equal(durationMs(entry, T0), 0);
});

test("abgeschlossene Laeufe bleiben von der Neustartbehandlung unberuehrt", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 1_000, result: "done" },
  ]);
  assert.equal(closeStaleRuns(state).entries[0]!.status, "done");
});

test("geloeschte Sitzungen verschwinden aus dem Zustand", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 1_000, result: "done" },
    { kind: "session-deleted", session: "s1" },
  ]);
  assert.equal(state.entries.length, 0);
  assert.deepEqual(state.sessions, []);
});

test("Aufraeumen entfernt Eintraege jenseits der Altersgrenze", () => {
  const old = T0;
  const fresh = T0 + (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
  const state = play(emptyState(), [
    start("e1", "s1", old),
    { kind: "run-ended", session: "s1", time: old + 1_000, result: "done" },
    start("e2", "s2", fresh),
    { kind: "run-ended", session: "s2", time: fresh + 1_000, result: "done" },
  ]);
  const after = prune(state, fresh + 1_000);
  assert.equal(after.entries.length, 1);
  assert.equal(after.entries[0]!.session, "s2");
  assert.deepEqual(after.sessions, ["s2"]);
});

test("Aufraeumen behaelt den letzten Prompt lebendiger Sitzungen", () => {
  const state = play(emptyState(), [
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "Bleibt erhalten", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0),
  ]);
  const after = prune(state, T0 + 1_000);
  assert.equal(after.lastPrompt["s1"], "Bleibt erhalten");
});

test("clearSession laesst andere Sitzungen unangetastet", () => {
  const state = play(emptyState(), [
    start("e1", "s1", T0),
    { kind: "run-ended", session: "s1", time: T0 + 1_000, result: "done" },
    start("e2", "s2", T0 + 2_000),
    { kind: "run-ended", session: "s2", time: T0 + 3_000, result: "done" },
  ]);
  const after = apply(state, { kind: "session-deleted", session: "s1" });
  assert.equal(visibleEntries(after, "s2").length, 1);
});

// ---------------------------------------------------------------------------
// Nachgebildete Ereignisfolge
// ---------------------------------------------------------------------------

test("eine realistische Folge ergibt die erwarteten drei Zeilen", () => {
  let state = emptyState();
  const sequence: Event[] = [
    // Aufgabe 1: Prompt, Lauf, Warten auf Freigabe, erfolgreich.
    { kind: "prompt-queued", deliveryID: "z1", session: "s1", text: "Baue das Plugin", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z1", session: "s1", time: T0, delivery: "queue" },
    start("e1", "s1", T0 + 10),
    { kind: "waiting-started", session: "s1", time: T0 + 5_000 },
    { kind: "waiting-ended", session: "s1", time: T0 + 15_000 },
    { kind: "run-ended", session: "s1", time: T0 + 20_000, result: "done" },
    // Aufgabe 2: der naechste Prompt wartet in der Schlange und benennt die
    // neue Aufgabe, ohne die abgeschlossene umzubenennen.
    { kind: "prompt-queued", deliveryID: "z2", session: "s1", text: "Und die Tests", delivery: "queue" },
    { kind: "prompt-delivered", deliveryID: "z2", session: "s1", time: T0 + 30_000, delivery: "queue" },
    start("e2", "s1", T0 + 30_100),
    { kind: "run-ended", session: "s1", time: T0 + 40_000, result: "done" },
    // Aufgabe 3: Kompaktierung fuehrt zu einem neuen Lauf, der verlaengert.
    start("e3", "s1", T0 + 50_000),
    start("e4", "s1", T0 + 51_000),
    { kind: "run-ended", session: "s1", time: T0 + 60_000, result: "done" },
    // Ein Subagent, der ignoriert wird.
    { kind: "run-started", id: "k1", session: "kind", time: T0 + 55_000, isChild: true },
    { kind: "run-ended", session: "kind", time: T0 + 58_000, result: "done", isChild: true },
  ];
  state = play(state, sequence);

  const visible = visibleEntries(state, "s1");
  assert.equal(visible.length, 3);
  assert.deepEqual(
    visible.map((entry) => entry.title),
    ["Und die Tests", "Und die Tests", "Baue das Plugin"],
  );
  assert.equal(visible[0]!.status, "done");
  assert.equal(visible[1]!.status, "done");
  assert.equal(visible[2]!.status, "done");
  assert.equal(durationMs(visible[2]!, T0 + 100_000), 19_990);
  assert.equal(waitingNote(visible[2]!, T0 + 100_000), "10s waiting");

  const numbers = stats(state.entries, T0 + 100_000);
  assert.equal(numbers.count, 3);
  assert.equal(numbers.totalMs, 19_990 + 9_900 + 10_000);
  assert.equal(state.entries.length, 3);
});
