import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";

type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};

function readPngRgba(path: string): { width: number; height: number; pixels: Rgba[] } {
  const buffer = readFileSync(path);
  const signature = buffer.subarray(0, 8).toString("hex");

  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`${path} is not a PNG file`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    }

    if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    }

    if (type === "IEND") {
      break;
    }
  }

  if (width === 0 || height === 0 || colorType !== 6) {
    throw new Error(`Expected 8-bit RGBA PNG for ${path}`);
  }

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels: Rgba[] = [];
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const scanline = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? scanline[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;

      if (filter === 1) {
        scanline[x] = (scanline[x] + left) & 0xff;
      } else if (filter === 2) {
        scanline[x] = (scanline[x] + up) & 0xff;
      } else if (filter === 3) {
        scanline[x] = (scanline[x] + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        scanline[x] = (scanline[x] + predictor) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter} in ${path}`);
      }
    }

    for (let x = 0; x < stride; x += bytesPerPixel) {
      pixels.push({
        r: scanline[x],
        g: scanline[x + 1],
        b: scanline[x + 2],
        a: scanline[x + 3],
      });
    }

    previous = scanline;
  }

  return { width, height, pixels };
}

function contentBounds(
  image: { width: number; height: number; pixels: Rgba[] },
  predicate: (pixel: Rgba) => boolean,
) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  image.pixels.forEach((pixel, index) => {
    if (!predicate(pixel)) {
      return;
    }

    const x = index % image.width;
    const y = Math.floor(index / image.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  if (maxX < minX || maxY < minY) {
    throw new Error("No pixels matched content bounds predicate");
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

describe("desktop app icon assets", () => {
  test("uses the crystal skill stack artwork for favicon and Tauri bundle source", () => {
    const sharedLogo = readFileSync("src/assets/metis-crystal-logo.svg", "utf8");
    const favicon = readFileSync("public/metis-icon.svg", "utf8");
    const tauriSource = readFileSync("src-tauri/icons/metis-icon.svg", "utf8");

    expect(sharedLogo).toContain("metis-crystal-logo-source");
    expect(sharedLogo).toContain("logo-layer-base");
    expect(sharedLogo).toContain("logo-layer-top");

    for (const svg of [favicon, tauriSource]) {
      expect(svg).toContain("metis-crystal-app-icon");
      expect(svg).toContain("metis-crystal-logo-source");
      expect(svg).toContain("logo-layer-base");
      expect(svg).toContain("logo-layer-top");
      expect(svg).not.toContain("<text");
      expect(svg).not.toContain(">M<");
    }
  });

  test("renders the Tauri primary PNG with a light app-icon background and crystal blues", () => {
    const icon = readPngRgba("src-tauri/icons/icon.png");
    const opaquePixels = icon.pixels.filter((pixel) => pixel.a > 220);
    const crystalPixels = opaquePixels.filter(
      (pixel) => pixel.b > 160 && pixel.g > 120 && pixel.r < 150,
    );
    const oldGoldPixels = opaquePixels.filter(
      (pixel) => pixel.r > 180 && pixel.g > 135 && pixel.g < 190 && pixel.b < 110,
    );
    const darkBackgroundPixels = opaquePixels.filter(
      (pixel) => pixel.r < 70 && pixel.g < 90 && pixel.b < 140,
    );
    const lightBackgroundPixels = opaquePixels.filter(
      (pixel) => pixel.r > 225 && pixel.g > 220 && pixel.b > 210,
    );

    expect(icon.width).toBe(512);
    expect(icon.height).toBe(512);
    expect(crystalPixels.length / opaquePixels.length).toBeGreaterThan(0.045);
    expect(oldGoldPixels.length / opaquePixels.length).toBeLessThan(0.02);
    expect(darkBackgroundPixels.length / opaquePixels.length).toBeLessThan(0.18);
    expect(lightBackgroundPixels.length / opaquePixels.length).toBeGreaterThan(0.45);
  });

  test("keeps the crystal artwork inside platform icon safe margins", () => {
    const tauriSource = readFileSync("src-tauri/icons/metis-icon.svg", "utf8");
    const transform = tauriSource.match(/class="metis-crystal-logo-source"[^>]*transform="translate\((\d+) (\d+)\) scale\(([\d.]+)\)"/);

    expect(transform).toBeTruthy();
    expect(Number(transform?.[3])).toBeLessThanOrEqual(11.7);

    const icon = readPngRgba("src-tauri/icons/icon.png");
    const blueMarkBounds = contentBounds(
      icon,
      (pixel) => pixel.a > 170 && pixel.b > 145 && pixel.g > 105 && pixel.r < 170,
    );

    expect(blueMarkBounds.width / icon.width).toBeLessThanOrEqual(0.74);
    expect(blueMarkBounds.height / icon.height).toBeLessThanOrEqual(0.74);
    expect(blueMarkBounds.minX / icon.width).toBeGreaterThan(0.12);
    expect(blueMarkBounds.minY / icon.height).toBeGreaterThan(0.12);
    expect(blueMarkBounds.maxX / icon.width).toBeLessThan(0.88);
    expect(blueMarkBounds.maxY / icon.height).toBeLessThan(0.88);
  });
});
