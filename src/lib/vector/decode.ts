import sharp from "sharp";

export type Raster = {
  width: number;
  height: number;
  /** RGBA, length = width * height * 4 */
  data: Uint8ClampedArray;
  hadAlpha: boolean;
};

export class ImageError extends Error {}

/** Minimal BMP decoder (24/32/8/4/1-bit uncompressed) – sharp cannot read BMP. */
function decodeBmp(buf: Buffer): { width: number; height: number; rgba: Uint8ClampedArray } {
  if (buf.length < 54 || buf.toString("ascii", 0, 2) !== "BM") {
    throw new ImageError("Unsupported BMP file (bad header)");
  }
  const dataOffset = buf.readUInt32LE(10);
  const dibSize = buf.readUInt32LE(14);
  let width: number;
  let height: number;
  let bitCount: number;
  let compression: number;
  let paletteOffset = 14 + dibSize;
  let paletteCount = 0;
  if (dibSize === 12) {
    width = buf.readUInt16LE(18);
    height = buf.readUInt16LE(20);
    bitCount = buf.readUInt16LE(24);
    compression = 0;
  } else {
    width = buf.readInt32LE(18);
    height = buf.readInt32LE(22);
    bitCount = buf.readUInt16LE(28);
    compression = buf.readUInt32LE(30);
    paletteCount = buf.readUInt32LE(46);
  }
  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height <= 0) throw new ImageError("Unsupported BMP file (empty image)");
  if (compression !== 0 && compression !== 3) {
    throw new ImageError("Compressed BMP files are not supported – please re-save as PNG or JPG");
  }
  const palette: [number, number, number][] = [];
  if (bitCount <= 8) {
    const count = paletteCount || 1 << bitCount;
    for (let i = 0; i < count; i++) {
      const o = paletteOffset + i * 4;
      if (o + 2 >= buf.length) break;
      palette.push([buf[o + 2], buf[o + 1], buf[o]]);
    }
    paletteOffset = 0;
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const rowSize = Math.floor((bitCount * width + 31) / 32) * 4;
  for (let row = 0; row < height; row++) {
    const srcRow = topDown ? row : height - 1 - row;
    const rowStart = dataOffset + srcRow * rowSize;
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (bitCount === 24 || bitCount === 32) {
        const px = rowStart + x * (bitCount / 8);
        if (px + 3 < buf.length) {
          b = buf[px];
          g = buf[px + 1];
          r = buf[px + 2];
          if (bitCount === 32 && compression === 0) a = buf[px + 3] || 255;
        }
      } else if (bitCount === 8) {
        const idx = buf[rowStart + x];
        const p = palette[idx] ?? [0, 0, 0];
        [r, g, b] = p;
      } else if (bitCount === 4) {
        const byte = buf[rowStart + (x >> 1)];
        const idx = x % 2 === 0 ? byte >> 4 : byte & 0x0f;
        const p = palette[idx] ?? [0, 0, 0];
        [r, g, b] = p;
      } else if (bitCount === 1) {
        const byte = buf[rowStart + (x >> 3)];
        const idx = (byte >> (7 - (x % 8))) & 1;
        const p = palette[idx] ?? [0, 0, 0];
        [r, g, b] = p;
      } else {
        throw new ImageError(`${bitCount}-bit BMP files are not supported`);
      }
      const o = (row * width + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { width, height, rgba: out };
}

const SHARP_INPUTS = ["jpeg", "png", "webp", "tiff", "gif", "svg", "heif", "avif", "raw"];

/** Decode any supported input into a resized RGBA raster ready for analysis. */
export async function decodeImage(buffer: Buffer, maxDim: number, filename = ""): Promise<Raster> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "bmp") {
    const bmp = decodeBmp(buffer);
    const { data, info } = await sharp(Buffer.from(bmp.rgba.buffer.slice(0)), {
      raw: { width: bmp.width, height: bmp.height, channels: 4 },
    })
      .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data),
      hadAlpha: true,
    };
  }
  let meta: { format?: string; hasAlpha?: boolean; width?: number; height?: number };
  try {
    meta = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit|too large|exceeds/i.test(message)) {
      throw new ImageError("This image is larger than 40 megapixels – please resize it (or crop it) and upload again");
    }
    throw new ImageError("Could not read this image – it may be corrupted or unsupported");
  }
  if ((meta.width ?? 0) * (meta.height ?? 0) > 40_000_000) {
    throw new ImageError("This image is larger than 40 megapixels – please resize it and upload again");
  }
  if (!meta.format || !SHARP_INPUTS.includes(meta.format)) {
    throw new ImageError(`Format "${meta.format ?? "unknown"}" is not supported`);
  }
  const hadAlpha = Boolean(meta.hasAlpha);
  const { data, info } = await sharp(buffer, { limitInputPixels: 40_000_000, animated: false })
    .rotate()
    .ensureAlpha()
    .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data),
    hadAlpha,
  };
}

export async function sourceDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    try {
      const bmp = decodeBmp(buffer);
      return { width: bmp.width, height: bmp.height };
    } catch {
      return { width: 0, height: 0 };
    }
  }
}
