export { analyzeSvg, convertSvg } from "./convert.js";
export { createPathKitGeometryEngine } from "./pathkit.js";
export type { GeometryEngine, StrokeOptions } from "./pathkit.js";
export {
  APPLE_V3_STATIC,
  colorAssetContents,
  normalizeSymbolName,
} from "./template.js";
export { validateSymbol } from "./validate.js";
export {
  RENDERING_COLOR_HEX,
  RENDERING_COLOR_TOKENS,
  RENDERING_HIERARCHIES,
  analyzeRenderingMasters,
  nearestRenderingColorToken,
  renderingModesForConfiguration,
  validateRenderingConfiguration,
} from "./rendering.js";
export { compareRgbaImages } from "./pixel.js";
export type { PixelCompareOptions, PixelCompareReport, RgbaImage } from "./pixel.js";
export {
  inspectGeometryDocument,
  inspectGeometrySource,
} from "./source-profile.js";
export type {
  GeometryInspection,
  GeometryInspectionIssue,
  GeometryInspectionIssueCode,
} from "./source-profile.js";
export {
  synthesizeApproximateScaleMasters,
} from "./approximate-scale-synthesis.js";
export type {
  ApproximateScaleSynthesisOptions,
  ApproximateScaleSynthesisResult,
} from "./approximate-scale-synthesis.js";
export {
  DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS,
  resolveOpticalScaleCalibration,
} from "./scale-calibration.js";
export type {
  OpticalScaleCalibration,
  OpticalScaleFactors,
} from "./scale-calibration.js";
export {
  DEFAULT_SF_WEIGHT_STROKE_MULTIPLIERS,
  synthesizeCenterlineDocument,
  synthesizeCenterlineMasters,
} from "./stroke-synthesis.js";
export type {
  CenterlineSynthesisOptions,
  CenterlineSynthesisResult,
  WeightStrokeMultipliers,
} from "./stroke-synthesis.js";
export {
  DEFAULT_SYMBOL_VARIANT,
  SYMBOL_SCALES,
  SYMBOL_WEIGHTS,
  parseSymbolVariant,
  sortSymbolVariants,
} from "./variants.js";
export type {
  BackgroundMode,
  ConversionResult,
  ConvertOptions,
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticStage,
  MasterOrigin,
  GeometryMode,
  GeometryModel,
  NormalizedPath,
  ParsedSvg,
  RenderingAnalysis,
  RenderingCapabilityStatus,
  RenderingColorToken,
  RenderingConfiguration,
  RenderingHierarchy,
  RenderingLayerCandidate,
  RenderingMode,
  RenderingModeCapability,
  RenderingPreview,
  SourceProfile,
  StrokeSummary,
  SvgAnalysis,
  SymbolArtifact,
  SymbolMaster,
  SymbolScale,
  SymbolVariant,
  SymbolWeight,
  TemplateProfile,
  ValidationReport,
  VariantMode,
} from "./types.js";
