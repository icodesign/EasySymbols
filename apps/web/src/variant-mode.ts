import type { SourceProfile, VariantMode } from "@easysymbols/core";

/**
 * Chooses the most capable generation mode that faithfully matches a newly
 * loaded SVG's geometry model. Users can still turn generation off afterward.
 */
export function defaultVariantMode(profile: SourceProfile | undefined): VariantMode {
  if (profile?.canGenerateVariants) return "all";
  if (profile?.canGenerateApproximateScaleVariants) return "approximate-scales";
  return "authored";
}
