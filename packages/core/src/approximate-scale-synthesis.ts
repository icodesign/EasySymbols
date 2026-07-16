import { transformNormalizedPath } from "./normalize.js";
import {
  resolveOpticalScaleCalibration,
  type OpticalScaleFactors,
} from "./scale-calibration.js";
import type {
  NormalizedPath,
  ParsedSvg,
  SymbolMaster,
} from "./types.js";
import {
  DEFAULT_SYMBOL_VARIANT,
  SYMBOL_SCALES,
  type SymbolScale,
  type SymbolVariant,
} from "./variants.js";

export interface ApproximateScaleSynthesisOptions {
  /** Which optical scale the source artwork already represents. Defaults to Medium. */
  referenceScale?: SymbolScale;
  scaleFactors?: OpticalScaleFactors;
}

export interface ApproximateScaleSynthesisResult {
  normalized: ParsedSvg;
  provenance: "approximate";
  referenceScale: SymbolScale;
  scaleFactors: OpticalScaleFactors;
}

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function boundsFor(paths: readonly NormalizedPath[]): Bounds {
  const bounds = paths.reduce<Bounds>(
    (result, path) => ({
      minX: Math.min(result.minX, path.minX),
      minY: Math.min(result.minY, path.minY),
      maxX: Math.max(result.maxX, path.maxX),
      maxY: Math.max(result.maxY, path.maxY),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    throw new Error("Approximate scale synthesis requires finite source artwork bounds.");
  }
  return bounds;
}

function pathsForScale(
  source: readonly NormalizedPath[],
  factor: number,
  centerX: number,
  centerY: number,
  variant: SymbolVariant,
): NormalizedPath[] {
  if (factor === 1) return source.map((path) => ({ ...path, variant }));
  const matrix = [
    factor,
    0,
    0,
    factor,
    centerX * (1 - factor),
    centerY * (1 - factor),
  ] as const;
  return source.map((path) => transformNormalizedPath(path, matrix, variant));
}

/**
 * Creates only Regular S/M/L masters by uniformly scaling fully normalized
 * artwork. This preserves relative fill/stroke geometry but is explicitly an
 * approximation of SF Symbol optical sizing; it does not synthesize weights.
 */
export function synthesizeApproximateScaleMasters(
  normalized: ParsedSvg,
  options: ApproximateScaleSynthesisOptions = {},
): ApproximateScaleSynthesisResult {
  const sourceMaster = normalized.masters.find(
    (master) => master.variant === DEFAULT_SYMBOL_VARIANT,
  );
  if (!sourceMaster || normalized.masters.length !== 1) {
    throw new Error(
      "Approximate scale synthesis requires one normalized Regular-M source master.",
    );
  }
  if (sourceMaster.paths.length === 0) {
    throw new Error("Approximate scale synthesis requires rendered source paths.");
  }

  const { referenceScale, scaleFactors } =
    resolveOpticalScaleCalibration(options);
  const bounds = boundsFor(sourceMaster.paths);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const referenceFactor = scaleFactors[referenceScale];
  const masters: SymbolMaster[] = SYMBOL_SCALES.map((scale) => {
    const variant = `Regular-${scale}` as SymbolVariant;
    return {
      origin: scale === referenceScale ? "authored" : "approximate",
      paths: pathsForScale(
        sourceMaster.paths,
        scaleFactors[scale] / referenceFactor,
        centerX,
        centerY,
        variant,
      ),
      variant,
    };
  });
  const defaultMaster = masters.find(
    (master) => master.variant === DEFAULT_SYMBOL_VARIANT,
  );
  if (!defaultMaster) {
    throw new Error("Approximate scale synthesis could not create a Regular-M master.");
  }

  return {
    normalized: {
      ...normalized,
      masters,
      paths: defaultMaster.paths,
    },
    provenance: "approximate",
    referenceScale,
    scaleFactors,
  };
}
