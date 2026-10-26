import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALTER_TAGE,
  MAX_EINTRAEGE,
  MAX_TITEL,
  OHNE_TITEL,
  anwenden,
  dauerMs,
  formatiereDauer,
  kuerzeTitel,
  laufenderEintrag,
  leererZustand,
  raeumeAuf,
  schliesseLiegengebliebeneAb,
  sichtbareEintraege,
  statistik,
  statusText,
  statusVonGrund,
  summenzeile,
  warteAusweis,
  type Ereignis,
  type Zustand,
} from "../src/laufzeit.ts";

const T0 = 1_700_000_000_000;

function spiele(zustand: Zustand, ereignisse: Ereignis[]): Zustand {
  return ereignisse.reduce((laufend, ereignis) => anwenden(laufend, ereignis), zustand);
}

function start(id: string, sitzung: string, zeit: number): Ereignis {
  return { art: "lauf-gestartet", id, sitzung, zeit };
}

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

test("formatiereDauer deckt Sekunden, Minuten und Stunden ab", () => {
  assert.equal(formatiereDauer(0), "0s");
  assert.equal(formatiereDauer(999), "1s");
  assert.equal(formatiereDauer(42_000), "42s");
  assert.equal(formatiereDauer(83_000), "1m 23s");
  assert.equal(formatiereDauer(3_723_000), "1h 02m");
});

test("formatiereDauer begrenzt negative Werte auf null", () => {
  assert.equal(formatiereDauer(-5_000), "0s");
});

test("kuerzeTitel nimmt die erste nicht leere Zeile", () => {
  assert.equal(kuerzeTitel("\n\n  Zweite Zeile  \nDritte"), "Zweite Zeile");
  assert.equal(kuerzeTitel("   "), OHNE_TITEL);
  assert.equal(kuerzeTitel(undefined), OHNE_TITEL);
  assert.equal(kuerzeTitel(""), OHNE_TITEL);
});

test("kuerzeTitel kuerzt auf die Hoechstlaenge mit Auslassungszeichen", () => {
  const lang = "a".repeat(120);
  const knapp = kuerzeTitel(lang);
  assert.equal(knapp.length, MAX_TITEL);
  assert.ok(knapp.endsWith("…"));
});

test("kuerzeTitel laesst Titel auf Hoechstlaenge unveraendert", () => {
  const genau = "b".repeat(MAX_TITEL);
  assert.equal(kuerzeTitel(genau), genau);
});

test("kuerzeTitel normalisiert inneren Leerraum", () => {
  assert.equal(kuerzeTitel("viel    Leerraum\thier"), "viel Leerraum hier");
});

test("statusText laesst erfolgreiche Laeufe schlicht", () => {
  assert.equal(statusText("fertig"), undefined);
  assert.equal(statusText("fehler"), "Fehler");
  assert.equal(statusText("abgebrochen"), "abgebrochen");
  assert.equal(statusText("verdraengt"), "verdrängt");
  assert.equal(statusText("beendet"), "beendet");
  assert.equal(statusText("inaktiv"), "inaktiv");
  assert.equal(statusText("zeitsprung"), "Zeitsprung");
});

test("statusVonGrund bildet alle vier Abbruchgruende ab", () => {
  assert.equal(statusVonGrund("user"), "abgebrochen");
  assert.equal(statusVonGrund("shutdown"), "beendet");
  assert.equal(statusVonGrund("superseded"), "verdraengt");
  assert.equal(statusVonGrund("inactivity"), "inaktiv");
});

// ---------------------------------------------------------------------------
// Messvertrag
// ---------------------------------------------------------------------------

test("ein Lauf von Start bis Ende ergibt genau einen Eintrag", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 83_000, ergebnis: "fertig" },
  ]);
  assert.equal(zustand.eintraege.length, 1);
  assert.equal(zustand.eintraege[0]!.status, "fertig");
  assert.equal(dauerMs(zustand.eintraege[0]!, T0 + 999_999), 83_000);
});

test("doppelte Zustellung desselben Starts erzeugt keinen zweiten Eintrag", () => {
  const zustand = spiele(leererZustand(), [start("e1", "s1", T0), start("e1", "s1", T0)]);
  assert.equal(zustand.eintraege.length, 1);
});

test("Kind-Sitzungen werden vollstaendig ignoriert", () => {
  const zustand = spiele(leererZustand(), [
    { art: "lauf-gestartet", id: "k1", sitzung: "kind", zeit: T0, istKind: true },
    { art: "lauf-beendet", sitzung: "kind", zeit: T0 + 5_000, ergebnis: "fertig", istKind: true },
    start("e1", "s1", T0),
  ]);
  assert.equal(zustand.eintraege.length, 1);
  assert.equal(zustand.eintraege[0]!.sitzung, "s1");
});

test("ein Fehlerlauf wird mit Status Fehler aufgenommen", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 4_000, ergebnis: "fehler" },
  ]);
  assert.equal(zustand.eintraege[0]!.status, "fehler");
});

test("Abbruch durch die nutzende Person heisst abgebrochen", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-unterbrochen", sitzung: "s1", zeit: T0 + 7_000, grund: "user" },
  ]);
  assert.equal(zustand.eintraege[0]!.status, "abgebrochen");
  assert.equal(dauerMs(zustand.eintraege[0]!, T0 + 7_000), 7_000);
});

test("superseded schliesst die alte Aufgabe und der neue Lauf startet neu", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-unterbrochen", sitzung: "s1", zeit: T0 + 10_000, grund: "superseded" },
    start("e2", "s1", T0 + 10_000),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 20_000, ergebnis: "fertig" },
  ]);
  assert.equal(zustand.eintraege.length, 2);
  assert.equal(zustand.eintraege[0]!.status, "verdraengt");
  assert.equal(zustand.eintraege[1]!.status, "fertig");
});

test("ein zweiter Start ohne Ende verlaengert die laufende Aufgabe", () => {
  const zustand = spiele(leererZustand(), [start("e1", "s1", T0), start("e2", "s1", T0 + 30_000)]);
  assert.equal(zustand.eintraege.length, 1);
  assert.equal(zustand.eintraege[0]!.id, "e1");
});

test("ein Ende ohne laufenden Eintrag aendert nichts", () => {
  const zustand = spiele(leererZustand(), [
    { art: "lauf-beendet", sitzung: "s1", zeit: T0, ergebnis: "fertig" },
  ]);
  assert.equal(zustand.eintraege.length, 0);
});

// ---------------------------------------------------------------------------
// Titel
// ---------------------------------------------------------------------------

test("der zugestellte Prompt benennt den laufenden Eintrag", () => {
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "Baue das Plugin\nzweite Zeile" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0 + 20),
  ]);
  assert.equal(zustand.eintraege[0]!.titel, "Baue das Plugin");
});

test("ohne Zustellung faellt der Titel auf den letzten Prompt zurueck", () => {
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "Erster Auftrag" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 1_000, ergebnis: "fertig" },
    start("e2", "s1", T0 + 2_000),
  ]);
  assert.equal(zustand.eintraege[1]!.titel, "Erster Auftrag");
});

test("ein steer-Prompt verlaengert den Titel statt ihn zu ersetzen", () => {
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "Erster Teil" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0),
    { art: "prompt-vorgemerkt", zustellID: "z2", text: "Nachtrag" },
    { art: "prompt-zugestellt", zustellID: "z2", sitzung: "s1", zeit: T0 + 5_000, zustellung: "steer" },
  ]);
  assert.equal(zustand.eintraege.length, 1);
  assert.equal(zustand.eintraege[0]!.titel, "Erster Teil + Nachtrag");
});

test("ein queue-Prompt benennt einen laufenden Eintrag nicht um", () => {
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "Erster Auftrag" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0),
    { art: "prompt-vorgemerkt", zustellID: "z2", text: "Wartet in der Schlange" },
    { art: "prompt-zugestellt", zustellID: "z2", sitzung: "s1", zeit: T0 + 2_000, zustellung: "queue" },
  ]);
  assert.equal(zustand.eintraege.length, 1);
  assert.equal(zustand.eintraege[0]!.titel, "Erster Auftrag");
  // Der vorgemerkte Text ist verbraucht und wird zum Rueckfall fuer den
  // naechsten Lauf.
  assert.equal(zustand.texte["z2"], undefined);
  assert.equal(zustand.letzterPrompt["s1"], "Wartet in der Schlange");

  const naechster = spiele(zustand, [
    { art: "lauf-unterbrochen", sitzung: "s1", zeit: T0 + 3_000, grund: "superseded" },
    start("e2", "s1", T0 + 3_000),
  ]);
  assert.equal(sichtbareEintraege(naechster, "s1")[0]!.titel, "Wartet in der Schlange");
});

test("ein steer-Prompt sprengt die Titellaenge nicht", () => {
  const lang = "x".repeat(MAX_TITEL);
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: lang },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0),
    { art: "prompt-vorgemerkt", zustellID: "z2", text: "Nachtrag" },
    { art: "prompt-zugestellt", zustellID: "z2", sitzung: "s1", zeit: T0 + 1_000, zustellung: "steer" },
  ]);
  assert.ok(zustand.eintraege[0]!.titel.length <= MAX_TITEL);
});

test("ein Slash-Befehl ohne Text heisst ohne Titel", () => {
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0),
  ]);
  assert.equal(zustand.eintraege[0]!.titel, OHNE_TITEL);
});

test("ein Titelrueckfall wird durch den echten Prompt ersetzt", () => {
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "Alter Auftrag" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 500, ergebnis: "fertig" },
    { art: "prompt-vorgemerkt", zustellID: "z2", text: "Neuer Auftrag" },
    { art: "prompt-zugestellt", zustellID: "z2", sitzung: "s1", zeit: T0 + 1_000, zustellung: "queue" },
    start("e2", "s1", T0 + 1_100),
  ]);
  assert.equal(zustand.eintraege[1]!.titel, "Neuer Auftrag");
});

// ---------------------------------------------------------------------------
// Wartezeit
// ---------------------------------------------------------------------------

test("Wartezeit zaehlt zur Laufzeit und wird ausgewiesen", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "warten-gestartet", sitzung: "s1", zeit: T0 + 2_000 },
    { art: "warten-beendet", sitzung: "s1", zeit: T0 + 22_000 },
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 23_000, ergebnis: "fertig" },
  ]);
  const eintrag = zustand.eintraege[0]!;
  assert.equal(dauerMs(eintrag, T0 + 99_999), 23_000);
  assert.equal(warteAusweis(eintrag, T0 + 99_999), "20s warten");
});

test("eine laufende Wartezeit wird beim Abschluss mitgerechnet", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "warten-gestartet", sitzung: "s1", zeit: T0 + 1_000 },
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 6_000, ergebnis: "fertig" },
  ]);
  assert.equal(warteAusweis(zustand.eintraege[0]!, T0 + 6_000), "5s warten");
});

test("verschachtelte Wartestarts zaehlen nur einmal", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "warten-gestartet", sitzung: "s1", zeit: T0 + 1_000 },
    { art: "warten-gestartet", sitzung: "s1", zeit: T0 + 2_000 },
    { art: "warten-beendet", sitzung: "s1", zeit: T0 + 3_000 },
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 4_000, ergebnis: "fertig" },
  ]);
  assert.equal(warteAusweis(zustand.eintraege[0]!, T0 + 4_000), "2s warten");
});

test("der laufende Eintrag zeigt keine Wartezeit an", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "warten-gestartet", sitzung: "s1", zeit: T0 + 1_000 },
  ]);
  assert.equal(warteAusweis(zustand.eintraege[0]!, T0 + 20_000), undefined);
});

test("kurze Wartezeiten unter einer Sekunde werden nicht ausgewiesen", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "warten-gestartet", sitzung: "s1", zeit: T0 + 100 },
    { art: "warten-beendet", sitzung: "s1", zeit: T0 + 600 },
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 700, ergebnis: "fertig" },
  ]);
  assert.equal(warteAusweis(zustand.eintraege[0]!, T0 + 700), undefined);
});

// ---------------------------------------------------------------------------
// Kennzahlen
// ---------------------------------------------------------------------------

test("die Statistik laesst den laufenden Eintrag aussen vor", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 10_000, ergebnis: "fertig" },
    start("e2", "s1", T0 + 11_000),
  ]);
  const stats = statistik(zustand.eintraege, T0 + 60_000);
  assert.equal(stats.anzahl, 1);
  assert.equal(stats.summeMs, 10_000);
  assert.equal(stats.durchschnittMs, 10_000);
});

test("die Statistik zaehlt abgebrochene Laeufe mit", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 10_000, ergebnis: "fertig" },
    start("e2", "s1", T0 + 20_000),
    { art: "lauf-unterbrochen", sitzung: "s1", zeit: T0 + 30_000, grund: "user" },
  ]);
  const stats = statistik(zustand.eintraege, T0 + 30_000);
  assert.equal(stats.anzahl, 2);
  assert.equal(stats.summeMs, 20_000);
  assert.equal(stats.durchschnittMs, 10_000);
});

test("die Summenzeile nennt Anzahl, Summe und Durchschnitt", () => {
  assert.equal(summenzeile({ anzahl: 1, summeMs: 83_000, durchschnittMs: 83_000 }), "1 Aufgabe, 1m 23s, Ø 1m 23s");
  // 2_538_000 ms / 12 = 211_500 ms = 3m 31,5s, gerundet auf ganze Sekunden.
  assert.equal(
    summenzeile({ anzahl: 12, summeMs: 2_538_000, durchschnittMs: 211_500 }),
    "12 Aufgaben, 42m 18s, Ø 3m 32s",
  );
  assert.equal(summenzeile({ anzahl: 0, summeMs: 0, durchschnittMs: 0 }), undefined);
});

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------

test("die sichtbare Liste ist auf zehn Eintraege begrenzt, neueste zuerst", () => {
  let zustand = leererZustand();
  const ereignisse: Ereignis[] = [];
  for (let i = 0; i < 12; i += 1) {
    ereignisse.push(start(`e${i}`, "s1", T0 + i * 1_000));
    ereignisse.push({
      art: "lauf-beendet",
      sitzung: "s1",
      zeit: T0 + i * 1_000 + 500,
      ergebnis: "fertig",
    });
  }
  zustand = spiele(zustand, ereignisse);
  const sichtbar = sichtbareEintraege(zustand, "s1");
  assert.equal(sichtbar.length, MAX_EINTRAEGE);
  assert.equal(sichtbar[0]!.id, "e11");
  assert.equal(sichtbar[MAX_EINTRAEGE - 1]!.id, "e2");
});

test("die Statistik umfasst auch die aus der Anzeige gefallenen Eintraege", () => {
  let zustand = leererZustand();
  const ereignisse: Ereignis[] = [];
  for (let i = 0; i < 12; i += 1) {
    ereignisse.push(start(`e${i}`, "s1", T0 + i * 1_000));
    ereignisse.push({
      art: "lauf-beendet",
      sitzung: "s1",
      zeit: T0 + i * 1_000 + 1_000,
      ergebnis: "fertig",
    });
  }
  zustand = spiele(zustand, ereignisse);
  const stats = statistik(zustand.eintraege, T0 + 100_000);
  assert.equal(stats.anzahl, 12);
  assert.equal(sichtbareEintraege(zustand, "s1").length, MAX_EINTRAEGE);
});

test("nur die angefragte Sitzung wird angezeigt", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 1_000, ergebnis: "fertig" },
    start("e2", "s2", T0 + 2_000),
    { art: "lauf-beendet", sitzung: "s2", zeit: T0 + 3_000, ergebnis: "fertig" },
  ]);
  assert.equal(sichtbareEintraege(zustand, "s1").length, 1);
  assert.equal(sichtbareEintraege(zustand, "s2").length, 1);
  assert.equal(sichtbareEintraege(zustand, "s3").length, 0);
});

test("der laufende Eintrag ist auffindbar", () => {
  const zustand = spiele(leererZustand(), [start("e1", "s1", T0)]);
  assert.equal(laufenderEintrag(zustand, "s1")!.id, "e1");
  assert.equal(laufenderEintrag(zustand, "s2"), undefined);
});

// ---------------------------------------------------------------------------
// Neustart, Uhr, Aufraeumen
// ---------------------------------------------------------------------------

test("ein liegengebliebener Lauf wird beim Neustart als beendet abgeschlossen", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lebenszeichen", sitzung: "s1", zeit: T0 + 40_000 },
  ]);
  const danach = schliesseLiegengebliebeneAb(zustand);
  assert.equal(danach.eintraege[0]!.status, "beendet");
  assert.equal(dauerMs(danach.eintraege[0]!, T0 + 99_999_999), 40_000);
});

test("ohne Lebenszeichen endet ein liegengebliebener Lauf bei seiner Startzeit", () => {
  const zustand = spiele(leererZustand(), [start("e1", "s1", T0)]);
  const danach = schliesseLiegengebliebeneAb(zustand);
  assert.equal(dauerMs(danach.eintraege[0]!, T0 + 500_000), 0);
});

test("eine zurueckgestellte Uhr erzeugt keine negative Laufzeit", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 - 5_000, ergebnis: "fertig" },
  ]);
  const eintrag = zustand.eintraege[0]!;
  assert.equal(eintrag.status, "zeitsprung");
  assert.equal(dauerMs(eintrag, T0), 0);
});

test("abgeschlossene Laeufe bleiben von der Neustartbehandlung unberuehrt", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 1_000, ergebnis: "fertig" },
  ]);
  assert.equal(schliesseLiegengebliebeneAb(zustand).eintraege[0]!.status, "fertig");
});

test("geloeschte Sitzungen verschwinden aus dem Zustand", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 1_000, ergebnis: "fertig" },
    { art: "sitzung-geloescht", sitzung: "s1" },
  ]);
  assert.equal(zustand.eintraege.length, 0);
  assert.deepEqual(zustand.sitzungen, []);
});

test("Aufraeumen entfernt Eintraege jenseits der Altersgrenze", () => {
  const alt = T0;
  const frisch = T0 + (ALTER_TAGE + 1) * 24 * 60 * 60 * 1000;
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", alt),
    { art: "lauf-beendet", sitzung: "s1", zeit: alt + 1_000, ergebnis: "fertig" },
    start("e2", "s2", frisch),
    { art: "lauf-beendet", sitzung: "s2", zeit: frisch + 1_000, ergebnis: "fertig" },
  ]);
  const danach = raeumeAuf(zustand, frisch + 1_000);
  assert.equal(danach.eintraege.length, 1);
  assert.equal(danach.eintraege[0]!.sitzung, "s2");
  assert.deepEqual(danach.sitzungen, ["s2"]);
});

test("Aufraeumen behaelt den letzten Prompt lebendiger Sitzungen", () => {
  const zustand = spiele(leererZustand(), [
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "Bleibt erhalten" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0),
  ]);
  const danach = raeumeAuf(zustand, T0 + 1_000);
  assert.equal(danach.letzterPrompt["s1"], "Bleibt erhalten");
});

test("leereSitzung laesst andere Sitzungen unangetastet", () => {
  const zustand = spiele(leererZustand(), [
    start("e1", "s1", T0),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 1_000, ergebnis: "fertig" },
    start("e2", "s2", T0 + 2_000),
    { art: "lauf-beendet", sitzung: "s2", zeit: T0 + 3_000, ergebnis: "fertig" },
  ]);
  const danach = anwenden(zustand, { art: "sitzung-geloescht", sitzung: "s1" });
  assert.equal(sichtbareEintraege(danach, "s2").length, 1);
});

// ---------------------------------------------------------------------------
// Nachgebildete Ereignisfolge
// ---------------------------------------------------------------------------

test("eine realistische Folge ergibt die erwarteten drei Zeilen", () => {
  let zustand = leererZustand();
  const folge: Ereignis[] = [
    // Aufgabe 1: Prompt, Lauf, Warten auf Freigabe, erfolgreich.
    { art: "prompt-vorgemerkt", zustellID: "z1", text: "Baue das Plugin" },
    { art: "prompt-zugestellt", zustellID: "z1", sitzung: "s1", zeit: T0, zustellung: "queue" },
    start("e1", "s1", T0 + 10),
    { art: "warten-gestartet", sitzung: "s1", zeit: T0 + 5_000 },
    { art: "warten-beendet", sitzung: "s1", zeit: T0 + 15_000 },
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 20_000, ergebnis: "fertig" },
    // Aufgabe 2: der naechste Prompt wartet in der Schlange und benennt die
    // neue Aufgabe, ohne die abgeschlossene umzubenennen.
    { art: "prompt-vorgemerkt", zustellID: "z2", text: "Und die Tests" },
    { art: "prompt-zugestellt", zustellID: "z2", sitzung: "s1", zeit: T0 + 30_000, zustellung: "queue" },
    start("e2", "s1", T0 + 30_100),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 40_000, ergebnis: "fertig" },
    // Aufgabe 3: Kompaktierung fuehrt zu einem neuen Lauf, der verlaengert.
    start("e3", "s1", T0 + 50_000),
    start("e4", "s1", T0 + 51_000),
    { art: "lauf-beendet", sitzung: "s1", zeit: T0 + 60_000, ergebnis: "fertig" },
    // Ein Subagent, der ignoriert wird.
    { art: "lauf-gestartet", id: "k1", sitzung: "kind", zeit: T0 + 55_000, istKind: true },
    { art: "lauf-beendet", sitzung: "kind", zeit: T0 + 58_000, ergebnis: "fertig", istKind: true },
  ];
  zustand = spiele(zustand, folge);

  const sichtbar = sichtbareEintraege(zustand, "s1");
  assert.equal(sichtbar.length, 3);
  assert.deepEqual(
    sichtbar.map((eintrag) => eintrag.titel),
    ["Und die Tests", "Und die Tests", "Baue das Plugin"],
  );
  assert.equal(sichtbar[0]!.status, "fertig");
  assert.equal(sichtbar[1]!.status, "fertig");
  assert.equal(sichtbar[2]!.status, "fertig");
  assert.equal(dauerMs(sichtbar[2]!, T0 + 100_000), 19_990);
  assert.equal(warteAusweis(sichtbar[2]!, T0 + 100_000), "10s warten");

  const stats = statistik(zustand.eintraege, T0 + 100_000);
  assert.equal(stats.anzahl, 3);
  assert.equal(stats.summeMs, 19_990 + 9_900 + 10_000);
  assert.equal(zustand.eintraege.length, 3);
});
