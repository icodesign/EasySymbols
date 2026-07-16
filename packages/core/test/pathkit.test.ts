import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { SVGPathData } from "svg-pathdata";
import { describe, expect, it } from "vitest";

import { createPathKitGeometryEngine, type GeometryEngine } from "../src/index.js";

let geometryPromise: Promise<GeometryEngine> | undefined;

function geometryEngine(): Promise<GeometryEngine> {
  geometryPromise ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("pathkit-wasm/bin/pathkit.wasm");
    return createPathKitGeometryEngine(await readFile(wasmPath));
  })();
  return geometryPromise;
}

function bounds(pathData: string) {
  return new SVGPathData(pathData).getBounds();
}

describe("PathKit stroke expansion", () => {
  it("maps lowercase SVG round caps to PathKit for calendar-days dots and binding lines", async () => {
    const geometry = await geometryEngine();

    // Actual centerline fragments from calendar-days.svg. A butt cap
    // turns the 0.01-unit dot into an almost invisible 0.01 x 2 rectangle;
    // a round cap must produce the intended approximately 2 x 2 dot.
    const dot = bounds(
      geometry.expandStroke("M8 14h.01", {
        cap: "round",
        join: "round",
        miterLimit: 4,
        width: 2,
      }),
    );
    expect(dot.minX).toBeCloseTo(7);
    expect(dot.maxX).toBeCloseTo(9.01);
    expect(dot.minY).toBeCloseTo(13);
    expect(dot.maxY).toBeCloseTo(15);

    // Round caps must also extend the calendar's two vertical binding lines
    // past their centerline endpoints, rather than leaving flat butt ends.
    const bindingLine = bounds(
      geometry.expandStroke("M8 2v4", {
        cap: "round",
        join: "round",
        miterLimit: 4,
        width: 2,
      }),
    );
    expect(bindingLine.minX).toBeCloseTo(7);
    expect(bindingLine.maxX).toBeCloseTo(9);
    expect(bindingLine.minY).toBeCloseTo(1);
    expect(bindingLine.maxY).toBeCloseTo(7);
  });

  it("maps lowercase SVG round joins to PathKit", async () => {
    const geometry = await geometryEngine();
    const common = {
      cap: "butt" as const,
      miterLimit: 4,
      width: 2,
    };
    const round = bounds(
      geometry.expandStroke("M2 10L10 2L18 10", {
        ...common,
        join: "round",
      }),
    );
    const miter = bounds(
      geometry.expandStroke("M2 10L10 2L18 10", {
        ...common,
        join: "miter",
      }),
    );

    // A round join rounds off the tip, whereas a miter projects it upward.
    expect(round.minY).toBeGreaterThan(miter.minY + 0.2);
    expect(round.minY).toBeCloseTo(1);
    expect(miter.minY).toBeCloseTo(0.585786, 5);
  });
});
