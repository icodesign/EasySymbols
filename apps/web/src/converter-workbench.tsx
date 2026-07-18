import { Drawer } from "@base-ui/react/drawer";
import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  CaretUp,
  Check,
  Circle,
  Code,
  DotsSixVertical,
  Eyedropper,
  Export,
  FileSvg,
  FileZip,
  Minus,
  Plus,
  SpinnerGap,
  Stack,
  Trash,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import {
  RENDERING_COLOR_HEX,
  type ConversionResult,
  type Diagnostic,
  type RenderingAnalysis,
  type RenderingColorToken,
  type RenderingHierarchy,
  type RenderingLayerCandidate,
  type RenderingMode,
  type SourceProfile,
  type SymbolArtifact,
  type SymbolScale,
  type SymbolVariant,
  type SymbolWeight,
  type VariantMode,
} from "@easysymbols/core";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

export type InputMode = "file" | "url" | "code";
export type ConversionPhase =
  | "empty"
  | "ready"
  | "converting"
  | "success"
  | "error";
export type PreviewOrigin =
  | "authored"
  | "generated"
  | "approximate"
  | "unavailable";

export interface PreviewRow {
  cells: Array<{
    origin?: Exclude<PreviewOrigin, "unavailable">;
    src?: string;
    variant: SymbolVariant;
    weight: SymbolWeight;
  }>;
  scale: SymbolScale;
}

interface InputPanelModel {
  conversionDiagnostics: Diagnostic[];
  dragging: boolean;
  error?: string;
  fetchingUrl: boolean;
  filename: string;
  mode: InputMode;
  phase: ConversionPhase;
  code: string;
  url: string;
  onCodeChange: (value: string) => void;
  onConvertCode: () => void;
  onExample: () => void;
  onFetchUrl: () => void;
  onFile: (file: File | undefined) => void;
  onModeChange: (mode: InputMode) => void;
  onSetDragging: (dragging: boolean) => void;
  onUrlChange: (value: string) => void;
}

interface PreviewPanelModel {
  artifact: SymbolArtifact;
  diagnostics: Diagnostic[];
  filename: string;
  rows: PreviewRow[];
  refreshing: boolean;
  settings: ControlPanelModel;
  onChangeArtwork: () => void;
  onOpenSource: () => void;
}

export interface ControlPanelModel {
  artifact: SymbolArtifact;
  canDownload: boolean;
  hierarchyAssignments: Record<string, RenderingHierarchy>;
  layerPreviewColors: Partial<Record<RenderingHierarchy, string>>;
  largeOpticalScale: number;
  multicolorAssignments: Record<string, RenderingColorToken>;
  name: string;
  padding: number;
  previewColor: string;
  previewColorIsOverridden: boolean;
  profile?: SourceProfile;
  referenceScale: SymbolScale;
  referenceWeight: SymbolWeight;
  result: ConversionResult;
  renderingMode: RenderingMode;
  smallOpticalScale: number;
  strokeScale: number;
  variantMode: VariantMode;
  onDownloadSymbol: () => void;
  onDownloadSymbolset: () => void;
  onHierarchyAssignmentChange: (
    layerId: string,
    value: RenderingHierarchy,
  ) => void;
  onLayerPreviewColorChange: (
    hierarchy: RenderingHierarchy,
    value: string,
  ) => void;
  onLargeOpticalScaleChange: (value: number) => void;
  onNameChange: (value: string) => void;
  onPaddingChange: (value: number) => void;
  onPreviewColorChange: (value: string) => void;
  onReferenceScaleChange: (value: SymbolScale) => void;
  onReferenceWeightChange: (value: SymbolWeight) => void;
  onRenderingModeChange: (value: RenderingMode) => void;
  onResetPreviewColor: () => void;
  onSmallOpticalScaleChange: (value: number) => void;
  onStrokeScaleChange: (value: number) => void;
  onVariantModeChange: (value: VariantMode) => void;
}

interface SourceDrawerModel {
  filename: string;
  open: boolean;
  source: string;
  onClose: () => void;
}

interface ConverterWorkbenchProps {
  controls?: ControlPanelModel;
  drawer: SourceDrawerModel;
  input: InputPanelModel;
  preview?: PreviewPanelModel;
}

const SCALE_LABELS: Record<SymbolScale, string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
};

const WEIGHT_LABELS: Record<SymbolWeight, string> = {
  Ultralight: "Ultra",
  Thin: "Thin",
  Light: "Light",
  Regular: "Reg",
  Medium: "Med",
  Semibold: "Semi",
  Bold: "Bold",
  Heavy: "Heavy",
  Black: "Black",
};

const SYMBOL_SCALES: SymbolScale[] = ["S", "M", "L"];
const SYMBOL_WEIGHTS: SymbolWeight[] = [
  "Ultralight",
  "Thin",
  "Light",
  "Regular",
  "Medium",
  "Semibold",
  "Bold",
  "Heavy",
  "Black",
];

const LAYER_ORDER: RenderingHierarchy[] = ["primary", "secondary", "tertiary"];

const LAYER_DESCRIPTIONS: Record<RenderingHierarchy, string> = {
  primary: "Main artwork",
  secondary: "Supporting artwork",
  tertiary: "Subtle detail",
};

const LAYER_DEFAULT_COLORS: Record<RenderingHierarchy, string> = {
  primary: "#1688f5",
  secondary: "#7c3aed",
  tertiary: "#f59e0b",
};

const ORIGIN_LABELS: Record<PreviewOrigin, string> = {
  authored: "Authored",
  generated: "Synthesized",
  approximate: "Approximate",
  unavailable: "Unavailable",
};

type SupportStatus = "supported" | "converted" | "conditional" | "unsupported";

interface SupportMatrixRow {
  conversion: string;
  feature: string;
  notes: string;
  status: SupportStatus;
}

const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  supported: "Supported",
  converted: "Converted",
  conditional: "Conditional",
  unsupported: "Not supported",
};

const SUPPORT_STATUS_CLASSES: Record<SupportStatus, string> = {
  supported: "border-success/25 bg-success/10 text-[#247d57]",
  converted: "border-accent/25 bg-accent/10 text-accent-dark",
  conditional: "border-warning/25 bg-warning-soft text-[#79520f]",
  unsupported: "border-error/25 bg-error-soft text-[#8f3229]",
};

const ORIGIN_ICON_CLASSES: Record<PreviewOrigin, string> = {
  authored: "text-accent",
  generated: "text-accent",
  approximate: "text-[#b1670d]",
  unavailable: "text-[#a8cce9]",
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const SUPPORT_MATRIX_ROWS: SupportMatrixRow[] = [
  {
    feature: "Paths & basic shapes",
    status: "supported",
    conversion: "Shapes become normalized paths.",
    notes: "path, rect, circle, ellipse, line, polyline, and polygon",
  },
  {
    feature: "Groups & transforms",
    status: "supported",
    conversion: "Nested transforms are flattened into final geometry.",
    notes: "Local transform matrices are preserved in the result.",
  },
  {
    feature: "Flat fills & solid strokes",
    status: "supported",
    conversion: "Strokes expand to filled outlines.",
    notes: "Butt, round, and square caps; bevel, miter, and round joins",
  },
  {
    feature: "Even-odd fills",
    status: "converted",
    conversion: "Even-odd geometry is resolved to nonzero winding.",
    notes: "Cutouts remain compatible with SF Symbols.",
  },
  {
    feature: "SVG styles",
    status: "supported",
    conversion:
      "Presentation attributes, inline styles, and local classes are resolved.",
    notes:
      "Simple local .class rules and existing Apple rendering classes are recognized.",
  },
  {
    feature: "Opaque gradients",
    status: "converted",
    conversion: "Gradient geometry is flattened to a solid monochrome layer.",
    notes: "Stops, colors, and direction are not retained.",
  },
  {
    feature: "Rendering modes",
    status: "conditional",
    conversion:
      "Opacity, literal colors, and Apple classes become reviewable layer suggestions.",
    notes:
      "Monochrome is always included; approved layers add Hierarchical, Palette, and Multicolor.",
  },
  {
    feature: "SF Symbol variants",
    status: "conditional",
    conversion:
      "Centerlines can synthesize 27 masters; filled art can approximate S/M/L.",
    notes: "Filled and mixed artwork never invents weight variants.",
  },
  {
    feature: "Canvas background",
    status: "converted",
    conversion: "A detected full-canvas first fill is removed automatically.",
    notes: "Foreground artwork must remain inside the detected artboard.",
  },
  {
    feature: "Text, images & references",
    status: "unsupported",
    conversion: "The source is rejected instead of changing it silently.",
    notes:
      "Convert text to outlines; expand <use> and embed external references first.",
  },
  {
    feature: "Effects & complex paint",
    status: "unsupported",
    conversion: "The source is rejected instead of approximated.",
    notes:
      "clip-path, mask, filter, pattern, markers, dashes, vector-effect, and transparent gradients",
  },
];

export function ConverterWorkbench({
  controls,
  drawer,
  input,
  preview,
}: ConverterWorkbenchProps) {
  const previewIsVisible = Boolean(preview && controls);

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-white" id="top">
      <header className="relative z-50 flex h-[68px] items-center justify-between border-b border-line bg-white px-8 max-[600px]:h-[60px] max-[600px]:px-4">
        {previewIsVisible && preview ? (
          <PreviewHeader
            artifact={preview.artifact}
            filename={preview.filename}
            onChangeArtwork={preview.onChangeArtwork}
            onOpenSource={preview.onOpenSource}
          />
        ) : (
          <a
            className="inline-flex items-center gap-3 text-[18px] font-[650] tracking-[-0.02em] text-ink no-underline max-[600px]:gap-[9px] max-[600px]:text-[15px]"
            href="#top"
            aria-label="EasySymbols home"
          >
            <img
              className="block size-[20px] shrink-0 max-[600px]:size-[20px]"
              src="/logo.svg"
              alt=""
            />
            <span>EasySymbols</span>
          </a>
        )}
        <div className="flex items-center gap-7 max-[600px]:gap-3">
          <nav
            className="flex items-center gap-6 max-[600px]:hidden"
            aria-label="External links"
          >
            <a
              className="text-xs font-semibold text-ink no-underline transition-colors hover:text-accent"
              href="https://github.com/icodesign/easysymbols"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a
              className="text-xs font-semibold text-ink no-underline transition-colors hover:text-accent"
              href="https://x.com/icodesign_me"
              target="_blank"
              rel="noreferrer"
            >
              X @icodesign_me
            </a>
          </nav>
          <span className="inline-flex items-center gap-[7px] font-mono text-[10px] tracking-[0.06em] text-muted uppercase max-[600px]:text-[8px]">
            <Circle
              aria-hidden="true"
              className="text-[#35a970] drop-shadow-[0_0_3px_rgba(53,169,112,0.4)]"
              size={8}
              weight="fill"
            />
            100% local conversion
          </span>
        </div>
      </header>

      {previewIsVisible && preview ? (
        <PreviewPanel {...preview} />
      ) : (
        <>
          <section
            className="grid min-h-[calc(100dvh-68px)] content-center px-6 py-12 max-[600px]:min-h-[calc(100dvh-60px)] max-[600px]:px-3 max-[600px]:py-8"
            id="converter"
            aria-label="SVG to SF Symbol converter"
          >
            <div className="mx-auto grid w-full max-w-[980px] gap-9 max-[600px]:gap-7">
              <section className="text-center" aria-labelledby="hero-title">
                <h1
                  className="m-0 text-[clamp(3rem,6vw,5.25rem)] leading-[0.95] font-[600] tracking-[-0.055em] max-[600px]:text-[clamp(2.65rem,14vw,4rem)]"
                  id="hero-title"
                >
                  SVG to SF Symbols
                </h1>
                <p className="mx-auto mt-5 max-w-[720px] text-[17px] leading-[1.5] tracking-[-0.02em] text-muted max-[600px]:mt-4 max-[600px]:text-sm">
                  Convert any SVG into native SF Symbols with clean layers,
                  consistent strokes, and perfect alignment.
                </p>
              </section>
              <ArtworkInput {...input} />
            </div>
          </section>
          <SupportMatrix />
        </>
      )}

      <SourceDrawer {...drawer} />
    </main>
  );
}

function PreviewHeader({
  artifact,
  filename,
  onChangeArtwork,
  onOpenSource,
}: Pick<
  PreviewPanelModel,
  "artifact" | "filename" | "onChangeArtwork" | "onOpenSource"
>) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-white p-0 text-ink transition-colors hover:border-accent hover:text-accent max-[600px]:size-8"
        type="button"
        aria-label="Change artwork"
        onClick={onChangeArtwork}
      >
        <ArrowLeft aria-hidden="true" size={18} />
      </button>
      <span className="inline-flex min-w-0 items-center gap-2 px-1.5 max-[600px]:max-w-[48vw]">
        <FileSvg
          aria-hidden="true"
          className="shrink-0 text-accent"
          size={18}
          weight="fill"
        />
        <strong className="overflow-hidden text-[12px] font-semibold text-ellipsis whitespace-nowrap">
          {filename || `${artifact.name}.svg`}
        </strong>
        <small className="shrink-0 font-mono text-[9px] text-muted max-[760px]:hidden">
          · {artifact.variants.length}{" "}
          {artifact.variants.length === 1 ? "master" : "masters"}
        </small>
      </span>
      <button
        className="inline-flex min-h-9 shrink-0 items-center justify-center gap-[7px] rounded-[10px] border border-line bg-white px-3 text-[11px] font-semibold text-ink transition-colors hover:border-accent hover:text-accent max-[520px]:px-2.5 max-[600px]:min-h-8"
        type="button"
        onClick={onOpenSource}
      >
        <Code aria-hidden="true" className="text-accent" size={16} />
        <span className="max-[520px]:sr-only">Show SVG code</span>
      </button>
    </div>
  );
}

function SupportMatrix() {
  return (
    <section
      className="mx-auto mt-11 w-[min(1160px,calc(100%_-_96px))] border-y border-line px-0 py-8 max-[860px]:w-[calc(100%_-_40px)] max-[600px]:mt-[34px] max-[600px]:w-[calc(100%_-_28px)] max-[600px]:py-7"
      id="support-matrix"
      aria-labelledby="support-matrix-title"
    >
      <div className="grid max-w-[760px] gap-2 px-1 pb-6">
        <span className="font-mono text-[9px] font-semibold tracking-[0.1em] text-muted uppercase">
          SVG compatibility
        </span>
        <h2
          className="m-0 text-2xl font-[640] tracking-[-0.04em]"
          id="support-matrix-title"
        >
          Support matrix
        </h2>
        <p className="m-0 text-[13px] leading-[1.55] text-muted">
          What imports directly, what EasySymbols deliberately converts, and
          what needs to be expanded before import.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[920px] table-fixed border-separate border-spacing-0 text-left [&_td]:border-b [&_td]:border-line [&_td]:px-3.5 [&_td]:py-3 [&_td]:align-top [&_td]:text-[11px] [&_td]:leading-[1.45] [&_th]:border-b [&_th]:border-line [&_th]:px-3.5 [&_th]:py-3 [&_th]:align-top [&_th]:text-[11px] [&_th]:leading-[1.45] [&_tr:last-child>*]:border-b-0 [&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-line [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-line">
          <thead>
            <tr>
              <th
                className="w-[20%] bg-surface-muted font-mono text-[8.5px]! font-semibold tracking-[0.08em] text-muted uppercase"
                scope="col"
              >
                Feature
              </th>
              <th
                className="w-[14%] bg-surface-muted font-mono text-[8.5px]! font-semibold tracking-[0.08em] text-muted uppercase"
                scope="col"
              >
                Status
              </th>
              <th
                className="w-[30%] bg-surface-muted font-mono text-[8.5px]! font-semibold tracking-[0.08em] text-muted uppercase"
                scope="col"
              >
                What EasySymbols does
              </th>
              <th
                className="w-[36%] bg-surface-muted font-mono text-[8.5px]! font-semibold tracking-[0.08em] text-muted uppercase"
                scope="col"
              >
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {SUPPORT_MATRIX_ROWS.map((row) => (
              <tr key={row.feature}>
                <th className="font-[650] text-ink" scope="row">
                  {row.feature}
                </th>
                <td className="text-muted">
                  <span
                    className={cx(
                      "inline-flex min-h-5 items-center rounded-full border px-2 font-mono text-[8.5px] font-semibold whitespace-nowrap",
                      SUPPORT_STATUS_CLASSES[row.status],
                    )}
                  >
                    {SUPPORT_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td className="text-muted">{row.conversion}</td>
                <td className="text-muted">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 mb-0 px-1 font-mono text-[9.5px] leading-[1.5] text-muted">
        Root SVGs need a valid viewBox or numeric width and height. Current
        limits: 2 MB source, 10,000 elements, and 2,000 rendered paths.
      </p>
    </section>
  );
}

function ArtworkInput({
  conversionDiagnostics,
  dragging,
  error,
  fetchingUrl,
  filename,
  mode,
  phase,
  code,
  url,
  onCodeChange,
  onConvertCode,
  onExample,
  onFetchUrl,
  onFile,
  onModeChange,
  onSetDragging,
  onUrlChange,
}: InputPanelModel) {
  const isPreparing = phase === "ready" || phase === "converting";

  return (
    <div className="grid content-start gap-[18px] bg-transparent">
      <h2 className="sr-only">Add SVG</h2>

      <div
        className="mx-auto flex w-full max-w-[560px] gap-1 rounded-xl border border-[#dfdfd8] bg-[#efefe9] p-1 shadow-[inset_0_1px_1px_rgba(20,20,18,0.03)]"
        role="tablist"
        aria-label="Artwork input method"
      >
        {(["file", "url", "code"] as const).map((inputMode) => (
          <button
            key={inputMode}
            type="button"
            role="tab"
            aria-controls={`input-panel-${inputMode}`}
            aria-selected={mode === inputMode}
            className={cx(
              "relative flex-1 rounded-[9px] border-0 px-1 py-[9px] text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
              mode === inputMode
                ? "bg-ink text-white shadow-[0_4px_12px_rgba(21,22,22,0.14)] hover:text-white"
                : "bg-transparent text-muted hover:text-ink",
            )}
            onClick={() => onModeChange(inputMode)}
          >
            {inputMode === "file"
              ? "File"
              : inputMode === "url"
                ? "URL"
                : "SVG code"}
          </button>
        ))}
      </div>

      <div
        className="mx-auto h-[310px] w-full max-w-[760px] max-[600px]:h-[260px]"
        id={`input-panel-${mode}`}
        role="tabpanel"
      >
        {mode === "file" ? (
          <div
            className={cx(
              "drop-zone-grid relative flex h-full cursor-pointer flex-col items-center justify-center gap-[7px] rounded-[16px] border-[1.5px] border-dashed p-6 text-center transition-[border-color,background-color,transform] duration-150 has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-[rgb(38_116_223/28%)]",
              dragging
                ? "scale-[0.99] border-accent bg-accent-soft"
                : "border-[#c3c5be] bg-[#fbfbf9] hover:border-accent hover:bg-[#f8fbff]",
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              onSetDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (
                event.currentTarget.contains(event.relatedTarget as Node | null)
              )
                return;
              onSetDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              onSetDragging(false);
              onFile(event.dataTransfer.files[0]);
            }}
          >
            <input
              className="absolute inset-0 z-[2] size-full cursor-pointer opacity-0"
              type="file"
              accept="image/svg+xml,.svg"
              aria-label={
                filename
                  ? `Choose another SVG. Current file: ${filename}`
                  : "Choose an SVG file"
              }
              onChange={(event) => {
                onFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <span
              className="mb-0.5 grid size-11 place-items-center rounded-full border border-line-strong bg-white shadow-[0_8px_22px_rgba(28,30,27,0.08)]"
              aria-hidden="true"
            >
              <Plus size={23} weight="regular" />
            </span>
            <strong className="max-w-full overflow-hidden text-[15px] font-[580] text-ellipsis whitespace-nowrap">
              {filename || "Drop an SVG here"}
            </strong>
            <span className="text-xs leading-[1.4] text-muted">
              {filename
                ? "Click anywhere to choose another SVG"
                : "or click anywhere to choose a file"}
            </span>
          </div>
        ) : null}

        {mode === "url" ? (
          <div className="flex h-full flex-col justify-center gap-2.5">
            <div className="flex gap-2 max-[600px]:grid">
              <input
                className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-white px-3.5 text-[13px]"
                aria-label="SVG URL"
                type="url"
                value={url}
                placeholder="https://…/icon.svg"
                onChange={(event) => onUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && url.trim() && !fetchingUrl)
                    onFetchUrl();
                }}
              />
              <button
                className="inline-flex min-h-11 items-center justify-center gap-[7px] rounded-[10px] border border-ink bg-ink px-5 text-[12.5px] font-semibold text-white transition-[background-color,border-color,transform] duration-150 not-disabled:hover:-translate-y-px not-disabled:hover:border-accent not-disabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
                type="button"
                disabled={!url.trim() || fetchingUrl}
                onClick={onFetchUrl}
              >
                {fetchingUrl ? (
                  <SpinnerGap
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-[spin_1.8s_linear_infinite]"
                    size={16}
                  />
                ) : null}
                {fetchingUrl ? "Fetching…" : "Fetch"}
              </button>
            </div>
            <p className="m-0 text-[11.5px] leading-[1.4] text-muted">
              Direct link to a raw .svg. Fetched and converted in your browser.
            </p>
          </div>
        ) : null}

        {mode === "code" ? (
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2.5">
            <textarea
              className="block size-full min-h-0 resize-none rounded-xl border border-line bg-[#fbfbf9] p-3.5 font-mono text-[11px] leading-[1.55]"
              aria-label="SVG source"
              spellCheck={false}
              value={code}
              placeholder={'<svg viewBox="0 0 24 24">…</svg>'}
              onChange={(event) => onCodeChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  code.trim() &&
                  !isPreparing
                ) {
                  event.preventDefault();
                  onConvertCode();
                }
              }}
            />
            <div className="flex min-h-11 items-center justify-end gap-3">
              <span className="font-mono text-[9px] tracking-[0.02em] text-muted max-[600px]:hidden">
                ⌘ / Ctrl + Enter
              </span>
              <button
                className="inline-flex min-h-9 items-center justify-center gap-[7px] rounded-[10px] border border-ink bg-ink px-5 text-[12.5px] font-semibold text-white transition-[background-color,border-color,transform] duration-150 not-disabled:hover:-translate-y-px not-disabled:hover:border-accent not-disabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
                type="button"
                disabled={!code.trim() || isPreparing}
                onClick={onConvertCode}
              >
                Convert
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <InlineInputError message={error} /> : null}
      {!error && conversionDiagnostics.length ? (
        <NoticeList
          className="mx-auto -mt-1 w-full max-w-[760px]"
          diagnostics={conversionDiagnostics}
        />
      ) : null}

      <div className="flex min-h-[34px] items-center justify-center gap-3.5">
        <button
          className="border-0 bg-transparent px-0 py-[3px] text-xs font-semibold text-accent underline underline-offset-[3px] hover:text-accent-dark"
          type="button"
          onClick={onExample}
        >
          Try our logo
        </button>
        {isPreparing ? (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[9px] tracking-[0.03em] text-muted uppercase"
            role="status"
            aria-live="polite"
          >
            <SpinnerGap
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-[spin_1.8s_linear_infinite]"
              size={15}
            />
            Preparing preview…
          </span>
        ) : null}
      </div>
    </div>
  );
}

function InlineInputError({ message }: { message: string }) {
  return (
    <div
      className="mx-auto -mt-1 flex w-full max-w-[700px] items-start gap-[9px] rounded-r-lg rounded-l-none border-l-[3px] border-error bg-error-soft px-3 py-2.5 text-[11.5px] leading-[1.4] text-[#8f3229]"
      role="alert"
    >
      <XCircle
        aria-hidden="true"
        className="mt-px shrink-0"
        size={17}
        weight="fill"
      />
      <span>{message}</span>
    </div>
  );
}

function PreviewPanel({
  artifact,
  diagnostics,
  rows,
  refreshing,
  settings,
}: PreviewPanelModel) {
  const [layerEditorOpen, setLayerEditorOpen] = useState(false);
  const [inspectorPage, setInspectorPage] = useState<InspectorPage>("root");
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>(() =>
    settings.result.analysis.rendering.layers.map((layer) => layer.id),
  );
  const [activeLayers, setActiveLayers] = useState<
    Record<RenderingHierarchy, boolean>
  >({
    primary: true,
    secondary: false,
    tertiary: false,
  });
  const [hoveredLayerIds, setHoveredLayerIds] = useState<string[]>([]);
  const [draggedLayerId, setDraggedLayerId] = useState<string>();
  const origins = useMemo(() => {
    const present = new Set<PreviewOrigin>();
    rows.forEach((row) =>
      row.cells.forEach((cell) => present.add(cell.origin ?? "unavailable")),
    );
    return (
      ["authored", "generated", "approximate", "unavailable"] as const
    ).filter((origin) => present.has(origin));
  }, [rows]);

  useEffect(() => {
    const availableLayerIds = settings.result.analysis.rendering.layers.map(
      (layer) => layer.id,
    );
    setSelectedLayerIds((current) => {
      const next = current.filter((id) => availableLayerIds.includes(id));
      return next.length > 0 || availableLayerIds.length === 0
        ? next
        : availableLayerIds;
    });
  }, [settings.result.analysis.rendering.layers]);

  useEffect(() => {
    const assignedHierarchies = new Set(
      Object.values(settings.hierarchyAssignments),
    );
    setActiveLayers((current) => {
      const next = {
        primary: true,
        secondary: current.secondary || assignedHierarchies.has("secondary"),
        tertiary: current.tertiary || assignedHierarchies.has("tertiary"),
      } satisfies Record<RenderingHierarchy, boolean>;
      return next.primary === current.primary &&
        next.secondary === current.secondary &&
        next.tertiary === current.tertiary
        ? current
        : next;
    });
  }, [settings.hierarchyAssignments]);

  const layerPreviewSource =
    artifact.renderingPreviews[settings.renderingMode]?.svg ??
    artifact.previewSvg;

  const renderingLayers = settings.result.analysis.rendering.layers;
  const layerPreviewColors = useMemo(() => {
    const next = { ...settings.layerPreviewColors };
    LAYER_ORDER.forEach((hierarchy) => {
      if (next[hierarchy]) return;
      const firstLayer = renderingLayers.find(
        (layer) =>
          (settings.hierarchyAssignments[layer.id] ?? "primary") === hierarchy,
      );
      const token = firstLayer
        ? (settings.multicolorAssignments[firstLayer.id] ??
          firstLayer.suggestedMulticolor)
        : undefined;
      const tokenColor =
        token && token !== "customColor"
          ? RENDERING_COLOR_HEX[token]
          : undefined;
      const customSourceColor =
        token === "customColor" ? firstLayer?.sourceColor : undefined;
      next[hierarchy] =
        tokenColor ??
        customSourceColor ??
        firstLayer?.sourceColor ??
        LAYER_DEFAULT_COLORS[hierarchy];
    });
    return next;
  }, [
    renderingLayers,
    settings.hierarchyAssignments,
    settings.layerPreviewColors,
    settings.multicolorAssignments,
  ]);

  function moveStrokeToLayer(
    strokeId: string,
    hierarchy: RenderingHierarchy,
  ): void {
    if ((settings.hierarchyAssignments[strokeId] ?? "primary") === hierarchy) {
      return;
    }
    settings.onHierarchyAssignmentChange(strokeId, hierarchy);
  }

  function deleteLayer(hierarchy: RenderingHierarchy): void {
    if (hierarchy === "primary") return;
    renderingLayers
      .filter(
        (layer) =>
          (settings.hierarchyAssignments[layer.id] ?? "primary") === hierarchy,
      )
      .forEach((layer) =>
        settings.onHierarchyAssignmentChange(layer.id, "primary"),
      );
    setActiveLayers((current) => ({ ...current, [hierarchy]: false }));
  }

  return (
    <section
      className="relative isolate h-[calc(100dvh-68px)] min-h-0 overflow-hidden bg-white max-[900px]:h-auto max-[900px]:min-h-0 max-[600px]:min-h-[calc(100dvh-60px)]"
      aria-label="Symbol preview"
    >
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,390px)] max-[900px]:h-auto max-[900px]:min-h-0 max-[900px]:grid-cols-1 max-[600px]:min-h-[calc(100dvh-60px)]">
        <div
          className={cx(
            "relative h-full min-h-0 min-w-0 overflow-hidden max-[900px]:h-auto max-[900px]:min-h-0 max-[600px]:min-h-[calc(100dvh-60px)]",
            diagnostics.length > 0 &&
              !layerEditorOpen &&
              "grid grid-rows-[minmax(0,1fr)_auto]",
          )}
        >
          <div
            className={cx(
              "flex items-center justify-center px-10 pt-10 pb-12 max-[600px]:px-3 max-[600px]:pt-8 max-[600px]:pb-8",
              diagnostics.length > 0 && !layerEditorOpen
                ? "h-full min-h-0"
                : "min-h-[calc(100dvh-68px)] max-[600px]:min-h-[calc(100dvh-60px)]",
            )}
          >
            {layerEditorOpen ? (
              <LayerEditorPreview
                activeLayers={activeLayers}
                assignments={settings.hierarchyAssignments}
                artifact={artifact}
                layers={settings.result.analysis.rendering.layers}
                layerPreviewSource={layerPreviewSource}
                layerPreviewColors={layerPreviewColors}
                multicolorAssignments={settings.multicolorAssignments}
                multicolorPreview={settings.renderingMode === "multicolor"}
                previewColor={settings.previewColor}
                selectedLayerIds={selectedLayerIds}
                draggedLayerId={draggedLayerId}
                hoveredLayerIds={hoveredLayerIds}
                onAddLayer={(hierarchy) =>
                  setActiveLayers((current) => ({
                    ...current,
                    [hierarchy]: true,
                  }))
                }
                onDeleteLayer={deleteLayer}
                onDragLayer={setDraggedLayerId}
                onHoverLayerIds={setHoveredLayerIds}
                onMoveStroke={moveStrokeToLayer}
                onPreviewLayerColorChange={settings.onLayerPreviewColorChange}
                onToggleLayer={(layerId) => {
                  setSelectedLayerIds((current) =>
                    current.includes(layerId)
                      ? current.filter((id) => id !== layerId)
                      : [...current, layerId],
                  );
                }}
              />
            ) : (
              <div className="relative w-full max-w-[1320px] overflow-hidden rounded-[20px] border border-line bg-white p-3 shadow-[0_24px_70px_rgba(24,26,29,0.1)] max-[600px]:rounded-[16px] max-[600px]:p-2">
                {refreshing ? (
                  <span
                    className="absolute top-5 right-5 z-[2] grid size-8 place-items-center rounded-full border border-[#b9ddfb] bg-white text-accent shadow-sm"
                    role="status"
                    aria-label="Refreshing preview"
                  >
                    <SpinnerGap
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-[spin_1.8s_linear_infinite]"
                      size={15}
                    />
                  </span>
                ) : null}
                <div className="overflow-hidden rounded-[14px] border border-[#8fcaff] bg-white">
                  <div
                    className="min-w-0"
                    role="table"
                    aria-label={`${artifact.name} master preview by weight and scale`}
                  >
                    <div
                      className="grid min-h-[52px] grid-cols-[52px_repeat(9,minmax(0,1fr))] items-center border-b border-[#8fcaff] bg-white/76"
                      role="row"
                    >
                      <span
                        className="overflow-hidden text-center font-mono text-[9px] font-[650] tracking-[0.08em] text-ellipsis whitespace-nowrap text-muted uppercase"
                        role="columnheader"
                      >
                        Size
                      </span>
                      {SYMBOL_WEIGHTS.map((weight) => (
                        <span
                          className="overflow-hidden text-center text-[10px] font-[650] text-ellipsis whitespace-nowrap text-muted"
                          key={weight}
                          role="columnheader"
                          title={weight}
                        >
                          {WEIGHT_LABELS[weight]}
                        </span>
                      ))}
                    </div>
                    {rows.map((row) => (
                      <div
                        className="grid min-h-[112px] grid-cols-[52px_repeat(9,minmax(0,1fr))] border-b border-[#bce1fc] last:border-b-0"
                        key={row.scale}
                        role="row"
                      >
                        <span
                          className="flex items-center justify-center text-[11px] font-[650]"
                          role="rowheader"
                        >
                          {SCALE_LABELS[row.scale]}
                        </span>
                        {row.cells.map((cell) => {
                          const origin = cell.origin ?? "unavailable";
                          return (
                            <span
                              key={cell.variant}
                              className="relative grid min-w-0 place-items-center border-l border-[rgb(155_210_255/34%)]"
                              role="cell"
                              aria-label={`${cell.weight}, ${SCALE_LABELS[row.scale]} — ${origin}`}
                            >
                              {cell.origin ? (
                                <>
                                  <OriginIcon
                                    className="absolute top-3 right-3"
                                    origin={cell.origin}
                                  />
                                  <img
                                    className={cx(
                                      "block w-auto max-w-[76%] object-contain",
                                      row.scale === "S"
                                        ? "h-8"
                                        : row.scale === "M"
                                          ? "h-10"
                                          : "h-12",
                                    )}
                                    src={cell.src ?? ""}
                                    alt={`${cell.weight} ${SCALE_LABELS[row.scale]} ${cell.origin} master`}
                                  />
                                </>
                              ) : (
                                <Minus
                                  aria-hidden="true"
                                  className="text-[#a8cce9]"
                                  size={16}
                                />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                {origins.length > 1 ? (
                  <div
                    className="flex flex-wrap items-center justify-end gap-3 px-1 pt-2.5 text-[9.5px] text-muted"
                    aria-label="Master preview legend"
                  >
                    {origins.map((origin) => (
                      <span
                        className="inline-flex items-center gap-1.5"
                        key={origin}
                      >
                        <OriginIcon origin={origin} />
                        {ORIGIN_LABELS[origin]}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {diagnostics.length ? (
            <div className="mx-auto w-full max-w-[1320px] px-10 pb-10 max-[600px]:px-3 max-[600px]:pb-6">
              <NoticeList collapsible diagnostics={diagnostics} />
            </div>
          ) : null}
        </div>

        <PreviewInspector
          settings={settings}
          page={inspectorPage}
          onOpenLayerEditor={() => setLayerEditorOpen(true)}
          onCloseLayerEditor={() => setLayerEditorOpen(false)}
          onPageChange={setInspectorPage}
        />
      </div>
    </section>
  );
}

function LayerEditorPreview({
  activeLayers,
  assignments,
  artifact,
  draggedLayerId,
  hoveredLayerIds,
  layers,
  layerPreviewSource,
  layerPreviewColors,
  multicolorAssignments,
  multicolorPreview,
  previewColor,
  selectedLayerIds,
  onAddLayer,
  onDeleteLayer,
  onDragLayer,
  onHoverLayerIds,
  onMoveStroke,
  onPreviewLayerColorChange,
  onToggleLayer,
}: {
  activeLayers: Record<RenderingHierarchy, boolean>;
  assignments: Record<string, RenderingHierarchy>;
  artifact: SymbolArtifact;
  draggedLayerId?: string;
  hoveredLayerIds: string[];
  layers: RenderingLayerCandidate[];
  layerPreviewSource?: string;
  layerPreviewColors: Partial<Record<RenderingHierarchy, string>>;
  multicolorAssignments: Record<string, RenderingColorToken>;
  multicolorPreview: boolean;
  previewColor: string;
  selectedLayerIds: string[];
  onAddLayer: (hierarchy: RenderingHierarchy) => void;
  onDeleteLayer: (hierarchy: RenderingHierarchy) => void;
  onDragLayer: (layerId: string | undefined) => void;
  onHoverLayerIds: (layerIds: string[]) => void;
  onMoveStroke: (strokeId: string, hierarchy: RenderingHierarchy) => void;
  onPreviewLayerColorChange: (
    hierarchy: RenderingHierarchy,
    color: string,
  ) => void;
  onToggleLayer: (layerId: string) => void;
}) {
  const selected = new Set(selectedLayerIds);
  const hovered = new Set(hoveredLayerIds);
  const [dragOverLayer, setDragOverLayer] = useState<RenderingHierarchy>();
  const [expandedLayers, setExpandedLayers] = useState<
    Record<RenderingHierarchy, boolean>
  >({
    primary: true,
    secondary: true,
    tertiary: true,
  });
  const layerColorOverrides = multicolorPreview
    ? Object.fromEntries(
        layers.map((layer) => [
          layer.id,
          layerPreviewColors[assignments[layer.id] ?? "primary"] ??
            layer.sourceColor ??
            previewColor,
        ]),
      )
    : {};
  const previewSvg = layerPreviewSource
    ? customizeLayerPreviewSvg(
        layerPreviewSource,
        selected,
        hovered,
        layerColorOverrides,
      )
    : artifact.previewSvg;
  const groupedLayers = LAYER_ORDER.filter(
    (hierarchy) => activeLayers[hierarchy],
  ).map((hierarchy) => ({
    hierarchy,
    strokes: layers.filter(
      (layer) => (assignments[layer.id] ?? "primary") === hierarchy,
    ),
  }));

  function onDropLayer(
    event: DragEvent<HTMLDivElement>,
    hierarchy: RenderingHierarchy,
  ) {
    event.preventDefault();
    const strokeId = event.dataTransfer.getData("text/plain") || draggedLayerId;
    if (strokeId) onMoveStroke(strokeId, hierarchy);
    setDragOverLayer(undefined);
    onDragLayer(undefined);
  }

  return (
    <div className="grid w-full max-w-[1320px] min-h-0 gap-3">
      <div className="flex items-end gap-4 px-1 max-[600px]:items-start max-[600px]:flex-col">
        <div className="grid gap-1">
          <span className="font-mono text-[9px] font-semibold tracking-[0.1em] text-accent uppercase">
            Layer editor
          </span>
          <h2 className="m-0 text-[clamp(1.35rem,2.5vw,2rem)] font-[680] tracking-[-0.045em]">
            Organize your layers
          </h2>
          <p className="m-0 max-w-[640px] text-[12px] leading-[1.5] text-muted">
            Drag strokes between Primary, Secondary, and Tertiary. Hover any
            layer or stroke to locate it in the preview.
          </p>
        </div>
      </div>

      <div className="grid h-[min(72dvh,680px)] min-h-[420px] grid-cols-[minmax(0,1fr)_minmax(270px,320px)] overflow-hidden rounded-[20px] border border-line bg-white shadow-[0_24px_70px_rgba(24,26,29,0.1)] max-[900px]:h-auto max-[900px]:min-h-0 max-[900px]:grid-cols-1">
        <div className="relative grid min-h-0 place-items-center bg-white p-8 max-[600px]:min-h-[280px] max-[600px]:p-6">
          {selected.size > 0 ? (
            <img
              alt={`${artifact.name} selected layer composition`}
              className="block h-auto max-h-[min(48dvh,420px)] w-auto max-w-[78%] object-contain drop-shadow-[0_16px_26px_rgba(24,26,29,0.12)] max-[600px]:max-h-[200px] max-[600px]:max-w-[74%]"
              src={renderingPreviewDataUrl(previewSvg, previewColor)}
            />
          ) : (
            <div className="grid max-w-[220px] justify-items-center gap-2 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-accent/10 text-accent">
                <Stack aria-hidden="true" size={22} weight="duotone" />
              </span>
              <strong className="text-[12px] font-[650]">
                No layers selected
              </strong>
              <span className="text-[10px] leading-[1.45] text-muted">
                Select a layer on the right to rebuild this preview.
              </span>
            </div>
          )}
          <span className="absolute bottom-4 left-5 rounded-full border border-line bg-white px-2.5 py-1 font-mono text-[9px] text-muted">
            {selected.size} of {layers.length} strokes visible
          </span>
        </div>

        <aside className="flex min-h-0 flex-col border-l border-line bg-white max-[900px]:max-h-[520px] max-[900px]:border-t max-[900px]:border-l-0">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <span className="text-[11px] font-[650] text-ink">Layers</span>
            <span className="font-mono text-[9px] font-semibold text-accent">
              {selected.size} selected
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="grid gap-2" role="list" aria-label="Preview layers">
              {groupedLayers.map(({ hierarchy, strokes }) => {
                const groupIds = strokes.map((layer) => layer.id);
                const groupColor =
                  layerPreviewColors[hierarchy] ??
                  LAYER_DEFAULT_COLORS[hierarchy];
                const firstStroke = strokes[0];
                const suggestedToken = firstStroke
                  ? (multicolorAssignments[firstStroke.id] ??
                    firstStroke.suggestedMulticolor)
                  : undefined;
                return (
                  <div
                    aria-label={`${HIERARCHY_LABELS[hierarchy]} layer`}
                    className={cx(
                      "grid gap-1.5 rounded-xl border p-2 transition-[border-color,background-color,box-shadow]",
                      dragOverLayer === hierarchy
                        ? "border-accent bg-accent-soft shadow-[0_0_0_2px_rgba(22,136,245,0.14)]"
                        : "border-line bg-white",
                    )}
                    key={hierarchy}
                    role="group"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverLayer(hierarchy);
                    }}
                    onDragLeave={() => setDragOverLayer(undefined)}
                    onDrop={(event) => onDropLayer(event, hierarchy)}
                    onMouseEnter={() => onHoverLayerIds(groupIds)}
                    onMouseLeave={() => onHoverLayerIds([])}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        aria-expanded={expandedLayers[hierarchy]}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition-colors hover:text-accent"
                        type="button"
                        onClick={() =>
                          setExpandedLayers((current) => ({
                            ...current,
                            [hierarchy]: !current[hierarchy],
                          }))
                        }
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                          <Stack
                            aria-hidden="true"
                            size={15}
                            weight="duotone"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block text-[10.5px] font-[650] text-ink">
                            {HIERARCHY_LABELS[hierarchy]}
                          </strong>
                          <small className="block text-[8.5px] text-muted">
                            {strokes.length}{" "}
                            {strokes.length === 1 ? "stroke" : "strokes"} ·{" "}
                            {LAYER_DESCRIPTIONS[hierarchy]}
                          </small>
                        </span>
                        {expandedLayers[hierarchy] ? (
                          <CaretDown
                            aria-hidden="true"
                            className="shrink-0 text-muted"
                            size={15}
                          />
                        ) : (
                          <CaretRight
                            aria-hidden="true"
                            className="shrink-0 text-muted"
                            size={15}
                          />
                        )}
                      </button>
                      {multicolorPreview ? (
                        <label
                          className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-line-strong bg-white"
                          title={`Preview color for ${HIERARCHY_LABELS[hierarchy]} layer`}
                        >
                          <span
                            aria-hidden="true"
                            className="absolute inset-0"
                            style={{ backgroundColor: groupColor }}
                          />
                          <Eyedropper
                            aria-hidden="true"
                            className="relative z-[1] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
                            size={13}
                            weight="duotone"
                          />
                          <input
                            aria-label={`${HIERARCHY_LABELS[hierarchy]} layer preview color`}
                            className="absolute inset-0 z-[2] size-full cursor-pointer opacity-0"
                            type="color"
                            value={groupColor}
                            onChange={(event) =>
                              onPreviewLayerColorChange(
                                hierarchy,
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      ) : null}
                      {hierarchy !== "primary" ? (
                        <button
                          aria-label={`Delete ${HIERARCHY_LABELS[hierarchy]} layer`}
                          className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-error/40 hover:bg-error-soft hover:text-error"
                          type="button"
                          onClick={() => onDeleteLayer(hierarchy)}
                        >
                          <Trash aria-hidden="true" size={14} />
                        </button>
                      ) : null}
                    </div>

                    {expandedLayers[hierarchy] ? (
                      <div className="grid gap-1">
                        {strokes.map((layer) => {
                          const isSelected = selected.has(layer.id);
                          const isHovered = hovered.has(layer.id);
                          return (
                            <div
                              aria-label={`${layer.label}, ${HIERARCHY_LABELS[hierarchy]} layer`}
                              className={cx(
                                "flex min-h-[44px] items-center gap-1.5 rounded-lg border px-2 text-left transition-[border-color,background-color,box-shadow]",
                                isHovered
                                  ? "border-accent bg-accent-soft shadow-[0_0_0_2px_rgba(22,136,245,0.12)]"
                                  : isSelected
                                    ? "border-accent/45 bg-accent/5"
                                    : "border-line bg-white hover:border-accent/60",
                              )}
                              draggable
                              key={layer.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => onToggleLayer(layer.id)}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  layer.id,
                                );
                                onDragLayer(layer.id);
                              }}
                              onDragEnd={() => {
                                onDragLayer(undefined);
                                setDragOverLayer(undefined);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  onToggleLayer(layer.id);
                                }
                              }}
                              onMouseEnter={() => onHoverLayerIds([layer.id])}
                            >
                              <button
                                aria-label={`${isSelected ? "Hide" : "Show"} ${layer.label}`}
                                aria-pressed={isSelected}
                                className={cx(
                                  "grid size-6 shrink-0 place-items-center rounded-md border transition-colors",
                                  isSelected
                                    ? "border-accent bg-accent text-white"
                                    : "border-line-strong bg-white text-transparent",
                                )}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onToggleLayer(layer.id);
                                }}
                              >
                                <Check
                                  aria-hidden="true"
                                  size={14}
                                  weight="bold"
                                />
                              </button>
                              <DotsSixVertical
                                aria-hidden="true"
                                className="shrink-0 text-muted"
                                size={15}
                              />
                              <span className="min-w-0 flex-1">
                                <strong className="block truncate text-[10px] font-[650] text-ink">
                                  {layer.label}
                                </strong>
                                <small className="block truncate text-[8.5px] text-muted">
                                  {layer.sourceRole} ·{" "}
                                  {Math.round(layer.sourceOpacity * 100)}%
                                </small>
                              </span>
                              {multicolorPreview ? (
                                <span
                                  aria-hidden="true"
                                  className="size-2.5 shrink-0 rounded-full border border-black/10"
                                  style={{ backgroundColor: groupColor }}
                                />
                              ) : layer.sourceColor ? (
                                <span
                                  aria-hidden="true"
                                  className="size-2.5 shrink-0 rounded-full border border-black/10"
                                  style={{ backgroundColor: layer.sourceColor }}
                                />
                              ) : null}
                            </div>
                          );
                        })}
                        {strokes.length === 0 ? (
                          <p className="m-0 rounded-lg border border-dashed border-line bg-surface-muted/70 px-2 py-2 text-[8.5px] text-muted">
                            Drop a stroke here
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {multicolorPreview && suggestedToken ? (
                      <small className="text-[7.5px] text-muted">
                        Preview color starts from{" "}
                        {COLOR_TOKEN_LABELS[suggestedToken]}.
                      </small>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2 border-t border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[8.5px] font-semibold tracking-[0.06em] text-muted uppercase">
                Add layer
              </span>
              <span className="text-[8px] text-muted">Primary is required</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {LAYER_ORDER.filter((hierarchy) => !activeLayers[hierarchy]).map(
                (hierarchy) => (
                  <button
                    aria-label={`Add ${HIERARCHY_LABELS[hierarchy]} layer`}
                    className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border border-line bg-white px-2 text-[9px] font-semibold text-muted transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
                    key={hierarchy}
                    type="button"
                    onClick={() => onAddLayer(hierarchy)}
                  >
                    <Plus aria-hidden="true" size={13} />
                    {HIERARCHY_LABELS[hierarchy]}
                  </button>
                ),
              )}
            </div>
            <p className="m-0 text-[8.5px] leading-[1.4] text-muted">
              Drag a stroke onto a layer card to change its rendering hierarchy.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function customizeLayerPreviewSvg(
  svg: string,
  selectedLayerIds: Set<string>,
  highlightedLayerIds: Set<string>,
  layerColorOverrides: Record<string, string>,
): string {
  return svg.replace(
    /<path\b([^>]*?)data-layer-id="([^"]+)"([^>]*)\/>/g,
    (_path, before: string, layerId: string, after: string) => {
      if (!selectedLayerIds.has(layerId)) return "";
      let attributes = `${before}data-layer-id="${layerId}"${after}`;
      const override = layerColorOverrides[layerId];
      if (override) {
        attributes = /\sfill="[^"]*"/.test(attributes)
          ? attributes.replace(/\sfill="[^"]*"/, ` fill="${override}"`)
          : ` fill="${override}"${attributes}`;
      }
      if (highlightedLayerIds.has(layerId)) {
        attributes +=
          ' stroke="#1688f5" stroke-width="0.9" stroke-linejoin="round" paint-order="stroke fill"';
      }
      return `<path${attributes}/>`;
    },
  );
}

type InspectorPage = "root" | "variants" | "layer-editor";

function PreviewInspector({
  settings,
  page,
  onOpenLayerEditor,
  onCloseLayerEditor,
  onPageChange,
}: {
  settings: ControlPanelModel;
  page: InspectorPage;
  onOpenLayerEditor: () => void;
  onCloseLayerEditor: () => void;
  onPageChange: (page: InspectorPage) => void;
}) {
  return (
    <aside className="h-full min-h-0 min-w-0 border-l border-line bg-surface-muted max-[900px]:h-auto max-[900px]:min-h-0 max-[900px]:border-t max-[900px]:border-l-0 max-[600px]:min-h-[calc(100dvh-60px)]">
      <div className="flex h-full min-h-0 flex-col max-[900px]:h-auto max-[900px]:min-h-0 max-[600px]:min-h-[calc(100dvh-60px)]">
        {page !== "root" ? (
          <InspectorHeader
            page={page}
            variantCount={settings.artifact.variants.length}
            onBack={() => {
              onPageChange("root");
              onCloseLayerEditor();
            }}
          />
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 max-[900px]:max-h-[560px] max-[600px]:px-4 max-[600px]:py-4">
          {page === "root" ? (
            <InspectorRootPage
              settings={settings}
              onOpenLayerEditor={onOpenLayerEditor}
              onOpenPage={onPageChange}
            />
          ) : null}
          {page === "variants" ? (
            <VariantSettingsPanel settings={settings} showHeading={false} />
          ) : null}
          {page === "layer-editor" ? (
            <LayerEditorSettingsPanel settings={settings} showHeading={false} />
          ) : null}
        </div>
        <InspectorExportFooter settings={settings} />
      </div>
    </aside>
  );
}

function InspectorExportFooter({ settings }: { settings: ControlPanelModel }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menuOpen]);

  function exportSymbol() {
    setMenuOpen(false);
    settings.onDownloadSymbol();
  }

  function exportAssets() {
    setMenuOpen(false);
    settings.onDownloadSymbolset();
  }

  return (
    <footer className="grid shrink-0 gap-2 border-t border-line bg-white p-4">
      <label className="grid gap-1.5 text-[10px] font-semibold text-muted">
        Asset name
        <input
          className="min-h-9 w-full rounded-lg border border-line bg-white px-3 text-[11px] font-medium text-ink"
          value={settings.name}
          onChange={(event) => settings.onNameChange(event.target.value)}
        />
      </label>
      <div ref={menuRef} className="relative">
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="Export"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 text-[14px] font-semibold text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:bg-[#e5e5e0] disabled:text-[#a0a19b]"
          disabled={!settings.canDownload}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Export aria-hidden="true" size={18} />
          Export
        </button>
        {menuOpen ? (
          <div
            aria-label="Export format"
            className="absolute right-0 bottom-[calc(100%+8px)] z-20 grid w-full min-w-[210px] gap-1 rounded-xl border border-line bg-white p-1.5 shadow-[0_16px_36px_rgba(24,26,29,0.16)]"
            role="menu"
          >
            <button
              aria-label="Export Symbol SVG"
              className="flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[10.5px] font-semibold text-ink transition-colors hover:bg-accent-soft hover:text-accent"
              role="menuitem"
              type="button"
              onClick={exportSymbol}
            >
              <FileSvg aria-hidden="true" className="text-accent" size={16} />
              <span className="grid gap-0.5 p-1">
                <strong>SVG</strong>
                <small className="text-xs font-normal text-muted">
                  SF Symbol compatibe SVG
                </small>
              </span>
            </button>
            <button
              aria-label="Export .symbolset"
              className="flex min-h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[10.5px] font-semibold text-ink transition-colors hover:bg-accent-soft hover:text-accent"
              role="menuitem"
              type="button"
              onClick={exportAssets}
            >
              <FileZip aria-hidden="true" className="text-accent" size={16} />
              <span className="grid gap-0.5 p-1">
                <strong>Xcode Assets</strong>
                <small className="text-xs font-normal text-muted">
                  Asset catalog to use in Xcode directly
                </small>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </footer>
  );
}

function InspectorHeader({
  page,
  variantCount,
  onBack,
}: {
  page: InspectorPage;
  variantCount: number;
  onBack: () => void;
}) {
  const title =
    page === "root"
      ? "Design"
      : page === "variants"
        ? "Variants"
        : "Layer editor";

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
      {page !== "root" ? (
        <button
          aria-label="Back to preview controls"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-white text-muted transition-colors hover:border-accent hover:text-accent"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-[15px] font-[680] tracking-[-0.025em] text-ink">
          {title}
        </h2>
        <p className="m-0 text-[10px] leading-[1.4] text-muted">
          {page === "root"
            ? "Shape the preview, variants, and rendering layers before export."
            : page === "variants"
              ? "Choose the masters generated for this symbol."
              : "Compose the layers and choose the preview rendering mode."}
        </p>
      </div>
      {page === "variants" ? (
        <span className="shrink-0 font-mono text-[9px] font-semibold text-accent">
          {variantCount} variants
        </span>
      ) : null}
    </header>
  );
}

function InspectorRootPage({
  settings,
  onOpenLayerEditor,
  onOpenPage,
}: {
  settings: ControlPanelModel;
  onOpenLayerEditor: () => void;
  onOpenPage: (page: InspectorPage) => void;
}) {
  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <InspectorSectionHeading
          description="Set the preview color and rendering style."
          title="Preview"
        />
        <PreviewControlsPanel settings={settings} />
      </section>
      <section className="grid gap-3">
        <InspectorSectionHeading
          description="Shape the preview, variants, and rendering layers."
          title="Design"
        />
        <div className="grid gap-3">
          <OpticalPaddingControl settings={settings} />
          <div className="grid gap-1">
            <InspectorNavigationRow
              description={`${settings.artifact.variants.length} authored or generated masters`}
              icon={<Stack aria-hidden="true" size={20} weight="duotone" />}
              label="Variants"
              onClick={() => onOpenPage("variants")}
            />
            <InspectorNavigationRow
              description={`${settings.artifact.renderingModes.length} rendering modes available`}
              icon={<Stack aria-hidden="true" size={20} weight="duotone" />}
              label="Layer editor"
              showChevron={false}
              onClick={() => {
                onOpenPage("layer-editor");
                onOpenLayerEditor();
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function InspectorSectionHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <header className="grid gap-1 py-1 text-left">
      <h2 className="m-0 text-xl font-[700] tracking-[-0.035em] text-ink">
        {title}
      </h2>
      <p className="m-0 text-xs leading-[1.45] text-muted">{description}</p>
    </header>
  );
}

function InspectorNavigationRow({
  description,
  icon,
  label,
  onClick,
  showChevron = true,
}: {
  description: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  showChevron?: boolean;
}) {
  return (
    <button
      className="group flex min-h-[54px] items-center gap-3 rounded-xl border border-line bg-white px-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-accent hover:bg-accent-soft"
      type="button"
      onClick={onClick}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-[11px] font-[650] text-ink">
          {label}
        </strong>
        <small className="block truncate text-[9px] text-muted">
          {description}
        </small>
      </span>
      {showChevron ? (
        <CaretRight
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
          size={16}
        />
      ) : null}
    </button>
  );
}

function ToolbarPanelHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <header className="mb-4 grid gap-1 border-b border-line pb-3">
      <h2 className="m-0 text-[16px] font-[650] tracking-[-0.025em]">
        {title}
      </h2>
      <p className="m-0 text-[11px] leading-[1.45] text-muted">{description}</p>
    </header>
  );
}

function PreviewControlsPanel({ settings }: { settings: ControlPanelModel }) {
  const nativeColor = /^#[0-9a-f]{6}$/i.test(settings.previewColor)
    ? settings.previewColor
    : "#151616";

  return (
    <section className="grid gap-3 rounded-xl border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <h2 className="m-0 text-[15px] font-[650] tracking-[-0.025em] text-ink">
            Color
          </h2>
          <p className="m-0 text-[11px] leading-[1.45] text-muted">
            Applies to the preview only.
          </p>
        </div>
        <label className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-line-strong bg-white shadow-[0_4px_12px_rgba(24,26,29,0.08)]">
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{ backgroundColor: nativeColor }}
          />
          <Eyedropper
            aria-hidden="true"
            className="relative z-[1] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
            size={16}
            weight="duotone"
          />
          <input
            aria-label="Open preview color picker"
            className="absolute inset-0 z-[2] size-full cursor-pointer opacity-0"
            type="color"
            value={nativeColor}
            onChange={(event) =>
              settings.onPreviewColorChange(event.target.value)
            }
          />
        </label>
      </div>
      <div className="grid gap-2 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
            Rendering mode
          </span>
        </div>
        <RenderingControls
          compact
          analysis={settings.result.analysis.rendering}
          artifact={settings.artifact}
          selectedRenderingMode={settings.renderingMode}
          previewColor={settings.previewColor}
          onRenderingModeChange={settings.onRenderingModeChange}
        />
      </div>
    </section>
  );
}

function OpticalPaddingControl({ settings }: { settings: ControlPanelModel }) {
  return (
    <label className="grid gap-1 pt-3 text-[10px] font-semibold text-muted">
      <span className="flex items-center justify-between gap-2">
        Optical padding
        <output className="font-mono font-medium text-ink">
          {Math.round(settings.padding * 100)}%
        </output>
      </span>
      <input
        className="w-full accent-accent"
        max="0.24"
        min="0"
        step="0.01"
        type="range"
        value={settings.padding}
        onChange={(event) =>
          settings.onPaddingChange(Number(event.target.value))
        }
      />
    </label>
  );
}

function VariantSettingsPanel({
  settings,
  showHeading = true,
}: {
  settings: ControlPanelModel;
  showHeading?: boolean;
}) {
  const profile = settings.profile;

  return (
    <div>
      {showHeading ? (
        <ToolbarPanelHeading
          description="Choose whether EasySymbols should synthesize compatible weight or optical-size masters."
          title="Symbol variants"
        />
      ) : null}
      <div className="grid gap-3">
        {profile?.canGenerateVariants ? (
          <VariantControls
            kind="centerline"
            largeOpticalScale={settings.largeOpticalScale}
            referenceScale={settings.referenceScale}
            referenceWeight={settings.referenceWeight}
            smallOpticalScale={settings.smallOpticalScale}
            strokeScale={settings.strokeScale}
            variantMode={settings.variantMode}
            onLargeOpticalScaleChange={settings.onLargeOpticalScaleChange}
            onReferenceScaleChange={settings.onReferenceScaleChange}
            onReferenceWeightChange={settings.onReferenceWeightChange}
            onSmallOpticalScaleChange={settings.onSmallOpticalScaleChange}
            onStrokeScaleChange={settings.onStrokeScaleChange}
            onVariantModeChange={settings.onVariantModeChange}
          />
        ) : null}
        {profile?.canGenerateApproximateScaleVariants ? (
          <VariantControls
            kind="approximate"
            largeOpticalScale={settings.largeOpticalScale}
            referenceScale={settings.referenceScale}
            referenceWeight={settings.referenceWeight}
            smallOpticalScale={settings.smallOpticalScale}
            strokeScale={settings.strokeScale}
            variantMode={settings.variantMode}
            onLargeOpticalScaleChange={settings.onLargeOpticalScaleChange}
            onReferenceScaleChange={settings.onReferenceScaleChange}
            onReferenceWeightChange={settings.onReferenceWeightChange}
            onSmallOpticalScaleChange={settings.onSmallOpticalScaleChange}
            onStrokeScaleChange={settings.onStrokeScaleChange}
            onVariantModeChange={settings.onVariantModeChange}
          />
        ) : null}
        {!profile?.canGenerateVariants &&
        !profile?.canGenerateApproximateScaleVariants ? (
          <p className="m-0 rounded-xl border border-line bg-white/70 p-4 text-[11px] leading-[1.5] text-muted">
            This SVG keeps its authored masters because its geometry does not
            expose a safe variant-generation model.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LayerEditorSettingsPanel({
  settings,
  showHeading = true,
}: {
  settings: ControlPanelModel;
  showHeading?: boolean;
}) {
  return (
    <div>
      {showHeading ? (
        <ToolbarPanelHeading
          description="Choose a preview mode, then organize the layers used by that mode."
          title="Layer editor"
        />
      ) : null}
      <RenderingControls
        analysis={settings.result.analysis.rendering}
        artifact={settings.artifact}
        selectedRenderingMode={settings.renderingMode}
        previewColor={settings.previewColor}
        onRenderingModeChange={settings.onRenderingModeChange}
      />
    </div>
  );
}

function OriginIcon({
  className,
  origin,
}: {
  className?: string;
  origin: PreviewOrigin;
}) {
  return (
    <Circle
      aria-hidden="true"
      className={cx(className, ORIGIN_ICON_CLASSES[origin])}
      size={8}
      weight={origin === "generated" ? "regular" : "fill"}
    />
  );
}

function NoticeList({
  className,
  collapsible = false,
  diagnostics,
}: {
  className?: string;
  collapsible?: boolean;
  diagnostics: Diagnostic[];
}) {
  const [expanded, setExpanded] = useState(false);
  const diagnosticKey = diagnostics
    .map((diagnostic) => `${diagnostic.code}:${diagnostic.message}`)
    .join("|");
  const canCollapse = collapsible && diagnostics.length > 1;
  const hasError = diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );

  useEffect(() => {
    setExpanded(false);
  }, [diagnosticKey]);

  if (!canCollapse) {
    return (
      <div
        className={cx("grid gap-[7px]", className)}
        role="status"
        aria-live="polite"
      >
        {diagnostics.map((diagnostic, index) => (
          <DiagnosticNotice
            diagnostic={diagnostic}
            key={`${diagnostic.code}-${index}`}
          />
        ))}
      </div>
    );
  }

  const summaryClass = hasError
    ? "border-[rgb(180_59_49/22%)] bg-error-soft text-[#8f3229]"
    : "border-[rgb(170_120_28/22%)] bg-warning-soft text-[#79520f]";

  return (
    <div
      className={cx("grid gap-[7px]", className)}
      role="status"
      aria-live="polite"
    >
      <button
        aria-expanded={expanded}
        className={cx(
          "flex w-full items-center gap-[9px] rounded-[10px] border px-[11px] py-[9px] text-left transition-colors",
          summaryClass,
        )}
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        {hasError ? (
          <XCircle
            aria-hidden="true"
            className="mt-px shrink-0"
            size={17}
            weight="fill"
          />
        ) : (
          <WarningCircle
            aria-hidden="true"
            className="mt-px shrink-0"
            size={17}
            weight="fill"
          />
        )}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <strong className="text-[10.5px] font-[650]">
            {diagnostics.length}{" "}
            {hasError ? "Compatibility issues" : "Compatibility notes"}
          </strong>
          <small className="truncate text-[10.5px] leading-[1.4] text-inherit">
            {expanded
              ? "Click to collapse the compatibility details."
              : diagnostics[0]?.message}
          </small>
        </span>
        {expanded ? (
          <CaretUp aria-hidden="true" className="shrink-0" size={17} />
        ) : (
          <CaretDown aria-hidden="true" className="shrink-0" size={17} />
        )}
      </button>
      {expanded ? (
        <div className="grid max-h-[min(30dvh,220px)] gap-[7px] overflow-y-auto">
          {diagnostics.map((diagnostic, index) => (
            <DiagnosticNotice
              diagnostic={diagnostic}
              key={`${diagnostic.code}-${index}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiagnosticNotice({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <div
      className={cx(
        "flex items-start gap-[9px] rounded-[10px] border px-[11px] py-[9px]",
        diagnostic.severity === "error"
          ? "border-[rgb(180_59_49/22%)] bg-error-soft text-[#8f3229]"
          : "border-[rgb(170_120_28/22%)] bg-warning-soft text-[#79520f]",
      )}
    >
      {diagnostic.severity === "error" ? (
        <XCircle
          aria-hidden="true"
          className="mt-px shrink-0"
          size={17}
          weight="fill"
        />
      ) : (
        <WarningCircle
          aria-hidden="true"
          className="mt-px shrink-0"
          size={17}
          weight="fill"
        />
      )}
      <span className="grid gap-0.5">
        <strong className="text-[10.5px] font-[650]">
          {diagnostic.severity === "error"
            ? "Compatibility issue"
            : "Compatibility note"}
        </strong>
        <small className="text-[10.5px] leading-[1.4] text-inherit">
          {diagnostic.message}
        </small>
      </span>
    </div>
  );
}

const RENDERING_MODE_LABELS: Record<RenderingMode, string> = {
  monochrome: "Monochrome",
  hierarchical: "Hierarchical",
  palette: "Palette",
  multicolor: "Multicolor",
};

const RENDERING_STATUS_LABELS: Record<
  RenderingAnalysis["modes"][RenderingMode]["status"],
  string
> = {
  ready: "Included",
  detected: "Detected",
  configurable: "Manual",
  unavailable: "Unavailable",
};

const HIERARCHY_LABELS: Record<RenderingHierarchy, string> = {
  primary: "Primary",
  secondary: "Secondary",
  tertiary: "Tertiary",
};

const COLOR_TOKEN_LABELS: Record<RenderingColorToken, string> = {
  tintColor: "Tint color",
  systemRedColor: "System red",
  systemOrangeColor: "System orange",
  systemYellowColor: "System yellow",
  systemGreenColor: "System green",
  systemBlueColor: "System blue",
  white: "White",
  customColor: "Custom color",
};

function renderingPreviewDataUrl(svg: string, color: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    svg.replaceAll("currentColor", color),
  )}`;
}

interface RenderingControlsProps {
  analysis: RenderingAnalysis;
  artifact: SymbolArtifact;
  compact?: boolean;
  previewColor: string;
  selectedRenderingMode: RenderingMode;
  onRenderingModeChange: (value: RenderingMode) => void;
}

function RenderingModeCard({
  analysis,
  compact = false,
  enabled,
  mode,
  previewColor,
  selected,
  svg,
  onSelect,
}: {
  analysis: RenderingAnalysis;
  compact?: boolean;
  enabled: boolean;
  mode: RenderingMode;
  previewColor: string;
  selected: boolean;
  svg?: string;
  onSelect: () => void;
}) {
  const capability = analysis.modes[mode];
  const unavailable = capability.status === "unavailable";
  const className = cx(
    "grid min-w-0 grid-rows-[1fr_auto] rounded-lg border text-left transition-[border-color,background-color,box-shadow]",
    compact ? "min-h-[56px] gap-0 p-1" : "min-h-[82px] gap-1 p-2",
    selected
      ? "border-accent bg-accent/8 text-ink"
      : enabled && !unavailable
        ? "border-line bg-white text-ink"
        : "border-line bg-white/70 text-muted",
    selected && "shadow-[0_0_0_2px_rgba(22,136,245,0.22)]",
    unavailable && "cursor-not-allowed opacity-45",
  );
  const content = (
    <>
      <span
        className={cx(
          "grid place-items-center rounded-md bg-surface-muted/70",
          compact ? "min-h-6" : "min-h-10",
        )}
      >
        {svg ? (
          <img
            alt=""
            className={cx(
              "w-auto max-w-full object-contain",
              compact ? "h-6" : "h-8",
            )}
            src={renderingPreviewDataUrl(svg, previewColor)}
          />
        ) : (
          <Minus aria-hidden="true" size={14} />
        )}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-[9.5px] font-[650]">
          {RENDERING_MODE_LABELS[mode]}
        </strong>
        <small
          className={cx(
            "text-[7.5px] font-semibold tracking-[0.05em] uppercase",
            capability.status === "detected" ? "text-accent" : "text-muted",
          )}
        >
          {RENDERING_STATUS_LABELS[capability.status]}
        </small>
      </span>
    </>
  );

  return (
    <button
      aria-label={`Show ${RENDERING_MODE_LABELS[mode]} rendering preview. ${capability.reason}`}
      aria-pressed={selected}
      className={className}
      disabled={unavailable}
      title={capability.reason}
      type="button"
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

function RenderingControls({
  analysis,
  artifact,
  compact = false,
  previewColor,
  selectedRenderingMode,
  onRenderingModeChange,
}: RenderingControlsProps) {
  const enabledModes = new Set(artifact.renderingModes);

  return (
    <section className={cx("grid", compact ? "gap-2" : "gap-3")}>
      <div className={cx("grid grid-cols-2", compact ? "gap-2" : "gap-2")}>
        <RenderingModeCard
          analysis={analysis}
          compact={compact}
          enabled={enabledModes.has("monochrome")}
          mode="monochrome"
          previewColor={previewColor}
          selected={selectedRenderingMode === "monochrome"}
          svg={artifact.renderingPreviews.monochrome?.svg}
          onSelect={() => onRenderingModeChange("monochrome")}
        />
        <RenderingModeCard
          analysis={analysis}
          compact={compact}
          enabled={enabledModes.has("hierarchical")}
          mode="hierarchical"
          previewColor={previewColor}
          selected={selectedRenderingMode === "hierarchical"}
          svg={artifact.renderingPreviews.hierarchical?.svg}
          onSelect={() => onRenderingModeChange("hierarchical")}
        />
        <RenderingModeCard
          analysis={analysis}
          compact={compact}
          enabled={enabledModes.has("palette")}
          mode="palette"
          previewColor={previewColor}
          selected={selectedRenderingMode === "palette"}
          svg={artifact.renderingPreviews.palette?.svg}
          onSelect={() => onRenderingModeChange("palette")}
        />
        <RenderingModeCard
          analysis={analysis}
          compact={compact}
          enabled={enabledModes.has("multicolor")}
          mode="multicolor"
          previewColor={previewColor}
          selected={selectedRenderingMode === "multicolor"}
          svg={artifact.renderingPreviews.multicolor?.svg}
          onSelect={() => onRenderingModeChange("multicolor")}
        />
      </div>
    </section>
  );
}

interface VariantControlsProps {
  kind: "centerline" | "approximate";
  largeOpticalScale: number;
  referenceScale: SymbolScale;
  referenceWeight: SymbolWeight;
  smallOpticalScale: number;
  strokeScale: number;
  variantMode: VariantMode;
  onLargeOpticalScaleChange: (value: number) => void;
  onReferenceScaleChange: (value: SymbolScale) => void;
  onReferenceWeightChange: (value: SymbolWeight) => void;
  onSmallOpticalScaleChange: (value: number) => void;
  onStrokeScaleChange: (value: number) => void;
  onVariantModeChange: (value: VariantMode) => void;
}

function VariantControls({
  kind,
  largeOpticalScale,
  referenceScale,
  referenceWeight,
  smallOpticalScale,
  strokeScale,
  variantMode,
  onLargeOpticalScaleChange,
  onReferenceScaleChange,
  onReferenceWeightChange,
  onSmallOpticalScaleChange,
  onStrokeScaleChange,
  onVariantModeChange,
}: VariantControlsProps) {
  const enabled =
    kind === "centerline"
      ? variantMode === "all"
      : variantMode === "approximate-scales";
  const enabledMode: VariantMode =
    kind === "centerline" ? "all" : "approximate-scales";

  return (
    <div className={cx("grid gap-3")}>
      <div className="grid gap-3">
        <label className="flex items-center justify-between gap-2.5">
          <span className="grid gap-0.5">
            <strong className="text-[10.5px] font-[650] text-ink pt-3">
              {kind === "centerline"
                ? "All 27 SF variants"
                : "Approximate S/M/L scales"}
            </strong>
            <small className="text-[8.5px] leading-[1.35] font-normal text-muted">
              {enabled ? "Enabled for this SVG" : "Keep only authored artwork"}
            </small>
          </span>
          <input
            className="relative m-0 h-[21px] w-9 shrink-0 appearance-none rounded-full border border-line-strong bg-[#d9dad5] transition-[border-color,background-color] duration-150 after:absolute after:top-0.5 after:left-0.5 after:size-[15px] after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgba(24,26,29,0.24)] after:transition-transform after:duration-150 after:content-[''] checked:border-accent checked:bg-accent checked:after:translate-x-[15px]"
            role="switch"
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              onVariantModeChange(
                event.target.checked ? enabledMode : "authored",
              )
            }
          />
        </label>

        {enabled ? (
          <div className="pt-[9px]">
            <span className="text-[9.5px] font-semibold text-accent">
              {kind === "centerline"
                ? "Centerline synthesis"
                : "Scale calibration"}
            </span>
            <div className="mt-[11px] grid gap-2.5">
              {kind === "centerline" ? (
                <label className="grid gap-1.5 text-[10px] font-semibold text-muted">
                  <span className="flex items-center justify-between gap-2">
                    Input weight
                  </span>
                  <select
                    className="min-h-8 w-full rounded-[7px] border border-line bg-white px-[9px] text-[11px] font-medium text-ink"
                    value={referenceWeight}
                    onChange={(event) =>
                      onReferenceWeightChange(
                        event.target.value as SymbolWeight,
                      )
                    }
                  >
                    {SYMBOL_WEIGHTS.map((weight) => (
                      <option key={weight} value={weight}>
                        {weight}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="grid gap-1.5 text-[10px] font-semibold text-muted">
                <span className="flex items-center justify-between gap-2">
                  Input optical size
                </span>
                <select
                  className="min-h-8 w-full rounded-[7px] border border-line bg-white px-[9px] text-[11px] font-medium text-ink"
                  value={referenceScale}
                  onChange={(event) =>
                    onReferenceScaleChange(event.target.value as SymbolScale)
                  }
                >
                  {SYMBOL_SCALES.map((scale) => (
                    <option key={scale} value={scale}>
                      {SCALE_LABELS[scale]}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "centerline" ? (
                <label className="grid gap-1.5 text-[10px] font-semibold text-muted">
                  <span className="flex items-center justify-between gap-2">
                    Stroke width{" "}
                    <output className="font-mono font-medium text-ink">
                      {Math.round(strokeScale * 100)}%
                    </output>
                  </span>
                  <input
                    className="w-full accent-accent"
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.05"
                    value={strokeScale}
                    onChange={(event) =>
                      onStrokeScaleChange(Number(event.target.value))
                    }
                  />
                </label>
              ) : null}
              <label className="grid gap-1.5 text-[10px] font-semibold text-muted">
                <span className="flex items-center justify-between gap-2">
                  Small scale{" "}
                  <output className="font-mono font-medium text-ink">
                    {smallOpticalScale.toFixed(3)}×
                  </output>
                </span>
                <input
                  className="w-full accent-accent"
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.005"
                  value={smallOpticalScale}
                  onChange={(event) =>
                    onSmallOpticalScaleChange(Number(event.target.value))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-[10px] font-semibold text-muted">
                <span className="flex items-center justify-between gap-2">
                  Large scale{" "}
                  <output className="font-mono font-medium text-ink">
                    {largeOpticalScale.toFixed(3)}×
                  </output>
                </span>
                <input
                  className="w-full accent-accent"
                  type="range"
                  min="1"
                  max="1.6"
                  step="0.005"
                  value={largeOpticalScale}
                  onChange={(event) =>
                    onLargeOpticalScaleChange(Number(event.target.value))
                  }
                />
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SourceDrawer({ filename, open, source, onClose }: SourceDrawerModel) {
  return (
    <Drawer.Root
      open={open}
      swipeDirection="right"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="source-drawer-backdrop-motion fixed inset-0 z-[90] min-h-dvh bg-[rgb(20_22_21/38%)] backdrop-blur-[3px] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0" />
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-[100] flex items-stretch justify-end">
          <Drawer.Popup className="source-drawer-motion pointer-events-auto flex h-full max-h-dvh w-[min(92vw,720px)] max-w-full flex-col rounded-l-[28px] border border-r-0 border-line bg-white text-ink shadow-[-24px_0_70px_rgba(0,0,0,0.2)] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] outline-none data-swiping:select-none">
            <Drawer.Content className="flex min-h-0 w-full flex-1 flex-col px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] max-[600px]:px-3 max-[600px]:pb-3">
              <header className="flex items-start justify-between gap-4 border-b border-line px-1 pb-4">
                <span className="grid min-w-0 gap-0.5">
                  <Drawer.Title
                    className="m-0 text-[16px] font-[650] tracking-[-0.025em] text-ink"
                    id="source-drawer-title"
                  >
                    SVG source
                  </Drawer.Title>
                  <Drawer.Description className="m-0 overflow-hidden text-[11px] leading-[1.45] text-muted text-ellipsis whitespace-nowrap">
                    Generated source for {filename || "the converted symbol"}.
                  </Drawer.Description>
                </span>
                <Drawer.Close
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-white p-0 text-muted transition-colors hover:border-accent hover:text-accent"
                  aria-label="Close"
                >
                  <X aria-hidden="true" size={18} />
                </Drawer.Close>
              </header>
              <pre className="mt-4 mb-0 min-h-0 flex-1 overflow-auto overscroll-contain rounded-[16px] border border-[#2c2d2b] bg-[#1b1c1b] px-5 py-4 font-mono text-[11.5px] leading-[1.65] break-words whitespace-pre-wrap text-[#d7d8d2] max-[600px]:rounded-[12px] max-[600px]:px-3.5">
                {source}
              </pre>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
