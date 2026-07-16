import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  convertSvg,
  createPathKitGeometryEngine,
  validateSymbol,
} from "../src/index.js";

const filledIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <g transform="translate(2 2)">
    <circle cx="10" cy="10" r="9"/>
    <rect x="8" y="4" width="4" height="12" fill="#fff"/>
  </g>
</svg>`;

const evenOddDonut = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <path fill-rule="evenodd" d="M0 0H10V10H0ZM2 2H8V8H2Z"/>
</svg>`;

const explicitMasters = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <g id="Notes"><text id="template-version">Template v.3.0</text></g>
  <g id="Guides"><path id="Capline-M" d="M0 0H24"/></g>
  <g id="Symbols">
    <g id="Regular-S"><path d="M2 2H10V10H2Z"/></g>
    <g id="Regular-M"><path d="M2 2H12V12H2Z"/></g>
    <g id="Black-M"><path d="M1 1H13V13H1Z"/></g>
  </g>
</svg>`;

const classedCenterlineIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon-source" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 10H21"/>
</svg>`;

const cssClassIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <style>.icon { fill: none; stroke: #111111; stroke-width: 2; stroke-linecap: round; }</style>
  <path class="icon" d="M3 12H21"/>
</svg>`;

let geometryPromise: ReturnType<typeof createPathKitGeometryEngine> | undefined;

function geometryEngine() {
  geometryPromise ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("pathkit-wasm/bin/pathkit.wasm");
    return createPathKitGeometryEngine(await readFile(wasmPath));
  })();
  return geometryPromise;
}

describe("convertSvg", () => {
  it("emits a deterministic static Apple template from filled geometry", () => {
    const first = convertSvg(filledIcon, { name: "status icon" });
    const second = convertSvg(filledIcon, { name: "status icon" });

    expect(first.analysis.isConvertible).toBe(true);
    expect(first.analysis.pathCount).toBe(2);
    expect(first.artifact?.name).toBe("status-icon");
    expect(first.artifact?.symbolSvg).toBe(second.artifact?.symbolSvg);
    expect(first.artifact?.symbolSvg).toContain('id="Regular-M"');
    expect(first.artifact?.symbolSvg).toContain("Template v.3.0");
    expect(first.artifact?.masterPreviews["Regular-M"]?.svg).toBe(first.artifact?.previewSvg);
    expect(validateSymbol(first.artifact?.symbolSvg ?? "").isValid).toBe(true);
  });

  it("preserves explicit size and weight masters without synthesizing variants", () => {
    const result = convertSvg(explicitMasters, { name: "multi-master" });

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.masterCount).toBe(3);
    expect(result.analysis.pathCount).toBe(3);
    expect(result.analysis.sourceProfile.geometryModel).toBe("sf-symbol-template");
    expect(result.analysis.variants).toEqual(["Regular-S", "Regular-M", "Black-M"]);
    expect(result.artifact?.variants).toEqual(["Regular-S", "Regular-M", "Black-M"]);
    expect(Object.keys(result.artifact?.masterPreviews ?? {})).toEqual([
      "Regular-S",
      "Regular-M",
      "Black-M",
    ]);
    expect(result.artifact?.symbolSvg).toMatch(/id="Regular-S"[\s\S]*id="Regular-M"[\s\S]*id="Black-M"/);
    expect(result.artifact?.symbolSvg).toContain('id="left-margin-Regular-S"');
    expect(result.artifact?.symbolSvg).toContain('id="right-margin-Black-M"');
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain("SVG_ELEMENT_UNSUPPORTED");
    expect(validateSymbol(result.artifact?.symbolSvg ?? "").isValid).toBe(true);
  });

  it("keeps a literal source color as the preview color hint while exporting monochrome paths", () => {
    const result = convertSvg(
      `<svg viewBox="0 0 10 10"><path fill="#D97757" d="M1 1H9V9H1Z"/></svg>`,
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.artifact?.previewColor).toBe("#d97757");
    expect(result.artifact?.previewSvg).toContain('fill="currentColor"');
    expect(result.artifact?.symbolSvg).not.toContain("#d97757");
  });

  it("accepts harmless SVG class metadata when presentation attributes are inline", async () => {
    const result = convertSvg(classedCenterlineIcon, {}, await geometryEngine());

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_CSS_CLASS_UNSUPPORTED",
    );
  });

  it("classifies and synthesizes a centerline-stroke source", async () => {
    const result = convertSvg(
      classedCenterlineIcon,
      { name: "calendar", variants: "all" },
      await geometryEngine(),
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.sourceProfile).toEqual({
      canGenerateVariants: true,
      canGenerateApproximateScaleVariants: false,
      geometryModel: "centerline-stroke",
      strokeSummary: {
        caps: ["round"],
        joins: ["round"],
        widths: [2],
      },
    });
    expect(result.analysis.masterCount).toBe(27);
    expect(result.artifact?.variants).toHaveLength(27);
    expect(
      Object.values(result.artifact?.masterPreviews ?? {}).every(
        (preview) => preview.origin === "generated",
      ),
    ).toBe(true);
    expect(validateSymbol(result.artifact?.symbolSvg ?? "").isValid).toBe(true);
  });

  it("applies a generic stroke-scale override to generated geometry", async () => {
    const engine = await geometryEngine();
    const defaultWidth = convertSvg(
      classedCenterlineIcon,
      { variants: "all" },
      engine,
    );
    const wider = convertSvg(
      classedCenterlineIcon,
      { variants: "all", synthesis: { strokeScale: 1.25 } },
      engine,
    );

    expect(defaultWidth.analysis.isConvertible).toBe(true);
    expect(wider.analysis.isConvertible).toBe(true);
    expect(wider.artifact?.symbolSvg).not.toBe(defaultWidth.artifact?.symbolSvg);
  });

  it("rejects all-variant generation for a generic filled SVG", async () => {
    const result = convertSvg(
      filledIcon,
      { variants: "all" },
      await geometryEngine(),
    );

    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.sourceProfile.geometryModel).toBe("filled-outline");
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "OUTLINE_WEIGHT_SYNTHESIS_UNAVAILABLE" }),
    );
  });

  it("creates opt-in approximate S/M/L masters for filled outlines without inventing weights", () => {
    const result = convertSvg(filledIcon, {
      variants: "approximate-scales",
    });

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.sourceProfile).toMatchObject({
      canGenerateVariants: false,
      canGenerateApproximateScaleVariants: true,
      geometryModel: "filled-outline",
    });
    expect(result.artifact?.variants).toEqual([
      "Regular-S",
      "Regular-M",
      "Regular-L",
    ]);
    expect(result.artifact?.masterPreviews["Regular-M"]?.origin).toBe("authored");
    expect(result.artifact?.masterPreviews["Regular-S"]?.origin).toBe("approximate");
    expect(result.artifact?.masterPreviews["Regular-L"]?.origin).toBe("approximate");
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "APPROXIMATE_SCALE_VARIANTS", severity: "warning" }),
    );
    expect(validateSymbol(result.artifact?.symbolSvg ?? "").isValid).toBe(true);
  });

  it("scales mixed fill and stroke artwork together only after stroke expansion", async () => {
    const result = convertSvg(
      `<svg viewBox="0 0 24 24"><path d="M4 4H20V20H4Z"/><path fill="none" stroke="black" stroke-width="2" d="M6 12H18"/></svg>`,
      { variants: "approximate-scales" },
      await geometryEngine(),
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.sourceProfile).toMatchObject({
      canGenerateApproximateScaleVariants: true,
      geometryModel: "mixed",
    });
    expect(result.artifact?.variants).toEqual([
      "Regular-S",
      "Regular-M",
      "Regular-L",
    ]);
    expect(result.artifact?.masterPreviews["Regular-S"]?.origin).toBe("approximate");
  });

  it("resolves simple class selectors from an embedded style block", async () => {
    const result = convertSvg(cssClassIcon, {}, await geometryEngine());

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_CSS_CLASS_UNSUPPORTED",
    );
    expect(result.artifact).toBeDefined();
  });

  it("does not silently drop an unresolved class on drawable artwork", () => {
    const result = convertSvg(
      `<svg viewBox="0 0 10 10"><path class="missing-style" d="M1 1H9V9H1Z"/></svg>`,
    );

    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.diagnostics.map((item) => item.code)).toContain(
      "SVG_CSS_CLASS_UNSUPPORTED",
    );
  });

  it("rejects semantic SVG features instead of silently dropping them", () => {
    const result = convertSvg(
      `<svg viewBox="0 0 20 20"><text x="0" y="10">A</text></svg>`,
    );
    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.diagnostics.map((item) => item.code)).toContain(
      "SVG_ELEMENT_UNSUPPORTED",
    );
  });

  it("rejects doctypes before XML parsing", () => {
    const result = convertSvg(
      `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 1 1"><path d="M0 0H1V1Z"/></svg>`,
    );
    expect(result.analysis.diagnostics[0]?.code).toBe("SVG_DOCTYPE_FORBIDDEN");
  });

  it("requires a real geometry engine for strokes", () => {
    const result = convertSvg(
      `<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><path d="M3 12L10 19L21 5"/></svg>`,
    );
    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.diagnostics.map((item) => item.code)).toContain(
      "SVG_STROKE_ENGINE_REQUIRED",
    );
  });

  it("expands strokes through Skia PathKit", async () => {
    const engine = await geometryEngine();
    const result = convertSvg(
      `<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L10 19L21 5"/></svg>`,
      { name: "check" },
      engine,
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.artifact?.symbolSvg).toContain('id="Regular-M"');
    expect(result.artifact?.symbolSvg).toMatch(
      /<g id="Regular-M" transform="[^"]+">\s*<path d="[^"]+"\/>\s*<\/g>/,
    );
  });

  it("reports a specific requirement when evenodd geometry has no engine", () => {
    const result = convertSvg(evenOddDonut);
    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.diagnostics.map((item) => item.code)).toContain(
      "SVG_EVENODD_ENGINE_REQUIRED",
    );
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_NO_NORMALIZED_PATHS",
    );
  });

  it("converts evenodd fills into a nonzero-winding template", async () => {
    const result = convertSvg(evenOddDonut, { name: "donut" }, await geometryEngine());

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.pathCount).toBe(1);
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_EVENODD_UNSUPPORTED",
    );
    expect(result.artifact?.symbolSvg).not.toContain("fill-rule");
    expect(validateSymbol(result.artifact?.symbolSvg ?? "").isValid).toBe(true);
  });

  it("preserves evenodd coverage across common contour topologies", async () => {
    const engine = await geometryEngine();
    const paths = [
      "M0 0H10V10H0ZM2 2V8H8V2Z",
      "M0 0H10V10H0ZM2 2H8V8H2ZM4 4V6H6V4Z",
      "M0 0H7V7H0ZM3 0H10V7H3Z",
      "M0 0L10 10L0 10L10 0Z",
    ];

    for (const d of paths) {
      const result = convertSvg(
        `<svg viewBox="0 0 10 10"><path fill-rule="evenodd" d="${d}"/></svg>`,
        {},
        engine,
      );
      expect(result.analysis.isConvertible, d).toBe(true);
      expect(result.artifact).toBeDefined();
    }
  });

  it("preserves the center cutout in complex inherited evenodd artwork", async () => {
    const source = await readFile(
      new URL(
        "../../../fixtures/svg-inputs/evenodd-compound-openai.svg",
        import.meta.url,
      ),
      "utf8",
    );
    const result = convertSvg(
      source,
      { name: "openai" },
      await geometryEngine(),
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.pathCount).toBe(1);
    expect(result.analysis.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "SVG_FILL_RULE_CONVERSION_FAILED" }),
    );
    expect(result.artifact?.symbolSvg).not.toContain("fill-rule");
    expect(validateSymbol(result.artifact?.symbolSvg ?? "").isValid).toBe(true);
  });

  it("flattens local gradients to a monochrome silhouette with a warning", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <rect id="artwork" width="10" height="10" fill="url(#sunset)"/>
        <defs>
          <linearGradient id="sunset"><stop stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>
        </defs>
      </svg>
    `);

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.pathCount).toBe(1);
    expect(result.artifact).toBeDefined();
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SVG_GRADIENT_FLATTENED", severity: "warning", elementId: "artwork" }),
    );
  });

  it("flattens nonzero partial opacity without dropping visible geometry", async () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" opacity="80%">
        <path id="soft-fill" fill-opacity="0.75" d="M0 0H8V8H0Z"/>
        <path id="soft-stroke" fill="none" stroke="#000" stroke-width="2" stroke-opacity="0.5" d="M11 4H19"/>
        <path id="hidden" opacity="0" d="M9 0H10V1H9Z"/>
      </svg>
    `, {}, await geometryEngine());

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.pathCount).toBe(2);
    expect(result.artifact).toBeDefined();
    expect(
      result.analysis.diagnostics.filter(
        (item) => item.code === "SVG_PARTIAL_OPACITY_FLATTENED",
      ),
    ).toEqual([
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("fill") }),
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("stroke") }),
    ]);
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_PARTIAL_OPACITY_UNSUPPORTED",
    );
  });

  it("suggests rendering layers from opacity and color without enabling them", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
        <path id="detail" fill="#ff3b30" opacity="0.2" d="M0 0H8V8H0Z"/>
        <path id="body" fill="#007aff" d="M10 0H18V8H10Z"/>
      </svg>
    `);

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.rendering.modes.hierarchical.status).toBe("detected");
    expect(result.analysis.rendering.modes.multicolor.status).toBe("detected");
    expect(
      result.analysis.rendering.layers.map((layer) => ({
        hierarchy: layer.suggestedHierarchy,
        id: layer.id,
        multicolor: layer.suggestedMulticolor,
      })),
    ).toEqual([
      {
        hierarchy: "secondary",
        id: "shape-1",
        multicolor: "systemRedColor",
      },
      {
        hierarchy: "primary",
        id: "shape-2",
        multicolor: "systemBlueColor",
      },
    ]);
    expect(result.artifact?.renderingModes).toEqual(["monochrome"]);
    expect(result.artifact?.renderingPreviews.hierarchical).toMatchObject({
      enabled: false,
      source: "suggested",
    });
    expect(result.artifact?.symbolSvg).not.toContain("hierarchical-0");
  });

  it("keeps hierarchical and palette available for a single shape", () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
        <path id="check" fill="#000000" d="M2 5L8 9L18 1Z"/>
      </svg>
    `;
    const suggested = convertSvg(source);

    expect(suggested.analysis.rendering.modes.hierarchical).toMatchObject({
      status: "configurable",
    });
    expect(suggested.analysis.rendering.modes.palette).toMatchObject({
      status: "configurable",
    });
    expect(suggested.analysis.rendering.modes.hierarchical.reason).toMatch(
      /single shape/i,
    );

    const configured = convertSvg(source, {
      rendering: {
        hierarchical: {
          layers: { "shape-1": "primary" },
        },
      },
    });

    expect(configured.analysis.isConvertible).toBe(true);
    expect(configured.artifact?.renderingModes).toEqual([
      "monochrome",
      "hierarchical",
      "palette",
    ]);
    expect(configured.artifact?.renderingPreviews.hierarchical).toMatchObject({
      enabled: true,
      source: "configured",
    });
    expect(configured.artifact?.symbolSvg).toContain(
      'class="monochrome-0 hierarchical-0:primary"',
    );
  });

  it("writes approved hierarchical, palette, and multicolor annotations", () => {
    const result = convertSvg(
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
          <path id="detail" fill="#ff3b30" opacity="0.2" d="M0 0H8V8H0Z"/>
          <path id="body" fill="#007aff" d="M10 0H18V8H10Z"/>
        </svg>
      `,
      {
        rendering: {
          hierarchical: {
            layers: { "shape-1": "secondary", "shape-2": "primary" },
          },
          multicolor: {
            layers: {
              "shape-1": "systemRedColor",
              "shape-2": "systemBlueColor",
            },
          },
        },
      },
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.artifact?.renderingModes).toEqual([
      "monochrome",
      "hierarchical",
      "palette",
      "multicolor",
    ]);
    expect(result.artifact?.symbolSvg).toContain(
      ".hierarchical-0:secondary {fill:#000000}",
    );
    expect(result.artifact?.symbolSvg).toContain(
      ".multicolor-0:systemRedColor {fill:#FF3B30}",
    );
    expect(result.artifact?.symbolSvg).toContain(
      'class="monochrome-0 multicolor-0:systemRedColor hierarchical-0:secondary"',
    );
    expect(result.artifact?.renderingPreviews.palette).toMatchObject({
      enabled: true,
      source: "configured",
    });
    expect(
      result.artifact?.renderingPreviews.multicolor?.masters?.["Regular-M"],
    ).toContain('data-layer-id="shape-1"');
    expect(
      result.artifact?.renderingPreviews.multicolor?.masters?.["Regular-M"],
    ).toContain('data-layer-id="shape-2"');
    expect(result.analysis.diagnostics.map((item) => item.code)).toContain(
      "SVG_PARTIAL_OPACITY_MAPPED_TO_HIERARCHY",
    );
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_PARTIAL_OPACITY_FLATTENED",
    );
    expect(validateSymbol(result.artifact?.symbolSvg ?? "").isValid).toBe(true);
  });

  it("keeps portable colors resolvable and preserves exact layer editor colors in assets", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
        <path id="detail" fill="#ff3b30" d="M0 0H8V8H0Z"/>
        <path id="body" fill="#007aff" d="M10 0H18V8H10Z"/>
      </svg>
    `, {
      rendering: {
        hierarchical: {
          layers: { "shape-1": "secondary", "shape-2": "primary" },
        },
        multicolor: {
          layers: {
            "shape-1": "systemRedColor",
            "shape-2": "systemBlueColor",
          },
          colors: {
            "shape-1": "#ff00aa",
            "shape-2": "#123456",
          },
        },
      },
    });

    expect(result.artifact?.symbolSvg).toContain(
      ".multicolor-0:systemRedColor {fill:#FF3B30}",
    );
    expect(result.artifact?.symbolSvg).toContain(
      ".multicolor-1:systemGreenColor {fill:#34C759}",
    );
    expect(result.artifact?.assetSymbolSvg).toContain(
      ".multicolor-0:easysymbols_custom_symbol_layer0_color {fill:#FF00AA}",
    );
    expect(result.artifact?.assetSymbolSvg).toContain(
      ".multicolor-1:easysymbols_custom_symbol_layer1_color {fill:#123456}",
    );
    expect(result.artifact?.colorAssets).toEqual({
      easysymbols_custom_symbol_layer0_color: "#ff00aa",
      easysymbols_custom_symbol_layer1_color: "#123456",
    });
    expect(
      result.artifact?.renderingPreviews.multicolor?.masters?.["Regular-M"],
    ).toContain('fill="#ff00aa"');
    expect(
      result.artifact?.renderingPreviews.multicolor?.masters?.["Regular-M"],
    ).toContain('fill="#123456"');
  });

  it("recognizes existing Apple rendering classes as authored evidence", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
        <style>
          .SFSymbolsPreviewFF3B30 {fill:#FF3B30}
          .SFSymbolsPreview007AFF {fill:#007AFF}
        </style>
        <path class="monochrome-0 multicolor-0:systemRedColor hierarchical-0:secondary SFSymbolsPreviewFF3B30" d="M0 0H8V8H0Z"/>
        <path class="monochrome-1 multicolor-1:systemBlueColor hierarchical-1:primary SFSymbolsPreview007AFF" d="M10 0H18V8H10Z"/>
      </svg>
    `);

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_CSS_CLASS_UNSUPPORTED",
    );
    expect(result.analysis.rendering.modes.hierarchical).toMatchObject({
      status: "detected",
      reason: expect.stringContaining("already contains Apple"),
    });
    expect(result.analysis.rendering.modes.multicolor.status).toBe("detected");
    expect(result.analysis.rendering.layers).toEqual([
      expect.objectContaining({
        authoredHierarchy: "secondary",
        authoredMulticolor: "systemRedColor",
        suggestedHierarchy: "secondary",
      }),
      expect.objectContaining({
        authoredHierarchy: "primary",
        authoredMulticolor: "systemBlueColor",
        suggestedHierarchy: "primary",
      }),
    ]);
  });

  it("rejects conflicting authored rendering annotations", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <path class="hierarchical-0:primary hierarchical-0:secondary" d="M1 1H9V9H1Z"/>
      </svg>
    `);

    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SVG_RENDERING_ANNOTATION_CONFLICT" }),
    );
  });

  it("rejects rendering annotations when authored masters do not share one shape model", () => {
    const result = convertSvg(
      `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
          <g id="Symbols">
            <g id="Regular-M"><path d="M0 0H8V8H0Z"/></g>
            <g id="Bold-M">
              <path d="M0 0H8V8H0Z"/>
              <path d="M10 0H18V8H10Z"/>
            </g>
          </g>
        </svg>
      `,
      {
        rendering: {
          hierarchical: {
            layers: { "shape-1": "primary" },
          },
        },
      },
    );

    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "RENDERING_MASTER_TOPOLOGY_MISMATCH" }),
    );
  });

  it("removes a canvas-sized first fill before collapsing color layers", async () => {
    const source = await readFile(
      new URL("../../../fixtures/svg-inputs/codex-color.svg", import.meta.url),
      "utf8",
    );
    const result = convertSvg(
      source,
      { name: "codex" },
      await geometryEngine(),
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.pathCount).toBe(1);
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "SVG_CANVAS_BACKGROUND_REMOVED",
        severity: "warning",
      }),
    );
    expect(result.artifact?.previewSvg.match(/<path /g)).toHaveLength(1);
  });

  it("keeps a canvas-sized fill when background policy is overridden", async () => {
    const source = await readFile(
      new URL("../../../fixtures/svg-inputs/codex-color.svg", import.meta.url),
      "utf8",
    );
    const result = convertSvg(
      source,
      { background: "keep", name: "codex-with-background" },
      await geometryEngine(),
    );

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.pathCount).toBe(2);
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_CANVAS_BACKGROUND_REMOVED",
    );
    expect(result.artifact?.previewSvg.match(/<path /g)).toHaveLength(2);
  });

  it("flattens an opaque gradient stroke into monochrome vector geometry", async () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="none" stroke="url(#ink)" stroke-width="2">
        <path id="artwork" d="M1 5H9"/>
        <defs><linearGradient id="ink"><stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
      </svg>
    `, {}, await geometryEngine());

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.artifact).toBeDefined();
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SVG_GRADIENT_FLATTENED", severity: "warning", elementId: "artwork" }),
    );
  });

  it("resolves an opaque inherited gradient declared after its use", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <circle id="artwork" cx="5" cy="5" r="5" fill="url(#derived)"/>
        <defs>
          <linearGradient id="derived" href="#base"/>
          <radialGradient id="base"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
        </defs>
      </svg>
    `);

    expect(result.analysis.isConvertible).toBe(true);
    expect(result.analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: "SVG_GRADIENT_FLATTENED", severity: "warning", elementId: "artwork" }),
    );
  });

  it("rejects transparent gradients without adding a cascade diagnostic", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <rect id="artwork" width="10" height="10" fill="url(#fade)"/>
        <defs><linearGradient id="fade"><stop stop-color="transparent"/><stop offset="1" stop-color="#000"/></linearGradient></defs>
      </svg>
    `);

    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.pathCount).toBe(0);
    expect(result.analysis.diagnostics.map((item) => item.code)).toContain(
      "SVG_GRADIENT_TRANSPARENCY_UNSUPPORTED",
    );
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_NO_NORMALIZED_PATHS",
    );
  });

  it("keeps patterns unsupported without adding a cascade diagnostic", () => {
    const result = convertSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <rect id="artwork" width="10" height="10" fill="url(#dots)"/>
        <defs><pattern id="dots" width="2" height="2" patternUnits="userSpaceOnUse"/></defs>
      </svg>
    `);

    expect(result.analysis.isConvertible).toBe(false);
    expect(result.analysis.pathCount).toBe(0);
    expect(result.analysis.diagnostics.map((item) => item.code)).toContain(
      "SVG_PATTERN_UNSUPPORTED",
    );
    expect(result.analysis.diagnostics.map((item) => item.code)).not.toContain(
      "SVG_NO_NORMALIZED_PATHS",
    );
  });
});
