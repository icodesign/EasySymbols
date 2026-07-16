import {
  SYMBOL_SCALES,
  type SymbolScale,
} from "./variants.js";

export type OpticalScaleFactors = Readonly<Record<SymbolScale, number>>;

/**
 * EasySymbols' optical-size calibration. This controls artwork scale around
 * the source artwork center; it is not a library runtime `size` attribute.
 */
export const DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS = {
  S: 0.783,
  M: 1,
  L: 1.29,
} as const satisfies OpticalScaleFactors;

export interface OpticalScaleCalibration {
  referenceScale: SymbolScale;
  scaleFactors: OpticalScaleFactors;
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

function assertReferenceScale(value: SymbolScale): void {
  if (!SYMBOL_SCALES.includes(value)) {
    throw new Error(`referenceScale must be one of: ${SYMBOL_SCALES.join(", ")}.`);
  }
}

export function resolveOpticalScaleCalibration(
  options: {
    referenceScale?: SymbolScale;
    scaleFactors?: OpticalScaleFactors;
  } = {},
): OpticalScaleCalibration {
  const referenceScale = options.referenceScale ?? "M";
  const scaleFactors =
    options.scaleFactors ?? DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS;
  assertReferenceScale(referenceScale);
  validatePositiveRecord(scaleFactors, "scaleFactors", SYMBOL_SCALES);
  return { referenceScale, scaleFactors };
}
