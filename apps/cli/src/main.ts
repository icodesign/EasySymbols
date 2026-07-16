#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS,
  analyzeSvg,
  convertSvg,
  createPathKitGeometryEngine,
  SYMBOL_SCALES,
  SYMBOL_WEIGHTS,
  validateSymbol,
  type ConvertOptions,
  type Diagnostic,
  type GeometryEngine,
} from "@easysymbols/core";

import {
  convertCollection,
  writeCollection,
  type CollectionFormat,
} from "./collection.js";
import { validateWithXcode } from "./xcode-validation.js";

const VERSION = "0.1.0";

const help = `EasySymbols ${VERSION}

Convert deterministic vector SVGs into Apple Custom SF Symbol templates.

Usage:
  easysymbols analyze <input.svg> [--json] [--background auto|keep]
                    [--geometry auto|static|centerline]
                    [--variants authored|all|approximate-scales] [--stroke-scale <0.25..4>]
                    [--reference-weight <weight>] [--reference-scale S|M|L]
                    [--small-scale <0.25..1>] [--large-scale <1..2>]
  easysymbols convert <input.svg> [-o <path>] [--format svg|symbolset]
                    [--name <asset-name>] [--padding <0..0.4>]
                    [--background auto|keep]
                    [--geometry auto|static|centerline]
                    [--variants authored|all|approximate-scales] [--stroke-scale <0.25..4>]
                    [--reference-weight <weight>] [--reference-scale S|M|L]
                    [--small-scale <0.25..1>] [--large-scale <1..2>]
                    [--xcode-validate]
  easysymbols collection <manifest.json> [-o <path>]
                    [--format xcassets|swift-package] [--force]
                    [same conversion options as 'convert']
  easysymbols validate <symbol.svg>

Use '-' as the input or output path for stdin/stdout. Conversion runs locally.
`;

async function readSource(path: string): Promise<string> {
  if (path !== "-") return readFile(resolve(path), "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.elementId ? ` (${diagnostic.elementId})` : "";
    process.stderr.write(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}: ${diagnostic.message}\n`,
    );
  }
}

let geometryPromise: Promise<GeometryEngine> | undefined;
async function geometry(): Promise<GeometryEngine> {
  geometryPromise ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("pathkit-wasm/bin/pathkit.wasm");
    return createPathKitGeometryEngine(await readFile(wasmPath));
  })();
  return geometryPromise;
}

function inputName(input: string): string {
  if (input === "-") return "custom-symbol";
  return basename(input, extname(input));
}

async function analyze(
  input: string,
  json: boolean,
  options: ConvertOptions,
): Promise<number> {
  const source = await readSource(input);
  const result = analyzeSvg(source, await geometry(), options);
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${result.isConvertible ? "convertible" : "not convertible"}: ${result.pathCount} path(s), ${result.masterCount} master(s) [${result.variants.join(", ") || "none"}], ${result.width}×${result.height} viewBox\n`,
    );
    printDiagnostics(result.diagnostics);
  }
  return result.isConvertible ? 0 : 1;
}

async function convert(
  input: string,
  values: {
    format?: string;
    background?: string;
    name?: string;
    output?: string;
    padding?: string;
    "xcode-validate"?: boolean;
  },
  conversionOptions: ConvertOptions,
): Promise<number> {
  const source = await readSource(input);
  const padding = values.padding === undefined ? undefined : Number(values.padding);
  if (padding !== undefined && (!Number.isFinite(padding) || padding < 0 || padding > 0.4)) {
    process.stderr.write("--padding must be a number between 0 and 0.4.\n");
    return 2;
  }
  const options = {
    ...conversionOptions,
    name: values.name ?? inputName(input),
    ...(padding === undefined ? {} : { padding }),
  } satisfies ConvertOptions;
  const result = convertSvg(source, options, await geometry());
  printDiagnostics(result.analysis.diagnostics);
  if (!result.artifact) return 1;

  if (values["xcode-validate"]) {
    const native = await validateWithXcode(
      result.artifact.name,
      result.artifact.assetSymbolSvg ?? result.artifact.symbolSvg,
      result.artifact.symbolsetContents,
    );
    if (native.output) process.stderr.write(`${native.output}\n`);
    if (!native.available || !native.valid) return 1;
    process.stderr.write("Xcode asset compiler accepted the generated symbol.\n");
  }

  const format = values.format ?? "svg";
  if (format === "svg") {
    const output = values.output ??
      (input === "-" ? "-" : resolve(dirname(input), `${result.artifact.name}.symbols.svg`));
    if (output === "-") process.stdout.write(result.artifact.symbolSvg);
    else {
      await mkdir(dirname(resolve(output)), { recursive: true });
      await writeFile(resolve(output), result.artifact.symbolSvg, "utf8");
      process.stderr.write(`Wrote ${resolve(output)}\n`);
    }
    return 0;
  }
  if (format === "symbolset") {
    if (values.output === "-") {
      process.stderr.write("symbolset output must be a directory, not stdout.\n");
      return 2;
    }
    const output = resolve(values.output ?? `${result.artifact.name}.symbolset`);
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, `${result.artifact.name}.svg`),
      result.artifact.assetSymbolSvg ?? result.artifact.symbolSvg,
      "utf8",
    );
    await writeFile(resolve(output, "Contents.json"), result.artifact.symbolsetContents, "utf8");
    process.stderr.write(`Wrote ${output}\n`);
    return 0;
  }
  process.stderr.write("--format must be 'svg' or 'symbolset'.\n");
  return 2;
}

async function collection(
  input: string,
  values: {
    format?: string;
    output?: string;
    force?: boolean;
    name?: string;
    padding?: string;
    "xcode-validate"?: boolean;
  },
  conversionOptions: ConvertOptions,
): Promise<number> {
  if (values.name !== undefined) {
    process.stderr.write("--name is only supported by the single-symbol convert command. The manifest supplies the collection name.\n");
    return 2;
  }
  if (values["xcode-validate"]) {
    process.stderr.write("--xcode-validate is only supported by the single-symbol convert command.\n");
    return 2;
  }
  const format = values.format ?? "xcassets";
  if (format !== "xcassets" && format !== "swift-package") {
    process.stderr.write("Collection --format must be 'xcassets' or 'swift-package'.\n");
    return 2;
  }
  const padding = values.padding === undefined ? undefined : Number(values.padding);
  if (padding !== undefined && (!Number.isFinite(padding) || padding < 0 || padding > 0.4)) {
    process.stderr.write("--padding must be a number between 0 and 0.4.\n");
    return 2;
  }
  const options = {
    ...conversionOptions,
    ...(padding === undefined ? {} : { padding }),
  } satisfies ConvertOptions;

  const converted = await convertCollection(
    input,
    options,
    await geometry(),
    (message) => process.stderr.write(`${message}\n`),
  );
  const output = await writeCollection(
    converted,
    values.output,
    format as CollectionFormat,
    values.force ?? false,
  );
  process.stderr.write(`Wrote ${output} (${converted.symbols.length} symbol(s))\n`);
  return 0;
}

async function validate(input: string): Promise<number> {
  const report = validateSymbol(await readSource(input));
  printDiagnostics(report.diagnostics);
  if (report.isValid) process.stdout.write("Structurally valid custom symbol template.\n");
  return report.isValid ? 0 : 1;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      background: { type: "string" },
      format: { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      json: { type: "boolean" },
      name: { type: "string" },
      output: { type: "string", short: "o" },
      padding: { type: "string" },
      geometry: { type: "string" },
      "reference-scale": { type: "string" },
      "reference-weight": { type: "string" },
      "small-scale": { type: "string" },
      "large-scale": { type: "string" },
      "stroke-scale": { type: "string" },
      variants: { type: "string" },
      version: { type: "boolean", short: "v" },
      "xcode-validate": { type: "boolean" },
    },
  });
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(help);
    return 0;
  }
  const command = positionals[0];
  const input = positionals[1];
  if (!input || positionals.length > 2) {
    process.stderr.write(help);
    return 2;
  }
  const background = values.background ?? "auto";
  if (background !== "auto" && background !== "keep") {
    process.stderr.write("--background must be 'auto' or 'keep'.\n");
    return 2;
  }
  const geometryMode = values.geometry ?? "auto";
  if (
    geometryMode !== "auto" &&
    geometryMode !== "static" &&
    geometryMode !== "centerline"
  ) {
    process.stderr.write("--geometry must be 'auto', 'static', or 'centerline'.\n");
    return 2;
  }
  const variants = values.variants ?? "authored";
  if (
    variants !== "authored" &&
    variants !== "all" &&
    variants !== "approximate-scales"
  ) {
    process.stderr.write("--variants must be 'authored', 'all', or 'approximate-scales'.\n");
    return 2;
  }
  const strokeScale = values["stroke-scale"] === undefined
    ? undefined
    : Number(values["stroke-scale"]);
  if (
    strokeScale !== undefined &&
    (!Number.isFinite(strokeScale) || strokeScale < 0.25 || strokeScale > 4)
  ) {
    process.stderr.write("--stroke-scale must be a number between 0.25 and 4.\n");
    return 2;
  }
  const referenceWeight = values["reference-weight"];
  if (
    referenceWeight !== undefined &&
    !SYMBOL_WEIGHTS.includes(referenceWeight as (typeof SYMBOL_WEIGHTS)[number])
  ) {
    process.stderr.write(`--reference-weight must be one of: ${SYMBOL_WEIGHTS.join(", ")}.\n`);
    return 2;
  }
  const referenceScale = values["reference-scale"];
  if (
    referenceScale !== undefined &&
    !SYMBOL_SCALES.includes(referenceScale as (typeof SYMBOL_SCALES)[number])
  ) {
    process.stderr.write("--reference-scale must be 'S', 'M', or 'L'.\n");
    return 2;
  }
  const smallScale = values["small-scale"] === undefined
    ? undefined
    : Number(values["small-scale"]);
  if (
    smallScale !== undefined &&
    (!Number.isFinite(smallScale) || smallScale < 0.25 || smallScale > 1)
  ) {
    process.stderr.write("--small-scale must be a number between 0.25 and 1.\n");
    return 2;
  }
  const largeScale = values["large-scale"] === undefined
    ? undefined
    : Number(values["large-scale"]);
  if (
    largeScale !== undefined &&
    (!Number.isFinite(largeScale) || largeScale < 1 || largeScale > 2)
  ) {
    process.stderr.write("--large-scale must be a number between 1 and 2.\n");
    return 2;
  }
  if (variants !== "all" && (strokeScale !== undefined || referenceWeight !== undefined)) {
    process.stderr.write("--stroke-scale and --reference-weight require --variants all.\n");
    return 2;
  }
  if (variants === "authored" && referenceScale !== undefined) {
    process.stderr.write("--reference-scale requires --variants all or --variants approximate-scales.\n");
    return 2;
  }
  if (variants === "authored" && (smallScale !== undefined || largeScale !== undefined)) {
    process.stderr.write("--small-scale and --large-scale require generated scale variants.\n");
    return 2;
  }
  const scaleFactors =
    smallScale === undefined && largeScale === undefined
      ? undefined
      : {
          ...DEFAULT_SYMBOL_OPTICAL_SCALE_FACTORS,
          ...(smallScale === undefined ? {} : { S: smallScale }),
          ...(largeScale === undefined ? {} : { L: largeScale }),
        };
  const scaleCalibration = {
    ...(referenceScale === undefined
      ? {}
      : { referenceScale: referenceScale as (typeof SYMBOL_SCALES)[number] }),
    ...(scaleFactors === undefined ? {} : { scaleFactors }),
  };
  const conversionOptions: ConvertOptions = {
    background,
    geometry: geometryMode,
    variants,
    ...(variants === "all" &&
    (strokeScale !== undefined || referenceWeight !== undefined || Object.keys(scaleCalibration).length > 0)
      ? {
          synthesis: {
            ...scaleCalibration,
            ...(strokeScale === undefined ? {} : { strokeScale }),
            ...(referenceWeight === undefined
              ? {}
              : { referenceWeight: referenceWeight as (typeof SYMBOL_WEIGHTS)[number] }),
          },
        }
      : variants === "approximate-scales"
        ? { approximateScales: scaleCalibration }
        : {}),
  };
  if (command === "analyze") {
    return analyze(input, values.json ?? false, conversionOptions);
  }
  if (command === "convert") return convert(input, values, conversionOptions);
  if (command === "collection") return collection(input, values, conversionOptions);
  if (command === "validate") return validate(input);
  process.stderr.write(`Unknown command: ${command ?? ""}\n\n${help}`);
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
