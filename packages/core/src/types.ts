import type { SymbolScale, SymbolVariant, SymbolWeight } from "./variants.js";
import type { OpticalScaleFactors } from "./scale-calibration.js";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticStage =
  | "parse"
  | "geometry"
  | "template"
  | "validation";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  stage: DiagnosticStage;
  message: string;
  elementId?: string;
}

export type BackgroundMode = "auto" | "keep";
/**
 * Selects whether conversion should preserve a static master or use a
 * centerline-stroke model for variant synthesis. This describes geometry, not
 * an icon library or a file-name convention.
 */
export type GeometryMode = "auto" | "static" | "centerline";
/**
 * `all` is exact centerline synthesis. `approximate-scales` deliberately
 * limits outlined artwork to three whole-artwork optical-scale masters.
 */
export type VariantMode = "authored" | "all" | "approximate-scales";
export type MasterOrigin = "authored" | "generated" | "approximate";
export type RenderingMode =
  | "monochrome"
  | "hierarchical"
  | "palette"
  | "multicolor";
export type RenderingHierarchy = "primary" | "secondary" | "tertiary";
/**
 * Color roles understood by Apple's custom-symbol SVG schema. These are
 * semantic class tokens or the stable constant used for an explicit custom
 * color selected in the layer editor.
 */
export type RenderingColorToken =
  | "tintColor"
  | "systemRedColor"
  | "systemOrangeColor"
  | "systemYellowColor"
  | "systemGreenColor"
  | "systemBlueColor"
  | "white"
  | "customColor";
export type RenderingCapabilityStatus =
  | "ready"
  | "detected"
  | "configurable"
  | "unavailable";
export type GeometryModel =
  | "centerline-stroke"
  | "filled-outline"
  | "mixed"
  | "sf-symbol-template"
  | "empty";

export type { SymbolScale, SymbolVariant, SymbolWeight } from "./variants.js";

export interface ConvertOptions {
  /** How a canvas-sized first fill is handled before monochrome conversion. */
  background?: BackgroundMode;
  /** Output asset name. It is normalized to an Xcode-safe filename. */
  name?: string;
  /** Fraction of the symbol slot reserved on every edge. Range: 0...0.4. */
  padding?: number;
  /** Select static conversion or the generic centerline-stroke profile. */
  geometry?: GeometryMode;
  /** Preserve only source masters or synthesize every SF weight and scale. */
  variants?: VariantMode;
  /** Parameters applied consistently to every source centerline stroke. */
  synthesis?: {
    /** Source master weight. Defaults to Regular. */
    referenceWeight?: SymbolWeight;
    /** Source master scale. Defaults to Medium. */
    referenceScale?: SymbolScale;
    /** Optical-size calibration used for Small, Medium, and Large. */
    scaleFactors?: OpticalScaleFactors;
    /** Multiplies all source stroke widths at the reference master. Defaults to 1. */
    strokeScale?: number;
  };
  /**
   * Controls opt-in S/M/L scaling for filled or mixed artwork. This never
   * invents weight variants; generated non-reference masters are marked
   * `approximate` in the artifact preview.
   */
  approximateScales?: {
    /** Which optical scale the input artwork already represents. Defaults to Medium. */
    referenceScale?: SymbolScale;
    /** Whole-artwork scale calibration used for Small, Medium, and Large. */
    scaleFactors?: OpticalScaleFactors;
  };
  /**
   * Explicitly approved rendering annotations. Automatic analysis only
   * proposes these values; it never enables a non-monochrome mode by itself.
   */
  rendering?: RenderingConfiguration;
}

export interface RenderingConfiguration {
  /** One hierarchy drives both hierarchical and palette runtime rendering. */
  hierarchical?: {
    layers: Record<string, RenderingHierarchy>;
  };
  /** Fixed semantic colors used when the symbol is rendered as multicolor. */
  multicolor?: {
    layers: Record<string, RenderingColorToken>;
    /**
     * Optional literal colors selected in the layer editor. The semantic
     * token remains in the exported class name for SF Symbols compatibility,
     * while this value preserves the editor's explicit color choice.
     */
    colors?: Record<string, string>;
  };
}

export interface RenderingLayerCandidate {
  authoredHierarchy?: RenderingHierarchy;
  authoredMulticolor?: RenderingColorToken;
  id: string;
  label: string;
  order: number;
  shapeIds: string[];
  sourceColor?: string;
  sourceOpacity: number;
  sourceRole: "fill" | "stroke";
  suggestedHierarchy: RenderingHierarchy;
  suggestedMulticolor: RenderingColorToken;
}

export interface RenderingModeCapability {
  reason: string;
  status: RenderingCapabilityStatus;
}

export interface RenderingAnalysis {
  /** False when authored masters do not expose the same ordered shape model. */
  annotatable: boolean;
  layers: RenderingLayerCandidate[];
  modes: Record<RenderingMode, RenderingModeCapability>;
  referenceVariant?: SymbolVariant;
}

export interface RenderingPreview {
  enabled: boolean;
  /** Preview renders keyed by the corresponding SF Symbol master variant. */
  masters?: Partial<Record<SymbolVariant, string>>;
  source: "configured" | "suggested";
  svg: string;
}

export interface StrokeSummary {
  caps: Array<"butt" | "round" | "square">;
  joins: Array<"bevel" | "miter" | "round">;
  /** Distinct local authoring widths, in ascending order. */
  widths: number[];
}

export interface SourceProfile {
  /** True only when the SVG can faithfully synthesize all 27 centerline masters. */
  canGenerateVariants: boolean;
  /** True when static outlined artwork may opt into approximate S/M/L masters. */
  canGenerateApproximateScaleVariants: boolean;
  geometryModel: GeometryModel;
  strokeSummary?: StrokeSummary;
}

export interface SvgAnalysis {
  diagnostics: Diagnostic[];
  height: number;
  isConvertible: boolean;
  masterCount: number;
  pathCount: number;
  rendering: RenderingAnalysis;
  sourceElementCount: number;
  sourceProfile: SourceProfile;
  variants: SymbolVariant[];
  width: number;
}

export interface SymbolArtifact {
  name: string;
  /** First opaque literal source color, used as the website preview default. */
  previewColor?: string;
  /** Portable SVG using system color tokens for standalone SF Symbols import. */
  symbolSvg: string;
  /**
   * SVG used inside an asset catalog. When custom multicolor colors are
   * configured, this version references the named colors listed in
   * `colorAssets` so Xcode can resolve the exact editor colors.
   */
  assetSymbolSvg?: string;
  /** Named asset-catalog colors required by `assetSymbolSvg`, keyed by name. */
  colorAssets?: Readonly<Record<string, string>>;
  symbolsetContents: string;
  previewSvg: string;
  /** Preview renders and their authorship keyed by SF Symbol master variant. */
  masterPreviews: Partial<
    Record<SymbolVariant, { origin: MasterOrigin; svg: string }>
  >;
  /** Runtime rendering modes encoded by the exported symbol. */
  renderingModes: RenderingMode[];
  /** Browser previews for enabled modes and safe, reviewable suggestions. */
  renderingPreviews: Partial<Record<RenderingMode, RenderingPreview>>;
  variants: SymbolVariant[];
}

export interface ConversionResult {
  analysis: SvgAnalysis;
  artifact?: SymbolArtifact;
}

export interface ValidationReport {
  diagnostics: Diagnostic[];
  isValid: boolean;
}

export interface TemplateProfile {
  id: "apple-v3-static";
  templateVersion: "3.0";
  canvas: { width: number; height: number };
  slots: Record<SymbolScale, { x: number; y: number; width: number; height: number }>;
  /**
   * Apple positions each weight in its own column. The scale-only slots are
   * retained as a fallback for custom profiles, while this map gives the
   * template writer the real 27-cell coordinate system.
   */
  variantSlots?: Partial<
    Record<SymbolVariant, { x: number; y: number; width: number; height: number }>
  >;
  referenceVariant: "Regular-M";
}

export interface NormalizedPath {
  d: string;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  previewColor?: string;
  sourceElementId?: string;
  sourceGroupIds: string[];
  sourceHierarchy?: RenderingHierarchy;
  sourceMulticolor?: RenderingColorToken;
  sourceOpacity: number;
  sourceOrder: number;
  sourcePaint: string;
  sourceRole: "fill" | "stroke";
  sourceShapeId: string;
  variant: SymbolVariant;
}

export interface SymbolMaster {
  origin: MasterOrigin;
  paths: NormalizedPath[];
  variant: SymbolVariant;
}

export interface ParsedSvg {
  diagnostics: Diagnostic[];
  height: number;
  masters: SymbolMaster[];
  paths: NormalizedPath[];
  previewColor?: string;
  sourceElementCount: number;
  width: number;
}
