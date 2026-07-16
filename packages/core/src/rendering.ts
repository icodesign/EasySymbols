import { error } from "./errors.js";
import type {
  Diagnostic,
  RenderingAnalysis,
  RenderingColorToken,
  RenderingConfiguration,
  RenderingHierarchy,
  RenderingLayerCandidate,
  RenderingMode,
  RenderingModeCapability,
  SymbolMaster,
} from "./types.js";
import { DEFAULT_SYMBOL_VARIANT } from "./variants.js";

export const RENDERING_HIERARCHIES = [
  "primary",
  "secondary",
  "tertiary",
] as const satisfies readonly RenderingHierarchy[];

export const RENDERING_COLOR_TOKENS = [
  "tintColor",
  "systemRedColor",
  "systemOrangeColor",
  "systemYellowColor",
  "systemGreenColor",
  "systemBlueColor",
  "white",
  "customColor",
] as const satisfies readonly RenderingColorToken[];

export const RENDERING_COLOR_HEX = {
  tintColor: "#007aff",
  systemRedColor: "#ff3b30",
  systemOrangeColor: "#ff9500",
  systemYellowColor: "#ffcc00",
  systemGreenColor: "#34c759",
  systemBlueColor: "#007aff",
  white: "#ffffff",
  customColor: "#000000",
} as const satisfies Readonly<Record<RenderingColorToken, string>>;

const HIERARCHY_OPACITY: Readonly<Record<RenderingHierarchy, number>> = {
  primary: 1,
  secondary: 0.55,
  tertiary: 0.28,
};

export function previewOpacityForHierarchy(
  hierarchy: RenderingHierarchy,
): number {
  return HIERARCHY_OPACITY[hierarchy];
}

function capability(
  status: RenderingModeCapability["status"],
  reason: string,
): RenderingModeCapability {
  return { reason, status };
}

export function emptyRenderingAnalysis(): RenderingAnalysis {
  return {
    annotatable: false,
    layers: [],
    modes: {
      monochrome: capability(
        "unavailable",
        "No normalized artwork is available.",
      ),
      hierarchical: capability(
        "unavailable",
        "No normalized artwork is available.",
      ),
      palette: capability(
        "unavailable",
        "No normalized artwork is available.",
      ),
      multicolor: capability(
        "unavailable",
        "No normalized artwork is available.",
      ),
    },
  };
}

function rgb(hex: string): readonly [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) return undefined;
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

function suggestedColorToken(color: string | undefined): RenderingColorToken {
  if (!color) return "tintColor";
  const source = rgb(color);
  if (!source) return "tintColor";
  const [red, green, blue] = source;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  if (maximum - minimum < 32) {
    return minimum > 224 ? "white" : "tintColor";
  }

  const candidates = RENDERING_COLOR_TOKENS.filter(
    (token) =>
      token !== "tintColor" && token !== "white" && token !== "customColor",
  );
  return candidates.reduce<RenderingColorToken>((closest, token) => {
    const candidate = rgb(RENDERING_COLOR_HEX[token]);
    const current = rgb(RENDERING_COLOR_HEX[closest]);
    if (!candidate || !current) return closest;
    const distance = candidate.reduce(
      (sum, channel, index) => sum + (channel - (source[index] ?? 0)) ** 2,
      0,
    );
    const currentDistance = current.reduce(
      (sum, channel, index) => sum + (channel - (source[index] ?? 0)) ** 2,
      0,
    );
    return distance < currentDistance ? token : closest;
  }, "systemBlueColor");
}

/**
 * Resolves a literal editor color to an Apple system color for standalone SVG
 * exports. Literal multicolor names only resolve when the matching named color
 * exists in the consuming asset catalog; a system token keeps a bare SVG
 * usable in SF Symbols and Xcode on its own.
 */
export function nearestRenderingColorToken(
  color: string | undefined,
): Exclude<RenderingColorToken, "customColor"> {
  const token = suggestedColorToken(color);
  return token === "customColor" ? "tintColor" : token;
}

function sameShapeModel(
  reference: SymbolMaster,
  candidate: SymbolMaster,
): boolean {
  const referencePaths = [...reference.paths].sort(
    (left, right) => left.sourceOrder - right.sourceOrder,
  );
  const candidatePaths = [...candidate.paths].sort(
    (left, right) => left.sourceOrder - right.sourceOrder,
  );
  if (referencePaths.length !== candidatePaths.length) return false;
  return referencePaths.every((path, index) => {
    const other = candidatePaths[index];
    if (!other || path.sourceShapeId !== other.sourceShapeId) return false;
    if (
      path.sourceElementId &&
      other.sourceElementId &&
      path.sourceElementId !== other.sourceElementId
    ) {
      return false;
    }
    if (path.sourceHierarchy !== other.sourceHierarchy) return false;
    if (path.sourceMulticolor !== other.sourceMulticolor) return false;
    return true;
  });
}

function layerLabel(
  path: SymbolMaster["paths"][number],
  index: number,
): string {
  return (
    path.sourceElementId ??
    path.sourceGroupIds.at(-1) ??
    `${path.sourceRole === "fill" ? "Fill" : "Stroke"} ${index + 1}`
  );
}

function hierarchySuggestions(opacities: readonly number[]): RenderingHierarchy[] {
  const levels = [...new Set(opacities.map((opacity) => opacity.toFixed(4)))]
    .map(Number)
    .sort((left, right) => right - left);
  if (levels.length === 1) return opacities.map(() => "primary");

  return opacities.map((opacity) => {
    const rank = levels.findIndex((value) => Math.abs(value - opacity) < 0.0001);
    if (rank <= 0) return "primary";
    if (levels.length >= 3 && rank === levels.length - 1) return "tertiary";
    return "secondary";
  });
}

/**
 * Examines normalized source evidence and proposes, but does not enable,
 * rendering layers. Shape order is the stable contract shared by all masters.
 */
export function analyzeRenderingMasters(
  masters: readonly SymbolMaster[],
): RenderingAnalysis {
  const reference =
    masters.find((master) => master.variant === DEFAULT_SYMBOL_VARIANT) ??
    masters[0];
  if (!reference || reference.paths.length === 0) {
    return emptyRenderingAnalysis();
  }

  const referencePaths = [...reference.paths].sort(
    (left, right) => left.sourceOrder - right.sourceOrder,
  );
  const uniqueShapeIds = new Set(
    referencePaths.map((path) => path.sourceShapeId),
  );
  const annotatable =
    uniqueShapeIds.size === referencePaths.length &&
    masters.every((master) => sameShapeModel(reference, master));
  const hierarchy = hierarchySuggestions(
    referencePaths.map((path) => path.sourceOpacity),
  );
  const baseLabels = referencePaths.map((path, index) =>
    layerLabel(path, index),
  );
  const labelCounts = baseLabels.reduce<Map<string, number>>((counts, label) => {
    counts.set(label, (counts.get(label) ?? 0) + 1);
    return counts;
  }, new Map());
  const layers: RenderingLayerCandidate[] = referencePaths.map(
    (path, index) => ({
      ...(path.sourceHierarchy
        ? { authoredHierarchy: path.sourceHierarchy }
        : {}),
      ...(path.sourceMulticolor
        ? { authoredMulticolor: path.sourceMulticolor }
        : {}),
      id: path.sourceShapeId,
      label:
        (labelCounts.get(baseLabels[index] ?? "") ?? 0) > 1
          ? `${baseLabels[index]} ${path.sourceRole} ${index + 1}`
          : (baseLabels[index] ?? `Layer ${index + 1}`),
      order: index,
      shapeIds: [path.sourceShapeId],
      ...(path.previewColor ? { sourceColor: path.previewColor } : {}),
      sourceOpacity: path.sourceOpacity,
      sourceRole: path.sourceRole,
      suggestedHierarchy:
        path.sourceHierarchy ?? hierarchy[index] ?? "primary",
      suggestedMulticolor:
        path.sourceMulticolor ?? suggestedColorToken(path.previewColor),
    }),
  );
  const distinctOpacities = new Set(
    layers.map((layer) => layer.sourceOpacity.toFixed(4)),
  ).size;
  const literalColors = layers
    .map((layer) => layer.sourceColor)
    .filter((color): color is string => color !== undefined);
  const distinctColors = new Set(literalColors).size;
  const hasAuthoredHierarchy = layers.some(
    (layer) => layer.authoredHierarchy !== undefined,
  );
  const hasAuthoredMulticolor = layers.some(
    (layer) => layer.authoredMulticolor !== undefined,
  );

  let hierarchical: RenderingModeCapability;
  if (!annotatable) {
    hierarchical = capability(
      "unavailable",
      "Authored masters do not share one ordered shape model.",
    );
  } else if (hasAuthoredHierarchy) {
    hierarchical = capability(
      "detected",
      "The SVG already contains Apple hierarchical layer annotations.",
    );
  } else if (distinctOpacities > 1) {
    hierarchical = capability(
      "detected",
      "Different source opacity levels provide a deterministic hierarchy suggestion.",
    );
  } else if (layers.length === 1) {
    hierarchical = capability(
      "configurable",
      "A single shape can opt into Primary hierarchy; it renders like monochrome until more layers are assigned.",
    );
  } else {
    hierarchical = capability(
      "configurable",
      "Multiple shapes are available, but the SVG does not declare their hierarchy.",
    );
  }

  let multicolor: RenderingModeCapability;
  if (!annotatable) {
    multicolor = capability(
      "unavailable",
      "Authored masters do not share one ordered shape model.",
    );
  } else if (hasAuthoredMulticolor) {
    multicolor = capability(
      "detected",
      "The SVG already contains Apple multicolor layer annotations.",
    );
  } else if (distinctColors > 1) {
    multicolor = capability(
      "detected",
      "Multiple literal source colors provide deterministic color-role suggestions.",
    );
  } else {
    multicolor = capability(
      "configurable",
      "The SVG does not contain multiple literal colors; color roles can still be assigned manually.",
    );
  }

  return {
    annotatable,
    layers,
    modes: {
      monochrome: capability(
        "ready",
        "Every converted symbol includes monochrome rendering.",
      ),
      hierarchical,
      palette: {
        ...hierarchical,
        reason:
          hierarchical.status === "unavailable"
            ? hierarchical.reason
            : "Palette rendering reuses the same Primary, Secondary, and Tertiary layer annotation.",
      },
      multicolor,
    },
    referenceVariant: reference.variant,
  };
}

function validateLayerAssignments<T extends string>(
  name: string,
  assignments: Readonly<Record<string, T>>,
  layers: readonly RenderingLayerCandidate[],
  allowed: readonly string[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const layerIds = new Set(layers.map((layer) => layer.id));
  const assignmentIds = Object.keys(assignments);
  const missing = layers.filter((layer) => assignments[layer.id] === undefined);
  const unknown = assignmentIds.filter((id) => !layerIds.has(id));
  const invalid = assignmentIds.filter(
    (id) => !allowed.includes(assignments[id] ?? ""),
  );
  if (missing.length > 0) {
    diagnostics.push(
      error(
        "RENDERING_LAYER_ASSIGNMENT_INCOMPLETE",
        "template",
        `${name} must assign every detected layer. Missing: ${missing.map((layer) => layer.label).join(", ")}.`,
      ),
    );
  }
  if (unknown.length > 0) {
    diagnostics.push(
      error(
        "RENDERING_LAYER_ASSIGNMENT_UNKNOWN",
        "template",
        `${name} references unknown layer IDs: ${unknown.join(", ")}.`,
      ),
    );
  }
  if (invalid.length > 0) {
    diagnostics.push(
      error(
        "RENDERING_LAYER_ASSIGNMENT_INVALID",
        "template",
        `${name} contains unsupported values for: ${invalid.join(", ")}.`,
      ),
    );
  }
  return diagnostics;
}

function validateLayerColorOverrides(
  colors: Readonly<Record<string, string>>,
  layers: readonly RenderingLayerCandidate[],
): Diagnostic[] {
  const layerIds = new Set(layers.map((layer) => layer.id));
  const unknown = Object.keys(colors).filter((id) => !layerIds.has(id));
  const invalid = Object.entries(colors)
    .filter(([, color]) => !/^#[0-9a-f]{6}$/i.test(color))
    .map(([id]) => id);
  const diagnostics: Diagnostic[] = [];
  if (unknown.length > 0) {
    diagnostics.push(
      error(
        "RENDERING_COLOR_OVERRIDE_UNKNOWN",
        "template",
        `Multicolor color overrides reference unknown layer IDs: ${unknown.join(", ")}.`,
      ),
    );
  }
  if (invalid.length > 0) {
    diagnostics.push(
      error(
        "RENDERING_COLOR_OVERRIDE_INVALID",
        "template",
        `Multicolor color overrides must be six-digit hex colors: ${invalid.join(", ")}.`,
      ),
    );
  }
  return diagnostics;
}

function validateCustomColorTokens(
  assignments: Readonly<Record<string, RenderingColorToken>>,
  colors: Readonly<Record<string, string>> | undefined,
): Diagnostic[] {
  const missing = Object.entries(assignments)
    .filter(([layerId, token]) => token === "customColor" && !colors?.[layerId])
    .map(([layerId]) => layerId);
  if (missing.length === 0) return [];
  return [
    error(
      "RENDERING_CUSTOM_COLOR_MISSING",
      "template",
      `Custom multicolor assignments need a hex color for: ${missing.join(", ")}.`,
    ),
  ];
}

export function validateRenderingConfiguration(
  analysis: RenderingAnalysis,
  configuration: RenderingConfiguration | undefined,
): Diagnostic[] {
  if (!configuration?.hierarchical && !configuration?.multicolor) return [];
  if (!analysis.annotatable) {
    return [
      error(
        "RENDERING_MASTER_TOPOLOGY_MISMATCH",
        "template",
        "Rendering annotations require every authored master to expose the same ordered shape model.",
      ),
    ];
  }

  const diagnostics: Diagnostic[] = [];
  if (configuration.hierarchical) {
    diagnostics.push(
      ...validateLayerAssignments(
        "Hierarchical rendering",
        configuration.hierarchical.layers,
        analysis.layers,
        RENDERING_HIERARCHIES,
      ),
    );
  }
  if (configuration.multicolor) {
    diagnostics.push(
      ...validateLayerAssignments(
        "Multicolor rendering",
        configuration.multicolor.layers,
        analysis.layers,
        RENDERING_COLOR_TOKENS,
      ),
    );
    if (configuration.multicolor.colors) {
      diagnostics.push(
        ...validateLayerColorOverrides(
          configuration.multicolor.colors,
          analysis.layers,
        ),
      );
    }
    diagnostics.push(
      ...validateCustomColorTokens(
        configuration.multicolor.layers,
        configuration.multicolor.colors,
      ),
    );
  }
  return diagnostics;
}

export function renderingModesForConfiguration(
  configuration: RenderingConfiguration | undefined,
): RenderingMode[] {
  const modes: RenderingMode[] = ["monochrome"];
  if (configuration?.hierarchical) modes.push("hierarchical", "palette");
  if (configuration?.multicolor) modes.push("multicolor");
  return modes;
}
