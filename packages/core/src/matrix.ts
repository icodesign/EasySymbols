import { error } from "./errors.js";
import { ConversionError } from "./errors.js";

export type Matrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function numbers(value: string): number[] {
  const matches = value.match(
    /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g,
  );
  const remainder = value.replace(
    /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g,
    "",
  );
  if (remainder.replace(/[\s,]/g, "") !== "") {
    throw new Error("contains invalid numeric syntax");
  }
  const result = (matches ?? []).map(Number);
  if (result.some((item) => !Number.isFinite(item))) {
    throw new Error("contains a non-finite number");
  }
  return result;
}

function operationMatrix(name: string, values: number[]): Matrix {
  switch (name) {
    case "matrix": {
      if (values.length !== 6) break;
      return values as unknown as Matrix;
    }
    case "translate": {
      if (values.length !== 1 && values.length !== 2) break;
      return [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0];
    }
    case "scale": {
      if (values.length !== 1 && values.length !== 2) break;
      const x = values[0] ?? 1;
      return [x, 0, 0, values[1] ?? x, 0, 0];
    }
    case "rotate": {
      if (values.length !== 1 && values.length !== 3) break;
      const radians = ((values[0] ?? 0) * Math.PI) / 180;
      const rotation: Matrix = [
        Math.cos(radians),
        Math.sin(radians),
        -Math.sin(radians),
        Math.cos(radians),
        0,
        0,
      ];
      if (values.length === 1) return rotation;
      const x = values[1] ?? 0;
      const y = values[2] ?? 0;
      return multiplyMatrices(
        multiplyMatrices([1, 0, 0, 1, x, y], rotation),
        [1, 0, 0, 1, -x, -y],
      );
    }
    case "skewx": {
      if (values.length !== 1) break;
      return [1, 0, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    }
    case "skewy": {
      if (values.length !== 1) break;
      return [1, Math.tan(((values[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
  }
  throw new Error(`unsupported transform operation or argument count: ${name}`);
}

export function parseTransform(value: string | undefined, elementId?: string): Matrix {
  if (!value?.trim()) return IDENTITY_MATRIX;

  try {
    let matrix = IDENTITY_MATRIX;
    let cursor = 0;
    const expression = /([A-Za-z]+)\s*\(([^)]*)\)/g;
    for (const match of value.matchAll(expression)) {
      const index = match.index ?? 0;
      if (value.slice(cursor, index).replace(/[\s,]/g, "") !== "") {
        throw new Error("contains text outside a transform operation");
      }
      const name = (match[1] ?? "").toLowerCase();
      const transform = operationMatrix(name, numbers(match[2] ?? ""));
      matrix = multiplyMatrices(matrix, transform);
      cursor = index + match[0].length;
    }
    if (cursor === 0 || value.slice(cursor).replace(/[\s,]/g, "") !== "") {
      throw new Error("contains invalid trailing syntax");
    }
    const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      throw new Error("is singular");
    }
    return matrix;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "is invalid";
    throw new ConversionError([
      error(
        "SVG_INVALID_TRANSFORM",
        "geometry",
        `Transform ${detail}.`,
        elementId,
      ),
    ]);
  }
}
