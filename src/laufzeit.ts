// Reine Messlogik für opencode-task-timer.
//
// Diese Datei kennt weder OpenCode noch Solid noch JSX. Sie ist damit mit
// `node --test` prüfbar und enthält die eigentliche Wahrheit darüber, was als
// Laufzeit gezählt wird. Alles Sichtbare und alles Verdrahtete liegt in
// `tui.tsx`.
//
// Messvertrag (kurz):
// - Gemessen wird ein Agentenlauf, nicht ein Prompt.
// - Start ist `lauf-gestartet`, Ende ist `lauf-beendet` oder `lauf-unterbrochen`.
// - Zeitstempel kommen vom Server, nicht von der lokalen Uhr.
// - Ein `steer`-Prompt und eine automatische Fortsetzung nach Kompaktierung
//   verlängern den laufenden Eintrag. Ein `queue`-Prompt führt über ein
//   `superseded`-Ende zu einer neuen Zeile.
// - Kind-Sitzungen (Subagenten) werden vollständig ignoriert, damit ihre Zeit
//   nicht doppelt in der Wurzel landet.
// - Warten auf Freigabe oder Rückfrage zählt zur Laufzeit und wird beim
//   Abschluss zusätzlich ausgewiesen.

export const MAX_EINTRAEGE = 10;
export const MAX_TITEL = 40;
export const ALTER_TAGE = 30;
export const MAX_SITZUNGEN = 200;
export const OHNE_TITEL = "ohne Titel";
export const WARTE_HINWEIS = "wartet auf dich";
export const LAEUFT_HINWEIS = "läuft";

const MS_PRO_TAG = 24 * 60 * 60 * 1000;

export type LaufStatus =
  | "laeuft"
  | "fertig"
  | "fehler"
  | "abgebrochen"
  | "verdraengt"
  | "beendet"
  | "inaktiv"
  | "zeitsprung";

export type Unterbrechungsgrund = "user" | "shutdown" | "superseded" | "inactivity";

export type Zustellung = "steer" | "queue";

export type Eintrag = {
  /** Ereignis-ID des Starts. Dient als Schlüssel gegen doppelte Erfassung. */
  id: string;
  sitzung: string;
  titel: string;
  /** Startzeit in Millisekunden, aus dem Serverstempel des Ereignisses. */
  start: number;
  ende?: number;
  status: LaufStatus;
  /** Aufgelaufene Wartezeit auf die nutzende Person in Millisekunden. */
  warteMs: number;
  /** Beginn der aktuell laufenden Wartezeit, falls gerade gewartet wird. */
  warteSeit?: number;
};

export type Zustand = {
  eintraege: Eintrag[];
  /** Prompt-Texte, vorgemerkt über die Zustellungs-ID. */
  texte: Record<string, string>;
  /** Zuletzt zugestellter Prompt je Sitzung, als Titelrückfall. */
  letzterPrompt: Record<string, string>;
  /** Sitzungen in der Reihenfolge des letzten Kontakts, älteste zuerst. */
  sitzungen: string[];
  /** Letztes Lebenszeichen je Sitzung, für das Abschließen beim Neustart. */
  lebenszeichen: Record<string, number>;
};

export type Ereignis =
  | { art: "lauf-gestartet"; id: string; sitzung: string; zeit: number; istKind?: boolean }
  | {
      art: "lauf-beendet";
      sitzung: string;
      zeit: number;
      ergebnis: "fertig" | "fehler";
      istKind?: boolean;
    }
  | {
      art: "lauf-unterbrochen";
      sitzung: string;
      zeit: number;
      grund: Unterbrechungsgrund;
      istKind?: boolean;
    }
  | { art: "prompt-vorgemerkt"; zustellID: string; text: string }
  | {
      art: "prompt-zugestellt";
      zustellID: string;
      sitzung: string;
      zeit: number;
      zustellung: Zustellung;
      istKind?: boolean;
    }
  | { art: "warten-gestartet"; sitzung: string; zeit: number }
  | { art: "warten-beendet"; sitzung: string; zeit: number }
  | { art: "sitzung-geloescht"; sitzung: string }
  | { art: "lebenszeichen"; sitzung: string; zeit: number };

export function leererZustand(): Zustand {
  return { eintraege: [], texte: {}, letzterPrompt: {}, sitzungen: [], lebenszeichen: {} };
}

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

/** Dauer als `42s`, `1m 23s` oder `1h 02m`. Sekundengenau, ohne Zehntel. */
export function formatiereDauer(ms: number): string {
  const gesamt = Math.max(0, Math.round(ms / 1000));
  const stunden = Math.floor(gesamt / 3600);
  const minuten = Math.floor((gesamt % 3600) / 60);
  const sekunden = gesamt % 60;
  if (stunden > 0) return `${stunden}h ${String(minuten).padStart(2, "0")}m`;
  if (minuten > 0) return `${minuten}m ${String(sekunden).padStart(2, "0")}s`;
  return `${sekunden}s`;
}

/**
 * Titel aus dem Prompt: erste nicht leere Zeile, auf `MAX_TITEL` Zeichen
 * gekürzt. Ohne verwertbaren Text bleibt `ohne Titel`.
 */
export function kuerzeTitel(text: string | undefined | null): string {
  if (!text) return OHNE_TITEL;
  const zeile = text
    .split(/\r?\n/)
    .map((teil) => teil.trim())
    .find((teil) => teil.length > 0);
  if (!zeile) return OHNE_TITEL;
  const knapp = zeile.replace(/\s+/g, " ");
  if (knapp.length <= MAX_TITEL) return knapp;
  return `${knapp.slice(0, MAX_TITEL - 1).trimEnd()}…`;
}

/** Anzeigetext eines Status. Erfolgreiche Läufe bleiben schlicht. */
export function statusText(status: LaufStatus): string | undefined {
  switch (status) {
    case "laeuft":
      return LAEUFT_HINWEIS;
    case "fehler":
      return "Fehler";
    case "abgebrochen":
      return "abgebrochen";
    case "verdraengt":
      return "verdrängt";
    case "beendet":
      return "beendet";
    case "inaktiv":
      return "inaktiv";
    case "zeitsprung":
      return "Zeitsprung";
    case "fertig":
      return undefined;
  }
}

export function statusVonGrund(grund: Unterbrechungsgrund): LaufStatus {
  switch (grund) {
    case "user":
      return "abgebrochen";
    case "shutdown":
      return "beendet";
    case "superseded":
      return "verdraengt";
    case "inactivity":
      return "inaktiv";
  }
}

// ---------------------------------------------------------------------------
// Ableitungen
// ---------------------------------------------------------------------------

/** Dauer eines Eintrags. Negatives aus einer zurückgestellten Uhr wird zu null. */
export function dauerMs(eintrag: Eintrag, jetzt: number): number {
  const ende = eintrag.ende ?? jetzt;
  return Math.max(0, ende - eintrag.start);
}

/** Wartezeit einschließlich einer noch laufenden Wartezeit. */
export function wartezeitMs(eintrag: Eintrag, jetzt: number): number {
  const offen = eintrag.warteSeit === undefined ? 0 : Math.max(0, jetzt - eintrag.warteSeit);
  return eintrag.warteMs + offen;
}

export type Statistik = {
  anzahl: number;
  summeMs: number;
  durchschnittMs: number;
};

/**
 * Kennzahlen über alle abgeschlossenen Einträge, auch die nicht erfolgreichen
 * und auch die aus der Anzeige gefallenen. Der laufende Eintrag bleibt außen
 * vor, sonst wäre die Summe bei jedem Takt eine andere.
 */
export function statistik(eintraege: Eintrag[], jetzt: number): Statistik {
  const abgeschlossen = eintraege.filter((eintrag) => eintrag.status !== "laeuft");
  const summeMs = abgeschlossen.reduce((summe, eintrag) => summe + dauerMs(eintrag, jetzt), 0);
  const anzahl = abgeschlossen.length;
  return { anzahl, summeMs, durchschnittMs: anzahl > 0 ? Math.round(summeMs / anzahl) : 0 };
}

export function summenzeile(stats: Statistik): string | undefined {
  if (stats.anzahl === 0) return undefined;
  const aufgaben = stats.anzahl === 1 ? "1 Aufgabe" : `${stats.anzahl} Aufgaben`;
  return `${aufgaben}, ${formatiereDauer(stats.summeMs)}, Ø ${formatiereDauer(stats.durchschnittMs)}`;
}

/** Zusatz zur Laufzeit, wenn beim Abschluss Wartezeit angefallen ist. */
export function warteAusweis(eintrag: Eintrag, jetzt: number): string | undefined {
  if (eintrag.status === "laeuft") return undefined;
  const warte = wartezeitMs(eintrag, jetzt);
  if (warte < 1000) return undefined;
  return `${formatiereDauer(warte)} warten`;
}

/** Einträge einer Sitzung, neueste zuerst, auf `MAX_EINTRAEGE` begrenzt. */
export function sichtbareEintraege(
  zustand: Zustand,
  sitzung: string,
  max: number = MAX_EINTRAEGE,
): Eintrag[] {
  return zustand.eintraege
    .filter((eintrag) => eintrag.sitzung === sitzung)
    .sort((links, rechts) => rechts.start - links.start)
    .slice(0, max);
}

export function laufenderEintrag(zustand: Zustand, sitzung: string): Eintrag | undefined {
  return zustand.eintraege.find(
    (eintrag) => eintrag.sitzung === sitzung && eintrag.status === "laeuft",
  );
}

// ---------------------------------------------------------------------------
// Zustandsübergänge
// ---------------------------------------------------------------------------

function mitEintraegen(zustand: Zustand, eintraege: Eintrag[]): Zustand {
  return { ...zustand, eintraege };
}

function ersetze(zustand: Zustand, id: string, aenderung: Partial<Eintrag>): Zustand {
  return mitEintraegen(
    zustand,
    zustand.eintraege.map((eintrag) => (eintrag.id === id ? { ...eintrag, ...aenderung } : eintrag)),
  );
}

function beruehreSitzung(zustand: Zustand, sitzung: string, zeit: number): Zustand {
  const ohne = zustand.sitzungen.filter((eintrag) => eintrag !== sitzung);
  return {
    ...zustand,
    sitzungen: [...ohne, sitzung],
    lebenszeichen: { ...zustand.lebenszeichen, [sitzung]: zeit },
  };
}

/**
 * Ein `steer`-Prompt verlängert die laufende Aufgabe, deshalb wird der Titel
 * ergänzt statt ersetzt. Passt die Ergänzung nicht mehr in `MAX_TITEL`, bleibt
 * der bisherige Titel stehen, damit die Zeile lesbar bleibt.
 */
function ergaenzeTitel(bisher: string, neu: string): string {
  if (bisher === OHNE_TITEL) return neu;
  if (neu === OHNE_TITEL) return bisher;
  const zusammen = `${bisher} + ${neu}`;
  return zusammen.length <= MAX_TITEL ? zusammen : bisher;
}

function beende(
  zustand: Zustand,
  sitzung: string,
  zeit: number,
  status: LaufStatus,
): Zustand {
  const laufend = laufenderEintrag(zustand, sitzung);
  if (!laufend) return zustand;
  const warteOffen = laufend.warteSeit === undefined ? 0 : Math.max(0, zeit - laufend.warteSeit);
  // Eine zurückgestellte Systemuhr darf keine negative Laufzeit erzeugen.
  const zeitsprung = zeit < laufend.start;
  return ersetze(zustand, laufend.id, {
    ende: zeitsprung ? laufend.start : zeit,
    status: zeitsprung ? "zeitsprung" : status,
    warteMs: laufend.warteMs + warteOffen,
    warteSeit: undefined,
  });
}

/** Wendet ein Ereignis auf den Zustand an. Ohne Seiteneffekte. */
export function anwenden(zustand: Zustand, ereignis: Ereignis): Zustand {
  switch (ereignis.art) {
    case "lauf-gestartet": {
      if (ereignis.istKind) return zustand;
      // Doppelte Zustellung, etwa nach Hot Reload oder in einer zweiten TUI.
      if (zustand.eintraege.some((eintrag) => eintrag.id === ereignis.id)) return zustand;
      const beruehrt = beruehreSitzung(zustand, ereignis.sitzung, ereignis.zeit);
      const laufend = laufenderEintrag(beruehrt, ereignis.sitzung);
      // Fortsetzung, etwa nach einer Kompaktierung: derselbe Auftrag läuft
      // weiter, es entsteht keine neue Zeile.
      if (laufend) return beruehrt;
      const rueckfall = beruehrt.letzterPrompt[ereignis.sitzung];
      const eintrag: Eintrag = {
        id: ereignis.id,
        sitzung: ereignis.sitzung,
        titel: kuerzeTitel(rueckfall),
        start: ereignis.zeit,
        status: "laeuft",
        warteMs: 0,
      };
      return mitEintraegen(beruehrt, [...beruehrt.eintraege, eintrag]);
    }

    case "lauf-beendet": {
      if (ereignis.istKind) return zustand;
      return beende(
        beruehreSitzung(zustand, ereignis.sitzung, ereignis.zeit),
        ereignis.sitzung,
        ereignis.zeit,
        ereignis.ergebnis === "fertig" ? "fertig" : "fehler",
      );
    }

    case "lauf-unterbrochen": {
      if (ereignis.istKind) return zustand;
      return beende(
        beruehreSitzung(zustand, ereignis.sitzung, ereignis.zeit),
        ereignis.sitzung,
        ereignis.zeit,
        statusVonGrund(ereignis.grund),
      );
    }

    case "prompt-vorgemerkt": {
      return { ...zustand, texte: { ...zustand.texte, [ereignis.zustellID]: ereignis.text } };
    }

    case "prompt-zugestellt": {
      if (ereignis.istKind) return zustand;
      const text = zustand.texte[ereignis.zustellID];
      const titel = kuerzeTitel(text);
      const texte = { ...zustand.texte };
      delete texte[ereignis.zustellID];
      const beruehrt: Zustand = {
        ...zustand,
        texte,
        letzterPrompt: { ...zustand.letzterPrompt, [ereignis.sitzung]: text ?? titel },
      };
      const laufend = laufenderEintrag(beruehrt, ereignis.sitzung);
      // Ein `queue`-Prompt gehört zum naechsten Lauf. Ist noch einer offen,
      // wird er nicht umbenannt, sonst stuende ein fremder Titel an einer
      // fremden Laufzeit.
      if (!laufend) return beruehrt;
      if (ereignis.zustellung === "steer") {
        return ersetze(beruehrt, laufend.id, { titel: ergaenzeTitel(laufend.titel, titel) });
      }
      return beruehrt;
    }

    case "warten-gestartet": {
      const laufend = laufenderEintrag(zustand, ereignis.sitzung);
      if (!laufend || laufend.warteSeit !== undefined) return zustand;
      return ersetze(zustand, laufend.id, { warteSeit: ereignis.zeit });
    }

    case "warten-beendet": {
      const laufend = laufenderEintrag(zustand, ereignis.sitzung);
      if (!laufend || laufend.warteSeit === undefined) return zustand;
      const dazu = Math.max(0, ereignis.zeit - laufend.warteSeit);
      return ersetze(zustand, laufend.id, {
        warteMs: laufend.warteMs + dazu,
        warteSeit: undefined,
      });
    }

    case "sitzung-geloescht": {
      const texte = { ...zustand.texte };
      const letzterPrompt = { ...zustand.letzterPrompt };
      const lebenszeichen = { ...zustand.lebenszeichen };
      delete letzterPrompt[ereignis.sitzung];
      delete lebenszeichen[ereignis.sitzung];
      return {
        eintraege: zustand.eintraege.filter((eintrag) => eintrag.sitzung !== ereignis.sitzung),
        texte,
        letzterPrompt,
        sitzungen: zustand.sitzungen.filter((sitzung) => sitzung !== ereignis.sitzung),
        lebenszeichen,
      };
    }

    case "lebenszeichen": {
      if (ereignis.istKind) return zustand;
      return beruehreSitzung(zustand, ereignis.sitzung, ereignis.zeit);
    }
  }
}

/**
 * Schließt beim Start liegengebliebene Läufe ab. Die Dauer endet beim letzten
 * Lebenszeichen, nicht bei der aktuellen Uhrzeit, sonst würde eine über Nacht
 * geschlossene Sitzung eine absurde Laufzeit behaupten.
 */
export function schliesseLiegengebliebeneAb(zustand: Zustand): Zustand {
  const eintraege = zustand.eintraege.map((eintrag) => {
    if (eintrag.status !== "laeuft") return eintrag;
    const letztes = zustand.lebenszeichen[eintrag.sitzung] ?? eintrag.start;
    const ende = Math.max(eintrag.start, letztes);
    return { ...eintrag, status: "beendet" as LaufStatus, ende, warteSeit: undefined };
  });
  return mitEintraegen(zustand, eintraege);
}

/**
 * Räumt nach Alter und Anzahl auf: Einträge älter als `ALTER_TAGE` verschwinden,
 * und es bleiben höchstens `MAX_SITZUNGEN` Sitzungen erhalten.
 */
export function raeumeAuf(zustand: Zustand, jetzt: number): Zustand {
  const grenze = jetzt - ALTER_TAGE * MS_PRO_TAG;
  const behalten = new Set(
    zustand.sitzungen.slice(Math.max(0, zustand.sitzungen.length - MAX_SITZUNGEN)),
  );
  const eintraege = zustand.eintraege.filter(
    (eintrag) => eintrag.start >= grenze && behalten.has(eintrag.sitzung),
  );
  const lebendigeSitzungen = new Set(eintraege.map((eintrag) => eintrag.sitzung));
  const texte: Record<string, string> = {};
  for (const [id, text] of Object.entries(zustand.texte)) {
    // Vorgemerkte Texte ohne Zustellung sind nach einem Aufräumen wertlos.
    if (text !== undefined) texte[id] = text;
  }
  const letzterPrompt: Record<string, string> = {};
  const lebenszeichen: Record<string, number> = {};
  for (const sitzung of lebendigeSitzungen) {
    const prompt = zustand.letzterPrompt[sitzung];
    if (prompt !== undefined) letzterPrompt[sitzung] = prompt;
    const zeichen = zustand.lebenszeichen[sitzung];
    if (zeichen !== undefined) lebenszeichen[sitzung] = zeichen;
  }
  return {
    eintraege,
    texte,
    letzterPrompt,
    sitzungen: zustand.sitzungen.filter((sitzung) => lebendigeSitzungen.has(sitzung)),
    lebenszeichen,
  };
}

/** Leert die Einträge einer Sitzung, ohne andere Sitzungen anzutasten. */
export function leereSitzung(zustand: Zustand, sitzung: string): Zustand {
  return mitEintraegen(
    zustand,
    zustand.eintraege.filter((eintrag) => eintrag.sitzung !== sitzung),
  );
}
