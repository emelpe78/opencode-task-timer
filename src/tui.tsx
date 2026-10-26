// OpenCode-2-TUI-Plugin: Laufzeiten je Aufgabe in der Seitenleiste.
//
// Diese Datei verdrahtet die OpenCode-Ereignisse mit der reinen Messlogik aus
// `laufzeit.ts` und rendert den Block. Die Wahrheit über die Messung liegt in
// `laufzeit.ts` und ist dort durch Tests belegt; hier steht nur Übersetzung und
// Darstellung.
//
// Messvertrag siehe README, Abschnitt "Was gemessen wird".

import { Plugin } from "@opencode/plugin/tui";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";

import {
  anwenden,
  dauerMs,
  formatiereDauer,
  laufenderEintrag,
  leererZustand,
  raeumeAuf,
  schliesseLiegengebliebeneAb,
  sichtbareEintraege,
  statistik,
  statusText,
  summenzeile,
  warteAusweis,
  type Eintrag,
  type Ereignis,
  type Unterbrechungsgrund,
  type Zustand,
} from "./laufzeit.ts";

/** Speicherschlüssel im durabelen Host-Store. */
const SPEICHER = "laufzeiten";
/** Unter dieser Breite wird der Block ausgeblendet statt unleserlich zu werden. */
const MIN_BREITE = 22;
/** Takt der Live-Anzeige. */
const TAKT_MS = 1_000;
/** Ab hier wird der Titel gekürzt, damit die Zeile in die Spalte passt. */
const TITEL_PLATZ = 12;

type Speicher = { zustand: Zustand };

/** Liest einen Textpfad defensiv, weil die Payload-Form zwischen Versionen wechselt. */
function textAus(wert: unknown, pfad: string[]): string | undefined {
  let laufend: unknown = wert;
  for (const teil of pfad) {
    if (laufend === null || typeof laufend !== "object") return undefined;
    laufend = (laufend as Record<string, unknown>)[teil];
  }
  return typeof laufend === "string" ? laufend : undefined;
}

/**
 * Prompt-Text eines Zustellungs-Ereignisses. Die Form ist je nach Version
 * `{ item: { type, payload: { text } } }` oder `{ item: { text } }`, deshalb
 * werden beide Wege versucht.
 */
function promptText(ereignis: unknown): string {
  for (const pfad of [
    ["data", "item", "payload", "text"],
    ["data", "item", "text"],
    ["data", "text"],
    ["item", "payload", "text"],
    ["item", "text"],
  ]) {
    const text = textAus(ereignis, pfad);
    if (text !== undefined) return text;
  }
  return "";
}

function zustellID(ereignis: unknown): string | undefined {
  for (const pfad of [
    ["data", "inboxID"],
    ["data", "item", "id"],
    ["data", "item", "payload", "id"],
    ["inboxID"],
  ]) {
    const id = textAus(ereignis, pfad);
    if (id !== undefined) return id;
  }
  return undefined;
}

export default Plugin.define({
  id: "task-timer",
  async setup(context) {
    // Beim Start liegengebliebene Läufe abschließen und aufräumen, damit eine
    // über Nacht geschlossene Sitzung keine absurde Laufzeit behauptet.
    const [gespeichert, schreibe] = context.storage.store<Speicher>(SPEICHER, {
      initial: { zustand: leererZustand() },
    });

    const bereinigt = raeumeAuf(schliesseLiegengebliebeneAb(gespeichert.zustand), Date.now());
    if (bereinigt !== gespeichert.zustand) {
      await schreibe((entwurf) => {
        entwurf.zustand = bereinigt;
      });
    }

    // Ein Taktzähler stößt die sekündliche Neuberechnung an. Der Zustand selbst
    // ist der reaktive Store, deshalb genügt ein Zähler ohne Wert.
    const [takt, setTakt] = createSignal(0);
    const stoerung = (): void => setTakt((wert) => wert + 1);

    const annehmen = (ereignis: Ereignis): void => {
      const vorher = gespeichert.zustand;
      const nachher = anwenden(vorher, ereignis);
      if (nachher === vorher) return;
      void schreibe((entwurf) => {
        entwurf.zustand = nachher;
      });
      stoerung();
    };

    /** Übersetzt ein OpenCode-Ereignis in unsere Sprache und wendet es an. */
    const uebersetze = (typ: string, ereignis: unknown): void => {
      const daten = (ereignis as { data?: Record<string, unknown> }).data ?? {};
      const sitzung = typeof daten.sessionID === "string" ? daten.sessionID : undefined;
      const stempel = (ereignis as { created?: unknown }).created;
      const zeit = typeof stempel === "number" ? stempel : Date.now();
      const istKind = sitzung !== undefined && sitzung !== context.data.session.root(sitzung);

      switch (typ) {
        case "session.execution.started": {
          if (!sitzung) return;
          const kennung = (ereignis as { id?: unknown }).id;
          const id = typeof kennung === "string" ? kennung : `${sitzung}:${zeit}`;
          annehmen({ art: "lauf-gestartet", id, sitzung, zeit, istKind });
          return;
        }
        case "session.execution.succeeded": {
          if (!sitzung) return;
          annehmen({ art: "lauf-beendet", sitzung, zeit, ergebnis: "fertig", istKind });
          return;
        }
        case "session.execution.failed": {
          if (!sitzung) return;
          annehmen({ art: "lauf-beendet", sitzung, zeit, ergebnis: "fehler", istKind });
          return;
        }
        case "session.execution.interrupted": {
          if (!sitzung) return;
          const roh = daten.reason;
          const bekannt: Unterbrechungsgrund[] = ["user", "shutdown", "superseded", "inactivity"];
          const grund = bekannt.find((wert) => wert === roh) ?? "user";
          annehmen({ art: "lauf-unterbrochen", sitzung, zeit, grund, istKind });
          return;
        }
        case "session.inbox.enqueued": {
          const id = zustellID(ereignis);
          if (!id) return;
          annehmen({ art: "prompt-vorgemerkt", zustellID: id, text: promptText(ereignis) });
          return;
        }
        case "session.inbox.delivered": {
          const id = zustellID(ereignis);
          if (!sitzung || !id) return;
          annehmen({
            art: "prompt-zugestellt",
            zustellID: id,
            sitzung,
            zeit,
            zustellung: "queue",
            istKind,
          });
          return;
        }
        case "session.inbox.delivery.changed": {
          // Nur eine Umstellung auf `steer` verlängert die laufende Aufgabe.
          const id = zustellID(ereignis);
          if (!sitzung || !id || daten.delivery !== "steer") return;
          annehmen({
            art: "prompt-zugestellt",
            zustellID: id,
            sitzung,
            zeit,
            zustellung: "steer",
            istKind,
          });
          return;
        }
        case "session.permissions": {
          if (!sitzung) return;
          const offen = Array.isArray(daten.permissions) && daten.permissions.length > 0;
          annehmen({ art: offen ? "warten-gestartet" : "warten-beendet", sitzung, zeit });
          return;
        }
        case "session.deleted": {
          if (!sitzung) return;
          annehmen({ art: "sitzung-geloescht", sitzung });
          return;
        }
        case "session.step.started":
        case "session.step.ended":
        case "session.tool.called":
        case "session.tool.success":
        case "session.tool.failed":
        case "session.status":
        case "session.retry.scheduled": {
          // Lebenszeichen halten die Dauer eines liegengebliebenen Laufs ehrlich.
          if (!sitzung) return;
          annehmen({ art: "lebenszeichen", sitzung, zeit, istKind });
          return;
        }
        default:
          return;
      }
    };

    const abo = context.data.listen((ereignis) => {
      const typ = ereignis.details?.type;
      if (!typ) return;
      uebersetze(typ, ereignis.details);
    });

    const taktgeber = setInterval(stoerung, TAKT_MS);
    onCleanup(() => {
      clearInterval(taktgeber);
      abo();
    });

    // ---------------------------------------------------------------------
    // Darstellung
    // ---------------------------------------------------------------------

    function Zeile(props: { eintrag: Eintrag; jetzt: number; breite: number }) {
      const dauer = createMemo(() => formatiereDauer(dauerMs(props.eintrag, props.jetzt)));
      const laeuft = createMemo(() => props.eintrag.status === "laeuft");
      const wartet = createMemo(() => props.eintrag.warteSeit !== undefined);
      const status = createMemo(() => statusText(props.eintrag.status));
      const warte = createMemo(() => warteAusweis(props.eintrag, props.jetzt));
      const titel = createMemo(() => {
        const platz = Math.max(6, props.breite - TITEL_PLATZ);
        const text = props.eintrag.titel;
        return text.length <= platz ? text : `${text.slice(0, platz - 1).trimEnd()}…`;
      });
      const farbe = createMemo(() => {
        switch (props.eintrag.status) {
          case "fehler":
            return context.theme.hue.red[500];
          case "abgebrochen":
          case "verdraengt":
          case "beendet":
          case "inaktiv":
          case "zeitsprung":
            return context.theme.hue.orange[500];
          default:
            return context.theme.text.muted;
        }
      });

      return (
        <box flexDirection="column">
          <box flexDirection="row">
            <text fg={laeuft() ? context.theme.hue.accent[500] : context.theme.text.base}>
              {dauer().padStart(7)}
            </text>
            <text fg={context.theme.text.base}> {titel()}</text>
          </box>
          <Show when={wartet() || status() !== undefined || warte() !== undefined}>
            <box flexDirection="row" paddingLeft={8}>
              <Show when={wartet()}>
                <text fg={context.theme.hue.orange[500]}>wartet auf dich</text>
              </Show>
              <Show when={!wartet() && status() !== undefined}>
                <text fg={farbe()}>{status()}</text>
              </Show>
              <Show when={warte() !== undefined}>
                <text fg={context.theme.text.muted}> · {warte()}</text>
              </Show>
            </box>
          </Show>
        </box>
      );
    }

    function Block(props: { sessionID: string }) {
      const [breite, setBreite] = createSignal(0);

      const jetzt = createMemo(() => {
        takt();
        return Date.now();
      });
      const liste = createMemo(() => sichtbareEintraege(gespeichert.zustand, props.sessionID));
      const laufend = createMemo(() => laufenderEintrag(gespeichert.zustand, props.sessionID));
      const kennzahlen = createMemo(() => statistik(gespeichert.zustand.eintraege, jetzt()));
      const summe = createMemo(() => summenzeile(kennzahlen()));

      // Eine Kind-Sitzung zeigt nichts: die Liste gehört zur Wurzel-Aufgabe.
      const sichtbar = createMemo(() => {
        if (props.sessionID !== context.data.session.root(props.sessionID)) return false;
        return liste().length > 0 && breite() >= MIN_BREITE;
      });

      return (
        <box
          flexDirection="column"
          paddingTop={1}
          flexShrink={0}
          ref={(element) => {
            const kasten = element as unknown as { width: number; onSizeChange?: () => void };
            const messen = (): void => setBreite(kasten.width ?? 0);
            kasten.onSizeChange = messen;
            messen();
          }}
        >
          <Show when={sichtbar()}>
            <text fg={context.theme.text.muted}>Laufzeiten</text>
            <Show when={laufend() !== undefined}>
              <Zeile eintrag={laufend()!} jetzt={jetzt()} breite={breite()} />
            </Show>
            <For each={liste().filter((eintrag) => eintrag.status !== "laeuft")}>
              {(eintrag) => <Zeile eintrag={eintrag} jetzt={jetzt()} breite={breite()} />}
            </For>
            <Show when={summe() !== undefined}>
              <text fg={context.theme.text.muted}>{summe()}</text>
            </Show>
          </Show>
        </box>
      );
    }

    const abbruch = context.ui.slot({
      append: "sidebar.content",
      render: (eingabe) => <Block sessionID={eingabe.sessionID} />,
    });
    onCleanup(abbruch);

    // ---------------------------------------------------------------------
    // Befehle
    // ---------------------------------------------------------------------

    const leeren = async (alle: boolean, sitzung: string | undefined): Promise<void> => {
      if (!alle && !sitzung) {
        context.ui.toast.show({ message: "Keine Sitzung geöffnet", variant: "warning" });
        return;
      }
      const bestaetigt = await context.ui.dialog.confirm({
        title: "Laufzeiten zurücksetzen",
        message: alle
          ? "Alle gespeicherten Laufzeiten verwerfen?"
          : "Laufzeiten dieser Sitzung verwerfen?",
      });
      if (!bestaetigt) return;
      await schreibe((entwurf) => {
        entwurf.zustand = alle
          ? leererZustand()
          : {
              ...entwurf.zustand,
              eintraege: entwurf.zustand.eintraege.filter(
                (eintrag) => eintrag.sitzung !== sitzung,
              ),
            };
      });
      stoerung();
      context.ui.toast.show({ message: "Laufzeiten zurückgesetzt", variant: "info" });
    };

    const sitzungJetzt = (): string | undefined => {
      const route = context.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };

    context.keymap.layer(() => ({
      commands: [
        {
          id: "task-timer.reset",
          title: "Laufzeiten zurücksetzen",
          group: "Laufzeiten",
          palette: true,
          slash: { name: "laufzeiten-reset" },
          run: () => {
            void leeren(false, sitzungJetzt());
          },
        },
        {
          id: "task-timer.reset-all",
          title: "Laufzeiten aller Sitzungen zurücksetzen",
          group: "Laufzeiten",
          palette: true,
          slash: { name: "laufzeiten-reset-alle" },
          run: () => {
            void leeren(true, sitzungJetzt());
          },
        },
      ],
    }));
  },
});
