// Reine Messlogik für opencode-task-timer.
//
// Diese Datei kennt weder OpenCode noch Solid noch JSX. Sie ist damit mit
// `node --test` prüfbar und enthält die eigentliche Wahrheit darüber, was als
// Laufzeit gezählt wird. Alles Sichtbare und alles Verdrahtete liegt in
// `tui.tsx`.
//
// Messvertrag (kurz):
// - Gemessen wird ein Agentenlauf, nicht ein Prompt.
// - Start ist `run-started`, Ende ist `run-ended` oder `run-interrupted`.
// - Zeitstempel kommen vom Server, nicht von der lokalen Uhr.
// - Ein `steer`-Prompt und eine automatische Fortsetzung nach Kompaktierung
//   verlängern den laufenden Eintrag. Ein `queue`-Prompt führt über ein
//   `superseded`-Ende zu einer neuen Zeile.
// - Kind-Sitzungen (Subagenten) werden vollständig ignoriert, damit ihre Zeit
//   nicht doppelt in der Wurzel landet.
// - Warten auf Freigabe oder Rückfrage zählt zur Laufzeit und wird beim
//   Abschluss zusätzlich ausgewiesen.

export const MAX_ENTRIES = 10;
export const MAX_TITLE = 40;
export const RETENTION_DAYS = 30;
export const MAX_SESSIONS = 200;
export const UNTITLED = "ohne Titel";
export const WAITING_HINT = "wartet auf dich";
export const RUNNING_HINT = "läuft";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RunStatus =
  | "running"
  | "done"
  | "error"
  | "aborted"
  | "superseded"
  | "ended"
  | "inactive"
  | "clockSkew";

export type InterruptionReason = "user" | "shutdown" | "superseded" | "inactivity";

export type Delivery = "steer" | "queue";

export type Entry = {
  /** Ereignis-ID des Starts. Dient als Schlüssel gegen doppelte Erfassung. */
  id: string;
  session: string;
  title: string;
  /** Startzeit in Millisekunden, aus dem Serverstempel des Ereignisses. */
  start: number;
  end?: number;
  status: RunStatus;
  /** Aufgelaufene Wartezeit auf die nutzende Person in Millisekunden. */
  waitingMs: number;
  /** Beginn der aktuell laufenden Wartezeit, falls gerade gewartet wird. */
  waitingSince?: number;
};

export type State = {
  entries: Entry[];
  /** Prompt-Texte, vorgemerkt über die Zustellungs-ID. */
  texts: Record<string, string>;
  /** Zuletzt zugestellter Prompt je Sitzung, als Titelrückfall. */
  lastPrompt: Record<string, string>;
  /** Sitzungen in der Reihenfolge des letzten Kontakts, älteste zuerst. */
  sessions: string[];
  /** Letztes Lebenszeichen je Sitzung, für das Abschließen beim Neustart. */
  heartbeats: Record<string, number>;
};

export type Event =
  | { kind: "run-started"; id: string; session: string; time: number; isChild?: boolean }
  | {
      kind: "run-ended";
      session: string;
      time: number;
      result: "done" | "error";
      isChild?: boolean;
    }
  | {
      kind: "run-interrupted";
      session: string;
      time: number;
      reason: InterruptionReason;
      isChild?: boolean;
    }
  | { kind: "prompt-queued"; deliveryID: string; text: string }
  | {
      kind: "prompt-delivered";
      deliveryID: string;
      session: string;
      time: number;
      delivery: Delivery;
      isChild?: boolean;
    }
  | { kind: "waiting-started"; session: string; time: number }
  | { kind: "waiting-ended"; session: string; time: number }
  | { kind: "session-deleted"; session: string }
  | { kind: "heartbeat"; session: string; time: number };

export function emptyState(): State {
  return { entries: [], texts: {}, lastPrompt: {}, sessions: [], heartbeats: {} };
}

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

/** Dauer als `42s`, `1m 23s` oder `1h 02m`. Sekundengenau, ohne Zehntel. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * Titel aus dem Prompt: erste nicht leere Zeile, auf `MAX_TITLE` Zeichen
 * gekürzt. Ohne verwertbaren Text bleibt `ohne Titel`.
 */
export function shortenTitle(text: string | undefined | null): string {
  if (!text) return UNTITLED;
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return UNTITLED;
  const compact = line.replace(/\s+/g, " ");
  if (compact.length <= MAX_TITLE) return compact;
  return `${compact.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

/** Anzeigetext eines Status. Erfolgreiche Läufe bleiben schlicht. */
export function statusLabel(status: RunStatus): string | undefined {
  switch (status) {
    case "running":
      return RUNNING_HINT;
    case "error":
      return "Fehler";
    case "aborted":
      return "abgebrochen";
    case "superseded":
      return "verdrängt";
    case "ended":
      return "beendet";
    case "inactive":
      return "inaktiv";
    case "clockSkew":
      return "Zeitsprung";
    case "done":
      return undefined;
  }
}

export function statusFromReason(reason: InterruptionReason): RunStatus {
  switch (reason) {
    case "user":
      return "aborted";
    case "shutdown":
      return "ended";
    case "superseded":
      return "superseded";
    case "inactivity":
      return "inactive";
  }
}

// ---------------------------------------------------------------------------
// Ableitungen
// ---------------------------------------------------------------------------

/** Dauer eines Eintrags. Negatives aus einer zurückgestellten Uhr wird zu null. */
export function durationMs(entry: Entry, now: number): number {
  const end = entry.end ?? now;
  return Math.max(0, end - entry.start);
}

/** Wartezeit einschließlich einer noch laufenden Wartezeit. */
export function waitingMs(entry: Entry, now: number): number {
  const open = entry.waitingSince === undefined ? 0 : Math.max(0, now - entry.waitingSince);
  return entry.waitingMs + open;
}

export type Stats = {
  count: number;
  totalMs: number;
  averageMs: number;
};

/**
 * Kennzahlen über alle abgeschlossenen Einträge, auch die nicht erfolgreichen
 * und auch die aus der Anzeige gefallenen. Der laufende Eintrag bleibt außen
 * vor, sonst wäre die Summe bei jedem Takt eine andere.
 */
export function stats(entries: Entry[], now: number): Stats {
  const finished = entries.filter((entry) => entry.status !== "running");
  const totalMs = finished.reduce((sum, entry) => sum + durationMs(entry, now), 0);
  const count = finished.length;
  return { count, totalMs, averageMs: count > 0 ? Math.round(totalMs / count) : 0 };
}

export function summaryLine(summary: Stats): string | undefined {
  if (summary.count === 0) return undefined;
  const tasks = summary.count === 1 ? "1 Aufgabe" : `${summary.count} Aufgaben`;
  return `${tasks}, ${formatDuration(summary.totalMs)}, Ø ${formatDuration(summary.averageMs)}`;
}

/** Zusatz zur Laufzeit, wenn beim Abschluss Wartezeit angefallen ist. */
export function waitingNote(entry: Entry, now: number): string | undefined {
  if (entry.status === "running") return undefined;
  const waiting = waitingMs(entry, now);
  if (waiting < 1000) return undefined;
  return `${formatDuration(waiting)} warten`;
}

/** Einträge einer Sitzung, neueste zuerst, auf `MAX_ENTRIES` begrenzt. */
export function visibleEntries(
  state: State,
  session: string,
  max: number = MAX_ENTRIES,
): Entry[] {
  return state.entries
    .filter((entry) => entry.session === session)
    .sort((left, right) => right.start - left.start)
    .slice(0, max);
}

export function runningEntry(state: State, session: string): Entry | undefined {
  return state.entries.find((entry) => entry.session === session && entry.status === "running");
}

// ---------------------------------------------------------------------------
// Zustandsübergänge
// ---------------------------------------------------------------------------

function withEntries(state: State, entries: Entry[]): State {
  return { ...state, entries };
}

function replace(state: State, id: string, patch: Partial<Entry>): State {
  return withEntries(
    state,
    state.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  );
}

function touchSession(state: State, session: string, time: number): State {
  const rest = state.sessions.filter((entry) => entry !== session);
  return {
    ...state,
    sessions: [...rest, session],
    heartbeats: { ...state.heartbeats, [session]: time },
  };
}

/**
 * Ein `steer`-Prompt verlängert die laufende Aufgabe, deshalb wird der Titel
 * ergänzt statt ersetzt. Passt die Ergänzung nicht mehr in `MAX_TITLE`, bleibt
 * der bisherige Titel stehen, damit die Zeile lesbar bleibt.
 */
function appendTitle(previous: string, next: string): string {
  if (previous === UNTITLED) return next;
  if (next === UNTITLED) return previous;
  const combined = `${previous} + ${next}`;
  return combined.length <= MAX_TITLE ? combined : previous;
}

function finish(state: State, session: string, time: number, status: RunStatus): State {
  const running = runningEntry(state, session);
  if (!running) return state;
  const openWaiting = running.waitingSince === undefined ? 0 : Math.max(0, time - running.waitingSince);
  // Eine zurückgestellte Systemuhr darf keine negative Laufzeit erzeugen.
  const clockSkew = time < running.start;
  return replace(state, running.id, {
    end: clockSkew ? running.start : time,
    status: clockSkew ? "clockSkew" : status,
    waitingMs: running.waitingMs + openWaiting,
    waitingSince: undefined,
  });
}

/** Wendet ein Ereignis auf den Zustand an. Ohne Seiteneffekte. */
export function apply(state: State, event: Event): State {
  switch (event.kind) {
    case "run-started": {
      if (event.isChild) return state;
      // Doppelte Zustellung, etwa nach Hot Reload oder in einer zweiten TUI.
      if (state.entries.some((entry) => entry.id === event.id)) return state;
      const touched = touchSession(state, event.session, event.time);
      const running = runningEntry(touched, event.session);
      // Fortsetzung, etwa nach einer Kompaktierung: derselbe Auftrag läuft
      // weiter, es entsteht keine neue Zeile.
      if (running) return touched;
      const fallback = touched.lastPrompt[event.session];
      const entry: Entry = {
        id: event.id,
        session: event.session,
        title: shortenTitle(fallback),
        start: event.time,
        status: "running",
        waitingMs: 0,
      };
      return withEntries(touched, [...touched.entries, entry]);
    }

    case "run-ended": {
      if (event.isChild) return state;
      return finish(
        touchSession(state, event.session, event.time),
        event.session,
        event.time,
        event.result === "done" ? "done" : "error",
      );
    }

    case "run-interrupted": {
      if (event.isChild) return state;
      return finish(
        touchSession(state, event.session, event.time),
        event.session,
        event.time,
        statusFromReason(event.reason),
      );
    }

    case "prompt-queued": {
      return { ...state, texts: { ...state.texts, [event.deliveryID]: event.text } };
    }

    case "prompt-delivered": {
      if (event.isChild) return state;
      const text = state.texts[event.deliveryID];
      const title = shortenTitle(text);
      const texts = { ...state.texts };
      delete texts[event.deliveryID];
      const touched: State = {
        ...state,
        texts,
        lastPrompt: { ...state.lastPrompt, [event.session]: text ?? title },
      };
      const running = runningEntry(touched, event.session);
      // Ein `queue`-Prompt gehört zum naechsten Lauf. Ist noch einer offen,
      // wird er nicht umbenannt, sonst stuende ein fremder Titel an einer
      // fremden Laufzeit.
      if (!running) return touched;
      if (event.delivery === "steer") {
        return replace(touched, running.id, { title: appendTitle(running.title, title) });
      }
      return touched;
    }

    case "waiting-started": {
      const running = runningEntry(state, event.session);
      if (!running || running.waitingSince !== undefined) return state;
      return replace(state, running.id, { waitingSince: event.time });
    }

    case "waiting-ended": {
      const running = runningEntry(state, event.session);
      if (!running || running.waitingSince === undefined) return state;
      const added = Math.max(0, event.time - running.waitingSince);
      return replace(state, running.id, {
        waitingMs: running.waitingMs + added,
        waitingSince: undefined,
      });
    }

    case "session-deleted": {
      const texts = { ...state.texts };
      const lastPrompt = { ...state.lastPrompt };
      const heartbeats = { ...state.heartbeats };
      delete lastPrompt[event.session];
      delete heartbeats[event.session];
      return {
        entries: state.entries.filter((entry) => entry.session !== event.session),
        texts,
        lastPrompt,
        sessions: state.sessions.filter((session) => session !== event.session),
        heartbeats,
      };
    }

    case "heartbeat": {
      if (event.isChild) return state;
      return touchSession(state, event.session, event.time);
    }
  }
}

/**
 * Schließt beim Start liegengebliebene Läufe ab. Die Dauer endet beim letzten
 * Lebenszeichen, nicht bei der aktuellen Uhrzeit, sonst würde eine über Nacht
 * geschlossene Sitzung eine absurde Laufzeit behaupten.
 */
export function closeStaleRuns(state: State): State {
  const entries = state.entries.map((entry) => {
    if (entry.status !== "running") return entry;
    const last = state.heartbeats[entry.session] ?? entry.start;
    const end = Math.max(entry.start, last);
    return { ...entry, status: "ended" as RunStatus, end, waitingSince: undefined };
  });
  return withEntries(state, entries);
}

/**
 * Räumt nach Alter und Anzahl auf: Einträge älter als `RETENTION_DAYS` verschwinden,
 * und es bleiben höchstens `MAX_SESSIONS` Sitzungen erhalten.
 */
export function prune(state: State, now: number): State {
  const cutoff = now - RETENTION_DAYS * MS_PER_DAY;
  const kept = new Set(
    state.sessions.slice(Math.max(0, state.sessions.length - MAX_SESSIONS)),
  );
  const entries = state.entries.filter(
    (entry) => entry.start >= cutoff && kept.has(entry.session),
  );
  const liveSessions = new Set(entries.map((entry) => entry.session));
  const texts: Record<string, string> = {};
  for (const [id, text] of Object.entries(state.texts)) {
    // Vorgemerkte Texte ohne Zustellung sind nach einem Aufräumen wertlos.
    if (text !== undefined) texts[id] = text;
  }
  const lastPrompt: Record<string, string> = {};
  const heartbeats: Record<string, number> = {};
  for (const session of liveSessions) {
    const prompt = state.lastPrompt[session];
    if (prompt !== undefined) lastPrompt[session] = prompt;
    const beat = state.heartbeats[session];
    if (beat !== undefined) heartbeats[session] = beat;
  }
  return {
    entries,
    texts,
    lastPrompt,
    sessions: state.sessions.filter((session) => liveSessions.has(session)),
    heartbeats,
  };
}

/** Leert die Einträge einer Sitzung, ohne andere Sitzungen anzutasten. */
export function clearSession(state: State, session: string): State {
  return withEntries(
    state,
    state.entries.filter((entry) => entry.session !== session),
  );
}
