const BASE83_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";
const PLACEHOLDER_SIZE = 24;
const CACHE_LIMIT = 500;
const cache = new Map<string, string | null>();

interface LinearColor {
  r: number;
  g: number;
  b: number;
}

export function blurHashToDataUrl(hash: string | undefined) {
  const normalized = hash?.trim();
  if (!normalized) return null;
  if (cache.has(normalized)) return cache.get(normalized) || null;

  let dataUrl: string | null = null;
  try {
    dataUrl = decodeBlurHashToDataUrl(normalized, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
  } catch {
    dataUrl = null;
  }

  cache.set(normalized, dataUrl);
  if (cache.size > CACHE_LIMIT) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  return dataUrl;
}

function decodeBlurHashToDataUrl(hash: string, width: number, height: number) {
  if (typeof document === "undefined") return null;
  if (hash.length < 6) return null;

  const sizeFlag = decode83(hash[0]);
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;
  const expectedLength = 4 + 2 * numX * numY;
  if (hash.length !== expectedLength) return null;

  const quantizedMaximumValue = decode83(hash[1]);
  const maximumValue = (quantizedMaximumValue + 1) / 166;
  const colors: LinearColor[] = [decodeDc(decode83(hash.slice(2, 6)))];
  for (let index = 1; index < numX * numY; index += 1) {
    colors[index] = decodeAc(decode83(hash.slice(4 + index * 2, 6 + index * 2)), maximumValue);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const imageData = context.createImageData(width, height);
  const pixels = imageData.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j += 1) {
        for (let i = 0; i < numX; i += 1) {
          const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
          const color = colors[i + j * numX];
          r += color.r * basis;
          g += color.g * basis;
          b += color.b * basis;
        }
      }

      const pixelIndex = 4 * (x + y * width);
      pixels[pixelIndex] = linearToSrgb(r);
      pixels[pixelIndex + 1] = linearToSrgb(g);
      pixels[pixelIndex + 2] = linearToSrgb(b);
      pixels[pixelIndex + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function decode83(value: string) {
  return value.split("").reduce((result, char) => {
    const digit = BASE83_CHARS.indexOf(char);
    if (digit < 0) throw new Error("Invalid BlurHash digit");
    return result * 83 + digit;
  }, 0);
}

function decodeDc(value: number): LinearColor {
  return {
    r: srgbToLinear(value >> 16),
    g: srgbToLinear((value >> 8) & 255),
    b: srgbToLinear(value & 255),
  };
}

function decodeAc(value: number, maximumValue: number): LinearColor {
  const quantR = Math.floor(value / (19 * 19));
  const quantG = Math.floor(value / 19) % 19;
  const quantB = value % 19;
  return {
    r: signPow((quantR - 9) / 9, 2) * maximumValue,
    g: signPow((quantG - 9) / 9, 2) * maximumValue,
    b: signPow((quantB - 9) / 9, 2) * maximumValue,
  };
}

function signPow(value: number, exponent: number) {
  return Math.sign(value) * Math.abs(value) ** exponent;
}

function srgbToLinear(value: number) {
  const normalized = value / 255;
  if (normalized <= 0.04045) return normalized / 12.92;
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped <= 0.0031308) return Math.round(clamped * 12.92 * 255);
  return Math.round((1.055 * clamped ** (1 / 2.4) - 0.055) * 255);
}
