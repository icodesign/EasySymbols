import { SVGPathData, type SVGCommand } from "svg-pathdata";

interface Bounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

interface Contour {
  area: number;
  bounds: Bounds;
  pathData: string;
}

export type ContourContainmentTest = (
  innerPathData: string,
  outerPathData: string,
) => boolean;

function splitSubpaths(pathData: string): SVGPathData[] {
  const contours: SVGPathData[] = [];
  let commands: SVGCommand[] = [];

  for (const command of new SVGPathData(pathData).toAbs().commands) {
    if (command.type === SVGPathData.MOVE_TO && commands.length > 0) {
      contours.push(new SVGPathData(commands));
      commands = [];
    }
    commands.push(command);
  }
  if (commands.length > 0) contours.push(new SVGPathData(commands));
  return contours;
}

function multiplyPolynomials(left: number[], right: number[]): number[] {
  const product = Array.from(
    { length: left.length + right.length - 1 },
    () => 0,
  );
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      product[leftIndex + rightIndex] =
        (product[leftIndex + rightIndex] ?? 0) +
        (left[leftIndex] ?? 0) * (right[rightIndex] ?? 0);
    }
  }
  return product;
}

function cubicCoefficients(
  start: number,
  control1: number,
  control2: number,
  end: number,
): number[] {
  return [
    start,
    3 * (control1 - start),
    3 * (control2 - 2 * control1 + start),
    end - 3 * control2 + 3 * control1 - start,
  ];
}

function derivative(coefficients: number[]): number[] {
  return coefficients.slice(1).map((value, index) => value * (index + 1));
}

function cubicSignedArea(
  startX: number,
  startY: number,
  command: Extract<SVGCommand, { type: typeof SVGPathData.CURVE_TO }>,
): number {
  const x = cubicCoefficients(startX, command.x1, command.x2, command.x);
  const y = cubicCoefficients(startY, command.y1, command.y2, command.y);
  const xDy = multiplyPolynomials(x, derivative(y));
  const yDx = multiplyPolynomials(y, derivative(x));
  const coefficientCount = Math.max(xDy.length, yDx.length);
  let integral = 0;

  for (let index = 0; index < coefficientCount; index += 1) {
    integral += ((xDy[index] ?? 0) - (yDx[index] ?? 0)) / (index + 1);
  }
  return integral / 2;
}

/**
 * Computes the exact Green's-theorem area for line and cubic segments. PathKit
 * can reduce curves while simplifying, so normalize every supported SVG curve
 * to an absolute cubic before inspecting its direction.
 */
function signedArea(path: SVGPathData): number {
  const normalized = new SVGPathData(path.encode())
    .toAbs()
    .normalizeST()
    .qtToC()
    .aToC()
    .normalizeHVZ();
  let area = 0;
  let currentX = 0;
  let currentY = 0;

  for (const command of normalized.commands) {
    switch (command.type) {
      case SVGPathData.MOVE_TO:
        currentX = command.x;
        currentY = command.y;
        break;
      case SVGPathData.LINE_TO:
        area += (currentX * command.y - command.x * currentY) / 2;
        currentX = command.x;
        currentY = command.y;
        break;
      case SVGPathData.CURVE_TO:
        area += cubicSignedArea(currentX, currentY, command);
        currentX = command.x;
        currentY = command.y;
        break;
      default:
        throw new Error(
          "Could not normalize a simplified contour for winding analysis.",
        );
    }
  }
  return area;
}

function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

function contourDepth(index: number, parents: Array<number | undefined>): number {
  const visited = new Set([index]);
  let depth = 0;
  let parent = parents[index];

  while (parent !== undefined) {
    if (visited.has(parent)) {
      throw new Error("PathKit produced cyclic contour containment.");
    }
    visited.add(parent);
    depth += 1;
    parent = parents[parent];
  }
  return depth;
}

function rootContour(index: number, parents: Array<number | undefined>): number {
  let root = index;
  while (parents[root] !== undefined) root = parents[root] as number;
  return root;
}

/**
 * PathKit Simplify preserves evenodd coverage and removes contour crossings,
 * but it does not promise nonzero-compatible direction for nested contours.
 * Determine the containment tree, then alternate direction at each nesting
 * level. Disconnected contour trees keep their authored root direction.
 */
export function orientSimplifiedContoursForWinding(
  pathData: string,
  isContainedBy: ContourContainmentTest,
): string {
  const contours: Contour[] = splitSubpaths(pathData).map((path) => {
    const area = signedArea(path);
    if (!Number.isFinite(area) || area === 0) {
      throw new Error("Could not determine the direction of a simplified contour.");
    }
    const bounds = new SVGPathData(path.encode()).getBounds();
    return {
      area,
      bounds,
      pathData: path.encode(),
    };
  });
  const parents: Array<number | undefined> = contours.map(() => undefined);

  for (let index = 0; index < contours.length; index += 1) {
    const inner = contours[index];
    if (!inner) continue;
    const candidates = contours
      .map((outer, outerIndex) => ({ outer, outerIndex }))
      .filter(
        ({ outer, outerIndex }) =>
          outerIndex !== index && boundsContain(outer.bounds, inner.bounds),
      )
      .sort(
        (left, right) =>
          Math.abs(left.outer.area) - Math.abs(right.outer.area),
      );

    for (const { outer, outerIndex } of candidates) {
      if (isContainedBy(inner.pathData, outer.pathData)) {
        parents[index] = outerIndex;
        break;
      }
    }
  }

  return contours
    .map((contour, index) => {
      const depth = contourDepth(index, parents);
      const root = contours[rootContour(index, parents)];
      if (!root) {
        throw new Error("Could not resolve the contour containment root.");
      }
      const rootDirection = Math.sign(root.area);
      const requiredDirection = depth % 2 === 0 ? rootDirection : -rootDirection;
      if (Math.sign(contour.area) === requiredDirection) return contour.pathData;
      return new SVGPathData(contour.pathData).toAbs().reverse().encode();
    })
    .join("");
}
