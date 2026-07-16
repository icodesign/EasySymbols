import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  colorAssetContents,
  convertSvg,
  normalizeSymbolName,
  type ConvertOptions,
  type Diagnostic,
  type GeometryEngine,
  type SymbolArtifact,
} from "@easysymbols/core";
import {
  buildToolPluginSwift,
  resourceGeneratorSwift,
} from "./swift-package-plugin.js";

export type CollectionFormat = "xcassets" | "swift-package";

export interface CollectionManifestSymbol {
  name?: string;
  source: string;
}

export interface CollectionManifest {
  name: string;
  symbols: CollectionManifestSymbol[];
  version?: 1;
}

export interface ConvertedCollectionSymbol {
  artifact: SymbolArtifact;
  source: string;
}

export interface ConvertedCollection {
  manifest: CollectionManifest;
  symbols: ConvertedCollectionSymbol[];
}

interface ParsedManifest {
  directory: string;
  manifest: CollectionManifest;
}

const TOP_LEVEL_KEYS = new Set(["name", "symbols", "version"]);
const SYMBOL_KEYS = new Set(["name", "source"]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Collection manifest field '${field}' must be a non-empty string.`);
  }
  return value.trim();
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown ${context} field '${key}'.`);
    }
  }
}

function manifestSymbolName(symbol: CollectionManifestSymbol): string {
  return normalizeSymbolName(symbol.name ?? basename(symbol.source));
}

function parseManifest(value: unknown): CollectionManifest {
  if (!isRecord(value)) {
    throw new Error("Collection manifest must contain a JSON object.");
  }
  rejectUnknownKeys(value, TOP_LEVEL_KEYS, "manifest");

  if (value.version !== undefined && value.version !== 1) {
    throw new Error("Collection manifest 'version' must be 1 when provided.");
  }
  const name = stringValue(value.name, "name");
  if (!Array.isArray(value.symbols) || value.symbols.length === 0) {
    throw new Error("Collection manifest 'symbols' must be a non-empty array.");
  }

  const symbols = value.symbols.map((item, index): CollectionManifestSymbol => {
    if (!isRecord(item)) {
      throw new Error(`Collection manifest symbol ${index + 1} must be an object.`);
    }
    rejectUnknownKeys(item, SYMBOL_KEYS, `symbol ${index + 1}`);
    const source = stringValue(item.source, `symbols[${index}].source`);
    if (source === "-") {
      throw new Error(`Collection manifest symbol ${index + 1} cannot read source '-'.`);
    }
    const symbolName = item.name === undefined
      ? undefined
      : stringValue(item.name, `symbols[${index}].name`);
    return {
      source,
      ...(symbolName === undefined ? {} : { name: symbolName }),
    };
  });

  const seen = new Map<string, number>();
  for (const [index, symbol] of symbols.entries()) {
    const name = manifestSymbolName(symbol);
    const previous = seen.get(name);
    if (previous !== undefined) {
      throw new Error(
        `Collection manifest contains duplicate output name '${name}' at symbols[${previous}] and symbols[${index}].`,
      );
    }
    seen.set(name, index);
  }

  return {
    name,
    symbols,
    ...(value.version === undefined ? {} : { version: 1 }),
  };
}

export async function readCollectionManifest(path: string): Promise<ParsedManifest> {
  const absolutePath = resolve(path);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  } catch (cause) {
    throw new Error(
      `Unable to read collection manifest '${absolutePath}': ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return {
    directory: dirname(absolutePath),
    manifest: parseManifest(value),
  };
}

function diagnosticMessage(source: string, diagnostic: Diagnostic): string {
  const location = diagnostic.elementId ? ` (${diagnostic.elementId})` : "";
  return `${source}: ${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location}: ${diagnostic.message}`;
}

export async function convertCollection(
  manifestPath: string,
  options: ConvertOptions,
  geometry: GeometryEngine,
  onDiagnostic?: (message: string) => void,
): Promise<ConvertedCollection> {
  const { directory, manifest } = await readCollectionManifest(manifestPath);
  const symbols: ConvertedCollectionSymbol[] = [];
  const failures: string[] = [];

  for (const symbol of manifest.symbols) {
    const sourcePath = resolve(directory, symbol.source);
    let source: string;
    try {
      source = await readFile(sourcePath, "utf8");
    } catch (cause) {
      failures.push(
        `${symbol.source}: unable to read source: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      continue;
    }

    const result = convertSvg(
      source,
      {
        ...options,
        name: manifestSymbolName(symbol),
      },
      geometry,
    );
    for (const diagnostic of result.analysis.diagnostics) {
      onDiagnostic?.(diagnosticMessage(symbol.source, diagnostic));
    }
    if (!result.artifact) {
      failures.push(`${symbol.source}: conversion did not produce a valid symbol.`);
      continue;
    }
    symbols.push({ artifact: result.artifact, source: symbol.source });
  }

  if (failures.length > 0) {
    throw new Error(`Collection conversion failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  return { manifest, symbols };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeAssetCatalog(root: string, symbols: ConvertedCollectionSymbol[]): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "Contents.json"),
    json({ info: { author: "easysymbols", version: 1 } }),
    "utf8",
  );
  for (const { artifact } of symbols) {
    const symbolset = join(root, `${artifact.name}.symbolset`);
    await mkdir(symbolset, { recursive: true });
    await writeFile(
      join(symbolset, `${artifact.name}.svg`),
      artifact.assetSymbolSvg ?? artifact.symbolSvg,
      "utf8",
    );
    await writeFile(join(symbolset, "Contents.json"), artifact.symbolsetContents, "utf8");
    for (const [assetName, hex] of Object.entries(artifact.colorAssets ?? {})) {
      const colorSet = join(root, `${assetName}.colorset`);
      await mkdir(colorSet, { recursive: true });
      await writeFile(join(colorSet, "Contents.json"), colorAssetContents(hex), "utf8");
    }
  }
}

function swiftString(value: string): string {
  return JSON.stringify(value);
}

function swiftTypeName(value: string): string {
  const words = value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1));
  const candidate = words.join("") || "Symbols";
  return /^[A-Za-z_]/.test(candidate) ? candidate : `Symbols${candidate}`;
}

function packageSwift(
  targetName: string,
  pluginTargetName: string,
  generatorTargetName: string,
): string {
  const escaped = swiftString(targetName);
  const escapedPlugin = swiftString(pluginTargetName);
  const escapedGenerator = swiftString(generatorTargetName);
  return `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: ${escaped},
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
        .tvOS(.v15),
        .watchOS(.v8)
    ],
    products: [
        .library(name: ${escaped}, targets: [${escaped}])
    ],
    targets: [
        .target(
            name: ${escaped},
            plugins: [.plugin(name: ${escapedPlugin})]
        ),
        .executableTarget(name: ${escapedGenerator}),
        .plugin(
            name: ${escapedPlugin},
            capability: .buildTool(),
            dependencies: [.target(name: ${escapedGenerator})]
        )
    ]
)
`;
}

async function writeSymbolSources(root: string, symbols: ConvertedCollectionSymbol[]): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const { artifact } of symbols) {
    const symbolset = join(root, `${artifact.name}.symbolset`);
    await mkdir(symbolset, { recursive: true });
    await writeFile(join(symbolset, `${artifact.name}.svg`), artifact.symbolSvg, "utf8");
    await writeFile(join(symbolset, "Contents.json"), artifact.symbolsetContents, "utf8");
  }
}

async function writeSwiftPackage(root: string, collection: ConvertedCollection): Promise<void> {
  const targetName = swiftTypeName(collection.manifest.name);
  const pluginTargetName = `${targetName}Plugin`;
  const generatorTargetName = "EasySymbolsResourceGenerator";
  const manifestFileName = `${targetName}.json`;
  await mkdir(join(root, "Sources", targetName), { recursive: true });
  await writeFile(
    join(root, "Sources", targetName, "CollectionModule.swift"),
    `public enum ${targetName} {}\n`,
    "utf8",
  );
  await writeSymbolSources(join(root, "SymbolSources"), collection.symbols);
  await mkdir(join(root, "Sources", generatorTargetName), { recursive: true });
  await writeFile(
    join(root, "Sources", generatorTargetName, "main.swift"),
    resourceGeneratorSwift(),
    "utf8",
  );
  await mkdir(join(root, "Plugins", pluginTargetName), { recursive: true });
  await writeFile(
    join(root, "Plugins", pluginTargetName, `${pluginTargetName}.swift`),
    buildToolPluginSwift(pluginTargetName, generatorTargetName, manifestFileName),
    "utf8",
  );
  await writeFile(
    join(root, manifestFileName),
    json({
      version: 1,
      name: collection.manifest.name,
      symbols: collection.symbols.map(({ artifact }) => ({
        name: artifact.name,
        source: `${artifact.name}.symbolset`,
      })),
    }),
    "utf8",
  );
  await writeFile(
    join(root, "Package.swift"),
    packageSwift(targetName, pluginTargetName, generatorTargetName),
    "utf8",
  );
  await writeFile(
    join(root, "README.md"),
    `# ${collection.manifest.name}\n\nGenerated by EasySymbols. The SwiftPM build plugin reads ${manifestFileName}, selects the listed symbolsets from \`SymbolSources\`, and generates the asset catalog and Swift accessors in the plugin work directory.\n\nUsage:\n\n\`\`\`swift\nimport SwiftUI\nimport ${targetName}\n\nImage(${targetName}.check, bundle: ${targetName}.bundle)\n// or: ${targetName}.image(named: ${targetName}.check)\n\`\`\`\n`,
    "utf8",
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeCollection(
  collection: ConvertedCollection,
  outputPath: string | undefined,
  format: CollectionFormat,
  force: boolean,
): Promise<string> {
  const safeCollectionName = normalizeSymbolName(collection.manifest.name);
  const defaultName = format === "xcassets"
    ? `${safeCollectionName}.xcassets`
    : safeCollectionName;
  const output = resolve(outputPath ?? defaultName);
  await mkdir(dirname(output), { recursive: true });
  if (await exists(output) && !force) {
    throw new Error(`Output already exists: ${output}. Pass --force to replace it.`);
  }

  const staging = await mkdtemp(join(dirname(output), ".easysymbols-collection-"));
  try {
    if (format === "xcassets") await writeAssetCatalog(staging, collection.symbols);
    else await writeSwiftPackage(staging, collection);
    if (await exists(output)) await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } catch (cause) {
    await rm(staging, { recursive: true, force: true });
    throw cause;
  }
  return output;
}
