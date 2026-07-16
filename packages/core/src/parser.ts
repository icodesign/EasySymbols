import { SaxesParser, type SaxesTagPlain } from "saxes";

import { ConversionError, error, warning } from "./errors.js";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  parseTransform,
  type Matrix,
} from "./matrix.js";
import { paintServerKindForTag, type PaintServer } from "./paint.js";
import {
  RENDERING_COLOR_TOKENS,
  RENDERING_HIERARCHIES,
} from "./rendering.js";
import {
  DEFAULT_SYMBOL_VARIANT,
  parseSymbolVariant,
  type SymbolVariant,
} from "./variants.js";
import type {
  Diagnostic,
  RenderingColorToken,
  RenderingHierarchy,
} from "./types.js";
import type { StrokeOptions } from "./pathkit.js";

const MAX_SOURCE_BYTES = 2_000_000;
const MAX_ELEMENTS = 10_000;
const MAX_DRAWABLES = 2_000;

export type Drawable =
  | {
      d: string;
      elementId?: string;
      fillRule: "evenodd" | "nonzero";
      groupIds: string[];
      matrix: Matrix;
      /** Effective source alpha after inherited fill and group opacity. */
      opacity: number;
      order: number;
      paint: string;
      role: "fill";
      shapeId: string;
      sourceHierarchy?: RenderingHierarchy;
      sourceMulticolor?: RenderingColorToken;
      variant?: SymbolVariant;
    }
  | {
      d: string;
      elementId?: string;
      groupIds: string[];
      matrix: Matrix;
      /** Effective source alpha after inherited stroke and group opacity. */
      opacity: number;
      order: number;
      paint: string;
      role: "stroke";
      shapeId: string;
      sourceHierarchy?: RenderingHierarchy;
      sourceMulticolor?: RenderingColorToken;
      stroke: StrokeOptions;
      variant?: SymbolVariant;
    };

export interface ParsedDocument {
  diagnostics: Diagnostic[];
  drawables: Drawable[];
  height: number;
  minX: number;
  minY: number;
  paintServers: ReadonlyMap<string, PaintServer>;
  sourceElementCount: number;
  width: number;
}

interface StyleState {
  display: string;
  fill: string;
  fillOpacity: number;
  fillRule: string;
  opacity: number;
  stroke: string;
  strokeCap: StrokeOptions["cap"];
  strokeJoin: StrokeOptions["join"];
  strokeMiterLimit: number;
  strokeOpacity: number;
  strokeWidth: number;
  visibility: string;
}

interface CssClassRule {
  declarations: Readonly<Record<string, string>>;
  order: number;
}

type CssClassRules = ReadonlyMap<string, CssClassRule>;

interface CssStylesheet {
  classNames: ReadonlySet<string>;
  classRules: CssClassRules;
}

type TemplateSection = "guides" | "notes" | "symbols";

interface Frame {
  gradientId?: string;
  groupIds: string[];
  ignored: boolean;
  matrix: Matrix;
  style: StyleState;
  tag: string;
  templateSection?: TemplateSection;
  variant?: SymbolVariant;
}

const DEFAULT_STYLE: StyleState = {
  display: "inline",
  fill: "black",
  fillOpacity: 1,
  fillRule: "nonzero",
  opacity: 1,
  stroke: "none",
  strokeCap: "butt",
  strokeJoin: "miter",
  strokeMiterLimit: 4,
  strokeOpacity: 1,
  strokeWidth: 1,
  visibility: "visible",
};

function isFillRule(value: string): value is "evenodd" | "nonzero" {
  return value === "evenodd" || value === "nonzero";
}

function parseNumber(
  raw: string | undefined,
  fallback: number,
  label: string,
  elementId?: string,
): number {
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px)?$/.exec(
    trimmed,
  );
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new ConversionError([
      error(
        "SVG_INVALID_NUMBER",
        "parse",
        `${label} must be a finite unitless or px number.`,
        elementId,
      ),
    ]);
  }
  return value;
}

function parseOpacity(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = raw.trim().endsWith("%")
    ? Number(raw.trim().slice(0, -1)) / 100
    : Number(raw);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : Number.NaN;
}

function parseInlineStyle(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const declaration of raw.split(";")) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    result[declaration.slice(0, separator).trim().toLowerCase()] = declaration
      .slice(separator + 1)
      .trim();
    const name = declaration.slice(0, separator).trim().toLowerCase();
    result[name] = result[name]?.replace(/\s*!important\s*$/i, "") ?? "";
  }
  return result;
}

function parseCssClassRules(source: string): CssStylesheet {
  const rules = new Map<string, CssClassRule>();
  const classNames = new Set<string>();
  let order = 0;
  const styleBlocks = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  for (const match of source.matchAll(styleBlocks)) {
    const css = (match[1] ?? "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/<!\[CDATA\[|\]\]>/g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = parseInlineStyle(rule[2]);
      if (Object.keys(declarations).length === 0) continue;
      for (const rawSelector of (rule[1] ?? "").split(",")) {
        const selector = rawSelector.trim();
        for (const className of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
          if (className[1]) classNames.add(className[1]);
        }
        const classMatch = /^\.([A-Za-z_][\w-]*)$/.exec(selector);
        if (!classMatch?.[1]) continue;
        const className = classMatch[1];
        const previous = rules.get(className);
        rules.set(className, {
          declarations: {
            ...(previous?.declarations ?? {}),
            ...declarations,
          },
          order,
        });
      }
      order += 1;
    }
  }
  return {
    classNames,
    classRules: rules,
  };
}

function sourceRenderingForClasses(raw: string | undefined): {
  conflicts: string[];
  hierarchy?: RenderingHierarchy;
  multicolor?: RenderingColorToken;
} {
  const classNames = raw?.split(/\s+/).filter(Boolean) ?? [];
  const hierarchies = [
    ...new Set(
      classNames
        .map(
          (className) =>
            /^hierarchical-\d+:(primary|secondary|tertiary)$/.exec(
              className,
            )?.[1],
        )
        .filter((value): value is RenderingHierarchy =>
          RENDERING_HIERARCHIES.includes(value as RenderingHierarchy),
        ),
    ),
  ];
  const multicolors = [
    ...new Set(
      classNames
        .map(
          (className) =>
            /^multicolor-\d+:([A-Za-z]+)$/.exec(className)?.[1],
        )
        .filter((value): value is RenderingColorToken =>
          RENDERING_COLOR_TOKENS.includes(value as RenderingColorToken),
        ),
    ),
  ];
  const hierarchy = hierarchies[0];
  const multicolor = multicolors[0];
  return {
    conflicts: [
      ...(hierarchies.length > 1
        ? [`hierarchical levels ${hierarchies.join(", ")}`]
        : []),
      ...(multicolors.length > 1
        ? [`multicolor roles ${multicolors.join(", ")}`]
        : []),
    ],
    ...(hierarchy ? { hierarchy } : {}),
    ...(multicolor ? { multicolor } : {}),
  };
}

function isRenderingMetadataClass(className: string): boolean {
  if (/^monochrome-\d+$/.test(className)) return true;
  const hierarchy = /^hierarchical-\d+:(.+)$/.exec(className)?.[1];
  if (
    hierarchy &&
    RENDERING_HIERARCHIES.includes(hierarchy as RenderingHierarchy)
  ) {
    return true;
  }
  const multicolor = /^multicolor-\d+:(.+)$/.exec(className)?.[1];
  return Boolean(
    multicolor &&
      RENDERING_COLOR_TOKENS.includes(multicolor as RenderingColorToken),
  );
}

function hasTransparentColor(value: string | undefined, elementId?: string): boolean {
  const color = value?.trim().toLowerCase();
  if (!color) return false;
  if (color === "transparent") return true;
  if (/^#[0-9a-f]{4}$/i.test(color)) return color[4] !== "f";
  if (/^#[0-9a-f]{8}$/i.test(color)) return color.slice(7) !== "ff";

  const functionMatch = /^(?:rgba?|hsla?)\((.*)\)$/i.exec(color);
  if (!functionMatch) return false;
  const functionName = color.slice(0, color.indexOf("(")).toLowerCase();
  const body = functionMatch[1] ?? "";
  const slash = body.lastIndexOf("/");
  const commaValues = body.split(",");
  const alpha = slash >= 0
    ? body.slice(slash + 1).trim()
    : (functionName === "rgba" || functionName === "hsla") && commaValues.length === 4
      ? (commaValues[3] ?? "").trim()
      : undefined;
  if (alpha === undefined) return false;
  const parsed = parseOpacity(alpha, Number.NaN);
  if (!Number.isFinite(parsed)) {
    throw new ConversionError([
      error("SVG_INVALID_OPACITY", "parse", "Gradient stop alpha must be a number or percentage.", elementId),
    ]);
  }
  return parsed < 1;
}

function gradientStopUsesTransparency(attributes: Record<string, string>): boolean {
  const inline = parseInlineStyle(attributes.style);
  const opacity = parseOpacity(inline["stop-opacity"] ?? attributes["stop-opacity"], 1);
  if (!Number.isFinite(opacity)) {
    throw new ConversionError([
      error("SVG_INVALID_OPACITY", "parse", "Gradient stop opacity must be a number or percentage.", attributes.id),
    ]);
  }
  return opacity < 1 || hasTransparentColor(inline["stop-color"] ?? attributes["stop-color"], attributes.id);
}

function resolveStyle(
  parent: StyleState,
  attributes: Record<string, string>,
  elementId?: string,
  cssClassRules: CssClassRules = new Map(),
): StyleState {
  const inline = parseInlineStyle(attributes.style);
  const classRules = (attributes.class ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((className) => cssClassRules.get(className))
    .filter((rule): rule is CssClassRule => rule !== undefined)
    .sort((left, right) => left.order - right.order);
  const classStyle = classRules.reduce<Record<string, string>>(
    (result, rule) => ({ ...result, ...rule.declarations }),
    {},
  );
  const property = (name: string): string | undefined =>
    inline[name] ?? classStyle[name] ?? attributes[name];
  const opacity = parseOpacity(property("opacity"), 1);
  const fillOpacity = parseOpacity(property("fill-opacity"), parent.fillOpacity);
  const strokeOpacity = parseOpacity(
    property("stroke-opacity"),
    parent.strokeOpacity,
  );
  if (![opacity, fillOpacity, strokeOpacity].every(Number.isFinite)) {
    throw new ConversionError([
      error(
        "SVG_INVALID_OPACITY",
        "parse",
        "Opacity values must be numbers or percentages.",
        elementId,
      ),
    ]);
  }
  const cap = (property("stroke-linecap") ?? parent.strokeCap).toLowerCase();
  const join = (property("stroke-linejoin") ?? parent.strokeJoin).toLowerCase();
  if (!(["butt", "round", "square"] as string[]).includes(cap)) {
    throw new ConversionError([
      error("SVG_UNSUPPORTED_STROKE_CAP", "geometry", `Unsupported stroke cap: ${cap}.`, elementId),
    ]);
  }
  if (!(["bevel", "miter", "round"] as string[]).includes(join)) {
    throw new ConversionError([
      error("SVG_UNSUPPORTED_STROKE_JOIN", "geometry", `Unsupported stroke join: ${join}.`, elementId),
    ]);
  }
  return {
    display: (property("display") ?? parent.display).toLowerCase(),
    fill: property("fill") ?? parent.fill,
    fillOpacity,
    fillRule: (property("fill-rule") ?? parent.fillRule).toLowerCase(),
    opacity: parent.opacity * opacity,
    stroke: property("stroke") ?? parent.stroke,
    strokeCap: cap as StyleState["strokeCap"],
    strokeJoin: join as StyleState["strokeJoin"],
    strokeMiterLimit: parseNumber(
      property("stroke-miterlimit"),
      parent.strokeMiterLimit,
      "stroke-miterlimit",
      elementId,
    ),
    strokeOpacity,
    strokeWidth: parseNumber(
      property("stroke-width"),
      parent.strokeWidth,
      "stroke-width",
      elementId,
    ),
    visibility: (property("visibility") ?? parent.visibility).toLowerCase(),
  };
}

function num(attributes: Record<string, string>, name: string, fallback = 0): number {
  return parseNumber(attributes[name], fallback, name, attributes.id);
}

function points(raw: string | undefined, elementId?: string): number[] {
  if (!raw) return [];
  const matches = raw.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  const remainder = raw.replace(
    /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g,
    "",
  );
  const values = (matches ?? []).map(Number);
  if (
    remainder.replace(/[\s,]/g, "") !== "" ||
    values.some((value) => !Number.isFinite(value)) ||
    values.length % 2 !== 0
  ) {
    throw new ConversionError([
      error("SVG_INVALID_POINTS", "parse", "points must contain x/y coordinate pairs.", elementId),
    ]);
  }
  return values;
}

function rectangle(attributes: Record<string, string>): string {
  const x = num(attributes, "x");
  const y = num(attributes, "y");
  const width = num(attributes, "width");
  const height = num(attributes, "height");
  if (width <= 0 || height <= 0) return "";
  let rx = attributes.rx === undefined ? undefined : Math.max(0, num(attributes, "rx"));
  let ry = attributes.ry === undefined ? undefined : Math.max(0, num(attributes, "ry"));
  if (rx === undefined && ry !== undefined) rx = ry;
  if (ry === undefined && rx !== undefined) ry = rx;
  rx = Math.min(rx ?? 0, width / 2);
  ry = Math.min(ry ?? 0, height / 2);
  if (rx === 0 || ry === 0) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
  return [
    `M${x + rx} ${y}`,
    `H${x + width - rx}`,
    `A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
    `V${y + height - ry}`,
    `A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
    `H${x + rx}`,
    `A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
    `V${y + ry}`,
    `A${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
    "Z",
  ].join("");
}

function shapePath(tag: string, attributes: Record<string, string>): string {
  switch (tag) {
    case "path":
      return attributes.d ?? "";
    case "rect":
      return rectangle(attributes);
    case "circle": {
      const cx = num(attributes, "cx");
      const cy = num(attributes, "cy");
      const radius = num(attributes, "r");
      if (radius <= 0) return "";
      return `M${cx + radius} ${cy}A${radius} ${radius} 0 1 0 ${cx - radius} ${cy}A${radius} ${radius} 0 1 0 ${cx + radius} ${cy}Z`;
    }
    case "ellipse": {
      const cx = num(attributes, "cx");
      const cy = num(attributes, "cy");
      const rx = num(attributes, "rx");
      const ry = num(attributes, "ry");
      if (rx <= 0 || ry <= 0) return "";
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}Z`;
    }
    case "line":
      return `M${num(attributes, "x1")} ${num(attributes, "y1")}L${num(attributes, "x2")} ${num(attributes, "y2")}`;
    case "polygon":
    case "polyline": {
      const values = points(attributes.points, attributes.id);
      if (values.length < 4) return "";
      const chunks = [`M${values[0]} ${values[1]}`];
      for (let index = 2; index < values.length; index += 2) {
        chunks.push(`L${values[index]} ${values[index + 1]}`);
      }
      if (tag === "polygon") chunks.push("Z");
      return chunks.join("");
    }
    default:
      return "";
  }
}

function dimensions(
  attributes: Record<string, string>,
): { height: number; minX: number; minY: number; width: number } {
  if (attributes.viewBox) {
    const values = points(attributes.viewBox);
    if (values.length === 4 && (values[2] ?? 0) > 0 && (values[3] ?? 0) > 0) {
      return {
        height: values[3] ?? 0,
        minX: values[0] ?? 0,
        minY: values[1] ?? 0,
        width: values[2] ?? 0,
      };
    }
    throw new ConversionError([
      error("SVG_INVALID_VIEWBOX", "parse", "viewBox must contain min-x, min-y, width, and height."),
    ]);
  }
  const width = parseNumber(attributes.width, Number.NaN, "width");
  const height = parseNumber(attributes.height, Number.NaN, "height");
  if (!(width > 0 && height > 0)) {
    throw new ConversionError([
      error("SVG_MISSING_DIMENSIONS", "parse", "The root SVG needs a valid viewBox or numeric width and height."),
    ]);
  }
  return { width, height, minX: 0, minY: 0 };
}

function hasUnsupportedEffect(attributes: Record<string, string>): string | undefined {
  const inline = parseInlineStyle(attributes.style);
  for (const name of ["clip-path", "mask", "filter", "marker", "marker-start", "marker-mid", "marker-end"]) {
    const value = inline[name] ?? attributes[name];
    if (value && value.toLowerCase() !== "none") return name;
  }
  return undefined;
}

export function parseSvg(source: string): ParsedDocument {
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
    throw new ConversionError([
      error("SVG_SOURCE_TOO_LARGE", "parse", `SVG input exceeds ${MAX_SOURCE_BYTES} bytes.`),
    ]);
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw new ConversionError([
      error("SVG_DOCTYPE_FORBIDDEN", "parse", "DOCTYPE and custom entities are not accepted."),
    ]);
  }

  const diagnostics: Diagnostic[] = [];
  const drawables: Drawable[] = [];
  const paintServers = new Map<string, PaintServer>();
  const cssStylesheet = parseCssClassRules(source);
  const frames: Frame[] = [];
  const drawableCountsByVariant = new Map<SymbolVariant, number>();
  let rootDimensions:
    | { height: number; minX: number; minY: number; width: number }
    | undefined;
  let sourceElementCount = 0;
  let parserFailure: Error | undefined;

  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", (cause) => {
    parserFailure = cause;
  });
  parser.on("doctype", () => {
    parserFailure = new Error("DOCTYPE is not accepted.");
  });
  parser.on("opentag", (node: SaxesTagPlain) => {
    if (parserFailure) return;
    try {
      sourceElementCount += 1;
      if (sourceElementCount > MAX_ELEMENTS) {
        throw new ConversionError([
          error("SVG_TOO_MANY_ELEMENTS", "parse", `SVG input exceeds ${MAX_ELEMENTS} elements.`),
        ]);
      }

      const tag = node.name.toLowerCase();
      const attributes = node.attributes;
      const elementId = attributes.id;
      const parent = frames.at(-1);
      const localVariant = tag === "g" ? parseSymbolVariant(elementId) : undefined;
      const localTemplateSection: TemplateSection | undefined =
        tag === "g" && elementId === "Notes"
          ? "notes"
          : tag === "g" && elementId === "Guides"
            ? "guides"
            : tag === "g" && elementId === "Symbols"
              ? "symbols"
              : undefined;
      const variant = localVariant ?? parent?.variant;
      const templateSection = localTemplateSection ?? parent?.templateSection;
      const parentGroupIds = parent?.groupIds ?? [];
      const groupIds =
        tag === "g" &&
        elementId &&
        !localVariant &&
        !localTemplateSection &&
        templateSection !== "notes" &&
        templateSection !== "guides"
          ? [...parentGroupIds, elementId]
          : parentGroupIds;
      const paintServerKind = paintServerKindForTag(tag);
      if (paintServerKind && elementId) {
        const href = attributes.href ?? attributes["xlink:href"];
        paintServers.set(elementId, {
          hasStops: false,
          hasTransparentStop: false,
          ...(href ? { href } : {}),
          kind: paintServerKind,
        });
      }
      if (tag === "stop" && parent?.gradientId) {
        const gradient = paintServers.get(parent.gradientId);
        if (gradient) {
          gradient.hasStops = true;
          gradient.hasTransparentStop ||= gradientStopUsesTransparency(attributes);
        }
      }
      const gradientId =
        (paintServerKind === "linear-gradient" || paintServerKind === "radial-gradient") && elementId
          ? elementId
          : parent?.gradientId;
      if (!parent && tag !== "svg") {
        throw new ConversionError([
          error("SVG_ROOT_REQUIRED", "parse", "The document root must be an svg element."),
        ]);
      }
      if (parent && tag === "svg") {
        throw new ConversionError([
          error("SVG_NESTED_SVG_UNSUPPORTED", "parse", "Nested svg viewports are not supported yet.", elementId),
        ]);
      }
      if (!parent) rootDimensions = dimensions(attributes);

      const style = resolveStyle(
        parent?.style ?? DEFAULT_STYLE,
        attributes,
        elementId,
        cssStylesheet.classRules,
      );
      if (attributes.class) {
        const classNames = attributes.class.split(/\s+/).filter(Boolean);
        const unsupportedClassNames = classNames.filter((className) => {
          if (isRenderingMetadataClass(className)) return false;
          const hasUnsupportedSelector =
            cssStylesheet.classNames.has(className) &&
            !cssStylesheet.classRules.has(className);
          const visualElementWithoutRule =
            tag !== "svg" && !cssStylesheet.classRules.has(className);
          return hasUnsupportedSelector || visualElementWithoutRule;
        });
        if (unsupportedClassNames.length > 0) {
          diagnostics.push(
            error(
              "SVG_CSS_CLASS_UNSUPPORTED",
              "parse",
              `CSS class selector(s) ${unsupportedClassNames.map((className) => `.${className}`).join(", ")} use unsupported selector syntax; only simple local .class rules are supported.`,
              elementId,
            ),
          );
        }
      }
      const localMatrix = parseTransform(attributes.transform, elementId);
      const matrix = multiplyMatrices(parent?.matrix ?? IDENTITY_MATRIX, localMatrix);
      let ignored = parent?.ignored ?? false;
      if (templateSection === "notes" || templateSection === "guides") {
        ignored = true;
      }

      const effect = hasUnsupportedEffect(attributes);
      if (effect) {
        diagnostics.push(error("SVG_EFFECT_UNSUPPORTED", "geometry", `${effect} cannot be flattened by the current converter.`, elementId));
      }
      if (attributes["vector-effect"] && attributes["vector-effect"] !== "none") {
        diagnostics.push(error("SVG_VECTOR_EFFECT_UNSUPPORTED", "geometry", "vector-effect is not supported.", elementId));
      }
      if (!paintServerKind) {
        for (const name of ["href", "xlink:href"]) {
          if (attributes[name]) {
            diagnostics.push(error("SVG_EXTERNAL_REFERENCE_UNSUPPORTED", "parse", `${name} references are not supported.`, elementId));
          }
        }
      }

      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === 0) {
        ignored = true;
      }
      const metadataTags = new Set(["title", "desc", "metadata"]);
      const definitionTags = new Set(["defs", "clippath", "mask", "filter", "pattern", "lineargradient", "radialgradient"]);
      const forbiddenTags = new Set(["script", "image", "text", "foreignobject", "use", "symbol"]);
      if (metadataTags.has(tag) || definitionTags.has(tag)) ignored = true;
      if (forbiddenTags.has(tag)) {
        if (!ignored) {
          diagnostics.push(error("SVG_ELEMENT_UNSUPPORTED", "parse", `<${node.name}> is not supported.`, elementId));
        }
        ignored = true;
      }
      if (tag === "style") ignored = true;

      const shapeTags = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
      if (!ignored && shapeTags.has(tag)) {
        const d = shapePath(tag, attributes);
        if (d) {
          const sourceRendering = sourceRenderingForClasses(attributes.class);
          if (sourceRendering.conflicts.length > 0) {
            diagnostics.push(
              error(
                "SVG_RENDERING_ANNOTATION_CONFLICT",
                "parse",
                `A drawable cannot declare multiple ${sourceRendering.conflicts.join(" or ")}.`,
                elementId,
              ),
            );
          }
          const fillActive = tag !== "line" && style.fill.toLowerCase() !== "none" && style.fillOpacity > 0;
          const strokeActive = style.stroke.toLowerCase() !== "none" && style.strokeOpacity > 0 && style.strokeWidth > 0;
          const nextShapeMetadata = () => {
            const masterVariant = variant ?? DEFAULT_SYMBOL_VARIANT;
            const order = drawableCountsByVariant.get(masterVariant) ?? 0;
            drawableCountsByVariant.set(masterVariant, order + 1);
            return {
              groupIds: [...groupIds],
              order,
              shapeId: `shape-${order + 1}`,
            };
          };
          if (fillActive) {
            if (!isFillRule(style.fillRule)) {
              diagnostics.push(error("SVG_FILL_RULE_UNSUPPORTED", "geometry", `Unsupported fill rule: ${style.fillRule}.`, elementId));
            } else {
              drawables.push({
                d,
                ...nextShapeMetadata(),
                matrix,
                opacity: style.opacity * style.fillOpacity,
                paint: style.fill,
                fillRule: style.fillRule,
                role: "fill",
                ...(sourceRendering.hierarchy
                  ? { sourceHierarchy: sourceRendering.hierarchy }
                  : {}),
                ...(sourceRendering.multicolor
                  ? { sourceMulticolor: sourceRendering.multicolor }
                  : {}),
                ...(variant ? { variant } : {}),
                ...(elementId ? { elementId } : {}),
              });
            }
          }
          if (strokeActive) {
            const inline = parseInlineStyle(attributes.style);
            const dash = inline["stroke-dasharray"] ?? attributes["stroke-dasharray"];
            if (dash && dash.toLowerCase() !== "none") {
              diagnostics.push(error("SVG_DASHED_STROKE_UNSUPPORTED", "geometry", "Dashed strokes are not supported yet.", elementId));
            } else {
              drawables.push({
                d,
                ...nextShapeMetadata(),
                matrix,
                opacity: style.opacity * style.strokeOpacity,
                paint: style.stroke,
                role: "stroke",
                ...(sourceRendering.hierarchy
                  ? { sourceHierarchy: sourceRendering.hierarchy }
                  : {}),
                ...(sourceRendering.multicolor
                  ? { sourceMulticolor: sourceRendering.multicolor }
                  : {}),
                ...(variant ? { variant } : {}),
                stroke: {
                  width: style.strokeWidth,
                  cap: style.strokeCap,
                  join: style.strokeJoin,
                  miterLimit: style.strokeMiterLimit,
                },
                ...(elementId ? { elementId } : {}),
              });
            }
          }
          if (!fillActive && !strokeActive) {
            diagnostics.push(warning("SVG_EMPTY_ELEMENT_IGNORED", "geometry", "An element with no visible fill or stroke was ignored.", elementId));
          }
        }
      } else if (!ignored && tag !== "svg" && tag !== "g") {
        diagnostics.push(error("SVG_ELEMENT_UNSUPPORTED", "parse", `<${node.name}> is not supported.`, elementId));
        ignored = true;
      }

      if (drawables.length > MAX_DRAWABLES) {
        throw new ConversionError([
          error("SVG_TOO_MANY_PATHS", "parse", `SVG input exceeds ${MAX_DRAWABLES} rendered paths.`),
        ]);
      }
      frames.push({
        ...(gradientId ? { gradientId } : {}),
        groupIds,
        ...(templateSection ? { templateSection } : {}),
        ...(variant ? { variant } : {}),
        ignored,
        matrix,
        style,
        tag,
      });
    } catch (cause) {
      if (cause instanceof ConversionError) diagnostics.push(...cause.diagnostics);
      else parserFailure = cause instanceof Error ? cause : new Error(String(cause));
      frames.push({
        groupIds: frames.at(-1)?.groupIds ?? [],
        ignored: true,
        matrix: IDENTITY_MATRIX,
        style: DEFAULT_STYLE,
        tag: node.name.toLowerCase(),
      });
    }
  });
  parser.on("closetag", () => {
    frames.pop();
  });

  try {
    parser.write(source).close();
  } catch (cause) {
    parserFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  if (parserFailure) {
    throw new ConversionError([
      error("SVG_XML_INVALID", "parse", `Invalid SVG XML: ${parserFailure.message}`),
    ]);
  }
  if (!rootDimensions) {
    throw new ConversionError([
      error("SVG_ROOT_REQUIRED", "parse", "The document root must be an svg element."),
    ]);
  }
  if (drawables.length === 0 && !diagnostics.some((item) => item.severity === "error")) {
    diagnostics.push(error("SVG_NO_DRAWABLE_CONTENT", "geometry", "No visible vector content was found."));
  }
  return {
    diagnostics,
    drawables,
    width: rootDimensions.width,
    height: rootDimensions.height,
    minX: rootDimensions.minX,
    minY: rootDimensions.minY,
    paintServers,
    sourceElementCount,
  };
}
