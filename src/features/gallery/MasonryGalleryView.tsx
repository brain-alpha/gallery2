import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorDrawer, type EditorDrawerHandle } from "../editor/EditorDrawer";
import { Icons } from "../../icons";
import type {
  GalleryPreferences,
  ImageRecord,
  PickedImage,
  XaiEditResult,
  XaiKeyStatus,
} from "../../types";
import { classNames, logError, setPageBackground, storeGalleryTheme, storedGalleryTheme } from "../../utils";
import { buildLayout } from "./layout";
import {
  pauseVideoElement,
  PreviewOverlay,
  TileImage,
  type ImageRetryOptions,
  type PreviewState,
  VideoTile,
} from "./MediaTile";
import { mediaSrc, recordOriginalSrc } from "./mediaSource";
import { useGalleryViewport } from "./useWindowViewport";

const DEFAULT_PAGE_SIZE = 50;
const OVERSCAN = 1200;
const MAX_REFERENCE_SELECTION = 3;
const MAX_PLAYING_TILE_VIDEOS = 10;

export interface GalleryDataPage<TCursor> {
  items: ImageRecord[];
  nextCursor: TCursor | null;
}

interface MasonryGalleryViewProps<TCursor> {
  loadPage: (cursor: TCursor | null, limit: number) => Promise<GalleryDataPage<TCursor>>;
  pageSize?: number;
  favoriteRecord?: (record: ImageRecord) => Promise<unknown>;
  unfavoriteRecord?: (record: ImageRecord) => Promise<unknown>;
  tileImageLoadDelayMs?: number;
  tileImageRetryOptions?: ImageRetryOptions;
}

interface ContextMenuState {
  left: number;
  top: number;
  record: ImageRecord;
}

export function MasonryGalleryView<TCursor>({
  loadPage,
  pageSize = DEFAULT_PAGE_SIZE,
  favoriteRecord,
  unfavoriteRecord,
  tileImageLoadDelayMs = 0,
  tileImageRetryOptions,
}: MasonryGalleryViewProps<TCursor>) {
  const [preferences, setPreferences] = useState<GalleryPreferences | null>(null);
  const initialTheme = useMemo(() => storedGalleryTheme(), []);
  const [records, setRecords] = useState<ImageRecord[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const { viewport, isResizing } = useGalleryViewport();
  const [preview, setPreview] = useState<PreviewState>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedReferenceRecords, setSelectedReferenceRecords] = useState<ImageRecord[]>([]);
  const [favoriteOverrides, setFavoriteOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [favoriteUpdatingPaths, setFavoriteUpdatingPaths] = useState<Set<string>>(() => new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorDrawerHandle | null>(null);
  const loadingRef = useRef(false);
  const doneRef = useRef(false);
  const recordsRef = useRef<ImageRecord[]>([]);
  const cursorRef = useRef<TCursor | null>(null);
  const selectedReferenceRecordsRef = useRef<ImageRecord[]>([]);
  const playingVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => {
    setPageBackground(initialTheme === "black" ? "#1a1b1e" : "#ffffff");
    invoke<GalleryPreferences>("get_gallery_preferences")
      .then((loadedPreferences) => {
        setPreferences(loadedPreferences);
        storeGalleryTheme(loadedPreferences.theme);
        setPageBackground(loadedPreferences.theme === "black" ? "#1a1b1e" : "#ffffff");
      })
      .catch((error) => logError(error, "Failed to load gallery preferences"));
  }, [initialTheme]);

  useEffect(() => {
    document.body.classList.toggle("previewing", preview !== null);
    return () => document.body.classList.remove("previewing");
  }, [preview]);

  useEffect(() => {
    selectedReferenceRecordsRef.current = selectedReferenceRecords;
  }, [selectedReferenceRecords]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (contextMenu && !(event.target as Element | null)?.closest("#context-menu")) {
        setContextMenu(null);
      }
    };
    const handleContextMenu = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest(".image-tile")) setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (preview) {
        setPreview(null);
        return;
      }
      if (editorRef.current?.isOpen()) {
        editorRef.current.close();
      }
    };

    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, preview]);

  useEffect(() => {
    loadMore().catch((error) => logError(error, "Failed to load gallery page"));
  }, []);

  useEffect(() => {
    const reloadGallery = () => {
      reloadFirstPage().catch((error) => logError(error, "Failed to reload gallery page"));
    };

    window.addEventListener("gallery:reload", reloadGallery);
    return () => window.removeEventListener("gallery:reload", reloadGallery);
  }, []);

  useEffect(() => {
    const reloadEmptyGallery = () => {
      if (recordsRef.current.length > 0) return;
      reloadFirstPage().catch((error) => logError(error, "Failed to reload gallery page"));
    };

    const timer = window.setInterval(reloadEmptyGallery, 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMore().catch((error) => logError(error, "Failed to load gallery page"));
      }
    }, { rootMargin: "1200px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [preferences]);

  useEffect(() => {
    return () => {
      for (const video of playingVideosRef.current.values()) {
        pauseVideoElement(video);
      }
      playingVideosRef.current.clear();
    };
  }, []);

  const gapSize = preferences?.hasGap ? 12 : 0;
  const minColumnWidth = Math.min(600, Math.max(100, preferences?.minColumnWidth || 280));
  const layoutItems = useMemo(
    () => buildLayout(records, viewport.width, gapSize, minColumnWidth),
    [records, viewport.width, gapSize, minColumnWidth],
  );
  const masonryHeight = layoutItems.length === 0
    ? 0
    : layoutItems.reduce((height, item) => Math.max(height, item.bottom + gapSize), gapSize);
  const visibleIndexes = useMemo(() => {
    const minVisible = Math.max(0, viewport.scrollY - OVERSCAN);
    const maxVisible = viewport.scrollY + viewport.height + OVERSCAN;
    const indexes: number[] = [];
    for (let index = 0; index < layoutItems.length; index += 1) {
      const item = layoutItems[index];
      if (!item) continue;
      if (item.bottom < minVisible) continue;
      if (item.top > maxVisible) break;
      indexes.push(index);
    }
    return indexes;
  }, [layoutItems, viewport.scrollY, viewport.height]);

  async function loadMore() {
    if (loadingRef.current || doneRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await loadPage(cursorRef.current, pageSize);
      const items = page.items;
      setRecords((current) => {
        const next = [...current, ...items];
        recordsRef.current = next;
        return next;
      });
      cursorRef.current = page.nextCursor;
      const nextDone = !page.nextCursor;
      doneRef.current = nextDone;
      setDone(nextDone);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  async function reloadFirstPage() {
    if (loadingRef.current) return;
    cursorRef.current = null;
    doneRef.current = false;
    setDone(false);
    if (recordsRef.current.length > 0) {
      recordsRef.current = [];
      setRecords([]);
    }
    await loadMore();
  }

  function showPreview(record: ImageRecord) {
    setContextMenu(null);
    if (record.mediaType === "video") {
      pauseTileVideo(record.path);
    }
    const src = recordOriginalSrc(record);
    if (record.mediaType === "video") {
      setPreview({
        type: "video",
        src,
        width: Math.max(1, record.width || 16),
        height: Math.max(1, record.height || 9),
      });
      return;
    }
    setPreview({ type: "image", src, path: record.path });
  }

  const playTileVideo = useCallback((path: string, video: HTMLVideoElement | null) => {
    if (!video) return;
    const playingVideos = playingVideosRef.current;
    if (playingVideos.has(path)) {
      playingVideos.delete(path);
    }
    playingVideos.set(path, video);

    while (playingVideos.size > MAX_PLAYING_TILE_VIDEOS) {
      const oldest = playingVideos.entries().next().value;
      if (!oldest) break;
      const [oldestPath, oldestVideo] = oldest;
      playingVideos.delete(oldestPath);
      pauseVideoElement(oldestVideo);
    }

    video.play().catch((error) => logError(error, "Failed to play gallery video"));
  }, []);

  const pauseTileVideo = useCallback((path: string) => {
    const video = playingVideosRef.current.get(path);
    if (!video) return;
    playingVideosRef.current.delete(path);
    pauseVideoElement(video);
  }, []);

  function handleTileClick(event: React.MouseEvent, record: ImageRecord) {
    if ((event.ctrlKey || event.metaKey) && record.mediaType === "image") {
      event.preventDefault();
      setPreview(null);
      setContextMenu(null);
      toggleReferenceSelection(record);
      return;
    }
    showPreview(record);
  }

  function toggleReferenceSelection(record: ImageRecord) {
    const current = selectedReferenceRecordsRef.current;
    const exists = current.some((item) => item.path === record.path);
    const next = exists
      ? current.filter((item) => item.path !== record.path)
      : [...current, record].slice(0, MAX_REFERENCE_SELECTION);

    selectedReferenceRecordsRef.current = next;
    setSelectedReferenceRecords(next);

    if (!exists && next.length === MAX_REFERENCE_SELECTION) {
      window.requestAnimationFrame(() => {
        editorRef.current?.open(next).catch((error) => logError(error, "Failed to open editor"));
        selectedReferenceRecordsRef.current = [];
        setSelectedReferenceRecords([]);
      });
    }
  }

  function showContextMenu(event: React.MouseEvent, record: ImageRecord) {
    event.preventDefault();
    if ((event.ctrlKey || event.metaKey) && record.mediaType === "image") {
      setPreview(null);
      setContextMenu(null);
      toggleReferenceSelection(record);
      return;
    }
    setPreview(null);
    const menuWidth = 118;
    const menuHeight = favoriteRecord && record.mediaType === "image" ? 74 : 40;
    const left = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const top = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    setContextMenu({
      left: Math.max(8, left),
      top: Math.max(8, top),
      record,
    });
  }

  function isRecordFavorited(record: ImageRecord) {
    return favoriteOverrides.get(record.path) ?? record.favorited;
  }

  function isRecordFavoriteUpdating(record: ImageRecord) {
    return favoriteUpdatingPaths.has(record.path);
  }

  async function handleFavoriteToggle(record: ImageRecord) {
    if (record.mediaType !== "image" || isRecordFavoriteUpdating(record)) {
      return;
    }

    const nextFavorited = !isRecordFavorited(record);
    const updateFavorite = nextFavorited ? favoriteRecord : unfavoriteRecord;
    if (!updateFavorite) return;

    setContextMenu(null);
    setFavoriteUpdatingPaths((current) => new Set(current).add(record.path));
    try {
      await updateFavorite(record);
      setFavoriteOverrides((current) => {
        const next = new Map(current);
        next.set(record.path, nextFavorited);
        return next;
      });
      setRecords((current) => {
        const next = current.map((item) => (
          item.path === record.path ? { ...item, favorited: nextFavorited } : item
        ));
        recordsRef.current = next;
        return next;
      });
    } catch (error) {
      const label = nextFavorited
        ? "Failed to favorite Civitai image"
        : "Failed to unfavorite Civitai image";
      logError(error, label);
    } finally {
      setFavoriteUpdatingPaths((current) => {
        const next = new Set(current);
        next.delete(record.path);
        return next;
      });
    }
  }

  if (!preferences) {
    return <main className={`gallery-shell theme-${initialTheme}`} />;
  }

  const themeClass = `theme-${preferences.theme === "black" ? "black" : "white"}`;
  const contextMenuFavorited = contextMenu ? isRecordFavorited(contextMenu.record) : false;
  const contextMenuFavoriteUpdating = contextMenu ? isRecordFavoriteUpdating(contextMenu.record) : false;

  return (
    <main
      className={classNames(
        "gallery-shell",
        preferences.hasGap ? "gallery-gap" : "gallery-flush",
        isResizing && "is-window-resizing",
        themeClass,
      )}
      onDragStart={(event) => {
        if (!(event.target as Element).closest("#editor-drawer")) event.preventDefault();
      }}
    >
      <section className="masonry" style={{ height: `${masonryHeight}px` }}>
        {visibleIndexes.map((index) => {
          const record = records[index];
          const layout = layoutItems[index];
          if (!record || !layout) return null;
          const selected = selectedReferenceRecords.some((item) => item.path === record.path);
          const favorited = isRecordFavorited(record);
          const favoriteUpdating = isRecordFavoriteUpdating(record);
          return (
            <button
              className={classNames(
                "image-tile",
                selected && "is-selected",
                favorited && "is-favorited",
                favoriteUpdating && "is-favoriting",
              )}
              key={record.path}
              type="button"
              style={{
                width: `${layout.width}px`,
                height: `${layout.height}px`,
                transform: `translate3d(${layout.left}px, ${layout.top}px, 0)`,
              }}
              onClick={(event) => handleTileClick(event, record)}
              onContextMenu={(event) => showContextMenu(event, record)}
            >
              {record.mediaType === "video" ? (
                <VideoTile
                  record={record}
                  onPlay={playTileVideo}
                  onRemove={pauseTileVideo}
                  videoIcon={<Icons.VideoCamera />}
                />
              ) : (
                <TileImage
                  record={record}
                  displayWidth={layout.width}
                  loadDelayMs={tileImageLoadDelayMs}
                  retryOptions={tileImageRetryOptions}
                />
              )}
              {selected ? (
                <span className="image-tile-badge image-tile-selection-mark">
                  <Icons.PuzzlePiece />
                </span>
              ) : null}
              {favoriteUpdating ? (
                <span className="image-tile-badge image-tile-favorite-status" aria-hidden="true">
                  <span className="favorite-status-spinner" />
                </span>
              ) : null}
              {favorited && !favoriteUpdating ? (
                <span className="image-tile-badge image-tile-favorite-mark" aria-hidden="true">
                  <Icons.Heart />
                </span>
              ) : null}
            </button>
          );
        })}
      </section>
      <div
        ref={sentinelRef}
        id="sentinel"
        aria-hidden="true"
        hidden={done || records.length === 0}
        style={{
          height: done || records.length === 0
            ? "1px"
            : `${Math.max(1, Math.min(240, viewport.height * 0.25))}px`,
        }}
      />
      {loading ? (
        <div className="gallery-loading-more" role="status" aria-live="polite">
          <span className="gallery-loading-spinner" aria-hidden="true" />
          <span>加载中</span>
        </div>
      ) : null}

      <PreviewOverlay preview={preview} onClose={() => setPreview(null)} />

      {contextMenu ? (
        <div className="context-menu" id="context-menu" style={{ left: contextMenu.left, top: contextMenu.top }}>
          <button
            type="button"
            disabled={contextMenu.record.mediaType !== "image"}
            onClick={() => {
              const record = contextMenu.record;
              setContextMenu(null);
              editorRef.current?.open(record).catch((error) => logError(error, "Failed to open editor"));
              selectedReferenceRecordsRef.current = [];
              setSelectedReferenceRecords([]);
            }}
          >
            <Icons.PaintBrush />
            <span>编辑</span>
          </button>
          {favoriteRecord && contextMenu.record.mediaType === "image" ? (
            <button
              type="button"
              disabled={contextMenuFavoriteUpdating || (contextMenuFavorited && !unfavoriteRecord)}
              onClick={() => {
                handleFavoriteToggle(contextMenu.record).catch((error) => {
                  logError(error, "Failed to toggle Civitai favorite");
                });
              }}
            >
              {contextMenuFavorited ? <Icons.HeartOff /> : <Icons.Heart />}
              <span>
                {contextMenuFavoriteUpdating
                  ? contextMenuFavorited
                    ? "取消中"
                    : "收藏中"
                  : contextMenuFavorited
                    ? "取消收藏"
                    : "收藏"}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <EditorDrawer
        ref={editorRef}
        readImageDataUri={(path) => invoke("read_image_data_uri", { path })}
        getXaiKeyStatus={() => invoke<XaiKeyStatus>("get_xai_key_status")}
        pickReferenceImages={() => invoke<PickedImage[]>("pick_xai_reference_images")}
        editImage={(payload) => invoke<XaiEditResult>("edit_image_with_xai", payload)}
        onPreviewAttachment={(attachment) => setPreview({ type: "image", src: attachment.dataUrl || mediaSrc(attachment.path), path: attachment.path })}
        onToggle={(nextOpen) => {
          document.body.classList.toggle("editing", nextOpen);
          if (nextOpen) {
            selectedReferenceRecordsRef.current = [];
            setSelectedReferenceRecords([]);
          }
        }}
        onError={(error, label) => logError(error, label)}
      />
    </main>
  );
}
