import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageRecord } from "../../types";

export function isRemoteMediaPath(path: string) {
  return /^https?:\/\//iu.test(path);
}

export function mediaSrc(path: string) {
  return isRemoteMediaPath(path) ? path : convertFileSrc(path);
}

export function recordDisplaySrc(record: ImageRecord) {
  return mediaSrc(record.displayPath || record.path);
}

export function recordOriginalSrc(record: ImageRecord) {
  return mediaSrc(record.path);
}
