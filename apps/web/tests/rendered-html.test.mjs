import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { defaultVariantMode } from "../src/variant-mode.ts";

async function builtApp() {
  const distDirectory = new URL("../dist/", import.meta.url);
  const html = await readFile(new URL("index.html", distDirectory), "utf8");
  const assetNames = await readdir(new URL("assets/", distDirectory));
  const scripts = await Promise.all(
    assetNames
      .filter((name) => name.endsWith(".js"))
      .map((name) =>
        readFile(
          join(new URL("assets/", distDirectory).pathname, name),
          "utf8",
        ),
      ),
  );
  return `${html}\n${scripts.join("\n")}`;
}

test("Vite builds the EasySymbols SPA shell and route metadata", async () => {
  const output = await builtApp();
  assert.match(output, /<div id="root"><\/div>/i);
  assert.match(output, /EasySymbols — SVG to SF Symbol/);
  assert.match(
    output,
    /Convert vector SVG artwork into an Xcode-ready custom SF Symbol/,
  );
  assert.doesNotMatch(
    output,
    /Make your icon|SVG → APPLE CUSTOM SYMBOL|AUTHORED VS GENERATED|How it works|Output formats/,
  );
  assert.match(output, /SVG to SF Symbols/);
  assert.match(
    output,
    /Convert any SVG into native SF Symbols with clean layers/,
  );
  assert.match(output, /Add SVG/);
  assert.match(output, /Drop an SVG here/);
  assert.doesNotMatch(
    output,
    /Browse files|Controls appear after the preview is ready/,
  );
  assert.match(output, /click anywhere to choose a file/);
  assert.match(output, /Try our logo/);
  assert.match(output, /Convert/);
  assert.match(output, /Support matrix/);
  assert.doesNotMatch(output, /RootStudio/);
  assert.doesNotMatch(output, /Limitations/);
  assert.match(output, /Paths & basic shapes/);
  assert.match(output, /What EasySymbols does/);
  assert.match(output, /Root SVGs need a valid viewBox/);
  assert.match(output, /SVG source/);
  assert.match(output, /Show SVG code/);
  assert.doesNotMatch(output, /Show SVG source/);
  assert.match(output, /Preparing preview/);
  assert.doesNotMatch(output, /Create SF Symbol/);
  assert.doesNotMatch(output, /Remove when detected/);
  assert.match(output, /Centerline synthesis/);
  assert.match(output, /All 27 SF variants/);
  assert.match(output, /Input weight/);
  assert.match(output, /Small scale/);
  assert.match(output, /Approximate S\/M\/L scales/);
  assert.match(output, /Authored/);
  assert.match(output, /Synthesized/);
  assert.match(output, /Approximate/);
  assert.match(output, /100% local conversion/);
  assert.doesNotMatch(output, /2 sizes/);
  assert.match(output, /Asset name/);
  assert.match(output, /Export Symbol SVG/);
  assert.match(output, /Export \.symbolset/);
  assert.match(output, /Xcode Assets/);
  assert.match(output, /Design/);
  assert.match(output, /Set the preview color and rendering style/);
  assert.match(
    output,
    /Shape the preview, variants, and rendering layers before export/,
  );
  assert.match(output, /Rendering mode/);
  assert.match(output, /Open preview color picker/);
  assert.match(output, /Organize your layers/);
  assert.match(output, /Drag strokes between Primary, Secondary, and Tertiary/);
  assert.match(output, /Multicolor/);
  assert.doesNotMatch(output, /Back to preview grid|Export details|Variant generation|Layer assignments/);
  assert.doesNotMatch(output, /Preview tint hex/);
  assert.doesNotMatch(output, /Preview tint presets/);
  assert.doesNotMatch(output, /preview-checkerboard/);
  assert.doesNotMatch(output, /Convert to SF Symbol/);
  assert.match(output, /\/og\.png/);
  assert.match(output, /\/logo\.svg/);
  assert.doesNotMatch(
    output,
    /next\/headers|vinext|codex-preview|Your site is taking shape|react-loading-skeleton/i,
  );
});

test("new SVGs default to the generation mode supported by their geometry", () => {
  assert.equal(
    defaultVariantMode({
      canGenerateVariants: false,
      canGenerateApproximateScaleVariants: true,
      geometryModel: "filled-outline",
    }),
    "approximate-scales",
  );
  assert.equal(
    defaultVariantMode({
      canGenerateVariants: false,
      canGenerateApproximateScaleVariants: true,
      geometryModel: "mixed",
    }),
    "approximate-scales",
  );
  assert.equal(
    defaultVariantMode({
      canGenerateVariants: true,
      canGenerateApproximateScaleVariants: false,
      geometryModel: "centerline-stroke",
    }),
    "all",
  );
  assert.equal(defaultVariantMode(undefined), "authored");
});
