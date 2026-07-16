import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function run(
  args: string[],
  input?: string,
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

function runCommand(
  command: string,
  args: string[],
  cwd = root,
): Promise<{ code: number; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code: code ?? 1, output }));
  });
}

describe("easysymbols CLI", () => {
  it("analyzes a filled fixture", async () => {
    const result = await run([
      "analyze",
      "fixtures/svg-inputs/filled-shapes.svg",
      "--json",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      isConvertible: true,
      pathCount: 2,
      width: 24,
      height: 24,
    });
  });

  it("converts stdin to a symbol template on stdout", async () => {
    const source = await readFile(
      join(root, "fixtures/svg-inputs/stroked-check.svg"),
      "utf8",
    );
    const result = await run(
      ["convert", "-", "--output", "-", "--name", "stdin-check"],
      source,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('id="Regular-M"');
    expect(result.stdout).toContain("Template v.3.0");
  });

  it("converts evenodd artwork with the same shared geometry engine", async () => {
    const result = await run([
      "convert",
      "fixtures/svg-inputs/evenodd-same-direction-donut.svg",
      "--output",
      "-",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('id="Regular-M"');
    expect(result.stdout).not.toContain("fill-rule");
  });

  it("reports and emits every explicit size and weight master", async () => {
    const analyzed = await run([
      "analyze",
      "fixtures/svg-inputs/explicit-masters.svg",
      "--json",
    ]);
    expect(analyzed.code).toBe(0);
    expect(JSON.parse(analyzed.stdout)).toMatchObject({
      masterCount: 3,
      variants: ["Regular-S", "Regular-M", "Black-M"],
    });

    const converted = await run([
      "convert",
      "fixtures/svg-inputs/explicit-masters.svg",
      "--output",
      "-",
    ]);
    expect(converted.code).toBe(0);
    expect(converted.stdout).toMatch(/id="Regular-S"[\s\S]*id="Regular-M"[\s\S]*id="Black-M"/);
  });

  it("synthesizes all 27 centerline weight and scale groups", async () => {
    const analyzed = await run([
      "analyze",
      "fixtures/svg-inputs/centerline-play.svg",
      "--geometry",
      "centerline",
      "--variants",
      "all",
      "--stroke-scale",
      "1.25",
      "--json",
    ]);
    expect(analyzed.code).toBe(0);
    expect(JSON.parse(analyzed.stdout)).toMatchObject({
      masterCount: 27,
      sourceProfile: {
        canGenerateVariants: true,
        geometryModel: "centerline-stroke",
        strokeSummary: {
          caps: ["round"],
          joins: ["round"],
          widths: [2],
        },
      },
    });

    const converted = await run([
      "convert",
      "fixtures/svg-inputs/centerline-play.svg",
      "--geometry",
      "centerline",
      "--variants",
      "all",
      "--stroke-scale",
      "1.25",
      "--output",
      "-",
    ]);
    expect(converted.code).toBe(0);
    expect(converted.stdout.match(/<g\s+id="(?:Ultralight|Thin|Light|Regular|Medium|Semibold|Bold|Heavy|Black)-(?:S|M|L)"(?:\s|>)/g)).toHaveLength(27);
  });

  it("creates explicit, opt-in approximate scale masters for filled artwork", async () => {
    const analyzed = await run([
      "analyze",
      "fixtures/svg-inputs/filled-shapes.svg",
      "--variants",
      "approximate-scales",
      "--small-scale",
      "0.7",
      "--large-scale",
      "1.35",
      "--json",
    ]);
    expect(analyzed.code).toBe(0);
    expect(JSON.parse(analyzed.stdout)).toMatchObject({
      masterCount: 3,
      variants: ["Regular-S", "Regular-M", "Regular-L"],
      sourceProfile: {
        canGenerateApproximateScaleVariants: true,
        geometryModel: "filled-outline",
      },
    });

    const converted = await run([
      "convert",
      "fixtures/svg-inputs/filled-shapes.svg",
      "--variants",
      "approximate-scales",
      "--output",
      "-",
    ]);
    expect(converted.code).toBe(0);
    expect(converted.stdout.match(/<g\s+id="Regular-(?:S|M|L)"(?:\s|>)/g)).toHaveLength(3);
    expect(converted.stderr).toContain("WARNING APPROXIMATE_SCALE_VARIANTS");
  });

  it.each([
    [["analyze", "fixtures/svg-inputs/centerline-play.svg", "--geometry", "official"], "--geometry must be 'auto', 'static', or 'centerline'."],
    [["analyze", "fixtures/svg-inputs/centerline-play.svg", "--variants", "generated"], "--variants must be 'authored', 'all', or 'approximate-scales'."],
    [["analyze", "fixtures/svg-inputs/centerline-play.svg", "--stroke-scale", "5"], "--stroke-scale must be a number between 0.25 and 4."],
  ])("rejects invalid centerline synthesis option values", async (args, message) => {
    const result = await run(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it("keeps opaque gradient conversion downloadable while reporting the change", async () => {
    const result = await run([
      "convert",
      "fixtures/svg-inputs/gradient-fill.svg",
      "--output",
      "-",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('id="Regular-M"');
    expect(result.stderr).toContain("WARNING SVG_GRADIENT_FLATTENED");
  });

  it("removes a detected canvas background unless explicitly kept", async () => {
    const automatic = await run([
      "analyze",
      "fixtures/svg-inputs/codex-color.svg",
      "--json",
    ]);
    expect(automatic.code).toBe(0);
    expect(JSON.parse(automatic.stdout)).toMatchObject({ pathCount: 1 });
    expect(JSON.parse(automatic.stdout).diagnostics).toContainEqual(
      expect.objectContaining({ code: "SVG_CANVAS_BACKGROUND_REMOVED" }),
    );

    const kept = await run([
      "analyze",
      "fixtures/svg-inputs/codex-color.svg",
      "--background",
      "keep",
      "--json",
    ]);
    expect(kept.code).toBe(0);
    expect(JSON.parse(kept.stdout)).toMatchObject({ pathCount: 2 });
  });

  it("rejects a transparent gradient with its root-cause diagnostic", async () => {
    const result = await run([
      "analyze",
      "fixtures/svg-inputs/gradient-transparent.svg",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("SVG_GRADIENT_TRANSPARENCY_UNSUPPORTED");
    expect(result.stderr).not.toContain("SVG_NO_NORMALIZED_PATHS");
  });

  it("writes a complete symbolset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "easysymbols-cli-"));
    const output = join(directory, "check.symbolset");
    try {
      const result = await run([
        "convert",
        "fixtures/svg-inputs/stroked-check.svg",
        "--format",
        "symbolset",
        "--output",
        output,
        "--name",
        "check",
      ]);
      expect(result.code).toBe(0);
      expect(JSON.parse(await readFile(join(output, "Contents.json"), "utf8"))).toMatchObject({
        symbols: [{ filename: "check.svg", idiom: "universal" }],
      });
      expect(await readFile(join(output, "check.svg"), "utf8")).toContain(
        'id="Regular-M"',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exports only manifest-selected symbols as an asset catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "easysymbols-collection-"));
    const manifest = join(directory, "RadixSymbols.json");
    const output = join(directory, "RadixSymbols.xcassets");
    try {
      await writeFile(
        manifest,
        JSON.stringify({
          version: 1,
          name: "RadixSymbols",
          symbols: [
            {
              name: "check",
              source: join(root, "fixtures/svg-inputs/stroked-check.svg"),
            },
            {
              name: "filled-shapes",
              source: join(root, "fixtures/svg-inputs/filled-shapes.svg"),
            },
          ],
        }),
        "utf8",
      );
      const result = await run([
        "collection",
        manifest,
        "--format",
        "xcassets",
        "--output",
        output,
      ]);
      expect(result.code).toBe(0);
      expect(result.stderr).toContain("Wrote");
      expect(await readdir(output)).toEqual(
        expect.arrayContaining(["Contents.json", "check.symbolset", "filled-shapes.symbolset"]),
      );
      expect(await readFile(join(output, "check.symbolset", "check.svg"), "utf8")).toContain(
        'id="Regular-M"',
      );
      expect(JSON.parse(await readFile(join(output, "Contents.json"), "utf8"))).toMatchObject({
        info: { author: "easysymbols", version: 1 },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("generates a Swift package whose resources contain the selected symbols", async () => {
    const directory = await mkdtemp(join(tmpdir(), "easysymbols-package-"));
    const manifest = join(directory, "RadixSymbols.json");
    const output = join(directory, "RadixSymbols");
    try {
      await writeFile(
        manifest,
        JSON.stringify({
          name: "RadixSymbols",
          symbols: [
            {
              name: "check",
              source: join(root, "fixtures/svg-inputs/stroked-check.svg"),
            },
            {
              name: "filled-shapes",
              source: join(root, "fixtures/svg-inputs/filled-shapes.svg"),
            },
          ],
        }),
        "utf8",
      );
      const result = await run([
        "collection",
        manifest,
        "--format",
        "swift-package",
        "--output",
        output,
      ]);
      expect(result.code).toBe(0);
      expect(await readFile(join(output, "Package.swift"), "utf8")).toContain(
        'name: "RadixSymbols"',
      );
      expect(await readFile(join(output, "Plugins/RadixSymbolsPlugin/RadixSymbolsPlugin.swift"), "utf8")).toContain(
        "BuildToolPlugin",
      );
      expect(
        await readFile(
          join(output, "SymbolSources/check.symbolset/check.svg"),
          "utf8",
        ),
      ).toContain('id="Regular-M"');
      expect(JSON.parse(await readFile(join(output, "RadixSymbols.json"), "utf8"))).toMatchObject({
        symbols: expect.arrayContaining([
          { name: "check", source: "check.symbolset" },
          { name: "filled-shapes", source: "filled-shapes.symbolset" },
        ]),
      });
      if (process.platform === "darwin") {
        const built = await runCommand("swift", ["build", "--package-path", output]);
        if (built.code !== 0) throw new Error(built.output);

        const generatedBefore = await runCommand("find", [
          join(output, ".build", "plugins", "outputs"),
          "-type",
          "d",
          "-name",
          "RadixSymbols.xcassets",
        ]);
        const catalogBefore = generatedBefore.output.trim().split("\n")[0];
        if (!catalogBefore) throw new Error("Swift package plugin did not emit an asset catalog path.");
        expect(await readdir(catalogBefore)).toEqual(
          expect.arrayContaining(["check.symbolset", "filled-shapes.symbolset"]),
        );

        await writeFile(
          join(output, "RadixSymbols.json"),
          JSON.stringify({
            version: 1,
            name: "RadixSymbols",
            symbols: [{ name: "check", source: "check.symbolset" }],
          }),
          "utf8",
        );
        const pruned = await runCommand("swift", ["build", "--package-path", output]);
        if (pruned.code !== 0) throw new Error(pruned.output);
        const generatedAfter = await runCommand("find", [
          join(output, ".build", "plugins", "outputs"),
          "-type",
          "d",
          "-name",
          "RadixSymbols.xcassets",
        ]);
        const catalogAfter = generatedAfter.output.trim().split("\n")[0];
        if (!catalogAfter) throw new Error("Swift package plugin did not emit the pruned asset catalog path.");
        expect(await readdir(catalogAfter)).toEqual(
          expect.arrayContaining(["check.symbolset"]),
        );
        expect(await readdir(catalogAfter)).not.toContain("filled-shapes.symbolset");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it.runIf(process.platform === "darwin")(
    "passes Xcode asset compiler validation",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "easysymbols-xcode-"));
      try {
        const result = await run([
          "convert",
          "fixtures/svg-inputs/evenodd-same-direction-donut.svg",
          "--output",
          join(directory, "check.svg"),
          "--xcode-validate",
        ]);
        expect(result.code).toBe(0);
        expect(result.stderr).toContain(
          "Xcode asset compiler accepted the generated symbol.",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
