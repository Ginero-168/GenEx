import React from "react";
import type { MoodboardAsset } from "../shared/types";

interface MoodBoardCanvasProps {
  assets: MoodboardAsset[];
  selectedAssetIds: Set<string>;
  removedAssetIds: Set<string>;
  onToggleAsset: (assetId: string) => void;
  onRemoveAsset: (assetId: string) => void;
}

interface TileRect {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  closeX: number;
  closeY: number;
  closeSize: number;
}

interface CachedImage {
  image: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
}

export function MoodBoardCanvas({
  assets,
  selectedAssetIds,
  removedAssetIds,
  onToggleAsset,
  onRemoveAsset
}: MoodBoardCanvasProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const tileRectsRef = React.useRef<TileRect[]>([]);
  const imageCacheRef = React.useRef<Map<string, CachedImage>>(new Map());
  const [width, setWidth] = React.useState(920);

  const visibleAssets = React.useMemo(
    () => assets.filter((asset) => !removedAssetIds.has(asset.id)),
    [assets, removedAssetIds]
  );
  const columns = width < 420 ? 2 : width < 780 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(visibleAssets.length / columns));
  const tileHeight = width < 560 ? 132 : 148;
  const canvasHeight = Math.max(330, rows * (tileHeight + 12) + 16);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.round(entries[0]?.contentRect.width ?? canvas.clientWidth);
      if (nextWidth > 0) setWidth(nextWidth);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    for (const asset of visibleAssets) {
      if (imageCacheRef.current.has(asset.id)) continue;

      const image = new window.Image();
      const cached: CachedImage = { image, loaded: false, failed: false };
      imageCacheRef.current.set(asset.id, cached);
      image.onload = () => {
        cached.loaded = true;
        if (!cancelled) draw();
      };
      image.onerror = () => {
        cached.failed = true;
        if (!cancelled) draw();
      };
      image.src = imageSourceFor(asset);
    }

    draw();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAssets, selectedAssetIds, width, canvasHeight]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    canvas.style.height = `${canvasHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, canvasHeight);
    ctx.fillStyle = "#edf2f4";
    ctx.fillRect(0, 0, width, canvasHeight);

    const gap = 12;
    const tileWidth = (width - gap * (columns + 1)) / columns;
    const rects: TileRect[] = [];

    visibleAssets.forEach((asset, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = gap + col * (tileWidth + gap);
      const y = gap + row * (tileHeight + gap);
      const selected = selectedAssetIds.has(asset.id);
      const closeSize = 23;
      const closeX = x + tileWidth - closeSize - 8;
      const closeY = y + 8;

      drawTile(ctx, asset, x, y, tileWidth, tileHeight, selected, imageCacheRef.current.get(asset.id));
      drawClose(ctx, closeX, closeY, closeSize);

      rects.push({ assetId: asset.id, x, y, width: tileWidth, height: tileHeight, closeX, closeY, closeSize });
    });

    if (visibleAssets.length === 0) {
      drawEmpty(ctx, width, canvasHeight);
    }

    tileRectsRef.current = rects;
  }

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const rects = [...tileRectsRef.current].reverse();

    for (const rect of rects) {
      if (
        x >= rect.closeX &&
        x <= rect.closeX + rect.closeSize &&
        y >= rect.closeY &&
        y <= rect.closeY + rect.closeSize
      ) {
        onRemoveAsset(rect.assetId);
        return;
      }

      if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
        onToggleAsset(rect.assetId);
        return;
      }
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="moodboard-canvas"
      onClick={handleClick}
      role="img"
      aria-label="Mood board reference canvas"
    />
  );
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  asset: MoodboardAsset,
  x: number,
  y: number,
  width: number,
  height: number,
  selected: boolean,
  cached: CachedImage | undefined
) {
  ctx.save();
  roundedRect(ctx, x, y, width, height, 8);
  ctx.clip();
  ctx.fillStyle = "#dbe4e8";
  ctx.fillRect(x, y, width, height);

  if (cached?.loaded && !cached.failed) {
    drawImageCover(ctx, cached.image, x, y, width, height);
  } else {
    drawPlaceholder(ctx, x, y, width, height, asset.role);
  }

  const gradient = ctx.createLinearGradient(0, y + height * 0.48, 0, y + height);
  gradient.addColorStop(0, "rgba(17, 31, 38, 0)");
  gradient.addColorStop(1, "rgba(17, 31, 38, 0.82)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  ctx.restore();

  ctx.lineWidth = selected ? 4 : 1;
  ctx.strokeStyle = selected ? "#2f8f83" : "#b9c4c9";
  roundedRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, 8);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "bottom";
  drawWrappedText(ctx, asset.componentLabel, x + 10, y + height - 30, width - 20, 14, 2);

  ctx.fillStyle = selected ? "#8ff0d8" : "#dce5e9";
  ctx.font = "700 10px Inter, system-ui, sans-serif";
  ctx.fillText(selected ? "KEEP" : "MUTED", x + 10, y + height - 10);
}

function drawClose(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "rgba(17, 31, 38, 0.18)";
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, size, size, 6);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#9e3430";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 7, y + 7);
  ctx.lineTo(x + size - 7, y + size - 7);
  ctx.moveTo(x + size - 7, y + 7);
  ctx.lineTo(x + 7, y + size - 7);
  ctx.stroke();
  ctx.restore();
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, role: string) {
  const hue = role === "human" ? "#375c93" : role === "food" ? "#b45d48" : role === "decor" ? "#8b6fba" : "#2f8f83";
  ctx.fillStyle = hue;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.beginPath();
  ctx.arc(x + width * 0.3, y + height * 0.35, Math.min(width, height) * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + width * 0.52, y + height * 0.28, width * 0.32, height * 0.18);
  ctx.fillRect(x + width * 0.18, y + height * 0.64, width * 0.58, height * 0.14);
}

function drawEmpty(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#5b6870";
  ctx.font = "800 15px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Mood board canvas", width / 2, height / 2);
  ctx.textAlign = "left";
}

function drawImageCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function imageSourceFor(asset: MoodboardAsset): string {
  const source = asset.previewUrl || asset.imageUrl;
  if (source.startsWith("data:") || source.startsWith("/")) return source;
  return `/api/moodboards/image?url=${encodeURIComponent(source)}`;
}
