const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  blue: "#0000ff",
  brown: "#a52a2a",
  gray: "#808080",
  green: "#008000",
  grey: "#808080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  purple: "#800080",
  red: "#ff0000",
  white: "#ffffff",
  yellow: "#ffff00",
};

function channel(value: string): number | undefined {
  const trimmed = value.trim();
  const parsed = trimmed.endsWith("%")
    ? Number(trimmed.slice(0, -1)) * 2.55
    : Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 255
    ? Math.round(parsed)
    : undefined;
}

/**
 * Returns a solid opaque color suitable for an HTML color input, when the SVG
 * paint is a literal color. Paint servers and unknown CSS colors intentionally
 * return undefined because their appearance is not a reliable preview hint.
 */
export function previewColorForPaint(paint: string): string | undefined {
  const value = paint.trim().toLowerCase();
  if (!value || value === "none" || value.startsWith("url(")) return undefined;

  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${[...value.slice(1)].map((digit) => `${digit}${digit}`).join("")}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{4}$/i.test(value) || /^#[0-9a-f]{8}$/i.test(value)) {
    const alpha = value.length === 5 ? value[4] : value.slice(7);
    if (alpha !== "f" && alpha !== "ff") return undefined;
    return value.length === 5
      ? previewColorForPaint(value.slice(0, 4))
      : previewColorForPaint(value.slice(0, 7));
  }

  const rgb = /^rgba?\(\s*([^,]+),\s*([^,]+),\s*([^,]+)(?:,\s*([^,]+))?\s*\)$/i.exec(value);
  if (rgb) {
    const red = channel(rgb[1] ?? "");
    const green = channel(rgb[2] ?? "");
    const blue = channel(rgb[3] ?? "");
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4].trim());
    if (red === undefined || green === undefined || blue === undefined || !Number.isFinite(alpha) || alpha < 1) {
      return undefined;
    }
    return `#${[red, green, blue].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
  }

  return NAMED_COLORS[value];
}
