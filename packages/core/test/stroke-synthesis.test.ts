import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SF_WEIGHT_STROKE_MULTIPLIERS,
  DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS,
  createPathKitGeometryEngine,
  inspectGeometrySource,
  synthesizeCenterlineMasters,
  type CenterlineSynthesisResult,
  type GeometryEngine,
} from "../src/index.js";

const centerlineIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -8 36 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="bevel">
  <g transform="scale(1.25 .8)">
    <path id="play" d="M2 4L20 11L2 18Z"/>
  </g>
</svg>`;

function recordingGeometry(): {
  calls: Array<{ pathData: string; width: number; cap: string; join: string }>;
  geometry: GeometryEngine;
} {
  const calls: Array<{
    pathData: string;
    width: number;
    cap: string;
    join: string;
  }> = [];
  return {
    calls,
    geometry: {
      convertEvenOddToWinding(pathData) {
        return pathData;
      },
      expandStroke(pathData, options) {
        calls.push({
          pathData,
          width: options.width,
          cap: options.cap,
          join: options.join,
        });
        // A deterministic finite outline keeps this unit test independent of
        // the WASM implementation while input semantics stay observable.
        return "M0 0H1V1H0Z";
      },
    },
  };
}

async function pathKitGeometry(): Promise<GeometryEngine> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("pathkit-wasm/bin/pathkit.wasm");
  return createPathKitGeometryEngine(await readFile(wasmPath));
}

function masterWidth(
  result: CenterlineSynthesisResult,
  variant: string,
): number {
  const paths = result.normalized.masters.find((master) => master.variant === variant)?.paths;
  if (!paths?.length) throw new Error(`Missing ${variant} master.`);
  return Math.max(...paths.map((path) => path.maxX)) -
    Math.min(...paths.map((path) => path.minX));
}

describe("SVG geometry profiles", () => {
  it("recognizes arbitrary-canvas centerline strokes without library heuristics", () => {
    expect(inspectGeometrySource(centerlineIcon).sourceProfile).toEqual({
      canGenerateVariants: true,
      canGenerateApproximateScaleVariants: false,
      geometryModel: "centerline-stroke",
      strokeSummary: {
        caps: ["square"],
        joins: ["bevel"],
        widths: [2],
      },
    });
  });

  it("distinguishes filled outlines and mixed geometry from editable centerlines", () => {
    expect(
      inspectGeometrySource(
        `<svg viewBox="0 0 15 15"><path d="M1 1H14V14H1Z"/></svg>`,
      ).sourceProfile,
    ).toMatchObject({
      canGenerateVariants: false,
      geometryModel: "filled-outline",
    });
    expect(
      inspectGeometrySource(
        `<svg viewBox="0 0 15 15" stroke="black"><path d="M1 1H14V14H1Z"/><path fill="none" d="M2 2H13"/></svg>`,
      ).sourceProfile,
    ).toMatchObject({
      canGenerateVariants: false,
      geometryModel: "mixed",
    });
  });
});

describe("centerline synthesis", () => {
  it("synthesizes 27 explicit masters while preserving local cap, join, and transform ownership", () => {
    const { calls, geometry } = recordingGeometry();
    const result = synthesizeCenterlineMasters(centerlineIcon, geometry);

    expect(result.provenance).toBe("synthesized");
    expect(result.normalized.masters).toHaveLength(27);
    expect(result.normalized.masters.map((master) => master.variant)).toEqual([
      "Ultralight-S", "Ultralight-M", "Ultralight-L",
      "Thin-S", "Thin-M", "Thin-L",
      "Light-S", "Light-M", "Light-L",
      "Regular-S", "Regular-M", "Regular-L",
      "Medium-S", "Medium-M", "Medium-L",
      "Semibold-S", "Semibold-M", "Semibold-L",
      "Bold-S", "Bold-M", "Bold-L",
      "Heavy-S", "Heavy-M", "Heavy-L",
      "Black-S", "Black-M", "Black-L",
    ]);
    expect(calls).toHaveLength(27);
    expect(calls.every((call) => call.cap === "square")).toBe(true);
    expect(calls.every((call) => call.join === "bevel")).toBe(true);

    // The geometry engine receives the untransformed local centerline. The
    // original non-uniform transform is applied only after local outlining.
    expect(calls[0]?.pathData).toBe("M2 4L20 11L2 18Z");
    const regularCalls = calls.slice(9, 12);
    expect(regularCalls.map((call) => call.width)).toEqual([
      2 / DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.S,
      2,
      2 / DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.L,
    ]);
    expect(result.weightStrokeFactors.Regular).toBe(1);
    expect(result.weightStrokeFactors.Black).toBe(
      DEFAULT_SF_WEIGHT_STROKE_MULTIPLIERS.Black,
    );
  });

  it("preserves proportional mixed source stroke widths", () => {
    const source = `<svg viewBox="0 0 30 20" fill="none" stroke="black" stroke-linecap="round"><path stroke-width="1" d="M2 4H28"/><path stroke-width="2" d="M2 16H28"/></svg>`;
    const { calls, geometry } = recordingGeometry();
    const result = synthesizeCenterlineMasters(source, geometry, {
      strokeScale: 1.5,
    });

    expect(result.normalized.masters).toHaveLength(27);
    // Regular-M is the 11th generated variant, with two source paths.
    expect(calls.slice(20, 22).map((call) => call.width)).toEqual([1.5, 3]);
  });

  it("accepts a complete calibration profile and reference master", () => {
    const { geometry } = recordingGeometry();
    const profile = {
      Ultralight: 0.4,
      Thin: 0.6,
      Light: 0.8,
      Regular: 1,
      Medium: 1.1,
      Semibold: 1.2,
      Bold: 1.3,
      Heavy: 1.4,
      Black: 1.5,
    } as const;
    const result = synthesizeCenterlineMasters(centerlineIcon, geometry, {
      referenceScale: "L",
      referenceWeight: "Bold",
      weightStrokeMultipliers: profile,
    });

    expect(result.referenceScale).toBe("L");
    expect(result.referenceWeight).toBe("Bold");
    expect(result.weightStrokeFactors.Ultralight).toBeCloseTo(0.4 / 1.3);
    expect(result.weightStrokeFactors.Black).toBeCloseTo(1.5 / 1.3);
  });

  it("rejects incomplete runtime calibration data at the profile boundary", () => {
    const { geometry } = recordingGeometry();
    expect(() =>
      synthesizeCenterlineMasters(centerlineIcon, geometry, {
        weightStrokeMultipliers: { Regular: 1 } as never,
      }),
    ).toThrow("weightStrokeMultipliers.Ultralight");
  });

  it("expands arbitrary-canvas masters through the production PathKit engine", async () => {
    const result = synthesizeCenterlineMasters(
      centerlineIcon,
      await pathKitGeometry(),
    );

    expect(result.normalized.masters.every((master) => master.paths.length === 1)).toBe(true);
    expect(masterWidth(result, "Regular-S")).toBeLessThan(
      masterWidth(result, "Regular-M"),
    );
    expect(masterWidth(result, "Regular-M")).toBeLessThan(
      masterWidth(result, "Regular-L"),
    );
  });
});
