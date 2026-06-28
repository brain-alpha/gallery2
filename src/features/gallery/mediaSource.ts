import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageRecord } from "../../types";

export function isRemoteMediaPath(path: string) {
  return /^https?:\/\//iu.test(path);
}

export function mediaSrc(path: string) {
  return isRemoteMediaPath(path) ? path : convertFileSrc(path);
}

export function recordDisplaySrc(record: ImageRecord, displayWidth?: number) {
  const sourcePath = civitaiSizedImagePath(record.path, displayWidth, record.width)
    || record.displayPath
    || record.path;
  return mediaSrc(sourcePath);
}

export function recordOriginalSrc(record: ImageRecord) {
  return mediaSrc(record.path);
}

function civitaiSizedImagePath(path: string, displayWidth: number | undefined, originalWidth: number) {
  if (!isCivitaiImagePath(path) || !displayWidth || !Number.isFinite(displayWidth)) return null;
  if (!path.includes("/original=true/")) return null;
  const pixelRatio = typeof window === "undefined" ? 1 : Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const requestedWidth = Math.max(1, Math.ceil(displayWidth * pixelRatio + 80));
  const safeWidth = originalWidth > 1 ? Math.min(requestedWidth, originalWidth) : requestedWidth;
  return path.replace("/original=true/", `/width=${safeWidth}/`);
}

function isCivitaiImagePath(path: string) {
  try {
    const url = new URL(path);
    return url.protocol === "https:" && url.hostname === "image.civitai.com";
  } catch {
    return false;
  }
}
