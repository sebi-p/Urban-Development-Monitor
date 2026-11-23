// Files the site needs from packages at fixed paths. Run before `next dev` / `next build`; the
// copies are gitignored.
// - MapLibre finds its web worker relative to its own module URL, which breaks once the bundler
//   moves the module: the self-contained worker is served from public/maplibre/.
// - The share image (next/og) reads Inter from disk. pnpm links packages through symlinks that
//   aren't in the deployment, so the four files it needs are copied to assets/og-fonts/.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = dirname(fileURLToPath(import.meta.resolve("maplibre-gl")));
const out = fileURLToPath(new URL("../public/maplibre/", import.meta.url));
mkdirSync(out, { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), join(out, "maplibre-gl-worker.mjs"));
console.log("copied maplibre-gl-worker.mjs to public/maplibre/");

const inter = join(
  dirname(fileURLToPath(import.meta.resolve("@fontsource/inter/package.json"))),
  "files",
);
const fonts = fileURLToPath(new URL("../assets/og-fonts/", import.meta.url));
mkdirSync(fonts, { recursive: true });
for (const subset of ["latin", "latin-ext"]) {
  for (const weight of [400, 700]) {
    const name = `inter-${subset}-${weight}-normal.woff`;
    copyFileSync(join(inter, name), join(fonts, name));
  }
}
console.log("copied 4 Inter files to assets/og-fonts/");
