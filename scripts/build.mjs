// Baut `src/tui.tsx` zu `dist/tui.js`.
//
// Warum ein Build nötig ist: OpenCodes Solid-JSX-Transform überspringt Pfade mit
// `/node_modules/`, damit fremde Pakete nicht angefasst werden. Ein
// veröffentlichtes Plugin liegt aber genau dort. Ohne vorgebautes `dist/` würde
// sein JSX als React-JSX übersetzt und der Ladevorgang scheitert an einem
// fehlenden `react`.
//
// Der Host ersetzt zur Laufzeit zwei Modulnamen durch seine eigenen Kopien:
// `opentui:runtime-module:@opentui/solid` und `solid-js`. Deshalb werden diese
// beiden Importe umgeschrieben; alles andere bleibt ein normaler Pfad.
//
// Aufruf: node scripts/build.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { transformAsync } from "@babel/core";
import presetTypeScript from "@babel/preset-typescript";
import solid from "babel-preset-solid";

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quelleTui = resolve(wurzel, "src/tui.tsx");
const quelleLogik = resolve(wurzel, "src/laufzeit.ts");
const zielTui = resolve(wurzel, "dist/tui.js");
const zielLogik = resolve(wurzel, "dist/laufzeit.js");

/** Der Host löst diese Namen über seine eingebauten Kopien auf. */
const LAUFZEIT_MODULE = {
  "@opentui/solid": "opentui:runtime-module:%40opentui%2Fsolid",
  "solid-js": "opentui:runtime-module:solid-js",
};

const code = await readFile(quelleTui, "utf8");

const ergebnis = await transformAsync(code, {
  filename: quelleTui,
  configFile: false,
  babelrc: false,
  presets: [
    [presetTypeScript, {}],
    [solid, { moduleName: "@opentui/solid", generate: "universal" }],
  ],
  plugins: [
    {
      name: "opencode-runtime-module",
      visitor: {
        ImportDeclaration(pfad) {
          const ersatz = LAUFZEIT_MODULE[pfad.node.source.value];
          if (ersatz) pfad.node.source.value = ersatz;
        },
        ExportNamedDeclaration(pfad) {
          const quelleName = pfad.node.source?.value;
          const ersatz = quelleName ? LAUFZEIT_MODULE[quelleName] : undefined;
          if (ersatz && pfad.node.source) pfad.node.source.value = ersatz;
        },
      },
    },
  ],
});

if (!ergebnis?.code)
  throw new Error("Der Solid-Transform hat keinen Code erzeugt.");

// Der Import in dist/tui.js zeigt auf die gebaute Logik, nicht auf die Quelle.
const ausgabeTui = ergebnis.code.replace(/\.\/laufzeit\.ts/g, "./laufzeit.js");

await mkdir(dirname(zielTui), { recursive: true });
await writeFile(zielTui, `${ausgabeTui}\n`, "utf8");

// Die Messlogik ist reines TypeScript ohne JSX und wird nur enttypt.
const logik = await readFile(quelleLogik, "utf8");
const logikErgebnis = await transformAsync(logik, {
  filename: quelleLogik,
  configFile: false,
  babelrc: false,
  presets: [[presetTypeScript, {}]],
});

if (!logikErgebnis?.code)
  throw new Error("Der TypeScript-Transform hat keinen Code erzeugt.");
await writeFile(zielLogik, `${logikErgebnis.code}\n`, "utf8");

console.log(`dist/tui.js und dist/laufzeit.js geschrieben`);
