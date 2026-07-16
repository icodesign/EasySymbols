import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS,
  synthesizeApproximateScaleMasters,
  type ParsedSvg,
} from "../src/index.js";

const source: ParsedSvg = {
  diagnostics: [],
  width: 24,
  height: 24,
  sourceElementCount: 1,
  paths: [
    {
      d: "M4 6H20V18H4Z",
      minX: 4,
      minY: 6,
      maxX: 20,
      maxY: 18,
      sourceGroupIds: [],
      sourceOpacity: 1,
      sourceOrder: 0,
      sourcePaint: "black",
      sourceRole: "fill",
      sourceShapeId: "shape-1",
      variant: "Regular-M",
    },
  ],
  masters: [
    {
      origin: "authored",
      variant: "Regular-M",
      paths: [
        {
          d: "M4 6H20V18H4Z",
          minX: 4,
          minY: 6,
          maxX: 20,
          maxY: 18,
          sourceGroupIds: [],
          sourceOpacity: 1,
          sourceOrder: 0,
          sourcePaint: "black",
          sourceRole: "fill",
          sourceShapeId: "shape-1",
          variant: "Regular-M",
        },
      ],
    },
  ],
};

function width(result: ReturnType<typeof synthesizeApproximateScaleMasters>, variant: string): number {
  const paths = result.normalized.masters.find((master) => master.variant === variant)?.paths;
  if (!paths?.[0]) throw new Error(`Missing ${variant}.`);
  return paths[0].maxX - paths[0].minX;
}

describe("approximate optical-scale synthesis", () => {
  it("keeps its reference artwork verbatim and marks only scaled masters approximate", () => {
    const result = synthesizeApproximateScaleMasters(source);

    expect(result.provenance).toBe("approximate");
    expect(result.normalized.masters.map((master) => master.variant)).toEqual([
      "Regular-S",
      "Regular-M",
      "Regular-L",
    ]);
    expect(result.normalized.masters.map((master) => master.origin)).toEqual([
      "approximate",
      "authored",
      "approximate",
    ]);
    expect(result.normalized.masters[1]?.paths[0]?.d).toBe(source.paths[0]?.d);
    expect(width(result, "Regular-S") / width(result, "Regular-M")).toBeCloseTo(
      DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.S,
    );
    expect(width(result, "Regular-L") / width(result, "Regular-M")).toBeCloseTo(
      DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.L,
    );
  });

  it("uses the selected source scale as the authored master", () => {
    const result = synthesizeApproximateScaleMasters(source, {
      referenceScale: "S",
    });

    expect(result.normalized.masters.map((master) => master.origin)).toEqual([
      "authored",
      "approximate",
      "approximate",
    ]);
    expect(result.normalized.masters[0]?.paths[0]?.d).toBe(source.paths[0]?.d);
    expect(width(result, "Regular-M") / width(result, "Regular-S")).toBeCloseTo(
      1 / DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.S,
    );
  });
});
