import { synthesizeApproximateScaleMasters } from "./approximate-scale-synthesis.js";
import { ConversionError, error, warning } from "./errors.js";
import { normalizeDocument } from "./normalize.js";
import { parseSvg } from "./parser.js";
import type { GeometryEngine } from "./pathkit.js";
import {
  analyzeRenderingMasters,
  emptyRenderingAnalysis,
  validateRenderingConfiguration,
} from "./rendering.js";
import { inspectGeometryDocument } from "./source-profile.js";
import { synthesizeCenterlineDocument } from "./stroke-synthesis.js";
import { createSymbolArtifact } from "./template.js";
import type {
  ConversionResult,
  ConvertOptions,
  Diagnostic,
  ParsedSvg,
  SourceProfile,
  RenderingAnalysis,
  SvgAnalysis,
} from "./types.js";
import { validateSymbol } from "./validate.js";

interface PreparedSvg extends ParsedSvg {
  rendering: RenderingAnalysis;
  sourceProfile: SourceProfile;
}

const EMPTY_SOURCE_PROFILE: SourceProfile = {
  canGenerateVariants: false,
  canGenerateApproximateScaleVariants: false,
  geometryModel: "empty",
};

function failedAnalysis(diagnostics: Diagnostic[]): SvgAnalysis {
  return {
    diagnostics,
    width: 0,
    height: 0,
    masterCount: 0,
    pathCount: 0,
    rendering: emptyRenderingAnalysis(),
    sourceElementCount: 0,
    sourceProfile: EMPTY_SOURCE_PROFILE,
    isConvertible: false,
    variants: [],
  };
}

function analysisFromParsed(parsed: PreparedSvg): SvgAnalysis {
  return {
    diagnostics: parsed.diagnostics,
    width: parsed.width,
    height: parsed.height,
    masterCount: parsed.masters.length,
    pathCount: parsed.masters.reduce((count, master) => count + master.paths.length, 0),
    rendering: parsed.rendering,
    sourceElementCount: parsed.sourceElementCount,
    sourceProfile: parsed.sourceProfile,
    isConvertible: !parsed.diagnostics.some((item) => item.severity === "error"),
    variants: parsed.masters.map((master) => master.variant),
  };
}

function finalizePrepared(
  parsed: ParsedSvg,
  sourceProfile: SourceProfile,
  options: ConvertOptions,
): PreparedSvg {
  const rendering = analyzeRenderingMasters(parsed.masters);
  const diagnostics = [
    ...parsed.diagnostics,
    ...validateRenderingConfiguration(rendering, options.rendering),
  ];
  const partialOpacityRoles = new Set(
    rendering.layers
      .filter((layer) => layer.sourceOpacity > 0 && layer.sourceOpacity < 1)
      .map((layer) => layer.sourceRole),
  );
  for (const role of partialOpacityRoles) {
    const opacityMappedToHierarchy = rendering.layers
      .filter(
        (layer) =>
          layer.sourceRole === role &&
          layer.sourceOpacity > 0 &&
          layer.sourceOpacity < 1,
      )
      .some(
        (layer) =>
          options.rendering?.hierarchical?.layers[layer.id] === "secondary" ||
          options.rendering?.hierarchical?.layers[layer.id] === "tertiary",
      );
    diagnostics.push(
      opacityMappedToHierarchy
        ? warning(
            "SVG_PARTIAL_OPACITY_MAPPED_TO_HIERARCHY",
            "geometry",
            `Partial ${role} opacity was used as a hierarchy hint; monochrome rendering remains solid.`,
          )
        : warning(
            "SVG_PARTIAL_OPACITY_FLATTENED",
            "geometry",
            `Partial ${role} opacity becomes solid in monochrome rendering. Enable hierarchical layers to retain the visual distinction as rendering semantics.`,
          ),
    );
  }
  return {
    ...parsed,
    diagnostics,
    rendering,
    sourceProfile,
  };
}

function prepare(
  source: string,
  geometry?: GeometryEngine,
  options: ConvertOptions = {},
): PreparedSvg {
  try {
    const document = parseSvg(source);
    const inspection = inspectGeometryDocument(document);
    const sourceProfile = inspection.sourceProfile;

    const normalized = () => normalizeDocument(document, geometry, options);
    const requestedExactGeneration = options.variants === "all";
    const requestedApproximateScales = options.variants === "approximate-scales";
    const requestedGeneration = requestedExactGeneration || requestedApproximateScales;
    const geometryMode = options.geometry ?? "auto";
    if (
      geometryMode === "centerline" &&
      sourceProfile.geometryModel !== "centerline-stroke"
    ) {
      const parsed = normalized();
      parsed.diagnostics.push(
        error(
          "CENTERLINE_GEOMETRY_REQUIRED",
          "geometry",
          "This operation requires a stroke-only centerline SVG without explicit SF Symbol masters.",
        ),
      );
      return finalizePrepared(parsed, sourceProfile, options);
    }
    if (options.synthesis && !requestedExactGeneration) {
      const parsed = normalized();
      parsed.diagnostics.push(
        error(
          "SYNTHESIS_OPTIONS_REQUIRE_GENERATION",
          "geometry",
          "Stroke synthesis options require variants='all'.",
        ),
      );
      return finalizePrepared(parsed, sourceProfile, options);
    }
    if (options.approximateScales && !requestedApproximateScales) {
      const parsed = normalized();
      parsed.diagnostics.push(
        error(
          "APPROXIMATE_SCALE_OPTIONS_REQUIRE_GENERATION",
          "geometry",
          "Approximate scale options require variants='approximate-scales'.",
        ),
      );
      return finalizePrepared(parsed, sourceProfile, options);
    }
    if (!requestedGeneration) {
      return finalizePrepared(normalized(), sourceProfile, options);
    }

    if (requestedApproximateScales) {
      if (
        geometryMode === "static" ||
        !sourceProfile.canGenerateApproximateScaleVariants
      ) {
        const parsed = normalized();
        parsed.diagnostics.push(
          error(
            "APPROXIMATE_SCALE_VARIANTS_UNAVAILABLE",
            "geometry",
            geometryMode === "static"
              ? "Static geometry mode preserves only the authored master; choose geometry='auto' to opt into approximate scales."
              : "Approximate scale variants require filled or mixed SVG artwork without explicit SF Symbol masters. Use variants='all' for a stroke-only centerline SVG.",
          ),
        );
        return finalizePrepared(parsed, sourceProfile, options);
      }
      const staticParsed = normalized();
      if (staticParsed.diagnostics.some((item) => item.severity === "error")) {
        return finalizePrepared(staticParsed, sourceProfile, options);
      }
      const synthesized = synthesizeApproximateScaleMasters(
        staticParsed,
        options.approximateScales,
      );
      return finalizePrepared({
        ...synthesized.normalized,
        diagnostics: [
          ...synthesized.normalized.diagnostics,
          warning(
            "APPROXIMATE_SCALE_VARIANTS",
            "geometry",
            "Regular S/M/L masters were created by uniform whole-artwork scaling; no weight variants were generated.",
          ),
        ],
      }, sourceProfile, options);
    }

    if (geometryMode === "static" || !sourceProfile.canGenerateVariants) {
      const parsed = normalized();
      const unsupported = sourceProfile.geometryModel === "filled-outline"
        ? {
            code: "OUTLINE_WEIGHT_SYNTHESIS_UNAVAILABLE",
            message:
              "This SVG contains outlined fill geometry, so reliable weight generation requires authored centerlines.",
          }
        : sourceProfile.geometryModel === "mixed"
          ? {
              code: "MIXED_GEOMETRY_WEIGHT_SYNTHESIS_UNAVAILABLE",
              message:
                "This SVG mixes fills and strokes, so changing only stroke widths would not preserve its visual relationships.",
            }
          : {
              code: "VARIANT_GENERATION_SOURCE_UNSUPPORTED",
              message:
                "Generating all variants requires a valid stroke-only centerline SVG without explicit SF Symbol masters.",
            };
      parsed.diagnostics.push(
        error(
          unsupported.code,
          "geometry",
          unsupported.message,
        ),
      );
      return finalizePrepared(parsed, sourceProfile, options);
    }
    if (!geometry) {
      const parsed = normalized();
      parsed.diagnostics.push(
        error(
          "CENTERLINE_GEOMETRY_ENGINE_REQUIRED",
          "geometry",
          "Centerline variant generation requires the PathKit geometry engine.",
        ),
      );
      return finalizePrepared(parsed, sourceProfile, options);
    }

    const synthesized = synthesizeCenterlineDocument(document, geometry, {
      ...(options.background === undefined
        ? {}
        : { background: options.background }),
      ...options.synthesis,
    });
    const diagnostics = [...synthesized.normalized.diagnostics];
    if ((sourceProfile.strokeSummary?.widths.length ?? 0) > 1) {
      diagnostics.push(
        {
          code: "MULTIPLE_STROKE_WIDTHS_PRESERVED",
          severity: "warning",
          stage: "geometry",
          message:
            "Multiple source stroke widths were preserved proportionally across synthesized weights and scales.",
        },
      );
    }
    return finalizePrepared({
      ...synthesized.normalized,
      diagnostics,
    }, sourceProfile, options);
  } catch (cause) {
    const diagnostics =
      cause instanceof ConversionError
        ? cause.diagnostics
        : [error("SVG_CONVERSION_FAILED", "parse", cause instanceof Error ? cause.message : String(cause))];
    return {
      diagnostics,
      width: 0,
      height: 0,
      masters: [],
      paths: [],
      rendering: emptyRenderingAnalysis(),
      sourceElementCount: 0,
      sourceProfile: EMPTY_SOURCE_PROFILE,
    };
  }
}

export function analyzeSvg(
  source: string,
  geometry?: GeometryEngine,
  options: ConvertOptions = {},
): SvgAnalysis {
  const parsed = prepare(source, geometry, options);
  return analysisFromParsed(parsed);
}

export function convertSvg(
  source: string,
  options: ConvertOptions = {},
  geometry?: GeometryEngine,
): ConversionResult {
  const parsed = prepare(source, geometry, options);
  const analysis = analysisFromParsed(parsed);
  if (!analysis.isConvertible) return { analysis };

  try {
    const artifact = createSymbolArtifact(parsed.masters, options);
    const validation = validateSymbol(artifact.symbolSvg);
    if (!validation.isValid) {
      return {
        analysis: {
          ...analysis,
          isConvertible: false,
          diagnostics: [...analysis.diagnostics, ...validation.diagnostics],
        },
      };
    }
    return { analysis, artifact };
  } catch (cause) {
    return {
      analysis: {
        ...failedAnalysis([
          ...analysis.diagnostics,
          error("SYMBOL_TEMPLATE_FAILED", "template", cause instanceof Error ? cause.message : String(cause)),
        ]),
        width: analysis.width,
        height: analysis.height,
        masterCount: analysis.masterCount,
        pathCount: analysis.pathCount,
        rendering: analysis.rendering,
        sourceElementCount: analysis.sourceElementCount,
        sourceProfile: analysis.sourceProfile,
        variants: analysis.variants,
      },
    };
  }
}
