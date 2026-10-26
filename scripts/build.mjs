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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceTui = resolve(root, "src/tui.tsx");
const sourceLogic = resolve(root, "src/measurement.ts");
const targetTui = resolve(root, "dist/tui.js");
const targetLogic = resolve(root, "dist/measurement.js");

/** Der Host löst diese Namen über seine eingebauten Kopien auf. */
const RUNTIME_MODULES = {
  "@opentui/solid": "opentui:runtime-module:%40opentui%2Fsolid",
  "solid-js": "opentui:runtime-module:solid-js",
};

const code = await readFile(sourceTui, "utf8");

const result = await transformAsync(code, {
  filename: sourceTui,
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
        ImportDeclaration(path) {
          const replacement = RUNTIME_MODULES[path.node.source.value];
          if (replacement) path.node.source.value = replacement;
        },
        ExportNamedDeclaration(path) {
          const sourceName = path.node.source?.value;
          const replacement = sourceName
            ? RUNTIME_MODULES[sourceName]
            : undefined;
          if (replacement && path.node.source)
            path.node.source.value = replacement;
        },
      },
    },
  ],
});

if (!result?.code)
  throw new Error("Der Solid-Transform hat keinen Code erzeugt.");

// Der Import in dist/tui.js zeigt auf die gebaute Logik, nicht auf die Quelle.
const tuiOutput = result.code.replace(
  /\.\/measurement\.ts/g,
  "./measurement.js",
);

await mkdir(dirname(targetTui), { recursive: true });
await writeFile(targetTui, `${tuiOutput}\n`, "utf8");

// Die Messlogik ist reines TypeScript ohne JSX und wird nur enttypt.
const logic = await readFile(sourceLogic, "utf8");
const logicResult = await transformAsync(logic, {
  filename: sourceLogic,
  configFile: false,
  babelrc: false,
  presets: [[presetTypeScript, {}]],
});

if (!logicResult?.code)
  throw new Error("Der TypeScript-Transform hat keinen Code erzeugt.");
await writeFile(targetLogic, `${logicResult.code}\n`, "utf8");

console.log(`dist/tui.js und dist/measurement.js geschrieben`);
