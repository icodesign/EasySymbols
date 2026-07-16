export const SYMBOL_WEIGHTS = [
  "Ultralight",
  "Thin",
  "Light",
  "Regular",
  "Medium",
  "Semibold",
  "Bold",
  "Heavy",
  "Black",
] as const;

export const SYMBOL_SCALES = ["S", "M", "L"] as const;

export type SymbolWeight = (typeof SYMBOL_WEIGHTS)[number];
export type SymbolScale = (typeof SYMBOL_SCALES)[number];
export type SymbolVariant = `${SymbolWeight}-${SymbolScale}`;

export const DEFAULT_SYMBOL_VARIANT: SymbolVariant = "Regular-M";

const VARIANT_ORDER = new Map<SymbolVariant, number>(
  SYMBOL_WEIGHTS.flatMap((weight, weightIndex) =>
    SYMBOL_SCALES.map((scale, scaleIndex) => [
      `${weight}-${scale}` as SymbolVariant,
      weightIndex * SYMBOL_SCALES.length + scaleIndex,
    ]),
  ),
);

export function parseSymbolVariant(value: string | undefined): SymbolVariant | undefined {
  if (!value) return undefined;
  const [weight, scale] = value.split("-");
  if (
    SYMBOL_WEIGHTS.includes(weight as SymbolWeight) &&
    SYMBOL_SCALES.includes(scale as SymbolScale)
  ) {
    return `${weight}-${scale}` as SymbolVariant;
  }
  return undefined;
}

export function sortSymbolVariants(variants: Iterable<SymbolVariant>): SymbolVariant[] {
  return [...new Set(variants)].sort(
    (left, right) => (VARIANT_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (VARIANT_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}
