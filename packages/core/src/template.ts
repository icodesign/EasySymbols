import { SVGPathData } from "svg-pathdata";

import type {
  NormalizedPath,
  RenderingAnalysis,
  RenderingColorToken,
  RenderingConfiguration,
  RenderingHierarchy,
  RenderingMode,
  SymbolArtifact,
  SymbolMaster,
  TemplateProfile,
} from "./types.js";
import {
  RENDERING_COLOR_HEX,
  analyzeRenderingMasters,
  nearestRenderingColorToken,
  previewOpacityForHierarchy,
  renderingModesForConfiguration,
  validateRenderingConfiguration,
} from "./rendering.js";
import {
  DEFAULT_SYMBOL_VARIANT,
  SYMBOL_SCALES,
  SYMBOL_WEIGHTS,
  sortSymbolVariants,
  type SymbolScale,
  type SymbolVariant,
  type SymbolWeight,
} from "./variants.js";

const APPLE_WEIGHT_CENTERS: Readonly<Record<SymbolWeight, number>> = {
  Ultralight: 559.711,
  Thin: 856.422,
  Light: 1153.133,
  Regular: 1449.844,
  Medium: 1746.555,
  Semibold: 2043.266,
  Bold: 2339.977,
  Heavy: 2636.688,
  Black: 2933.399,
};

const APPLE_SCALE_CAPLINES: Readonly<Record<SymbolScale, number>> = {
  S: 625.541,
  M: 1055.541,
  L: 1485.541,
};

const APPLE_SYMBOL_SLOT = { width: 110.89, height: 70 } as const;

const APPLE_VARIANT_SLOTS = Object.fromEntries(
  SYMBOL_WEIGHTS.flatMap((weight) =>
    SYMBOL_SCALES.map((scale) => {
      const center = APPLE_WEIGHT_CENTERS[weight];
      const y = APPLE_SCALE_CAPLINES[scale];
      return [
        `${weight}-${scale}` as SymbolVariant,
        {
          x: center - APPLE_SYMBOL_SLOT.width / 2,
          y,
          ...APPLE_SYMBOL_SLOT,
        },
      ];
    }),
  ),
) as Record<SymbolVariant, { x: number; y: number; width: number; height: number }>;

export const APPLE_V3_STATIC: TemplateProfile = {
  id: "apple-v3-static",
  templateVersion: "3.0",
  canvas: { width: 3300, height: 2200 },
  slots: {
    // Compact slots are used for in-browser previews. The exported SVG uses
    // the full Apple 3300×2200 coordinates from `variantSlots`.
    S: { x: 421, y: 76, width: 88, height: 70 },
    M: { x: 421, y: 276, width: 88, height: 70 },
    L: { x: 421, y: 476, width: 88, height: 70 },
  },
  variantSlots: APPLE_VARIANT_SLOTS,
  referenceVariant: "Regular-M",
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Slot = TemplateProfile["slots"][SymbolScale];

function slotForVariant(profile: TemplateProfile, variant: SymbolVariant): Slot {
  return (
    profile.variantSlots?.[variant] ??
    profile.slots[scaleForVariant(variant)]
  );
}

function previewSlotForVariant(
  profile: TemplateProfile,
  variant: SymbolVariant,
): Slot {
  return profile.slots[scaleForVariant(variant)];
}

type FittedPath = Pick<
  NormalizedPath,
  "d" | "sourceOrder" | "sourceShapeId"
>;

type FittedMaster = {
  origin: SymbolMaster["origin"];
  paths: FittedPath[];
  previewPaths: FittedPath[];
  variant: SymbolVariant;
};

/**
 * Normalizes a user-facing symbol name to the filename-safe name shared by
 * templates, symbolsets, asset catalogs, and generated package accessors.
 */
export function normalizeSymbolName(value: string | undefined): string {
  const withoutExtension = (value ?? "custom-symbol").replace(/\.svg$/i, "");
  const normalized = withoutExtension
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized || "custom-symbol";
}

/** Serializes a literal hex color into an Xcode color-set Contents.json. */
export function colorAssetContents(hex: string): string {
  const normalized = hex.replace(/^#/, "").toUpperCase();
  return `${JSON.stringify(
    {
      colors: [
        {
          idiom: "universal",
          color: {
            "color-space": "srgb",
            components: {
              alpha: "1.000",
              blue: `0x${normalized.slice(4, 6)}`,
              green: `0x${normalized.slice(2, 4)}`,
              red: `0x${normalized.slice(0, 2)}`,
            },
          },
        },
      ],
      info: { author: "easysymbols", version: 1 },
    },
    null,
    2,
  )}\n`;
}

function pathBounds(paths: NormalizedPath[]): Bounds {
  return paths.reduce(
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
}

function scaleForVariant(variant: SymbolVariant): SymbolScale {
  return variant.slice(variant.lastIndexOf("-") + 1) as SymbolScale;
}

function fitPaths(
  paths: NormalizedPath[],
  scale: number,
  slot: Slot,
): FittedPath[] {
  const bounds = pathBounds(paths);
  const sourceWidth = bounds.maxX - bounds.minX;
  const sourceHeight = bounds.maxY - bounds.minY;
  if (!(sourceWidth > 0 && sourceHeight > 0)) {
    throw new Error("The rendered SVG bounds must have positive width and height.");
  }

  const targetCenterX = slot.x + slot.width / 2;
  const targetCenterY = slot.y + slot.height / 2;
  const sourceCenterX = (bounds.minX + bounds.maxX) / 2;
  const sourceCenterY = (bounds.minY + bounds.maxY) / 2;
  const translateX = targetCenterX - sourceCenterX * scale;
  const translateY = targetCenterY - sourceCenterY * scale;

  return paths.map((path) => ({
    d: new SVGPathData(path.d)
      .matrix(scale, 0, 0, scale, translateX, translateY)
      .round(10_000_000)
      .encode(),
    sourceOrder: path.sourceOrder,
    sourceShapeId: path.sourceShapeId,
  }));
}

function canonicalScale(
  referencePaths: NormalizedPath[],
  padding: number,
  slot: Slot,
): number {
  const bounds = pathBounds(referencePaths);
  const sourceWidth = bounds.maxX - bounds.minX;
  const sourceHeight = bounds.maxY - bounds.minY;
  if (!(sourceWidth > 0 && sourceHeight > 0)) {
    throw new Error("The rendered SVG bounds must have positive width and height.");
  }

  const availableWidth = slot.width * (1 - padding * 2);
  const availableHeight = slot.height * (1 - padding * 2);
  return Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
}

function layerIndexByShapeId(
  analysis: RenderingAnalysis,
): ReadonlyMap<string, number> {
  return new Map(
    analysis.layers.flatMap((layer, index) =>
      layer.shapeIds.map((shapeId) => [shapeId, index] as const),
    ),
  );
}

type SymbolColorOutput = "portable" | "asset";

function colorAssetName(symbolName: string, layerIndex: number): string {
  const safeName = symbolName.replace(/[^A-Za-z0-9_]/g, "_");
  return `easysymbols_${safeName}_layer${layerIndex}_color`;
}

function multicolorAnnotation(
  layer: RenderingAnalysis["layers"][number],
  index: number,
  configuration: RenderingConfiguration | undefined,
  output: SymbolColorOutput,
  colorAssetNames: Readonly<Record<string, string>>,
): { name: string; fill: string } | undefined {
  const token = configuration?.multicolor?.layers[layer.id];
  if (!token) return undefined;
  const override = configuration?.multicolor?.colors?.[layer.id];
  if (override && output === "asset") {
    return {
      name: colorAssetNames[layer.id] ?? colorAssetName("custom-symbol", index),
      fill: override,
    };
  }
  const portableToken = override
    ? nearestRenderingColorToken(override)
    : token === "customColor"
      ? "tintColor"
      : token;
  return {
    name: portableToken,
    fill: RENDERING_COLOR_HEX[portableToken],
  };
}

function annotationStyles(
  analysis: RenderingAnalysis,
  configuration: RenderingConfiguration | undefined,
  output: SymbolColorOutput,
  colorAssetNames: Readonly<Record<string, string>>,
): string {
  if (!configuration?.hierarchical && !configuration?.multicolor) return "";
  const rules = analysis.layers.flatMap((layer, index) => {
    const layerRules = [`.monochrome-${index} {fill:#000000}`];
    const hierarchy = configuration.hierarchical?.layers[layer.id];
    if (hierarchy) {
      layerRules.push(`.hierarchical-${index}:${hierarchy} {fill:#000000}`);
    }
    const color = multicolorAnnotation(
      layer,
      index,
      configuration,
      output,
      colorAssetNames,
    );
    if (color) {
      layerRules.push(
        `.multicolor-${index}:${color.name} {fill:${color.fill.toUpperCase()}}`,
      );
    }
    return layerRules;
  });
  return `  <style>\n${rules.join("\n")}\n  </style>\n`;
}

function annotationClass(
  path: FittedPath,
  analysis: RenderingAnalysis,
  configuration: RenderingConfiguration | undefined,
  indices: ReadonlyMap<string, number>,
  output: SymbolColorOutput,
  colorAssetNames: Readonly<Record<string, string>>,
): string | undefined {
  if (!configuration?.hierarchical && !configuration?.multicolor) {
    return undefined;
  }
  const index = indices.get(path.sourceShapeId);
  const layer = index === undefined ? undefined : analysis.layers[index];
  if (index === undefined || !layer) {
    throw new Error(
      `No rendering layer matches source shape ${path.sourceShapeId}.`,
    );
  }
  const classes = [`monochrome-${index}`];
  const color = multicolorAnnotation(
    layer,
    index,
    configuration,
    output,
    colorAssetNames,
  );
  if (color) {
    classes.push(`multicolor-${index}:${color.name}`);
  }
  const hierarchy = configuration.hierarchical?.layers[layer.id];
  if (hierarchy) classes.push(`hierarchical-${index}:${hierarchy}`);
  return classes.join(" ");
}

function localPathForMaster(path: FittedPath, slot: Slot): string {
  const baseline = slot.y + slot.height;
  return new SVGPathData(path.d)
    .matrix(1, 0, 0, 1, -slot.x, -baseline)
    .round(10_000_000)
    .encode();
}

function symbolSvg(
  masters: FittedMaster[],
  profile: TemplateProfile,
  analysis: RenderingAnalysis,
  configuration: RenderingConfiguration | undefined,
  output: SymbolColorOutput,
  colorAssetNames: Readonly<Record<string, string>>,
): string {
  const indices = layerIndexByShapeId(analysis);
  const marginPaths = masters
    .map((master) => {
      const slot = slotForVariant(profile, master.variant);
      const left = slot.x;
      const right = slot.x + slot.width;
      const top = slot.y - 24.757;
      const bottom = slot.y + slot.height + 24.121;
      return `    <line id="left-margin-${master.variant}" style="fill:none;stroke:#00AEEF;stroke-width:0.5;opacity:1.0;" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"/>\n    <line id="right-margin-${master.variant}" style="fill:none;stroke:#00AEEF;stroke-width:0.5;opacity:1.0;" x1="${right}" x2="${right}" y1="${top}" y2="${bottom}"/>`;
    })
    .join("\n");
  const symbolGroups = masters
    .map((master) => {
      const slot = slotForVariant(profile, master.variant);
      const baseline = slot.y + slot.height;
      const paths = master.paths.map((path) => {
        const className = annotationClass(
          path,
          analysis,
          configuration,
          indices,
          output,
          colorAssetNames,
        );
        const localPath = localPathForMaster(path, slot);
        return `      <path${className ? ` class="${className}"` : ""} d="${localPath}"/>`;
      });
      return `    <g id="${master.variant}" transform="matrix(1 0 0 1 ${slot.x} ${baseline})">
${paths.join("\n")}
    </g>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Generator: EasySymbols; template schema follows Apple Custom SF Symbols v${profile.templateVersion} -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${profile.canvas.width}" height="${profile.canvas.height}">
${annotationStyles(analysis, configuration, output, colorAssetNames)}  <g id="Notes" font-family="'Helvetica Neue', sans-serif" font-size="9px">
    <rect id="artboard" x="0" y="0" width="${profile.canvas.width}" height="${profile.canvas.height}" style="fill:white;opacity:1"/>
    <text id="template-version" x="3036" y="1933" text-anchor="end">Template v.${profile.templateVersion}</text>
  </g>
  <g id="Guides" stroke="rgb(39,170,225)" stroke-width="0.5">
    <path id="Capline-S" d="M263 ${APPLE_SCALE_CAPLINES.S}H3036"/>
    <path id="Baseline-S" d="M263 ${APPLE_SCALE_CAPLINES.S + 70}H3036"/>
    <path id="Capline-M" d="M263 ${APPLE_SCALE_CAPLINES.M}H3036"/>
    <path id="Baseline-M" d="M263 ${APPLE_SCALE_CAPLINES.M + 70}H3036"/>
    <path id="Capline-L" d="M263 ${APPLE_SCALE_CAPLINES.L}H3036"/>
    <path id="Baseline-L" d="M263 ${APPLE_SCALE_CAPLINES.L + 70}H3036"/>
${marginPaths}
  </g>
  <g id="Symbols">
${symbolGroups}
  </g>
</svg>
`;
}

function previewSvg(paths: FittedPath[], slot: Slot): string {
  const pad = 10;
  const x = slot.x - pad;
  const y = slot.y - pad;
  const width = slot.width + pad * 2;
  const height = slot.height + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" fill="currentColor">${paths.map((path) => `<path d="${path.d}"/>`).join("")}</svg>`;
}

const PALETTE_PREVIEW_COLORS: Readonly<
  Record<RenderingHierarchy, string>
> = {
  primary: "#1688f5",
  secondary: "#7657e8",
  tertiary: "#ef8b45",
};

function renderingPreviewSvg(
  paths: FittedPath[],
  slot: Slot,
  mode: Exclude<RenderingMode, "monochrome">,
  analysis: RenderingAnalysis,
  configuration: RenderingConfiguration | undefined,
): string {
  const pad = 10;
  const x = slot.x - pad;
  const y = slot.y - pad;
  const width = slot.width + pad * 2;
  const height = slot.height + pad * 2;
  const indices = layerIndexByShapeId(analysis);
  const hierarchy = Object.fromEntries(
    analysis.layers.map((layer) => [
      layer.id,
      configuration?.hierarchical?.layers[layer.id] ??
        layer.suggestedHierarchy,
    ]),
  ) as Record<string, RenderingHierarchy>;
  const colors = Object.fromEntries(
    analysis.layers.map((layer) => [
      layer.id,
      configuration?.multicolor?.layers[layer.id] ??
        layer.suggestedMulticolor,
    ]),
  ) as Record<string, RenderingColorToken>;
  const renderedPaths = paths.map((path) => {
    const index = indices.get(path.sourceShapeId);
    const layer = index === undefined ? undefined : analysis.layers[index];
    if (!layer) {
      throw new Error(
        `No rendering preview layer matches source shape ${path.sourceShapeId}.`,
      );
    }
    const level = hierarchy[layer.id] ?? "primary";
    const fill =
      mode === "multicolor"
        ? configuration?.multicolor?.colors?.[layer.id] ??
          (colors[layer.id] === "tintColor"
            ? "currentColor"
            : RENDERING_COLOR_HEX[colors[layer.id] ?? "tintColor"])
        : mode === "palette"
          ? PALETTE_PREVIEW_COLORS[level]
          : "currentColor";
    const opacity =
      mode === "hierarchical"
        ? ` opacity="${previewOpacityForHierarchy(level)}"`
        : "";
    return `<path data-layer-id="${layer.id}" fill="${fill}"${opacity} d="${path.d}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}">${renderedPaths.join("")}</svg>`;
}

export function createSymbolArtifact(
  masters: SymbolMaster[],
  options: {
    name?: string;
    padding?: number;
    rendering?: RenderingConfiguration;
  },
  profile: TemplateProfile = APPLE_V3_STATIC,
): SymbolArtifact {
  const name = normalizeSymbolName(options.name);
  const padding = Math.min(0.4, Math.max(0, options.padding ?? 0.08));
  const variantOrder = sortSymbolVariants(masters.map((master) => master.variant));
  const orderIndex = new Map(variantOrder.map((variant, index) => [variant, index]));
  const sortedMasters = [...masters].sort(
    (left, right) =>
      (orderIndex.get(left.variant) ?? Number.MAX_SAFE_INTEGER) -
      (orderIndex.get(right.variant) ?? Number.MAX_SAFE_INTEGER),
  );
  const referenceMaster =
    sortedMasters.find((master) => master.variant === profile.referenceVariant) ??
    sortedMasters[0];
  if (!referenceMaster) {
    throw new Error("At least one symbol master is required.");
  }
  const rendering = analyzeRenderingMasters(sortedMasters);
  const renderingDiagnostics = validateRenderingConfiguration(
    rendering,
    options.rendering,
  );
  if (renderingDiagnostics.length > 0) {
    throw new Error(
      renderingDiagnostics.map((diagnostic) => diagnostic.message).join(" "),
    );
  }
  const referenceSlot = previewSlotForVariant(profile, referenceMaster.variant);
  const scale = canonicalScale(referenceMaster.paths, padding, referenceSlot);
  const fittedMasters = sortedMasters.map((master) => ({
    origin: master.origin,
    paths: fitPaths(master.paths, scale, slotForVariant(profile, master.variant)),
    previewPaths: fitPaths(
      master.paths,
      scale,
      previewSlotForVariant(profile, master.variant),
    ),
    variant: master.variant,
  }));
  const previewMaster =
    fittedMasters.find((master) => master.variant === DEFAULT_SYMBOL_VARIANT) ??
    fittedMasters[0];
  if (!previewMaster) {
    throw new Error("At least one symbol master is required.");
  }
  const masterPreviews = Object.fromEntries(
    fittedMasters.map((master) => [
      master.variant,
      {
        origin: master.origin,
        svg: previewSvg(
          master.previewPaths,
          previewSlotForVariant(profile, master.variant),
        ),
      },
    ]),
  ) as SymbolArtifact["masterPreviews"];
  const defaultPreviewSvg = masterPreviews[previewMaster.variant]?.svg;
  if (!defaultPreviewSvg) {
    throw new Error("The default symbol master preview could not be generated.");
  }
  const previewColor = [...masters]
    .reverse()
    .flatMap((master) => [...master.paths].reverse())
    .find((path) => path.previewColor)?.previewColor;
  const renderingModes = renderingModesForConfiguration(options.rendering);
  const previewSlot = previewSlotForVariant(profile, previewMaster.variant);
  const renderingPreviewMasters = (
    mode: Exclude<RenderingMode, "monochrome">,
  ): Partial<Record<SymbolVariant, string>> =>
    Object.fromEntries(
      fittedMasters.map((master) => [
        master.variant,
        renderingPreviewSvg(
          master.previewPaths,
          previewSlotForVariant(profile, master.variant),
          mode,
          rendering,
          options.rendering,
        ),
      ]),
    );
  const renderingPreviews: SymbolArtifact["renderingPreviews"] = {
    monochrome: {
      enabled: true,
      source: "configured",
      svg: defaultPreviewSvg,
    },
  };
  if (rendering.modes.hierarchical.status !== "unavailable") {
    const source = options.rendering?.hierarchical
      ? "configured"
      : "suggested";
    renderingPreviews.hierarchical = {
      enabled: Boolean(options.rendering?.hierarchical),
      source,
      masters: renderingPreviewMasters("hierarchical"),
      svg: renderingPreviewSvg(
        previewMaster.previewPaths,
        previewSlot,
        "hierarchical",
        rendering,
        options.rendering,
      ),
    };
    renderingPreviews.palette = {
      enabled: Boolean(options.rendering?.hierarchical),
      source,
      masters: renderingPreviewMasters("palette"),
      svg: renderingPreviewSvg(
        previewMaster.previewPaths,
        previewSlot,
        "palette",
        rendering,
        options.rendering,
      ),
    };
  }
  if (rendering.modes.multicolor.status !== "unavailable") {
    renderingPreviews.multicolor = {
      enabled: Boolean(options.rendering?.multicolor),
      source: options.rendering?.multicolor ? "configured" : "suggested",
      masters: renderingPreviewMasters("multicolor"),
      svg: renderingPreviewSvg(
        previewMaster.previewPaths,
        previewSlot,
        "multicolor",
        rendering,
        options.rendering,
      ),
    };
  }
  const colorAssetNames = Object.fromEntries(
    rendering.layers.flatMap((layer, index) => {
      const color = options.rendering?.multicolor?.colors?.[layer.id];
      return color
        ? [[layer.id, colorAssetName(name, index)] as const]
        : [];
    }),
  );
  const colorAssets = Object.fromEntries(
    rendering.layers.flatMap((layer) => {
      const color = options.rendering?.multicolor?.colors?.[layer.id];
      const assetName = colorAssetNames[layer.id];
      return color && assetName ? [[assetName, color] as const] : [];
    }),
  );
  return {
    name,
    ...(previewColor ? { previewColor } : {}),
    symbolSvg: symbolSvg(
      fittedMasters,
      profile,
      rendering,
      options.rendering,
      "portable",
      colorAssetNames,
    ),
    ...(Object.keys(colorAssets).length > 0
      ? {
          assetSymbolSvg: symbolSvg(
            fittedMasters,
            profile,
            rendering,
            options.rendering,
            "asset",
            colorAssetNames,
          ),
          colorAssets,
        }
      : {}),
    previewSvg: defaultPreviewSvg,
    masterPreviews,
    renderingModes,
    renderingPreviews,
    symbolsetContents: `${JSON.stringify(
      {
        info: { author: "easysymbols", version: 1 },
        symbols: [{ filename: `${name}.svg`, idiom: "universal" }],
      },
      null,
      2,
    )}\n`,
    variants: fittedMasters.map((master) => master.variant),
  };
}
