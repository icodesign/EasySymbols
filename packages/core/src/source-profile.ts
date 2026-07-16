import { ConversionError } from "./errors.js";
import { parseSvg, type Drawable, type ParsedDocument } from "./parser.js";
import type { SourceProfile, StrokeSummary } from "./types.js";

const NUMBER_TOLERANCE = 1e-7;

export type GeometryInspectionIssueCode =
  | "parse-error"
  | "parser-diagnostic"
  | "no-rendered-geometry";

export interface GeometryInspectionIssue {
  code: GeometryInspectionIssueCode;
  message: string;
}

export interface GeometryInspection {
  drawableCount: number;
  issues: GeometryInspectionIssue[];
  sourceProfile: SourceProfile;
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function distinctWidths(values: readonly number[]): number[] {
  return [...values]
    .sort((left, right) => left - right)
    .reduce<number[]>((result, value) => {
      if (result.length === 0 || Math.abs((result.at(-1) ?? value) - value) > NUMBER_TOLERANCE) {
        result.push(value);
      }
      return result;
    }, []);
}

function summarizeStrokes(
  strokes: readonly Extract<Drawable, { role: "stroke" }>[],
): StrokeSummary | undefined {
  if (strokes.length === 0) return undefined;
  return {
    caps: distinct(strokes.map((stroke) => stroke.stroke.cap)),
    joins: distinct(strokes.map((stroke) => stroke.stroke.join)),
    widths: distinctWidths(strokes.map((stroke) => stroke.stroke.width)),
  };
}

function emptyProfile(): SourceProfile {
  return {
    canGenerateVariants: false,
    canGenerateApproximateScaleVariants: false,
    geometryModel: "empty",
  };
}

/**
 * Classifies the authoring geometry that the parser actually retained. The
 * classification deliberately ignores library names, CSS class names, canvas
 * dimensions, and cap/join preferences: none of those identify whether an SVG
 * has editable centerlines.
 */
export function inspectGeometryDocument(
  document: ParsedDocument,
): GeometryInspection {
  const issues: GeometryInspectionIssue[] = [];
  const errorDiagnostics = document.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errorDiagnostics.length > 0) {
    issues.push({
      code: "parser-diagnostic",
      message: `The SVG has ${errorDiagnostics.length} unsupported or invalid feature${errorDiagnostics.length === 1 ? "" : "s"}.`,
    });
  }

  const hasExplicitMasters = document.drawables.some(
    (drawable) => drawable.variant !== undefined,
  );
  const fills = document.drawables.filter(
    (drawable): drawable is Extract<Drawable, { role: "fill" }> =>
      drawable.role === "fill",
  );
  const strokes = document.drawables.filter(
    (drawable): drawable is Extract<Drawable, { role: "stroke" }> =>
      drawable.role === "stroke",
  );
  const strokeSummary = summarizeStrokes(strokes);

  let sourceProfile: SourceProfile;
  if (hasExplicitMasters) {
    sourceProfile = {
      canGenerateVariants: false,
      canGenerateApproximateScaleVariants: false,
      geometryModel: "sf-symbol-template",
      ...(strokeSummary ? { strokeSummary } : {}),
    };
  } else if (strokes.length > 0 && fills.length === 0) {
    sourceProfile = {
      canGenerateVariants: errorDiagnostics.length === 0,
      // A centerline source has the more faithful `all` mode instead.
      canGenerateApproximateScaleVariants: false,
      geometryModel: "centerline-stroke",
      ...(strokeSummary ? { strokeSummary } : {}),
    };
  } else if (fills.length > 0 && strokes.length === 0) {
    sourceProfile = {
      canGenerateVariants: false,
      canGenerateApproximateScaleVariants: errorDiagnostics.length === 0,
      geometryModel: "filled-outline",
    };
  } else if (fills.length > 0 || strokes.length > 0) {
    sourceProfile = {
      canGenerateVariants: false,
      canGenerateApproximateScaleVariants: errorDiagnostics.length === 0,
      geometryModel: "mixed",
      ...(strokeSummary ? { strokeSummary } : {}),
    };
  } else {
    issues.push({
      code: "no-rendered-geometry",
      message: "The SVG contains no rendered fill or stroke geometry.",
    });
    sourceProfile = emptyProfile();
  }

  return {
    drawableCount: document.drawables.length,
    issues,
    sourceProfile,
  };
}

export function inspectGeometrySource(source: string): GeometryInspection {
  try {
    return inspectGeometryDocument(parseSvg(source));
  } catch (cause) {
    const message =
      cause instanceof ConversionError
        ? cause.diagnostics.map((diagnostic) => diagnostic.message).join(" ")
        : cause instanceof Error
          ? cause.message
          : String(cause);
    return {
      drawableCount: 0,
      issues: [{ code: "parse-error", message }],
      sourceProfile: emptyProfile(),
    };
  }
}
