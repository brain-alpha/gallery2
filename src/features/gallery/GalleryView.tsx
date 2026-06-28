import { invoke } from "@tauri-apps/api/core";
import type { ImageCursor, ImagePage } from "../../types";
import { MasonryGalleryView } from "./MasonryGalleryView";

export function GalleryView() {
  return (
    <MasonryGalleryView<ImageCursor>
      loadPage={(cursor, limit) => invoke<ImagePage>("list_images", { cursor, limit })}
    />
  );
}
