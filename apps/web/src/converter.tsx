import {
  DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS,
  SYMBOL_SCALES,
  SYMBOL_WEIGHTS,
  colorAssetContents,
  convertSvg,
  createPathKitGeometryEngine,
  inspectGeometrySource,
  type ConvertOptions,
  type ConversionResult,
  type GeometryEngine,
  type RenderingColorToken,
  type RenderingHierarchy,
  type RenderingMode,
  type SymbolScale,
  type SymbolVariant,
  type SymbolWeight,
  type VariantMode,
} from "@easysymbols/core";
import { strToU8, zipSync } from "fflate";
import { useEffect, useMemo, useRef, useState } from "react";
import pathKitWasmUrl from "pathkit-wasm/bin/pathkit.wasm?url";

import {
  ConverterWorkbench,
  type ControlPanelModel,
  type ConversionPhase,
  type InputMode,
  type PreviewRow,
} from "./converter-workbench";
import { defaultVariantMode } from "./variant-mode";

const DEFAULT_PREVIEW_COLOR = "#1688f5";
const AUTO_CONVERT_DEBOUNCE_MS = 180;

let geometryPromise: Promise<GeometryEngine> | undefined;

function geometry(): Promise<GeometryEngine> {
  geometryPromise ??= fetch(pathKitWasmUrl)
    .then((response) => {
      if (!response.ok)
        throw new Error("Could not load the vector geometry engine.");
      return response.arrayBuffer();
    })
    .then(createPathKitGeometryEngine);
  return geometryPromise;
}

function assetNameFromFile(filename: string): string {
  return (
    filename
      .replace(/\.svg$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom-symbol"
  );
}

function download(
  data: string | Uint8Array,
  filename: string,
  type: string,
): void {
  const part =
    typeof data === "string" ? data : (data.slice().buffer as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function previewDataUrl(svg: string, color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    svg.replaceAll("currentColor", color),
  )}`;
}

function failedConversion(cause: unknown): ConversionResult {
  return {
    analysis: {
      diagnostics: [
        {
          code: "CONVERSION_RUNTIME_FAILED",
          severity: "error",
          stage: "geometry",
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ],
      height: 0,
      width: 0,
      masterCount: 0,
      pathCount: 0,
      rendering: {
        annotatable: false,
        layers: [],
        modes: {
          monochrome: {
            reason: "No normalized artwork is available.",
            status: "unavailable",
          },
          hierarchical: {
            reason: "No normalized artwork is available.",
            status: "unavailable",
          },
          palette: {
            reason: "No normalized artwork is available.",
            status: "unavailable",
          },
          multicolor: {
            reason: "No normalized artwork is available.",
            status: "unavailable",
          },
        },
      },
      sourceElementCount: 0,
      sourceProfile: {
        canGenerateVariants: false,
        canGenerateApproximateScaleVariants: false,
        geometryModel: "empty",
      },
      variants: [],
      isConvertible: false,
    },
  };
}

export function Converter() {
  const openPreviewOnSuccess = useRef(false);
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [source, setSource] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  const [sourceRevision, setSourceRevision] = useState(0);
  const [filename, setFilename] = useState("");
  const [name, setName] = useState("custom-symbol");
  const [padding, setPadding] = useState(0.08);
  const [variantMode, setVariantMode] = useState<VariantMode>("authored");
  const [renderingMode, setRenderingMode] = useState<RenderingMode>(
    "monochrome",
  );
  const [hierarchyAssignments, setHierarchyAssignments] = useState<
    Record<string, RenderingHierarchy>
  >({});
  const [multicolorAssignments, setMulticolorAssignments] = useState<
    Record<string, RenderingColorToken>
  >({});
  const [layerPreviewColors, setLayerPreviewColors] = useState<
    Partial<Record<RenderingHierarchy, string>>
  >({});
  const [strokeScale, setStrokeScale] = useState(1);
  const [referenceWeight, setReferenceWeight] =
    useState<SymbolWeight>("Regular");
  const [referenceScale, setReferenceScale] = useState<SymbolScale>("M");
  const [smallOpticalScale, setSmallOpticalScale] = useState<number>(
    DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.S,
  );
  const [largeOpticalScale, setLargeOpticalScale] = useState<number>(
    DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.L,
  );
  const [result, setResult] = useState<ConversionResult>();
  const [previewColorOverride, setPreviewColorOverride] = useState<string>();
  const [phase, setPhase] = useState<ConversionPhase>("empty");
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [inputError, setInputError] = useState<string>();
  const [isEditing, setIsEditing] = useState(true);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);

  const artifact = result?.artifact;
  const geometryInspection = useMemo(
    () => (source.trim() ? inspectGeometrySource(source) : undefined),
    [source],
  );
  const sourceProfile = geometryInspection?.sourceProfile;
  const canSynthesizeVariants = sourceProfile?.canGenerateVariants === true;
  const canGenerateApproximateScales =
    sourceProfile?.canGenerateApproximateScaleVariants === true;
  const conversionOptions = useMemo(() => {
    const variants: NonNullable<ConvertOptions["variants"]> =
      canSynthesizeVariants && variantMode === "all"
        ? "all"
        : canGenerateApproximateScales && variantMode === "approximate-scales"
          ? "approximate-scales"
          : "authored";
    const scaleFactors = {
      S: smallOpticalScale,
      M: 1,
      L: largeOpticalScale,
    } as const;
    const hierarchyConfigured = Object.keys(hierarchyAssignments).length > 0;
    const multicolorConfigured = Object.keys(multicolorAssignments).length > 0;
    const multicolorColors = Object.fromEntries(
      Object.keys(multicolorAssignments).flatMap((layerId) => {
        const hierarchy = hierarchyAssignments[layerId] ?? "primary";
        const color = layerPreviewColors[hierarchy];
        return color ? [[layerId, color] as const] : [];
      }),
    );
    return {
      background: "auto",
      name,
      padding,
      variants,
      ...(hierarchyConfigured || multicolorConfigured
        ? {
            rendering: {
              ...(hierarchyConfigured
                ? { hierarchical: { layers: hierarchyAssignments } }
                : {}),
              ...(multicolorConfigured
                ? {
                    multicolor: {
                      layers: multicolorAssignments,
                      ...(Object.keys(multicolorColors).length > 0
                        ? { colors: multicolorColors }
                        : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(variants === "all"
        ? {
            synthesis: {
              referenceScale,
              referenceWeight,
              scaleFactors,
              strokeScale,
            },
          }
        : variants === "approximate-scales"
          ? { approximateScales: { referenceScale, scaleFactors } }
          : {}),
    } satisfies ConvertOptions;
  }, [
    canGenerateApproximateScales,
    canSynthesizeVariants,
    hierarchyAssignments,
    layerPreviewColors,
    largeOpticalScale,
    name,
    multicolorAssignments,
    padding,
    referenceScale,
    referenceWeight,
    smallOpticalScale,
    strokeScale,
    variantMode,
  ]);
  const previewColor =
    previewColorOverride ?? artifact?.previewColor ?? DEFAULT_PREVIEW_COLOR;
  const previewRows = useMemo<PreviewRow[]>(
    () => {
      if (!artifact) return [];
      const renderingMasters =
        artifact.renderingPreviews[renderingMode]?.masters;
      return SYMBOL_SCALES.map((scale) => ({
        scale,
        cells: SYMBOL_WEIGHTS.map((weight) => {
          const variant = `${weight}-${scale}` as SymbolVariant;
          const preview = artifact.masterPreviews[variant];
          const svg = renderingMasters?.[variant] ?? preview?.svg;
          return {
            origin: preview?.origin,
            src: svg ? previewDataUrl(svg, previewColor) : undefined,
            variant,
            weight,
          };
        }),
      }));
    },
    [artifact, previewColor, renderingMode],
  );

  function loadSvg(value: string, nextFilename: string) {
    const hasSource = Boolean(value.trim());
    const effectiveFilename = hasSource ? nextFilename : "";
    let inspection: ReturnType<typeof inspectGeometrySource> | undefined;
    if (hasSource) {
      try {
        inspection = inspectGeometrySource(value);
      } catch {
        inspection = undefined;
      }
    }

    setSource(value);
    setCodeDraft(value);
    setFilename(effectiveFilename);
    setName(hasSource ? assetNameFromFile(effectiveFilename) : "custom-symbol");
    setVariantMode(defaultVariantMode(inspection?.sourceProfile));
    setRenderingMode("monochrome");
    setHierarchyAssignments({});
    setMulticolorAssignments({});
    setLayerPreviewColors({});
    setStrokeScale(1);
    setReferenceWeight("Regular");
    setReferenceScale("M");
    setSmallOpticalScale(DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.S);
    setLargeOpticalScale(DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS.L);
    setResult(undefined);
    setPreviewColorOverride(undefined);
    setInputError(undefined);
    setSourceDrawerOpen(false);
    setIsEditing(true);
    setPhase(hasSource ? "ready" : "empty");
    openPreviewOnSuccess.current = hasSource;
    setSourceRevision((revision) => revision + 1);
  }

  async function loadExampleLogo() {
    try {
      const response = await fetch("/logo.svg");
      if (!response.ok) {
        throw new Error(`The server returned HTTP ${response.status}.`);
      }
      loadSvg(await response.text(), "easysymbols-logo.svg");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setInputError(`Could not load the EasySymbols logo example. ${detail}`);
    }
  }

  function invalidateConversion() {
    setPhase(source.trim() ? "ready" : "empty");
  }

  useEffect(() => {
    if (!source.trim()) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPhase("converting");
      void geometry()
        .then((engine) => convertSvg(source, conversionOptions, engine))
        .then((converted) => {
          if (cancelled) return;
          setResult(converted);
          if (converted.analysis.rendering.layers.length > 0) {
            setHierarchyAssignments((current) =>
              Object.keys(current).length > 0
                ? current
                : Object.fromEntries(
                    converted.analysis.rendering.layers.map((layer) => [
                      layer.id,
                      "primary" as RenderingHierarchy,
                    ]),
                  ),
            );
            setMulticolorAssignments((current) =>
              Object.keys(current).length > 0
                ? current
                : Object.fromEntries(
                    converted.analysis.rendering.layers.map((layer) => [
                      layer.id,
                      layer.suggestedMulticolor,
                    ]),
                  ),
            );
          }
          if (converted.artifact) {
            setPhase("success");
            if (openPreviewOnSuccess.current) {
              openPreviewOnSuccess.current = false;
              setIsEditing(false);
            }
          } else {
            setPhase("error");
          }
        })
        .catch((cause) => {
          if (cancelled) return;
          setResult(failedConversion(cause));
          setPhase("error");
        });
    }, AUTO_CONVERT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [conversionOptions, source, sourceRevision]);

  async function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".svg")) {
      setInputError("Choose a file with the .svg extension.");
      return;
    }
    setInputError(undefined);
    loadSvg(await file.text(), file.name);
  }

  async function fetchSvgUrl() {
    const value = url.trim();
    if (!value) return;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(value);
    } catch {
      setInputError("Enter a complete SVG URL, including https://.");
      return;
    }
    if (
      !(["http:", "https:"] as const).includes(
        parsedUrl.protocol as "http:" | "https:",
      )
    ) {
      setInputError("The SVG URL must use http:// or https://.");
      return;
    }

    setFetchingUrl(true);
    setInputError(undefined);
    try {
      const response = await fetch(parsedUrl);
      if (!response.ok)
        throw new Error(`The server returned HTTP ${response.status}.`);
      const text = await response.text();
      if (!/<svg(?:\s|>)/i.test(text))
        throw new Error("The response did not contain SVG artwork.");
      const pathFilename =
        parsedUrl.pathname.split("/").filter(Boolean).at(-1) || "remote.svg";
      loadSvg(
        text,
        pathFilename.toLowerCase().endsWith(".svg")
          ? pathFilename
          : `${pathFilename}.svg`,
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setInputError(
        `Could not fetch that SVG. ${detail} The host may block browser requests.`,
      );
    } finally {
      setFetchingUrl(false);
    }
  }

  function downloadSymbolset() {
    if (!artifact) return;
    const catalog = `${artifact.name}.xcassets`;
    const files: Record<string, Uint8Array> = {
      [`${catalog}/Contents.json`]: strToU8(
        `${JSON.stringify({ info: { author: "easysymbols", version: 1 } }, null, 2)}\n`,
      ),
      [`${catalog}/${artifact.name}.symbolset/${artifact.name}.svg`]: strToU8(
        artifact.assetSymbolSvg ?? artifact.symbolSvg,
      ),
      [`${catalog}/${artifact.name}.symbolset/Contents.json`]: strToU8(
        artifact.symbolsetContents,
      ),
    };
    Object.entries(artifact.colorAssets ?? {}).forEach(([assetName, hex]) => {
      files[`${catalog}/${assetName}.colorset/Contents.json`] = strToU8(
        colorAssetContents(hex),
      );
    });
    download(
      zipSync(files),
      `${artifact.name}.xcassets.zip`,
      "application/zip",
    );
  }

  const controlModel: ControlPanelModel | undefined =
    artifact && result && !isEditing
      ? {
          artifact,
          canDownload: phase === "success",
          largeOpticalScale,
          hierarchyAssignments,
          layerPreviewColors,
          name,
          multicolorAssignments,
          padding,
          previewColor,
          previewColorIsOverridden: Boolean(previewColorOverride),
          profile: sourceProfile,
          referenceScale,
          referenceWeight,
          result,
          renderingMode,
          smallOpticalScale,
          strokeScale,
          variantMode,
          onDownloadSymbol: () => {
            if (artifact)
              download(
                artifact.symbolSvg,
                `${artifact.name}.symbols.svg`,
                "image/svg+xml",
              );
          },
          onDownloadSymbolset: downloadSymbolset,
          onLargeOpticalScaleChange: (value) => {
            setLargeOpticalScale(value);
            invalidateConversion();
          },
          onHierarchyAssignmentChange: (layerId, value) => {
            setHierarchyAssignments((current) => ({
              ...current,
              [layerId]: value,
            }));
            invalidateConversion();
          },
          onLayerPreviewColorChange: (hierarchy, value) => {
            setLayerPreviewColors((current) => ({
              ...current,
              [hierarchy]: value,
            }));
            invalidateConversion();
          },
          onNameChange: (value) => {
            setName(value);
            invalidateConversion();
          },
          onPaddingChange: (value) => {
            setPadding(value);
            invalidateConversion();
          },
          onPreviewColorChange: setPreviewColorOverride,
          onReferenceScaleChange: (value) => {
            setReferenceScale(value);
            invalidateConversion();
          },
          onReferenceWeightChange: (value) => {
            setReferenceWeight(value);
            invalidateConversion();
          },
          onRenderingModeChange: setRenderingMode,
          onResetPreviewColor: () => setPreviewColorOverride(undefined),
          onSmallOpticalScaleChange: (value) => {
            setSmallOpticalScale(value);
            invalidateConversion();
          },
          onStrokeScaleChange: (value) => {
            setStrokeScale(value);
            invalidateConversion();
          },
          onVariantModeChange: (value) => {
            setVariantMode(value);
            invalidateConversion();
          },
        }
      : undefined;

  const previewIsRefreshing =
    (phase === "ready" || phase === "converting") && Boolean(artifact);
  const previewModel =
    controlModel
      ? {
          artifact: controlModel.artifact,
          diagnostics: controlModel.result.analysis.diagnostics,
          filename,
          rows: previewRows,
          refreshing: previewIsRefreshing,
          settings: controlModel,
          onChangeArtwork: () => {
            openPreviewOnSuccess.current = false;
            setInputError(undefined);
            setSourceDrawerOpen(false);
            setIsEditing(true);
          },
          onOpenSource: () => setSourceDrawerOpen(true),
        }
      : undefined;

  return (
    <ConverterWorkbench
      input={{
        conversionDiagnostics:
          !artifact && (inputMode !== "code" || codeDraft === source)
          ? (result?.analysis.diagnostics ?? [])
          : [],
        code: codeDraft,
        dragging,
        error: inputError,
        fetchingUrl,
        filename,
        mode: inputMode,
        phase,
        url,
        onCodeChange: (value) => {
          setCodeDraft(value);
          setInputError(undefined);
        },
        onConvertCode: () => loadSvg(codeDraft, "pasted-symbol.svg"),
        onExample: () => void loadExampleLogo(),
        onFetchUrl: () => void fetchSvgUrl(),
        onFile: (file) => void acceptFile(file),
        onModeChange: (mode) => {
          setInputMode(mode);
          setInputError(undefined);
        },
        onSetDragging: setDragging,
        onUrlChange: setUrl,
      }}
      preview={previewModel}
      controls={controlModel}
      drawer={{
        filename,
        open: sourceDrawerOpen,
        source,
        onClose: () => setSourceDrawerOpen(false),
      }}
    />
  );
}
