export type PaintServerKind = "linear-gradient" | "radial-gradient" | "pattern";

export interface PaintServer {
  hasStops: boolean;
  hasTransparentStop: boolean;
  href?: string;
  kind: PaintServerKind;
}

export type PaintResolution =
  | { kind: "flat" }
  | { hasTransparency: boolean; id: string; kind: "gradient" }
  | { kind: "pattern"; id: string }
  | { kind: "unresolved"; reference: string };

const PAINT_SERVER_REFERENCE = /^\s*url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/i;

export function paintServerKindForTag(tag: string): PaintServerKind | undefined {
  switch (tag) {
    case "lineargradient":
      return "linear-gradient";
    case "radialgradient":
      return "radial-gradient";
    case "pattern":
      return "pattern";
    default:
      return undefined;
  }
}

function localFragmentReference(value: string | undefined): string | undefined {
  const target = value?.trim();
  if (!target?.startsWith("#") || target.length === 1) return undefined;
  return target.slice(1);
}

function inheritedGradientTransparency(
  id: string,
  paintServers: ReadonlyMap<string, PaintServer>,
  visited = new Set<string>(),
): boolean | undefined {
  if (visited.has(id)) return undefined;
  const gradient = paintServers.get(id);
  if (!gradient || (gradient.kind !== "linear-gradient" && gradient.kind !== "radial-gradient")) {
    return undefined;
  }
  if (gradient.hasStops) return gradient.hasTransparentStop;

  const inheritedId = localFragmentReference(gradient.href);
  if (!inheritedId) return undefined;
  visited.add(id);
  return inheritedGradientTransparency(inheritedId, paintServers, visited);
}

/**
 * Classifies SVG paint values without attempting to reproduce their colors.
 * The converter only needs to know whether their vector coverage can become a
 * single monochrome Symbol path.
 */
export function resolvePaint(
  value: string,
  paintServers: ReadonlyMap<string, PaintServer>,
): PaintResolution {
  const match = PAINT_SERVER_REFERENCE.exec(value);
  if (!match) {
    return value.toLowerCase().includes("url(")
      ? { kind: "unresolved", reference: value.trim() }
      : { kind: "flat" };
  }

  const target = (match[2] ?? match[3] ?? "").trim();
  if (!target.startsWith("#") || target.length === 1) {
    return { kind: "unresolved", reference: target || value.trim() };
  }

  const id = target.slice(1);
  const server = paintServers.get(id);
  switch (server?.kind) {
    case "linear-gradient":
    case "radial-gradient": {
      const hasTransparency = inheritedGradientTransparency(id, paintServers);
      return hasTransparency === undefined
        ? { kind: "unresolved", reference: `#${id}` }
        : { kind: "gradient", id, hasTransparency };
    }
    case "pattern":
      return { kind: "pattern", id };
    default:
      return { kind: "unresolved", reference: `#${id}` };
  }
}
