import { SVGPathData, type SVGCommand } from "svg-pathdata";

import { error, warning } from "./errors.js";
import { previewColorForPaint } from "./color.js";
import { IDENTITY_MATRIX, type Matrix } from "./matrix.js";
import { resolvePaint } from "./paint.js";
import type { GeometryEngine } from "./pathkit.js";
import type { ParsedDocument } from "./parser.js";
import type {
  BackgroundMode,
  Diagnostic,
  MasterOrigin,
  NormalizedPath,
  ParsedSvg,
  SymbolMaster,
} from "./types.js";
import {
  DEFAULT_SYMBOL_VARIANT,
  sortSymbolVariants,
  type SymbolVariant,
} from "./variants.js";

function closeFilledSubpaths(path: SVGPathData): SVGPathData {
  const commands: SVGCommand[] = [];
  let subpathOpen = false;
  let subpathHasDrawing = false;

  for (const command of path.commands) {
    if (command.type === SVGPathData.MOVE_TO) {
      if (subpathOpen && subpathHasDrawing) {
        commands.push({ type: SVGPathData.CLOSE_PATH });
      }
      subpathOpen = true;
      subpathHasDrawing = false;
    } else if (command.type === SVGPathData.CLOSE_PATH) {
      subpathOpen = false;
      subpathHasDrawing = false;
    } else if ((command.type & SVGPathData.DRAWING_COMMANDS) !== 0) {
      subpathHasDrawing = true;
    }
    commands.push(command);
  }
  if (subpathOpen && subpathHasDrawing) {
    commands.push({ type: SVGPathData.CLOSE_PATH });
  }
  return new SVGPathData(commands);
}

function canonicalizePathData(
  source: string,
  matrix: Matrix,
  closeSubpaths: boolean,
): SVGPathData {
  let path = new SVGPathData(source)
    .toAbs()
    .normalizeST()
    .qtToC()
    .aToC();
  if (closeSubpaths) path = closeFilledSubpaths(path);
  path.matrix(...matrix).round(10_000_000);
  return path;
}

function toNormalizedPath(
  path: SVGPathData,
  variant: SymbolVariant,
  source: Pick<
    NormalizedPath,
    | "sourceGroupIds"
    | "sourceOpacity"
    | "sourceOrder"
    | "sourcePaint"
    | "sourceRole"
    | "sourceShapeId"
  > &
    Partial<Pick<NormalizedPath, "sourceHierarchy" | "sourceMulticolor">> & {
    previewColor?: string;
    sourceElementId?: string;
  },
): NormalizedPath {
  const bounds = path.getBounds();
  const values = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Path has no finite rendered bounds.");
  }
  return {
    d: path.encode(),
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    ...(source.previewColor ? { previewColor: source.previewColor } : {}),
    ...(source.sourceElementId
      ? { sourceElementId: source.sourceElementId }
      : {}),
    sourceGroupIds: [...source.sourceGroupIds],
    ...(source.sourceHierarchy
      ? { sourceHierarchy: source.sourceHierarchy }
      : {}),
    ...(source.sourceMulticolor
      ? { sourceMulticolor: source.sourceMulticolor }
      : {}),
    sourceOpacity: source.sourceOpacity,
    sourceOrder: source.sourceOrder,
    sourcePaint: source.sourcePaint,
    sourceRole: source.sourceRole,
    sourceShapeId: source.sourceShapeId,
    variant,
  };
}

function normalizePathData(
  source: string,
  matrix: Matrix,
  closeSubpaths: boolean,
  variant: SymbolVariant,
  metadata: Parameters<typeof toNormalizedPath>[2],
): NormalizedPath {
  return toNormalizedPath(
    canonicalizePathData(source, matrix, closeSubpaths),
    variant,
    metadata,
  );
}

/**
 * Applies a shared affine transform to already-normalized artwork. Callers
 * use this after paint/background/stroke semantics have been resolved, so a
 * fill and an expanded stroke remain one visual group.
 */
export function transformNormalizedPath(
  path: NormalizedPath,
  matrix: Matrix,
  variant: SymbolVariant = path.variant,
): NormalizedPath {
  const transformed = new SVGPathData(path.d)
    .toAbs()
    .matrix(...matrix)
    .round(10_000_000);
  return toNormalizedPath(
    transformed,
    variant,
    {
      ...(path.previewColor ? { previewColor: path.previewColor } : {}),
      ...(path.sourceElementId
        ? { sourceElementId: path.sourceElementId }
        : {}),
      sourceGroupIds: path.sourceGroupIds,
      ...(path.sourceHierarchy
        ? { sourceHierarchy: path.sourceHierarchy }
        : {}),
      ...(path.sourceMulticolor
        ? { sourceMulticolor: path.sourceMulticolor }
        : {}),
      sourceOpacity: path.sourceOpacity,
      sourceOrder: path.sourceOrder,
      sourcePaint: path.sourcePaint,
      sourceRole: path.sourceRole,
      sourceShapeId: path.sourceShapeId,
    },
  );
}

function removeCanvasBackground(
  paths: NormalizedPath[],
  width: number,
  height: number,
  mode: BackgroundMode,
  diagnostics: Diagnostic[],
): NormalizedPath[] {
  if (mode !== "auto" || paths.length < 2) return paths;
  const background = paths[0];
  if (!background || background.sourceRole !== "fill") return paths;

  const tolerance = Math.max(width, height, 1) * 0.005;
  const coversCanvas =
    background.minX >= -tolerance &&
    background.minX <= tolerance &&
    background.minY >= -tolerance &&
    background.minY <= tolerance &&
    background.maxX >= width - tolerance &&
    background.maxX <= width + tolerance &&
    background.maxY >= height - tolerance &&
    background.maxY <= height + tolerance;
  if (!coversCanvas) return paths;

  const foreground = paths.slice(1);
  const containedByBackgroundBounds = foreground.every(
    (path) =>
      path.minX >= background.minX - tolerance &&
      path.minY >= background.minY - tolerance &&
      path.maxX <= background.maxX + tolerance &&
      path.maxY <= background.maxY + tolerance,
  );
  const hasInsetArtwork = foreground.some(
    (path) =>
      path.minX > background.minX + tolerance ||
      path.minY > background.minY + tolerance ||
      path.maxX < background.maxX - tolerance ||
      path.maxY < background.maxY - tolerance,
  );
  if (!containedByBackgroundBounds || !hasInsetArtwork) return paths;

  diagnostics.push(
    warning(
      "SVG_CANVAS_BACKGROUND_REMOVED",
      "geometry",
      "A canvas-sized first fill was removed so foreground artwork remains visible after monochrome conversion. Disable background removal to keep it.",
      background.sourceElementId,
    ),
  );
  return foreground;
}

function applyBackgroundPolicy(
  paths: NormalizedPath[],
  width: number,
  height: number,
  mode: BackgroundMode,
  diagnostics: Diagnostic[],
): NormalizedPath[] {
  if (mode !== "auto" || paths.length < 2) return paths;
  const groups = new Map<SymbolVariant, NormalizedPath[]>();
  for (const path of paths) {
    const group = groups.get(path.variant) ?? [];
    group.push(path);
    groups.set(path.variant, group);
  }
  return sortSymbolVariants(groups.keys()).flatMap((variant) =>
    removeCanvasBackground(groups.get(variant) ?? [], width, height, mode, diagnostics),
  );
}

function supportsStaticPaint(
  paint: string,
  role: "fill" | "stroke",
  document: ParsedDocument,
  diagnostics: Diagnostic[],
  elementId?: string,
): boolean {
  const resolution = resolvePaint(paint, document.paintServers);
  const label = role === "fill" ? "fill" : "stroke";

  switch (resolution.kind) {
    case "flat":
      return true;
    case "gradient":
      if (resolution.hasTransparency) {
        diagnostics.push(
          error(
            "SVG_GRADIENT_TRANSPARENCY_UNSUPPORTED",
            "geometry",
            `Gradient ${label} #${resolution.id} uses transparency, which cannot be preserved in a static monochrome SF Symbol.`,
            elementId,
          ),
        );
        return false;
      }
      diagnostics.push(
        warning(
          "SVG_GRADIENT_FLATTENED",
          "geometry",
          `Gradient ${label} #${resolution.id} was converted to solid monochrome vector geometry; colors, stops, and direction are not preserved.`,
          elementId,
        ),
      );
      return true;
    case "pattern":
      diagnostics.push(
        error(
          "SVG_PATTERN_UNSUPPORTED",
          "geometry",
          `Pattern ${label} #${resolution.id} cannot be converted to a static monochrome SF Symbol.`,
          elementId,
        ),
      );
      return false;
    case "unresolved":
      diagnostics.push(
        error(
          "SVG_PAINT_SERVER_UNRESOLVED",
          "geometry",
          `The ${label} references ${resolution.reference}, but only local linear or radial gradients can be flattened.`,
          elementId,
        ),
      );
      return false;
  }
}

export function normalizeDocument(
  document: ParsedDocument,
  geometry?: GeometryEngine,
  options: { background?: BackgroundMode; origin?: MasterOrigin } = {},
): ParsedSvg {
  const diagnostics: Diagnostic[] = [...document.diagnostics];
  const paths: NormalizedPath[] = [];

  for (const drawable of document.drawables) {
    if (!supportsStaticPaint(drawable.paint, drawable.role, document, diagnostics, drawable.elementId)) {
      continue;
    }
    const previewColor = previewColorForPaint(drawable.paint);
    try {
      if (drawable.role === "fill") {
        let source = drawable.d;
        const variant = drawable.variant ?? DEFAULT_SYMBOL_VARIANT;
        if (drawable.fillRule === "evenodd") {
          if (!geometry) {
            diagnostics.push(
              error(
                "SVG_EVENODD_ENGINE_REQUIRED",
                "geometry",
                "evenodd fills require the PathKit geometry engine to convert them to nonzero winding.",
                drawable.elementId,
              ),
            );
            continue;
          }
          // Keep PathOps in the source coordinate space. An affine transform
          // preserves filled coverage (including a reflection), and applying it
          // after winding conversion is numerically more stable.
          source = geometry.convertEvenOddToWinding(
            canonicalizePathData(source, IDENTITY_MATRIX, true).encode(),
          );
        }
        paths.push(
          normalizePathData(
            source,
            drawable.matrix,
            true,
            variant,
            {
              ...(previewColor ? { previewColor } : {}),
              ...(drawable.elementId
                ? { sourceElementId: drawable.elementId }
                : {}),
              sourceGroupIds: drawable.groupIds,
              ...(drawable.sourceHierarchy
                ? { sourceHierarchy: drawable.sourceHierarchy }
                : {}),
              ...(drawable.sourceMulticolor
                ? { sourceMulticolor: drawable.sourceMulticolor }
                : {}),
              sourceOpacity: drawable.opacity,
              sourceOrder: drawable.order,
              sourcePaint: drawable.paint,
              sourceRole: "fill",
              sourceShapeId: drawable.shapeId,
            },
          ),
        );
        continue;
      }

      let source = drawable.d;
      const variant = drawable.variant ?? DEFAULT_SYMBOL_VARIANT;
      if (drawable.role === "stroke") {
        if (!geometry) {
          diagnostics.push(
            error(
              "SVG_STROKE_ENGINE_REQUIRED",
              "geometry",
              "This SVG contains strokes; initialize the PathKit geometry engine to expand them.",
              drawable.elementId,
            ),
          );
          continue;
        }
        source = geometry.expandStroke(source, drawable.stroke);
      }
      paths.push(
        normalizePathData(
          source,
          drawable.matrix,
          false,
          variant,
          {
            ...(previewColor ? { previewColor } : {}),
            ...(drawable.elementId
              ? { sourceElementId: drawable.elementId }
              : {}),
            sourceGroupIds: drawable.groupIds,
            ...(drawable.sourceHierarchy
              ? { sourceHierarchy: drawable.sourceHierarchy }
              : {}),
            ...(drawable.sourceMulticolor
              ? { sourceMulticolor: drawable.sourceMulticolor }
              : {}),
            sourceOpacity: drawable.opacity,
            sourceOrder: drawable.order,
            sourcePaint: drawable.paint,
            sourceRole: "stroke",
            sourceShapeId: drawable.shapeId,
          },
        ),
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const code =
        drawable.role === "fill" && drawable.fillRule === "evenodd"
          ? "SVG_FILL_RULE_CONVERSION_FAILED"
          : "SVG_PATH_INVALID";
      const message =
        code === "SVG_FILL_RULE_CONVERSION_FAILED"
          ? `Could not convert evenodd fill to equivalent nonzero winding: ${detail}`
          : `Could not normalize path geometry: ${detail}`;
      diagnostics.push(error(code, "geometry", message, drawable.elementId));
    }
  }

  const outputPaths = applyBackgroundPolicy(
    paths,
    document.width,
    document.height,
    options.background ?? "auto",
    diagnostics,
  );

  if (outputPaths.length === 0 && !diagnostics.some((item) => item.severity === "error")) {
    diagnostics.push(
      error("SVG_NO_NORMALIZED_PATHS", "geometry", "No paths could be normalized."),
    );
  }

  const mastersByVariant = new Map<SymbolVariant, NormalizedPath[]>();
  for (const path of outputPaths) {
    const master = mastersByVariant.get(path.variant) ?? [];
    master.push(path);
    mastersByVariant.set(path.variant, master);
  }
  const variants = sortSymbolVariants(mastersByVariant.keys());
  const masters: SymbolMaster[] = variants.map((variant) => ({
    origin: options.origin ?? "authored",
    paths: mastersByVariant.get(variant) ?? [],
    variant,
  }));
  const defaultMaster =
    masters.find((master) => master.variant === DEFAULT_SYMBOL_VARIANT) ?? masters[0];
  const previewColor = [...outputPaths].reverse().find((path) => path.previewColor)?.previewColor;

  return {
    diagnostics,
    width: document.width,
    height: document.height,
    masters,
    paths: defaultMaster?.paths ?? [],
    ...(previewColor ? { previewColor } : {}),
    sourceElementCount: document.sourceElementCount,
  };
}
