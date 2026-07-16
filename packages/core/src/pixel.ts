/**
 * A rendered RGBA image that can be compared with another rendered image.
 *
 * The comparator deliberately operates on pixels rather than SVG strings. This
 * makes it useful for regression tests where equivalent SVGs may have a
 * different attribute order or path formatting.
 */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Four 8-bit channels (red, green, blue, alpha) per pixel. */
  readonly pixels: ArrayLike<number>;
}

export interface PixelCompareOptions {
  /** Maximum permitted absolute difference for an individual channel. */
  readonly channelTolerance?: number;
  /** Maximum number of pixels that may differ beyond the channel tolerance. */
  readonly maxDifferentPixels?: number;
}

export interface PixelCompareReport {
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly actualWidth: number;
  readonly actualHeight: number;
  readonly dimensionsMatch: boolean;
  readonly totalPixels: number;
  /** Number of pixels with at least one channel over the tolerance. */
  readonly differentPixels: number;
  /** Largest absolute channel delta observed across comparable pixels. */
  readonly maxChannelDelta: number;
  /** Mean absolute delta across all comparable channels. */
  readonly meanChannelDelta: number;
  readonly channelTolerance: number;
  readonly maxDifferentPixels: number;
  readonly passed: boolean;
}

const CHANNELS_PER_PIXEL = 4;

function validateImage(image: RgbaImage, label: string): void {
  if (!Number.isInteger(image.width) || image.width < 0) {
    throw new RangeError(`${label}.width must be a non-negative integer.`);
  }
  if (!Number.isInteger(image.height) || image.height < 0) {
    throw new RangeError(`${label}.height must be a non-negative integer.`);
  }

  const expectedLength = image.width * image.height * CHANNELS_PER_PIXEL;
  if (image.pixels.length !== expectedLength) {
    throw new RangeError(
      `${label}.pixels must contain ${expectedLength} RGBA channels; received ${image.pixels.length}.`,
    );
  }
}

function normalizeTolerance(value: number | undefined, label: string): number {
  const tolerance = value ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new RangeError(`${label} must be between 0 and 255.`);
  }
  return tolerance;
}

function normalizePixelCount(value: number | undefined): number {
  const count = value ?? 0;
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("maxDifferentPixels must be a non-negative integer.");
  }
  return count;
}

/**
 * Compare two RGBA renders with an optional per-channel tolerance.
 *
 * A pixel is counted once when any of its four channels exceeds the channel
 * tolerance. Dimensions and buffer lengths are validated so a malformed
 * renderer result cannot accidentally pass a golden test.
 */
export function compareRgbaImages(
  expected: RgbaImage,
  actual: RgbaImage,
  options: PixelCompareOptions = {},
): PixelCompareReport {
  validateImage(expected, "expected");
  validateImage(actual, "actual");

  const channelTolerance = normalizeTolerance(
    options.channelTolerance,
    "channelTolerance",
  );
  const maxDifferentPixels = normalizePixelCount(options.maxDifferentPixels);
  const dimensionsMatch =
    expected.width === actual.width && expected.height === actual.height;
  const totalPixels = Math.min(expected.width * expected.height, actual.width * actual.height);

  let differentPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  let comparableChannels = 0;

  if (dimensionsMatch) {
    const channelCount = expected.width * expected.height * CHANNELS_PER_PIXEL;
    for (let offset = 0; offset < channelCount; offset += CHANNELS_PER_PIXEL) {
      let different = false;
      for (let channel = 0; channel < CHANNELS_PER_PIXEL; channel += 1) {
        const expectedValue = expected.pixels[offset + channel] ?? 0;
        const actualValue = actual.pixels[offset + channel] ?? 0;
        const delta = Math.abs(expectedValue - actualValue);
        totalChannelDelta += delta;
        comparableChannels += 1;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (delta > channelTolerance) different = true;
      }
      if (different) differentPixels += 1;
    }
  }

  return {
    expectedWidth: expected.width,
    expectedHeight: expected.height,
    actualWidth: actual.width,
    actualHeight: actual.height,
    dimensionsMatch,
    totalPixels,
    differentPixels,
    maxChannelDelta,
    meanChannelDelta:
      comparableChannels === 0 ? 0 : totalChannelDelta / comparableChannels,
    channelTolerance,
    maxDifferentPixels,
    passed: dimensionsMatch && differentPixels <= maxDifferentPixels,
  };
}
