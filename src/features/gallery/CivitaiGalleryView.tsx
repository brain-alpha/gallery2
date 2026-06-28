import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import type {
  CivitaiFavoriteResult,
  CivitaiImageFilters,
  CivitaiImagePage,
} from "../../types";
import { CivitaiFilterBar } from "./CivitaiFilterBar";
import type { ImageRetryOptions } from "./MediaTile";
import { MasonryGalleryView } from "./MasonryGalleryView";

const CIVITAI_PAGE_SIZE = 200;
const CIVITAI_TILE_IMAGE_LOAD_DELAY_MS = 180;
const CIVITAI_TILE_IMAGE_RETRY_OPTIONS: ImageRetryOptions = {
  displayRetries: 2,
  originalRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};
const DEFAULT_CIVITAI_FILTERS: CivitaiImageFilters = {
  period: "Month",
  sort: "Most Reactions",
  browsingLevel: 3,
};

export function CivitaiGalleryView() {
  const [filters, setFilters] = useState<CivitaiImageFilters>(DEFAULT_CIVITAI_FILTERS);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const reloadKey = `${filters.period}:${filters.sort}:${filters.browsingLevel}`;

  const loadPage = useCallback((cursor: string | null, limit: number) => invoke<CivitaiImagePage>("list_civitai_images", {
    cursor,
    limit,
    period: filters.period,
    sort: filters.sort,
    browsingLevel: filters.browsingLevel,
  }), [filters]);

  const toolbar = useMemo(() => (
    <CivitaiFilterBar
      filters={filters}
      panelOpen={filterPanelOpen}
      onPanelOpenChange={setFilterPanelOpen}
      onApplyFilters={setFilters}
    />
  ), [filterPanelOpen, filters]);

  return (
    <MasonryGalleryView<string>
      pageSize={CIVITAI_PAGE_SIZE}
      reloadKey={reloadKey}
      toolbar={toolbar}
      toolbarPinned={filterPanelOpen}
      tileImageLoadDelayMs={CIVITAI_TILE_IMAGE_LOAD_DELAY_MS}
      tileImageRetryOptions={CIVITAI_TILE_IMAGE_RETRY_OPTIONS}
      loadPage={loadPage}
      favoriteRecord={(record) => invoke<CivitaiFavoriteResult>("favorite_civitai_image", {
        imageId: record.modified,
        url: record.path,
      })}
      unfavoriteRecord={(record) => invoke<void>("unfavorite_civitai_image", {
        imageId: record.modified,
      })}
    />
  );
}
