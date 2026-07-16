import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface XcodeValidationResult {
  available: boolean;
  output: string;
  valid: boolean;
}

function run(command: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

export async function validateWithXcode(
  name: string,
  symbolSvg: string,
  symbolsetContents: string,
): Promise<XcodeValidationResult> {
  if (process.platform !== "darwin") {
    return {
      available: false,
      valid: false,
      output: "Xcode validation is available only on macOS.",
    };
  }

  const root = await mkdtemp(join(tmpdir(), "easysymbols-"));
  try {
    const catalog = join(root, "Assets.xcassets");
    const symbolset = join(catalog, `${name}.symbolset`);
    const compiled = join(root, "compiled");
    await mkdir(symbolset, { recursive: true });
    await mkdir(compiled, { recursive: true });
    await writeFile(join(symbolset, `${name}.svg`), symbolSvg, "utf8");
    await writeFile(join(symbolset, "Contents.json"), symbolsetContents, "utf8");

    try {
      const result = await run("xcrun", [
        "actool",
        catalog,
        "--compile",
        compiled,
        "--platform",
        "macosx",
        "--minimum-deployment-target",
        "14.0",
        "--target-device",
        "mac",
        "--warnings",
        "--notices",
        "--errors",
        "--output-format",
        "human-readable-text",
      ]);
      return {
        available: true,
        valid: result.code === 0,
        output: result.output.trim(),
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { available: false, valid: false, output: message };
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
