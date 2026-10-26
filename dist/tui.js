import { use as _$use } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createComponent as _$createComponent } from "opentui:runtime-module:%40opentui%2Fsolid";
import { effect as _$effect } from "opentui:runtime-module:%40opentui%2Fsolid";
import { memo as _$memo } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createTextNode as _$createTextNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insertNode as _$insertNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insert as _$insert } from "opentui:runtime-module:%40opentui%2Fsolid";
import { setProp as _$setProp } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createElement as _$createElement } from "opentui:runtime-module:%40opentui%2Fsolid";
// OpenCode-2-TUI-Plugin: Laufzeiten je Aufgabe in der Seitenleiste.
//
// Diese Datei verdrahtet die OpenCode-Ereignisse mit der reinen Messlogik aus
// `measurement.ts` und rendert den Block. Die Wahrheit über die Messung liegt in
// `measurement.ts` und ist dort durch Tests belegt; hier steht nur Übersetzung und
// Darstellung.
//
// Messvertrag siehe README, Abschnitt "Was gemessen wird".

import { Plugin } from "@opencode/plugin/tui";
import { For, Show, createMemo, createSignal, onCleanup } from "opentui:runtime-module:solid-js";
import { apply, clearSession, closeStaleRuns, durationMs, emptyState, formatDuration, prune, runningEntry, stats, statusLabel, summaryLine, visibleEntries, waitingNote, WAITING_HINT } from "./measurement.js";

/** Speicherschlüssel im durabelen Host-Store. */
const STORAGE = "laufzeiten";
/** Unter dieser Breite wird der Block ausgeblendet statt unleserlich zu werden. */
const MIN_WIDTH = 22;
/** Takt der Live-Anzeige. */
const TICK_MS = 1_000;
/** Ab hier wird der Titel gekürzt, damit die Zeile in die Spalte passt. */
const TITLE_SPACE = 12;
/** Liest einen Textpfad defensiv, weil die Payload-Form zwischen Versionen wechselt. */
function textAt(value, path) {
  let current = value;
  for (const part of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Prompt-Text eines Zustellungs-Ereignisses. Die Form ist je nach Version
 * `{ item: { type, payload: { text } } }` oder `{ item: { text } }`, deshalb
 * werden beide Wege versucht.
 */
function promptText(event) {
  for (const path of [["data", "item", "payload", "text"], ["data", "item", "text"], ["data", "text"], ["item", "payload", "text"], ["item", "text"]]) {
    const text = textAt(event, path);
    if (text !== undefined) return text;
  }
  return "";
}
function deliveryID(event) {
  for (const path of [["data", "inboxID"], ["data", "item", "id"], ["data", "item", "payload", "id"], ["inboxID"]]) {
    const id = textAt(event, path);
    if (id !== undefined) return id;
  }
  return undefined;
}
export default Plugin.define({
  id: "task-timer",
  async setup(context) {
    // Beim Start liegengebliebene Läufe abschließen und aufräumen, damit eine
    // über Nacht geschlossene Sitzung keine absurde Laufzeit behauptet.
    const [stored, write] = context.storage.store(STORAGE, {
      initial: {
        state: emptyState()
      }
    });
    const cleaned = prune(closeStaleRuns(stored.state), Date.now());
    if (cleaned !== stored.state) {
      await write(draft => {
        draft.state = cleaned;
      });
    }
    // Ein Taktzähler stößt die sekündliche Neuberechnung an. Der Zustand selbst
    // ist der reaktive Store, deshalb genügt ein Zähler ohne Wert.
    const [tick, setTick] = createSignal(0);
    const nudge = () => setTick(value => value + 1);

    // Der Store schreibt asynchron und zieht seinen Stand verzögert nach. Würde
    // jedes Ereignis blind aus dem Store rechnen, überschriebe der alte Stand
    // das frisch Zugestellte. Genau daran ging der Titel verloren. Deshalb trägt
    // jeder Zustand eine Revision: der Store gilt nur, wenn er nicht älter ist
    // als der eigene Stand. So gehen Änderungen einer zweiten TUI nicht
    // verloren, und der eigene Fortschritt wird nicht zurückgedreht.
    const [latest, setLatest] = createSignal(cleaned);
    const advance = next => {
      setLatest(() => next);
      return write(draft => {
        draft.state = next;
      }).then(() => undefined, () => undefined);
    };

    /** Der Zustand, auf den das nächste Ereignis trifft. */
    const currentState = () => stored.state.rev > latest().rev ? stored.state : latest();
    const accept = event => {
      const before = currentState();
      const after = apply(before, event);
      if (after === before) return;
      void advance(after);
      nudge();
    };

    /** Übersetzt ein OpenCode-Ereignis in unsere Sprache und wendet es an. */
    const translate = (type, event) => {
      const data = event.data ?? {};
      const session = typeof data.sessionID === "string" ? data.sessionID : undefined;
      const stamp = event.created;
      const time = typeof stamp === "number" ? stamp : Date.now();
      const isChild = session !== undefined && session !== context.data.session.root(session);
      switch (type) {
        case "session.execution.started":
          {
            if (!session) return;
            const identifier = event.id;
            const id = typeof identifier === "string" ? identifier : `${session}:${time}`;
            accept({
              kind: "run-started",
              id,
              session,
              time,
              isChild
            });
            return;
          }
        case "session.execution.succeeded":
          {
            if (!session) return;
            accept({
              kind: "run-ended",
              session,
              time,
              result: "done",
              isChild
            });
            return;
          }
        case "session.execution.failed":
          {
            if (!session) return;
            accept({
              kind: "run-ended",
              session,
              time,
              result: "error",
              isChild
            });
            return;
          }
        case "session.execution.interrupted":
          {
            if (!session) return;
            const raw = data.reason;
            const known = ["user", "shutdown", "superseded", "inactivity"];
            const reason = known.find(value => value === raw) ?? "user";
            accept({
              kind: "run-interrupted",
              session,
              time,
              reason,
              isChild
            });
            return;
          }
        case "session.inbox.enqueued":
          {
            // Der Host meldet den Prompt vor dem Lauf. Text und Zustellart werden
            // vorgemerkt, damit der Eintrag beim Start schon seinen Titel kennt.
            const id = deliveryID(event);
            if (!id || !session) return;
            const item = data.item ?? {};
            const delivery = item.delivery === "steer" ? "steer" : "queue";
            accept({
              kind: "prompt-queued",
              deliveryID: id,
              session,
              text: promptText(event),
              delivery
            });
            return;
          }
        case "session.inbox.delivered":
          {
            const id = deliveryID(event);
            if (!session || !id) return;
            // Die Zustellart vom Vormerken bleibt maßgeblich; das Ereignis selbst
            // trägt sie nicht.
            const queued = currentState().pending[session] ?? [];
            const delivery = queued.find(item => item.id === id)?.delivery ?? "queue";
            accept({
              kind: "prompt-delivered",
              deliveryID: id,
              session,
              time,
              delivery,
              isChild
            });
            return;
          }
        case "session.inbox.delivery.changed":
          {
            // Nur eine Umstellung auf `steer` verlängert die laufende Aufgabe.
            const id = deliveryID(event);
            if (!session || !id || data.delivery !== "steer") return;
            accept({
              kind: "prompt-delivered",
              deliveryID: id,
              session,
              time,
              delivery: "steer",
              isChild
            });
            return;
          }
        case "session.inbox.cancelled":
          {
            // Ein verworfener Prompt benennt keinen Lauf.
            const id = deliveryID(event);
            if (!session || !id) return;
            accept({
              kind: "prompt-cancelled",
              deliveryID: id,
              session
            });
            return;
          }
        case "session.permissions":
          {
            if (!session) return;
            const open = Array.isArray(data.permissions) && data.permissions.length > 0;
            accept({
              kind: open ? "waiting-started" : "waiting-ended",
              session,
              time
            });
            return;
          }
        case "session.deleted":
          {
            if (!session) return;
            accept({
              kind: "session-deleted",
              session
            });
            return;
          }
        case "session.step.started":
        case "session.step.ended":
        case "session.tool.called":
        case "session.tool.success":
        case "session.tool.failed":
        case "session.status":
        case "session.retry.scheduled":
          {
            // Lebenszeichen halten die Dauer eines liegengebliebenen Laufs ehrlich.
            if (!session) return;
            accept({
              kind: "heartbeat",
              session,
              time,
              isChild
            });
            return;
          }
        default:
          return;
      }
    };
    const subscription = context.data.listen(event => {
      const type = event.details?.type;
      if (!type) return;
      translate(type, event.details);
    });
    const ticker = setInterval(nudge, TICK_MS);
    onCleanup(() => {
      clearInterval(ticker);
      subscription();
    });

    // ---------------------------------------------------------------------
    // Darstellung
    // ---------------------------------------------------------------------

    function Row(props) {
      const duration = createMemo(() => formatDuration(durationMs(props.entry, props.now)));
      const running = createMemo(() => props.entry.status === "running");
      const waiting = createMemo(() => props.entry.waitingSince !== undefined);
      const status = createMemo(() => statusLabel(props.entry.status));
      const note = createMemo(() => waitingNote(props.entry, props.now));
      const title = createMemo(() => {
        const space = Math.max(6, props.width - TITLE_SPACE);
        const text = props.entry.title;
        return text.length <= space ? text : `${text.slice(0, space - 1).trimEnd()}…`;
      });
      const color = createMemo(() => {
        switch (props.entry.status) {
          case "error":
            return context.theme.hue.red[500];
          case "aborted":
          case "superseded":
          case "ended":
          case "inactive":
          case "clockSkew":
            return context.theme.hue.orange[500];
          default:
            return context.theme.text.muted;
        }
      });
      return (() => {
        var _el$ = _$createElement("box"),
          _el$2 = _$createElement("box"),
          _el$3 = _$createElement("text"),
          _el$4 = _$createElement("text"),
          _el$5 = _$createTextNode(` `);
        _$insertNode(_el$, _el$2);
        _$setProp(_el$, "flexDirection", "column");
        _$insertNode(_el$2, _el$3);
        _$insertNode(_el$2, _el$4);
        _$setProp(_el$2, "flexDirection", "row");
        _$insert(_el$3, () => duration().padStart(7));
        _$insertNode(_el$4, _el$5);
        _$insert(_el$4, title, null);
        _$insert(_el$, _$createComponent(Show, {
          get when() {
            return waiting() || status() !== undefined || note() !== undefined;
          },
          get children() {
            var _el$6 = _$createElement("box");
            _$setProp(_el$6, "flexDirection", "row");
            _$setProp(_el$6, "paddingLeft", 8);
            _$insert(_el$6, _$createComponent(Show, {
              get when() {
                return waiting();
              },
              get children() {
                var _el$7 = _$createElement("text");
                _$insert(_el$7, WAITING_HINT);
                _$effect(_$p => _$setProp(_el$7, "fg", context.theme.hue.orange[500], _$p));
                return _el$7;
              }
            }), null);
            _$insert(_el$6, _$createComponent(Show, {
              get when() {
                return _$memo(() => !!!waiting())() && status() !== undefined;
              },
              get children() {
                var _el$8 = _$createElement("text");
                _$insert(_el$8, status);
                _$effect(_$p => _$setProp(_el$8, "fg", color(), _$p));
                return _el$8;
              }
            }), null);
            _$insert(_el$6, _$createComponent(Show, {
              get when() {
                return note() !== undefined;
              },
              get children() {
                var _el$9 = _$createElement("text"),
                  _el$0 = _$createTextNode(` · `);
                _$insertNode(_el$9, _el$0);
                _$insert(_el$9, note, null);
                _$effect(_$p => _$setProp(_el$9, "fg", context.theme.text.muted, _$p));
                return _el$9;
              }
            }), null);
            return _el$6;
          }
        }), null);
        _$effect(_p$ => {
          var _v$ = running() ? context.theme.hue.accent[500] : context.theme.text.base,
            _v$2 = context.theme.text.base;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$4, "fg", _v$2, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$;
      })();
    }
    function Block(props) {
      const [width, setWidth] = createSignal(0);
      const now = createMemo(() => {
        tick();
        return Date.now();
      });
      const list = createMemo(() => visibleEntries(currentState(), props.sessionID));
      const running = createMemo(() => runningEntry(currentState(), props.sessionID));
      const numbers = createMemo(() => stats(currentState().entries, now()));
      const summary = createMemo(() => summaryLine(numbers()));

      // Eine Kind-Sitzung zeigt nichts: die Liste gehört zur Wurzel-Aufgabe.
      const visible = createMemo(() => {
        if (props.sessionID !== context.data.session.root(props.sessionID)) return false;
        return list().length > 0 && width() >= MIN_WIDTH;
      });
      return (() => {
        var _el$1 = _$createElement("box");
        _$use(element => {
          const box = element;
          const measure = () => setWidth(box.width ?? 0);
          box.onSizeChange = measure;
          measure();
        }, _el$1);
        _$setProp(_el$1, "flexDirection", "column");
        _$setProp(_el$1, "paddingTop", 1);
        _$setProp(_el$1, "flexShrink", 0);
        _$insert(_el$1, _$createComponent(Show, {
          get when() {
            return visible();
          },
          get children() {
            return [(() => {
              var _el$10 = _$createElement("text");
              _$insertNode(_el$10, _$createTextNode(`Durations`));
              _$effect(_$p => _$setProp(_el$10, "fg", context.theme.text.muted, _$p));
              return _el$10;
            })(), _$createComponent(Show, {
              get when() {
                return running() !== undefined;
              },
              get children() {
                return _$createComponent(Row, {
                  get entry() {
                    return running();
                  },
                  get now() {
                    return now();
                  },
                  get width() {
                    return width();
                  }
                });
              }
            }), _$createComponent(For, {
              get each() {
                return list().filter(entry => entry.status !== "running");
              },
              children: entry => _$createComponent(Row, {
                entry: entry,
                get now() {
                  return now();
                },
                get width() {
                  return width();
                }
              })
            }), _$createComponent(Show, {
              get when() {
                return summary() !== undefined;
              },
              get children() {
                var _el$12 = _$createElement("text");
                _$insert(_el$12, summary);
                _$effect(_$p => _$setProp(_el$12, "fg", context.theme.text.muted, _$p));
                return _el$12;
              }
            })];
          }
        }));
        return _el$1;
      })();
    }
    const slot = context.ui.slot({
      append: "sidebar.content",
      render: input => _$createComponent(Block, {
        get sessionID() {
          return input.sessionID;
        }
      })
    });
    onCleanup(slot);

    // ---------------------------------------------------------------------
    // Befehle
    // ---------------------------------------------------------------------

    const reset = async (all, session) => {
      if (!all && !session) {
        context.ui.toast.show({
          message: "Keine Sitzung geöffnet",
          variant: "warning"
        });
        return;
      }
      const confirmed = await context.ui.dialog.confirm({
        title: "Laufzeiten zurücksetzen",
        message: all ? "Alle gespeicherten Laufzeiten verwerfen?" : "Laufzeiten dieser Sitzung verwerfen?"
      });
      if (!confirmed) return;
      // Zurücksetzen behält die Revision bei, damit die Anzeige sofort folgt.
      await advance(all ? emptyState() : clearSession(currentState(), session));
      nudge();
      context.ui.toast.show({
        message: "Laufzeiten zurückgesetzt",
        variant: "info"
      });
    };
    const currentSession = () => {
      const route = context.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };
    context.keymap.layer(() => ({
      // Ohne `mode` landet die Ebene im Standardmodus `base`, der nur bei
      // leerem Eingabefeld greift. Palettensuche und Slash-Vervollständigung
      // laufen dagegen im globalen Modus, deshalb blieben beide Befehle dort
      // unsichtbar.
      mode: "global",
      commands: [{
        id: "task-timer.reset",
        title: "Laufzeiten zurücksetzen",
        group: "Laufzeiten",
        palette: true,
        slash: {
          name: "ott-reset"
        },
        run: () => {
          void reset(false, currentSession());
        }
      }, {
        id: "task-timer.reset-all",
        title: "Laufzeiten aller Sitzungen zurücksetzen",
        group: "Laufzeiten",
        palette: true,
        slash: {
          name: "ott-reset-all"
        },
        run: () => {
          void reset(true, currentSession());
        }
      }]
    }));
  }
});
