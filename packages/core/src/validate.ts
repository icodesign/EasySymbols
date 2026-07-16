import { SaxesParser, type SaxesTagPlain } from "saxes";

import { error } from "./errors.js";
import type { Diagnostic, ValidationReport } from "./types.js";

export function validateSymbol(source: string): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  let currentVariant: string | undefined;
  let rootSeen = false;
  let symbolPathCount = 0;
  let xmlFailure: Error | undefined;

  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", (cause) => {
    xmlFailure = cause;
  });
  parser.on("opentag", (node: SaxesTagPlain) => {
    const tag = node.name.toLowerCase();
    if (!rootSeen) {
      rootSeen = true;
      if (tag !== "svg") {
        diagnostics.push(error("SYMBOL_ROOT_INVALID", "validation", "The symbol root must be svg."));
      }
    }
    const id = node.attributes.id;
    if (id) {
      if (ids.has(id)) {
        diagnostics.push(error("SYMBOL_DUPLICATE_ID", "validation", `Duplicate id: ${id}.`, id));
      }
      ids.add(id);
      if (/^(?:Ultralight|Thin|Light|Regular|Medium|Semibold|Bold|Heavy|Black)-[SML]$/.test(id)) {
        currentVariant = id;
      }
    }
    if (currentVariant && tag === "path") {
      symbolPathCount += 1;
      if (!node.attributes.d) {
        diagnostics.push(error("SYMBOL_PATH_EMPTY", "validation", "Every symbol path needs path data.", id));
      }
      for (const attribute of ["stroke", "filter", "mask", "clip-path"]) {
        if (node.attributes[attribute] && node.attributes[attribute] !== "none") {
          diagnostics.push(error("SYMBOL_PATH_ATTRIBUTE_UNSUPPORTED", "validation", `Symbol paths cannot retain ${attribute}.`, id));
        }
      }
    }
  });
  parser.on("closetag", (node: SaxesTagPlain) => {
    if (node.attributes.id === currentVariant) currentVariant = undefined;
  });
  try {
    parser.write(source).close();
  } catch (cause) {
    xmlFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  if (xmlFailure) {
    diagnostics.push(error("SYMBOL_XML_INVALID", "validation", `Invalid symbol XML: ${xmlFailure.message}`));
  }
  for (const required of ["Notes", "template-version", "Guides", "Symbols", "Capline-S", "Baseline-S", "Capline-M", "Baseline-M", "Capline-L", "Baseline-L"]) {
    if (!ids.has(required)) {
      diagnostics.push(error("SYMBOL_REQUIRED_ID_MISSING", "validation", `Required template id is missing: ${required}.`, required));
    }
  }
  if (![...ids].some((id) => /^(?:Ultralight|Thin|Light|Regular|Medium|Semibold|Bold|Heavy|Black)-[SML]$/.test(id))) {
    diagnostics.push(error("SYMBOL_VARIANT_MISSING", "validation", "At least one symbol variant is required."));
  }
  if (symbolPathCount === 0) {
    diagnostics.push(error("SYMBOL_PATH_MISSING", "validation", "The symbol has no paths in a variant."));
  }
  return {
    diagnostics,
    isValid: !diagnostics.some((item) => item.severity === "error"),
  };
}
