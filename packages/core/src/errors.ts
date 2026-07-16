import type { Diagnostic } from "./types.js";

export class ConversionError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics[0]?.message ?? "SVG conversion failed.");
    this.name = "ConversionError";
    this.diagnostics = diagnostics;
  }
}

export function error(
  code: string,
  stage: Diagnostic["stage"],
  message: string,
  elementId?: string,
): Diagnostic {
  return {
    code,
    severity: "error",
    stage,
    message,
    ...(elementId ? { elementId } : {}),
  };
}

export function warning(
  code: string,
  stage: Diagnostic["stage"],
  message: string,
  elementId?: string,
): Diagnostic {
  return {
    code,
    severity: "warning",
    stage,
    message,
    ...(elementId ? { elementId } : {}),
  };
}
