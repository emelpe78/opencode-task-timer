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
export const UNTITLED = "untitled";
export const WAITING_HINT = "waiting for you";
export const RUNNING_HINT = "running";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export function emptyState() {
  return {
    rev: 0,
    entries: [],
    texts: {},
    pending: {},
    lastPrompt: {},
    sessions: [],
    heartbeats: {}
  };
}

// ---------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------

/** Dauer als `42s`, `1m 23s` oder `1h 02m`. Sekundengenau, ohne Zehntel. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * Titel aus dem Prompt: erste nicht leere Zeile, auf `MAX_TITLE` Zeichen
 * gekürzt. Ohne verwertbaren Text bleibt `untitled`.
 */
export function shortenTitle(text) {
  if (!text) return UNTITLED;
  const line = text.split(/\r?\n/).map(part => part.trim()).find(part => part.length > 0);
  if (!line) return UNTITLED;
  const compact = line.replace(/\s+/g, " ");
  if (compact.length <= MAX_TITLE) return compact;
  return `${compact.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

/** Anzeigetext eines Status. Erfolgreiche Läufe bleiben schlicht. */
export function statusLabel(status) {
  switch (status) {
    case "running":
      return RUNNING_HINT;
    case "error":
      return "error";
    case "aborted":
      return "aborted";
    case "superseded":
      return "superseded";
    case "ended":
      return "ended";
    case "inactive":
      return "inactive";
    case "clockSkew":
      return "clock skew";
    case "done":
      return undefined;
  }
}
export function statusFromReason(reason) {
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
export function durationMs(entry, now) {
  const end = entry.end ?? now;
  return Math.max(0, end - entry.start);
}

/** Wartezeit einschließlich einer noch laufenden Wartezeit. */
export function waitingMs(entry, now) {
  const open = entry.waitingSince === undefined ? 0 : Math.max(0, now - entry.waitingSince);
  return entry.waitingMs + open;
}
/**
 * Kennzahlen über alle abgeschlossenen Einträge, auch die nicht erfolgreichen
 * und auch die aus der Anzeige gefallenen. Der laufende Eintrag bleibt außen
 * vor, sonst wäre die Summe bei jedem Takt eine andere.
 */
export function stats(entries, now) {
  const finished = entries.filter(entry => entry.status !== "running");
  const totalMs = finished.reduce((sum, entry) => sum + durationMs(entry, now), 0);
  const count = finished.length;
  return {
    count,
    totalMs,
    averageMs: count > 0 ? Math.round(totalMs / count) : 0
  };
}
export function summaryLine(summary) {
  if (summary.count === 0) return undefined;
  const tasks = summary.count === 1 ? "1 task" : `${summary.count} tasks`;
  return `${tasks}, ${formatDuration(summary.totalMs)}, Ø ${formatDuration(summary.averageMs)}`;
}

/** Zusatz zur Laufzeit, wenn beim Abschluss Wartezeit angefallen ist. */
export function waitingNote(entry, now) {
  if (entry.status === "running") return undefined;
  const waiting = waitingMs(entry, now);
  if (waiting < 1000) return undefined;
  return `${formatDuration(waiting)} waiting`;
}

/** Einträge einer Sitzung, neueste zuerst, auf `MAX_ENTRIES` begrenzt. */
export function visibleEntries(state, session, max = MAX_ENTRIES) {
  return state.entries.filter(entry => entry.session === session).sort((left, right) => right.start - left.start).slice(0, max);
}
export function runningEntry(state, session) {
  return state.entries.find(entry => entry.session === session && entry.status === "running");
}

// ---------------------------------------------------------------------------
// Zustandsübergänge
// ---------------------------------------------------------------------------

export function withEntries(state, entries) {
  return {
    ...state,
    entries
  };
}
function replace(state, id, patch) {
  return withEntries(state, state.entries.map(entry => entry.id === id ? {
    ...entry,
    ...patch
  } : entry));
}
function touchSession(state, session, time) {
  const rest = state.sessions.filter(entry => entry !== session);
  return {
    ...state,
    sessions: [...rest, session],
    heartbeats: {
      ...state.heartbeats,
      [session]: time
    }
  };
}

/**
 * Ein `steer`-Prompt verlängert die laufende Aufgabe, deshalb wird der Titel
 * ergänzt statt ersetzt. Passt die Ergänzung nicht mehr in `MAX_TITLE`, bleibt
 * der bisherige Titel stehen, damit die Zeile lesbar bleibt.
 */
function appendTitle(previous, next) {
  if (previous === UNTITLED) return next;
  if (next === UNTITLED) return previous;
  const combined = `${previous} + ${next}`;
  return combined.length <= MAX_TITLE ? combined : previous;
}
function finish(state, session, time, status) {
  const running = runningEntry(state, session);
  if (!running) return state;
  const openWaiting = running.waitingSince === undefined ? 0 : Math.max(0, time - running.waitingSince);
  // Eine zurückgestellte Systemuhr darf keine negative Laufzeit erzeugen.
  const clockSkew = time < running.start;
  return replace(state, running.id, {
    end: clockSkew ? running.start : time,
    status: clockSkew ? "clockSkew" : status,
    waitingMs: running.waitingMs + openWaiting,
    waitingSince: undefined
  });
}

/** Wendet ein Ereignis auf den Zustand an. Ohne Seiteneffekte. */
export function apply(state, event) {
  const next = reduce(state, event);
  // Jede angenommene Änderung zählt eine Revision weiter.
  return next === state ? state : {
    ...next,
    rev: state.rev + 1
  };
}
function reduce(state, event) {
  switch (event.kind) {
    case "run-started":
      {
        if (event.isChild) return state;
        // Doppelte Zustellung, etwa nach Hot Reload oder in einer zweiten TUI.
        if (state.entries.some(entry => entry.id === event.id)) return state;
        const touched = touchSession(state, event.session, event.time);
        const running = runningEntry(touched, event.session);
        // Fortsetzung, etwa nach einer Kompaktierung: derselbe Auftrag läuft
        // weiter, es entsteht keine neue Zeile.
        if (running) return touched;
        // Der Host meldet den Prompt vor dem Start, die Zustellung aber erst
        // danach. Deshalb ist der vorgemerkte Prompt die richtige Quelle und der
        // zuletzt zugestellte nur der Rückfall. `titleFrom` verhindert später,
        // dass dieselbe Zustellung den Titel ein zweites Mal ergänzt.
        const queued = touched.pending[event.session]?.[0];
        const fallback = queued?.text ?? touched.lastPrompt[event.session];
        const entry = {
          id: event.id,
          session: event.session,
          title: shortenTitle(fallback),
          ...(queued === undefined ? {} : {
            titleFrom: queued.id
          }),
          start: event.time,
          status: "running",
          waitingMs: 0
        };
        return withEntries(touched, [...touched.entries, entry]);
      }
    case "run-ended":
      {
        if (event.isChild) return state;
        return finish(touchSession(state, event.session, event.time), event.session, event.time, event.result === "done" ? "done" : "error");
      }
    case "run-interrupted":
      {
        if (event.isChild) return state;
        return finish(touchSession(state, event.session, event.time), event.session, event.time, statusFromReason(event.reason));
      }
    case "prompt-queued":
      {
        const queue = state.pending[event.session] ?? [];
        const known = queue.some(item => item.id === event.deliveryID);
        return {
          ...state,
          texts: {
            ...state.texts,
            [event.deliveryID]: event.text
          },
          pending: {
            ...state.pending,
            [event.session]: known ? queue : [...queue, {
              id: event.deliveryID,
              text: event.text,
              delivery: event.delivery
            }]
          }
        };
      }
    case "prompt-delivered":
      {
        if (event.isChild) return state;
        const text = state.texts[event.deliveryID];
        const title = shortenTitle(text);
        // Der Prompt ist zugestellt: Text und Vormerkung sind verbraucht.
        const texts = {
          ...state.texts
        };
        delete texts[event.deliveryID];
        const queue = (state.pending[event.session] ?? []).filter(item => item.id !== event.deliveryID);
        const pending = {
          ...state.pending,
          [event.session]: queue
        };
        if (queue.length === 0) delete pending[event.session];
        const touched = {
          ...state,
          texts,
          pending,
          lastPrompt: {
            ...state.lastPrompt,
            [event.session]: text ?? title
          }
        };
        const running = runningEntry(touched, event.session);
        if (!running) return touched;
        // Hat dieser Prompt den Lauf schon beim Start benannt, steht der Titel
        // bereits und wird nicht ein zweites Mal ergänzt.
        if (running.titleFrom === event.deliveryID) return touched;
        // Ein `steer`-Prompt schiebt sich in die laufende Arbeit und ergänzt
        // deren Titel.
        if (event.delivery === "steer") {
          return replace(touched, running.id, {
            title: appendTitle(running.title, title)
          });
        }
        // Ein `queue`-Prompt gehört zum naechsten Lauf. Ist noch einer offen, wird
        // er nicht umbenannt, sonst stuende ein fremder Titel an einer fremden
        // Laufzeit. Ist der offene Lauf noch ohne Titel, ist das die eigene
        // Zustellung, die der Host erst nach dem Start meldet.
        if (running.title === UNTITLED) {
          return replace(touched, running.id, {
            title
          });
        }
        return touched;
      }
    case "prompt-cancelled":
      {
        // Ein verworfener Prompt darf weder den nächsten Lauf benennen noch als
        // Rückfall liegen bleiben.
        const texts = {
          ...state.texts
        };
        delete texts[event.deliveryID];
        const queue = (state.pending[event.session] ?? []).filter(item => item.id !== event.deliveryID);
        const pending = {
          ...state.pending,
          [event.session]: queue
        };
        if (queue.length === 0) delete pending[event.session];
        return {
          ...state,
          texts,
          pending
        };
      }
    case "waiting-started":
      {
        const running = runningEntry(state, event.session);
        if (!running || running.waitingSince !== undefined) return state;
        return replace(state, running.id, {
          waitingSince: event.time
        });
      }
    case "waiting-ended":
      {
        const running = runningEntry(state, event.session);
        if (!running || running.waitingSince === undefined) return state;
        const added = Math.max(0, event.time - running.waitingSince);
        return replace(state, running.id, {
          waitingMs: running.waitingMs + added,
          waitingSince: undefined
        });
      }
    case "session-deleted":
      {
        const texts = {
          ...state.texts
        };
        const pending = {
          ...state.pending
        };
        const lastPrompt = {
          ...state.lastPrompt
        };
        const heartbeats = {
          ...state.heartbeats
        };
        delete pending[event.session];
        delete lastPrompt[event.session];
        delete heartbeats[event.session];
        return {
          entries: state.entries.filter(entry => entry.session !== event.session),
          texts,
          pending,
          lastPrompt,
          sessions: state.sessions.filter(session => session !== event.session),
          heartbeats
        };
      }
    case "heartbeat":
      {
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
export function closeStaleRuns(state) {
  const entries = state.entries.map(entry => {
    if (entry.status !== "running") return entry;
    const last = state.heartbeats[entry.session] ?? entry.start;
    const end = Math.max(entry.start, last);
    return {
      ...entry,
      status: "ended",
      end,
      waitingSince: undefined
    };
  });
  return withEntries(state, entries);
}

/**
 * Räumt nach Alter und Anzahl auf: Einträge älter als `RETENTION_DAYS` verschwinden,
 * und es bleiben höchstens `MAX_SESSIONS` Sitzungen erhalten.
 */
export function prune(state, now) {
  const cutoff = now - RETENTION_DAYS * MS_PER_DAY;
  const kept = new Set(state.sessions.slice(Math.max(0, state.sessions.length - MAX_SESSIONS)));
  const entries = state.entries.filter(entry => entry.start >= cutoff && kept.has(entry.session));
  const liveSessions = new Set(entries.map(entry => entry.session));
  const pending = {};
  const lastPrompt = {};
  const heartbeats = {};
  for (const session of liveSessions) {
    const queue = state.pending[session];
    if (queue !== undefined && queue.length > 0) pending[session] = queue;
    const prompt = state.lastPrompt[session];
    if (prompt !== undefined) lastPrompt[session] = prompt;
    const beat = state.heartbeats[session];
    if (beat !== undefined) heartbeats[session] = beat;
  }
  // Vorgemerkte Texte ohne noch offene Vormerkung sind nach einem Aufräumen
  // wertlos: ihre Zustellung kommt nicht mehr.
  const texts = {};
  for (const queue of Object.values(pending)) {
    for (const item of queue) {
      const text = state.texts[item.id];
      if (text !== undefined) texts[item.id] = text;
    }
  }
  return {
    rev: state.rev + 1,
    entries,
    texts,
    pending,
    lastPrompt,
    sessions: state.sessions.filter(session => liveSessions.has(session)),
    heartbeats
  };
}

/** Leert die Einträge einer Sitzung, ohne andere Sitzungen anzutasten. */
export function clearSession(state, session) {
  return {
    ...withEntries(state, state.entries.filter(entry => entry.session !== session)),
    rev: state.rev + 1
  };
}
