import { invoke } from "@tauri-apps/api/core";
import type { CivitaiFavoriteResult, CivitaiImagePage } from "../../types";
import { MasonryGalleryView } from "./MasonryGalleryView";

const CIVITAI_PAGE_SIZE = 200;
const CIVITAI_TILE_IMAGE_LOAD_DELAY_MS = 180;

export function CivitaiGalleryView() {
  return (
    <MasonryGalleryView<string>
      pageSize={CIVITAI_PAGE_SIZE}
      tileImageLoadDelayMs={CIVITAI_TILE_IMAGE_LOAD_DELAY_MS}
      loadPage={(cursor, limit) => invoke<CivitaiImagePage>("list_civitai_images", { cursor, limit })}
      favoriteRecord={(record) => invoke<CivitaiFavoriteResult>("favorite_civitai_image", {
        imageId: record.modified,
        url: record.path,
      })}
    />
  );
}
