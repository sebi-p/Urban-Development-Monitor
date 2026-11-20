// MapLibre finds its web worker relative to its own module URL, which breaks once the bundler moves
// the module. Copy the self-contained worker into public/ so it's served from a fixed path.
// Run before `next dev` / `next build`; the copy is gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = dirname(fileURLToPath(import.meta.resolve("maplibre-gl")));
const out = fileURLToPath(new URL("../public/maplibre/", import.meta.url));
mkdirSync(out, { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
console.log("copied maplibre-gl-worker.mjs to public/maplibre/");
