import { orientSimplifiedContoursForWinding } from "./winding.js";

export interface StrokeOptions {
  cap: "butt" | "round" | "square";
  join: "bevel" | "miter" | "round";
  miterLimit: number;
  width: number;
}

export interface GeometryEngine {
  expandStroke(pathData: string, options: StrokeOptions): string;
  convertEvenOddToWinding(pathData: string): string;
}

/**
 * SVG keeps its stroke vocabulary lowercase, while pathkit-wasm exposes its
 * enum members as uppercase names. Keep that boundary explicit rather than
 * relying on an unsafe indexed lookup: an undefined enum value makes
 * pathkit-wasm silently fall back to BUTT/MITER.
 */
const PATHKIT_STROKE_CAP = {
  butt: "BUTT",
  round: "ROUND",
  square: "SQUARE",
} as const satisfies Record<StrokeOptions["cap"], string>;

const PATHKIT_STROKE_JOIN = {
  bevel: "BEVEL",
  miter: "MITER",
  round: "ROUND",
} as const satisfies Record<StrokeOptions["join"], string>;

type PathKitStrokeCap = (typeof PATHKIT_STROKE_CAP)[StrokeOptions["cap"]];
type PathKitStrokeJoin = (typeof PATHKIT_STROKE_JOIN)[StrokeOptions["join"]];

interface PathKitPath {
  delete(): void;
  setFillType(fillType: unknown): void;
  simplify(): PathKitPath | null;
  stroke(options: {
    cap: unknown;
    join: unknown;
    miter_limit: number;
    precision: number;
    width: number;
  }): PathKitPath | null;
  toCmds(): { length: number };
  toSVGString(): string;
}

interface PathKitApi {
  FillType: {
    EVENODD: unknown;
    WINDING: unknown;
  };
  FromSVGString(value: string): PathKitPath | null;
  MakeFromOp(
    first: PathKitPath,
    second: PathKitPath,
    operation: unknown,
  ): PathKitPath | null;
  PathOp: {
    DIFFERENCE: unknown;
    XOR: unknown;
  };
  StrokeCap: Record<PathKitStrokeCap, unknown>;
  StrokeJoin: Record<PathKitStrokeJoin, unknown>;
}

type PathKitInitializer = (options: {
  wasmBinary: Uint8Array;
}) => Promise<PathKitApi>;

export async function createPathKitGeometryEngine(
  wasmBinary: ArrayBuffer | Uint8Array,
): Promise<GeometryEngine> {
  const imported = (await import("pathkit-wasm")) as unknown as {
    default: PathKitInitializer;
  };
  const pathKit = await imported.default({
    wasmBinary:
      wasmBinary instanceof Uint8Array ? wasmBinary : new Uint8Array(wasmBinary),
  });

  return {
    expandStroke(pathData, options) {
      const path = pathKit.FromSVGString(pathData);
      if (!path) throw new Error("PathKit could not parse the SVG path.");
      try {
        if (!path.stroke({
          width: options.width,
          cap: pathKit.StrokeCap[PATHKIT_STROKE_CAP[options.cap]],
          join: pathKit.StrokeJoin[PATHKIT_STROKE_JOIN[options.join]],
          miter_limit: options.miterLimit,
          precision: 0.25,
        })) {
          throw new Error("PathKit could not expand the SVG stroke.");
        }
        return path.toSVGString();
      } finally {
        path.delete();
      }
    },
    convertEvenOddToWinding(pathData) {
      const input = pathKit.FromSVGString(pathData);
      if (!input) throw new Error("PathKit could not parse the SVG path.");
      const containmentPaths = new Map<string, PathKitPath>();
      let simplified: PathKitPath | null = null;
      let output: PathKitPath | null = null;
      let difference: PathKitPath | null = null;
      try {
        input.setFillType(pathKit.FillType.EVENODD);
        simplified = pathKit.FromSVGString(pathData);
        if (!simplified) {
          throw new Error("PathKit could not parse the SVG path.");
        }

        // Simplify owns single-path contour resolution: it removes crossings
        // while preserving evenodd coverage. The winding helper then gives
        // nested, non-overlapping contours alternating direction.
        simplified.setFillType(pathKit.FillType.EVENODD);
        if (!simplified.simplify()) {
          throw new Error("PathKit could not simplify evenodd fill geometry.");
        }
        const pathForContainment = (contourPathData: string) => {
          const cached = containmentPaths.get(contourPathData);
          if (cached) return cached;
          const contour = pathKit.FromSVGString(contourPathData);
          if (!contour) {
            throw new Error("PathKit could not parse a simplified contour.");
          }
          contour.setFillType(pathKit.FillType.WINDING);
          containmentPaths.set(contourPathData, contour);
          return contour;
        };
        const windingPathData = orientSimplifiedContoursForWinding(
          simplified.toSVGString(),
          (innerPathData, outerPathData) => {
            const containmentDifference = pathKit.MakeFromOp(
              pathForContainment(innerPathData),
              pathForContainment(outerPathData),
              pathKit.PathOp.DIFFERENCE,
            );
            if (!containmentDifference) {
              throw new Error("PathKit could not resolve contour containment.");
            }
            try {
              return containmentDifference.toCmds().length === 0;
            } finally {
              containmentDifference.delete();
            }
          },
        );
        output = pathKit.FromSVGString(windingPathData);
        if (!output) {
          throw new Error("PathKit could not parse the winding path.");
        }
        output.setFillType(pathKit.FillType.WINDING);

        // Keep the original evenodd path untouched so this remains an
        // independent filled-coverage check of the complete conversion.
        difference = pathKit.MakeFromOp(input, output, pathKit.PathOp.XOR);
        if (!difference) {
          throw new Error("PathKit could not verify the winding conversion.");
        }
        if (difference.toCmds().length !== 0) {
          throw new Error("Winding conversion changed the filled coverage.");
        }
        return output.toSVGString();
      } finally {
        difference?.delete();
        output?.delete();
        simplified?.delete();
        for (const contour of containmentPaths.values()) contour.delete();
        input.delete();
      }
    },
  };
}
