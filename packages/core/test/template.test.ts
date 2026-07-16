import { describe, expect, it } from "vitest";

import { createSymbolArtifact } from "../src/template.js";
import type { NormalizedPath, SymbolMaster, SymbolVariant } from "../src/types.js";

function rectangleMaster(
  variant: SymbolVariant,
  min: number,
  max: number,
): SymbolMaster {
  const path: NormalizedPath = {
    d: `M${min} ${min}H${max}V${max}H${min}Z`,
    minX: min,
    minY: min,
    maxX: max,
    maxY: max,
    sourceGroupIds: [],
    sourceOpacity: 1,
    sourceOrder: 0,
    sourcePaint: "black",
    sourceRole: "fill",
    sourceShapeId: "shape-1",
    variant,
  };
  return { origin: "authored", paths: [path], variant };
}

describe("static symbol template placement", () => {
  it("fits a generic Regular-M master into Apple's template slot", () => {
    const artifact = createSymbolArtifact(
      [rectangleMaster("Regular-M", 2, 12)],
      { name: "single-master" },
    );

    expect(artifact.symbolSvg).toContain('width="3300" height="2200"');
    expect(artifact.symbolSvg).toContain(
      '<g id="Regular-M" transform="matrix(1 0 0 1 1394.3990000000001 1125.541)">\n      <path d="M26.045 -64.4H84.845V-5.6H26.045z"/>',
    );
    expect(artifact.previewSvg).toContain('viewBox="411 266 108 90"');
    expect(artifact.symbolSvg).toMatch(
      /<line id="left-margin-Regular-M"[^>]*x1="1394\.399/,
    );
  });

  it("uses one canonical scale while placing S, M, and L in their own rows", () => {
    const artifact = createSymbolArtifact(
      [
        rectangleMaster("Regular-S", 2, 10),
        rectangleMaster("Regular-M", 2, 12),
        rectangleMaster("Regular-L", 0, 14),
      ],
      { name: "scale-masters" },
    );

    expect(artifact.symbolSvg).toContain(
      '<path d="M31.925 -58.52H78.965V-11.48H31.925z"/>',
    );
    expect(artifact.symbolSvg).toContain(
      '<path d="M26.045 -64.4H84.845V-5.6H26.045z"/>',
    );
    expect(artifact.symbolSvg).toContain(
      '<path d="M14.285 -76.16H96.605V6.16H14.285z"/>',
    );

    expect(artifact.masterPreviews["Regular-S"]?.svg).toContain('viewBox="411 66 108 90"');
    expect(artifact.masterPreviews["Regular-M"]?.svg).toContain('viewBox="411 266 108 90"');
    expect(artifact.masterPreviews["Regular-L"]?.svg).toContain('viewBox="411 466 108 90"');

    expect(artifact.symbolSvg).toMatch(
      /<line id="left-margin-Regular-S"[^>]*x1="1394\.399/,
    );
    expect(artifact.symbolSvg).toMatch(
      /<line id="right-margin-Regular-L"[^>]*x1="1505\.289/,
    );
  });
});
