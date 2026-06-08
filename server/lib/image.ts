import sharp from "sharp";
import type { AspectRatio, RenderQuality } from "../../shared/types";

export interface TargetProfile {
  apiSize: "1024x1024" | "1536x1024" | "1024x1536";
  width: number;
  height: number;
  ratioLabel: string;
}

export interface PreparedImage {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
  fileSizeBytes: number;
  hasAlpha: boolean;
  megapixels: number;
  upscaled: boolean;
}

export function targetProfileFor(aspectRatio: AspectRatio, minMegapixels = 4): TargetProfile {
  const inflate = (width: number, height: number) => {
    const pixels = width * height;
    const minPixels = minMegapixels * 1_000_000;
    if (pixels >= minPixels) return { width, height };
    const scale = Math.sqrt(minPixels / pixels);
    return {
      width: Math.ceil((width * scale) / 2) * 2,
      height: Math.ceil((height * scale) / 2) * 2
    };
  };

  if (aspectRatio === "portrait") {
    return { apiSize: "1024x1536", ...inflate(2048, 3072), ratioLabel: "2:3" };
  }

  if (aspectRatio === "landscape") {
    return { apiSize: "1536x1024", ...inflate(3072, 2048), ratioLabel: "3:2" };
  }

  return { apiSize: "1024x1024", ...inflate(2400, 2400), ratioLabel: "1:1" };
}

export async function createDemoImage(_prompt: string, aspectRatio: AspectRatio, quality: RenderQuality, minMegapixels = 4): Promise<Buffer> {
  const target = targetProfileFor(aspectRatio, minMegapixels);
  const accent = quality === "high" ? "#2f8f83" : quality === "medium" ? "#6f7f3f" : "#7c6f64";
  const secondary = quality === "high" ? "#d9a441" : quality === "medium" ? "#8eb6bd" : "#c6a18a";
  const svg = `
    <svg width="${target.width}" height="${target.height}" viewBox="0 0 ${target.width} ${target.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f5f7f2"/>
          <stop offset="55%" stop-color="#d7e5e0"/>
          <stop offset="100%" stop-color="#cfd7bd"/>
        </linearGradient>
        <linearGradient id="surface" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="${secondary}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#sky)"/>
      <rect x="0" y="${target.height * 0.63}" width="${target.width}" height="${target.height * 0.37}" fill="#e9e3d4"/>
      <path d="M0 ${target.height * 0.60} C ${target.width * 0.20} ${target.height * 0.46}, ${target.width * 0.32} ${target.height * 0.74}, ${target.width * 0.52} ${target.height * 0.58} S ${target.width * 0.82} ${target.height * 0.48}, ${target.width} ${target.height * 0.62} L ${target.width} ${target.height} L 0 ${target.height} Z" fill="url(#surface)" opacity="0.92"/>
      <circle cx="${target.width * 0.78}" cy="${target.height * 0.23}" r="${Math.min(target.width, target.height) * 0.11}" fill="#fff8d7" opacity="0.9"/>
      <g opacity="0.38">
        <rect x="${target.width * 0.10}" y="${target.height * 0.18}" width="${target.width * 0.26}" height="${target.height * 0.30}" rx="18" fill="#ffffff"/>
        <rect x="${target.width * 0.13}" y="${target.height * 0.22}" width="${target.width * 0.20}" height="${target.height * 0.035}" rx="8" fill="#475057"/>
        <rect x="${target.width * 0.13}" y="${target.height * 0.29}" width="${target.width * 0.16}" height="${target.height * 0.028}" rx="7" fill="#7f8d78"/>
        <rect x="${target.width * 0.13}" y="${target.height * 0.35}" width="${target.width * 0.22}" height="${target.height * 0.028}" rx="7" fill="#b98d44"/>
      </g>
      <g transform="translate(${target.width * 0.49} ${target.height * 0.43})">
        <rect x="${-target.width * 0.13}" y="${-target.height * 0.10}" width="${target.width * 0.26}" height="${target.height * 0.20}" rx="28" fill="#ffffff" opacity="0.96"/>
        <circle cx="${-target.width * 0.045}" cy="${-target.height * 0.008}" r="${Math.min(target.width, target.height) * 0.032}" fill="${accent}"/>
        <circle cx="${target.width * 0.045}" cy="${-target.height * 0.008}" r="${Math.min(target.width, target.height) * 0.032}" fill="${secondary}"/>
        <rect x="${-target.width * 0.065}" y="${target.height * 0.048}" width="${target.width * 0.13}" height="${target.height * 0.018}" rx="7" fill="#48545b"/>
      </g>
      <g opacity="0.22">
        <rect x="${target.width * 0.08}" y="${target.height * 0.84}" width="${target.width * 0.28}" height="${target.height * 0.026}" rx="8" fill="#263034"/>
        <rect x="${target.width * 0.08}" y="${target.height * 0.89}" width="${target.width * 0.20}" height="${target.height * 0.018}" rx="6" fill="#263034"/>
        <rect x="${target.width * 0.08}" y="${target.height * 0.93}" width="${target.width * 0.34}" height="${target.height * 0.018}" rx="6" fill="#263034"/>
      </g>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function prepareDeliverable(
  sourceBuffer: Buffer,
  aspectRatio: AspectRatio,
  outputFormat: "jpeg" | "png",
  minMegapixels: number
): Promise<PreparedImage> {
  const target = targetProfileFor(aspectRatio, minMegapixels);
  const original = await sharp(sourceBuffer).metadata();
  const needsResize = (original.width ?? 0) < target.width || (original.height ?? 0) < target.height;
  const pipeline = sharp(sourceBuffer)
    .resize({
      width: target.width,
      height: target.height,
      fit: "cover",
      kernel: "lanczos3"
    })
    .sharpen({ sigma: 0.6, m1: 0.7, m2: 1.4 })
    .toColorspace("srgb");

  const buffer =
    outputFormat === "jpeg"
      ? await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer()
      : await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? target.width;
  const height = metadata.height ?? target.height;

  return {
    buffer,
    width,
    height,
    format: metadata.format ?? outputFormat,
    fileSizeBytes: buffer.length,
    hasAlpha: Boolean(metadata.hasAlpha),
    megapixels: Number(((width * height) / 1_000_000).toFixed(2)),
    upscaled: needsResize
  };
}
