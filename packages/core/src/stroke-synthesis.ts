import { multiplyMatrices, type Matrix } from "./matrix.js";
import { normalizeDocument } from "./normalize.js";
import { parseSvg, type Drawable, type ParsedDocument } from "./parser.js";
import type { GeometryEngine } from "./pathkit.js";
import {
  resolveOpticalScaleCalibration,
  type OpticalScaleFactors,
} from "./scale-calibration.js";
import { inspectGeometryDocument } from "./source-profile.js";
import type { BackgroundMode, ParsedSvg } from "./types.js";
import {
  SYMBOL_SCALES,
  SYMBOL_WEIGHTS,
  type SymbolScale,
  type SymbolVariant,
  type SymbolWeight,
} from "./variants.js";

export type WeightStrokeMultipliers = Readonly<Record<SymbolWeight, number>>;
export type { OpticalScaleFactors } from "./scale-calibration.js";
export { DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS } from "./scale-calibration.js";

/**
 * EasySymbols' authoring calibration for SF Symbol weights. These are relative
 * stroke-width multipliers, not values published or guaranteed by Apple.
 */
export const DEFAULT_SF_WEIGHT_STROKE_MULTIPLIERS = {
  Ultralight: 0.5,
  Thin: 0.625,
  Light: 0.75,
  Regular: 1,
  Medium: 1.125,
  Semibold: 1.25,
  Bold: 1.375,
  Heavy: 1.5,
  Black: 1.625,
} as const satisfies WeightStrokeMultipliers;

export interface CenterlineSynthesisOptions {
  background?: BackgroundMode;
  /** Which source weight the input artwork represents. Defaults to Regular. */
  referenceWeight?: SymbolWeight;
  /** Which source scale the input artwork represents. Defaults to Medium. */
  referenceScale?: SymbolScale;
  scaleFactors?: OpticalScaleFactors;
  /** Multiplies all source stroke widths at the reference master. Defaults to 1. */
  strokeScale?: number;
  weightStrokeMultipliers?: WeightStrokeMultipliers;
}

export interface CenterlineSynthesisResult {
  normalized: ParsedSvg;
  provenance: "synthesized";
  referenceScale: SymbolScale;
  referenceWeight: SymbolWeight;
  scaleFactors: OpticalScaleFactors;
  strokeScale: number;
  weightStrokeFactors: Readonly<Record<SymbolWeight, number>>;
}

function validatePositiveRecord(
  values: Readonly<Record<string, number>>,
  label: string,
  requiredKeys: readonly string[],
): void {
  for (const key of requiredKeys) {
    const value = values[key];
    if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
      throw new Error(`${label}.${key} must be a finite positive number.`);
    }
  }
}

function assertReferenceWeight(value: SymbolWeight): void {
  if (!SYMBOL_WEIGHTS.includes(value)) {
    throw new Error(`referenceWeight must be one of: ${SYMBOL_WEIGHTS.join(", ")}.`);
  }
}

function scaleAround(
  factor: number,
  centerX: number,
  centerY: number,
): Matrix {
  return [
    factor,
    0,
    0,
    factor,
    centerX * (1 - factor),
    centerY * (1 - factor),
  ];
}

function cloneStrokesForVariant(
  document: ParsedDocument,
  variant: SymbolVariant,
  geometryScale: number,
  widthFactor: number,
): Drawable[] {
  const centerX = document.minX + document.width / 2;
  const centerY = document.minY + document.height / 2;
  const globalScale = scaleAround(geometryScale, centerX, centerY);

  return document.drawables.map((drawable) => {
    if (drawable.role !== "stroke") {
      throw new Error("Centerline synthesis requires stroke-only SVG geometry.");
    }
    return {
      ...drawable,
      matrix: multiplyMatrices(globalScale, drawable.matrix),
      stroke: {
        ...drawable.stroke,
        // Expand in local coordinates first, then apply original and global
        // transforms. Dividing by geometryScale preserves visual line weight
        // across S/M/L even if the source uses non-uniform transforms.
        width: (drawable.stroke.width * widthFactor) / geometryScale,
      },
      variant,
    };
  });
}

function incompatibleMessage(document: ParsedDocument): string {
  const inspection = inspectGeometryDocument(document);
  if (inspection.sourceProfile.geometryModel === "filled-outline") {
    return "The SVG contains filled outline geometry, not editable centerline strokes.";
  }
  if (inspection.sourceProfile.geometryModel === "mixed") {
    return "The SVG mixes fills and strokes, so changing only stroke widths would alter its visual relationships.";
  }
  if (inspection.sourceProfile.geometryModel === "sf-symbol-template") {
    return "The SVG already contains explicit SF Symbol masters.";
  }
  return inspection.issues.map((issue) => issue.message).join(" ") ||
    "The SVG contains no centerline stroke geometry.";
}

/**
 * Generates explicit S/M/L × weight masters from any stroke-only SVG. The
 * source drawing remains in local SVG coordinates until PathKit expands its
 * stroke; only then is the original transform and the optical scale applied.
 */
export function synthesizeCenterlineDocument(
  document: ParsedDocument,
  geometry: GeometryEngine,
  options: CenterlineSynthesisOptions = {},
): CenterlineSynthesisResult {
  const inspection = inspectGeometryDocument(document);
  if (!inspection.sourceProfile.canGenerateVariants) {
    throw new Error(`The SVG cannot synthesize centerline variants: ${incompatibleMessage(document)}`);
  }

  const referenceWeight = options.referenceWeight ?? "Regular";
  const strokeScale = options.strokeScale ?? 1;
  const { referenceScale, scaleFactors } = resolveOpticalScaleCalibration({
    ...(options.referenceScale === undefined
      ? {}
      : { referenceScale: options.referenceScale }),
    ...(options.scaleFactors === undefined
      ? {}
      : { scaleFactors: options.scaleFactors }),
  });
  const weightStrokeMultipliers =
    options.weightStrokeMultipliers ?? DEFAULT_SF_WEIGHT_STROKE_MULTIPLIERS;

  assertReferenceWeight(referenceWeight);
  if (!(Number.isFinite(strokeScale) && strokeScale > 0)) {
    throw new Error("strokeScale must be a finite positive number.");
  }
  validatePositiveRecord(
    weightStrokeMultipliers,
    "weightStrokeMultipliers",
    SYMBOL_WEIGHTS,
  );

  const referenceWeightMultiplier = weightStrokeMultipliers[referenceWeight];
  const referenceScaleFactor = scaleFactors[referenceScale];
  const weightStrokeFactors = Object.fromEntries(
    SYMBOL_WEIGHTS.map((weight) => [
      weight,
      (weightStrokeMultipliers[weight] / referenceWeightMultiplier) * strokeScale,
    ]),
  ) as Record<SymbolWeight, number>;

  const drawables = SYMBOL_WEIGHTS.flatMap((weight) =>
    SYMBOL_SCALES.flatMap((scale) => {
      const geometryScale = scaleFactors[scale] / referenceScaleFactor;
      const variant = `${weight}-${scale}` as SymbolVariant;
      return cloneStrokesForVariant(
        document,
        variant,
        geometryScale,
        weightStrokeFactors[weight],
      );
    }),
  );
  const normalized = normalizeDocument(
    { ...document, drawables },
    geometry,
    {
      ...(options.background === undefined
        ? {}
        : { background: options.background }),
      origin: "generated",
    },
  );

  return {
    normalized,
    provenance: "synthesized",
    referenceScale,
    referenceWeight,
    scaleFactors,
    strokeScale,
    weightStrokeFactors,
  };
}

export function synthesizeCenterlineMasters(
  source: string,
  geometry: GeometryEngine,
  options: CenterlineSynthesisOptions = {},
): CenterlineSynthesisResult {
  return synthesizeCenterlineDocument(parseSvg(source), geometry, options);
}
