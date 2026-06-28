import { invoke } from "@tauri-apps/api/core";
import type { CivitaiImagePage } from "../../types";
import { MasonryGalleryView } from "./MasonryGalleryView";

const CIVITAI_PAGE_SIZE = 200;

export function CivitaiGalleryView() {
  return (
    <MasonryGalleryView<string>
      pageSize={CIVITAI_PAGE_SIZE}
      loadPage={(cursor, limit) => invoke<CivitaiImagePage>("list_civitai_images", { cursor, limit })}
    />
  );
}
