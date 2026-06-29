export type MediaType = "image" | "video";

export interface ImageRecord {
  path: string;
  displayPath: string;
  blurHash?: string;
  favorited: boolean;
  mediaType: MediaType;
  width: number;
  height: number;
  modified: number;
  size: number;
}

export interface ImageCursor {
  modified: number;
  path: string;
}

export interface ImagePage {
  items: ImageRecord[];
  nextCursor: ImageCursor | null;
}

export interface CivitaiImagePage {
  items: ImageRecord[];
  nextCursor: string | null;
}

export type CivitaiPeriod = "AllTime" | "Year" | "Month" | "Week" | "Day";
export type CivitaiImageSort = "Most Reactions" | "Most Comments" | "Most Collected" | "Newest" | "Oldest";

export interface CivitaiImageFilters {
  period: CivitaiPeriod;
  sort: CivitaiImageSort;
  browsingLevel: number;
}

export interface CivitaiFavoriteResult {
  path: string;
  alreadyFavorited: boolean;
}

export interface SettingsState {
  platform: string;
  paths: string[];
  imageCount: number;
  dbPath: string;
  generatedContentDir: string;
  civitaiFavoritesDir: string;
  appVersion: string;
  thumbnailEnabled: boolean;
  thumbnailDir: string;
  xaiKey: string;
  galleryMode: string;
  galleryHasGap: boolean;
  galleryTheme: "black" | "white";
  minColumnWidth: number;
  windowsStartupEnabled: boolean;
  windowsStartupDesktopBackground: boolean;
}

export interface AppUpdateInfo {
  available: boolean;
  currentVersion: string;
  version: string | null;
  date: string | null;
  body: string | null;
}

export interface WindowsStartupSettings {
  startupEnabled: boolean;
  startupDesktopBackground: boolean;
}

export interface GalleryPreferences {
  hasGap: boolean;
  theme: "black" | "white";
  minColumnWidth: number;
}

export interface SourcePathsUpdate {
  paths: string[];
  changed: boolean;
}

export interface ScanSummary {
  indexed: number;
  skipped: number;
  removed: number;
  total: number;
}

export interface ThumbnailProgress {
  running: boolean;
  stage: string;
  processed: number;
  total: number;
  generated: number;
  skipped: number;
  message: string;
  error: string;
}

export interface DedupeSummary {
  checked: number;
  duplicates: number;
  moved: number;
  skipped: number;
  total: number;
  maxFileSize: number;
}

export interface ExtensionRepairSummary {
  repaired: number;
  skipped: number;
  total: number;
}

export interface PickedImage {
  path: string;
  dataUri: string;
}

export interface XaiEditResult {
  path: string;
  paths: string[];
  response: unknown;
}

export interface XaiKeyStatus {
  configured: boolean;
}

export interface Attachment {
  path: string;
  label: string;
  dataUrl?: string;
  dataUri?: string;
}
