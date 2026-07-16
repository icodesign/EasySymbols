import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  compareRgbaImages,
  convertSvg,
  createPathKitGeometryEngine,
  synthesizeCenterlineMasters,
  type GeometryEngine,
  type RgbaImage,
} from "../src/index.js";

let geometry: GeometryEngine;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  geometry = await createPathKitGeometryEngine(
    await readFile(require.resolve("pathkit-wasm/bin/pathkit.wasm")),
  );
});

function renderSvg(svg: string, width = 32): RgbaImage {
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  }).render();
  const result: RgbaImage = {
    width: rendered.width,
    height: rendered.height,
    pixels: new Uint8Array(rendered.pixels),
  };
  rendered.free();
  return result;
}

function image(width: number, height: number, pixels: number[]) {
  return { width, height, pixels: Uint8Array.from(pixels) };
}

function masterSvg(paths: Array<{ d: string }>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000">${paths.map((path) => `<path d="${path.d}"/>`).join("")}</svg>`;
}

function opaquePixelsInRegion(
  image: RgbaImage,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  let count = 0;
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] ?? 0 > 127) count += 1;
    }
  }
  return count;
}

describe("compareRgbaImages", () => {
  it("keeps a generated centerline Regular-M master pixel-equivalent to its source master", () => {
    const source = `<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>`;
    const sourceMaster = convertSvg(source, {}, geometry);
    const generated = convertSvg(source, { variants: "all" }, geometry);
    const generatedRegular = generated.artifact?.masterPreviews["Regular-M"]?.svg;

    expect(sourceMaster.artifact).toBeDefined();
    expect(generatedRegular).toBeDefined();
    const report = compareRgbaImages(
      renderSvg(sourceMaster.artifact?.previewSvg ?? ""),
      renderSvg(generatedRegular ?? ""),
    );
    expect(report.passed, JSON.stringify(report)).toBe(true);
    expect(report.differentPixels).toBe(0);
  });

  it("keeps the authored Medium master pixel-equivalent when approximate scales are enabled", () => {
    const source = `<svg viewBox="0 0 24 24" fill="black"><path d="M4 4H20V20H4Z"/><path d="M8 8H16V16H8Z" fill="white" fill-rule="evenodd"/></svg>`;
    const staticResult = convertSvg(source, {}, geometry);
    const approximateResult = convertSvg(
      source,
      { variants: "approximate-scales" },
      geometry,
    );
    const approximateMedium = approximateResult.artifact?.masterPreviews["Regular-M"];

    expect(staticResult.artifact).toBeDefined();
    expect(approximateMedium?.origin).toBe("authored");
    expect(approximateResult.artifact?.masterPreviews["Regular-S"]?.origin).toBe(
      "approximate",
    );
    expect(approximateResult.artifact?.masterPreviews["Regular-L"]?.origin).toBe(
      "approximate",
    );
    const report = compareRgbaImages(
      renderSvg(staticResult.artifact?.previewSvg ?? ""),
      renderSvg(approximateMedium?.svg ?? ""),
    );
    expect(report.passed, JSON.stringify(report)).toBe(true);
    expect(report.differentPixels).toBe(0);
  });

  it("keeps calendar-days round-cap dots and binding caps visible against the original SVG", async () => {
    const source = await readFile(
      new URL("../../../fixtures/svg-inputs/calendar-days.svg", import.meta.url),
      "utf8",
    );
    const synthesized = synthesizeCenterlineMasters(source, geometry);
    const regularMaster = synthesized.normalized.masters.find(
      (master) => master.variant === "Regular-M",
    );
    if (!regularMaster) throw new Error("Missing generated Regular-M calendar master.");

    const original = renderSvg(source, 240);
    const generated = renderSvg(masterSvg(regularMaster.paths), 240);
    const report = compareRgbaImages(original, generated, {
      channelTolerance: 12,
      // PathKit and resvg rasterize curve edges differently, but the whole
      // icon must remain closely aligned. This threshold leaves only that
      // edge antialiasing budget; a butt-cap dot regression is far larger.
      maxDifferentPixels: 1_000,
    });

    expect(report.passed, JSON.stringify(report)).toBe(true);
    expect(report.meanChannelDelta).toBeLessThan(0.3);
    // The first dot is centered around (8, 14), rendered at 10 pixels per
    // SVG unit. A butt-cap regression only paints a thin vertical sliver here;
    // correct round caps occupy the circular dot area.
    expect(opaquePixelsInRegion(generated, 68, 128, 92, 152)).toBeGreaterThan(200);
    // The first binding must visibly extend beyond its centerline endpoint at y=2.
    expect(opaquePixelsInRegion(generated, 68, 8, 92, 24)).toBeGreaterThan(50);
  });

  it("keeps the Codex foreground pixel-equivalent after semantic flattening", async () => {
    const original = await readFile(
      new URL("../../../fixtures/svg-inputs/codex-color.svg", import.meta.url),
      "utf8",
    );
    const foregroundPath = original.match(
      /<path d="([^"]+)" fill="url\([^)]*\)"\/>/,
    )?.[1];
    if (!foregroundPath) throw new Error("Codex fixture foreground path is missing.");

    // The reference keeps the original foreground geometry but expresses it in
    // the generated preview frame. The white canvas underlay and gradient color
    // are intentionally excluded because they are semantic conversion choices.
    const reference = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="411 266 108 90" fill="black"><path d="${foregroundPath}" transform="matrix(3.2666666667 0 0 3.2666666667 425.8 271.8)"/></svg>`;
    const result = convertSvg(original, { name: "codex" });

    expect(result.artifact).toBeDefined();
    const report = compareRgbaImages(
      renderSvg(reference),
      renderSvg(result.artifact?.previewSvg ?? ""),
      { channelTolerance: 16, maxDifferentPixels: 64 },
    );
    expect(report.passed, JSON.stringify(report)).toBe(true);
  });

  it("compares the source artwork with the converter preview at the symbol frame", () => {
    const original = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="411 266 108 90">
        <path d="M421 276H509V346H421Z" fill="#000"/>
      </svg>`;
    const result = convertSvg(original, { name: "pixel-check", padding: 0 });

    expect(result.artifact).toBeDefined();
    const report = compareRgbaImages(
      renderSvg(original),
      renderSvg(result.artifact?.previewSvg ?? ""),
    );
    expect(report.passed, JSON.stringify(report)).toBe(true);
    expect(report.differentPixels).toBe(0);
  });

  it("compares original and generated SVG renders pixel by pixel", () => {
    const original = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <rect x="4" y="4" width="24" height="24" fill="#000"/>
      </svg>`;
    const generated = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <path d="M4 4H28V28H4Z" fill="#000"/>
      </svg>`;

    const report = compareRgbaImages(renderSvg(original), renderSvg(generated));
    expect(report.passed, JSON.stringify(report)).toBe(true);
    expect(report.differentPixels).toBe(0);
  });

  it("passes identical RGBA renders", () => {
    const expected = image(1, 2, [0, 0, 0, 0, 255, 255, 255, 255]);
    const report = compareRgbaImages(expected, expected);

    expect(report).toMatchObject({
      dimensionsMatch: true,
      totalPixels: 2,
      differentPixels: 0,
      maxChannelDelta: 0,
      meanChannelDelta: 0,
      passed: true,
    });
  });

  it("counts each changed pixel once and reports channel deltas", () => {
    const expected = image(2, 1, [0, 0, 0, 255, 10, 20, 30, 255]);
    const actual = image(2, 1, [1, 2, 3, 255, 30, 20, 40, 255]);
    const report = compareRgbaImages(expected, actual);

    expect(report.differentPixels).toBe(2);
    expect(report.maxChannelDelta).toBe(20);
    expect(report.meanChannelDelta).toBe(4.5);
    expect(report.passed).toBe(false);
  });

  it("supports an antialiasing tolerance and a different-pixel budget", () => {
    const expected = image(2, 1, [0, 0, 0, 255, 10, 20, 30, 255]);
    const actual = image(2, 1, [1, 2, 3, 255, 30, 20, 40, 255]);

    expect(
      compareRgbaImages(expected, actual, {
        channelTolerance: 3,
        maxDifferentPixels: 1,
      }),
    ).toMatchObject({
      differentPixels: 1,
      passed: true,
    });
  });

  it("fails cleanly when rendered dimensions differ", () => {
    const report = compareRgbaImages(
      image(1, 1, [0, 0, 0, 255]),
      image(2, 1, [0, 0, 0, 255, 0, 0, 0, 255]),
    );

    expect(report).toMatchObject({
      dimensionsMatch: false,
      expectedWidth: 1,
      expectedHeight: 1,
      actualWidth: 2,
      actualHeight: 1,
      differentPixels: 0,
      passed: false,
    });
  });

  it("rejects malformed RGBA buffers", () => {
    expect(() =>
      compareRgbaImages(image(1, 1, [0, 0, 0]), image(1, 1, [0, 0, 0, 255])),
    ).toThrow(/must contain 4 RGBA channels/);
  });
});
