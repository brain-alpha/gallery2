import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ImageRecord } from "../../types";
import { classNames } from "../../utils";
import { blurHashToDataUrl } from "./blurHash";
import { mediaSrc, recordDisplaySrc } from "./mediaSource";

const TILE_VIDEO_PREVIEW_TIME = 0.08;
const DEFAULT_IMAGE_RETRY_OPTIONS: ImageRetryOptions = {
  displayRetries: 0,
  originalRetries: 0,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

export interface ImageRetryOptions {
  displayRetries: number;
  originalRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type PreviewState =
  | { type: "image"; src: string; path?: string }
  | { type: "video"; src: string; width: number; height: number }
  | null;

export function TileImage({
  record,
  displayWidth,
  loadDelayMs = 0,
  retryOptions = DEFAULT_IMAGE_RETRY_OPTIONS,
}: {
  record: ImageRecord;
  displayWidth?: number;
  loadDelayMs?: number;
  retryOptions?: ImageRetryOptions;
}) {
  const [sourceKind, setSourceKind] = useState<"display" | "original">("display");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [readyToLoad, setReadyToLoad] = useState(loadDelayMs <= 0);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<number | null>(null);
  const displaySrc = recordDisplaySrc(record, displayWidth);
  const originalSrc = mediaSrc(record.path);
  const src = sourceKind === "display" ? displaySrc : originalSrc;
  const imageSrc = retryableImageSrc(src, retryCount);
  const placeholderSrc = useMemo(() => blurHashToDataUrl(record.blurHash), [record.blurHash]);

  useEffect(() => {
    clearRetryTimer();
    setSourceKind("display");
    setLoaded(false);
    setFailed(false);
    setRetryCount(0);
    setReadyToLoad(loadDelayMs <= 0);
    if (loadDelayMs <= 0) return;

    const timer = window.setTimeout(() => setReadyToLoad(true), loadDelayMs);
    return () => window.clearTimeout(timer);
  }, [displaySrc, originalSrc, loadDelayMs]);

  useEffect(() => () => clearRetryTimer(), []);

  function clearRetryTimer() {
    if (!retryTimerRef.current) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }

  function scheduleRetry(nextRetryCount: number) {
    clearRetryTimer();
    setLoaded(false);
    setFailed(false);
    setReadyToLoad(false);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setRetryCount(nextRetryCount);
      setReadyToLoad(true);
    }, retryDelayMs(nextRetryCount, retryOptions));
  }

  function scheduleOriginalFallback() {
    clearRetryTimer();
    setLoaded(false);
    setFailed(false);
    setReadyToLoad(false);
    const fallbackDelay = retryOptions.displayRetries > 0
      ? retryDelayMs(retryCount + 1, retryOptions)
      : 0;
    if (fallbackDelay <= 0) {
      setSourceKind("original");
      setRetryCount(0);
      setReadyToLoad(true);
      return;
    }
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setSourceKind("original");
      setRetryCount(0);
      setReadyToLoad(true);
    }, fallbackDelay);
  }

  function handleError() {
    const maxRetries = sourceKind === "display"
      ? retryOptions.displayRetries
      : retryOptions.originalRetries;
    if (retryCount < maxRetries) {
      scheduleRetry(retryCount + 1);
      return;
    }
    if (sourceKind === "display" && displaySrc !== originalSrc) {
      scheduleOriginalFallback();
      return;
    }
    setLoaded(false);
    setFailed(true);
  }

  return (
    <>
      <span
        className={classNames("media-loading-placeholder", placeholderSrc && "has-blurhash")}
        style={placeholderSrc ? { backgroundImage: `url(${placeholderSrc})` } : undefined}
        aria-hidden="true"
      />
      <img
        className={classNames("tile-media", !loaded && "is-loading", failed && "is-error")}
        loading="lazy"
        decoding="async"
        draggable={false}
        src={readyToLoad ? imageSrc : undefined}
        alt=""
        onLoad={() => {
          clearRetryTimer();
          setLoaded(true);
          setFailed(false);
        }}
        onError={handleError}
      />
      {failed ? <MediaPlaceholder path={record.path} /> : null}
    </>
  );
}

export function MediaPlaceholder({ path }: { path: string }) {
  return (
    <span className="media-placeholder" aria-hidden="true" title={path}>
      <span className="media-placeholder-title">加载失败</span>
    </span>
  );
}

export function PreviewImage({ src, path }: { src: string; path?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <>
      <img
        id="preview-image"
        className={classNames("preview-media", failed && "is-error")}
        src={src}
        alt=""
        draggable={false}
        onLoad={() => setFailed(false)}
        onError={() => setFailed(true)}
      />
      {failed ? <MediaPlaceholder path={path || src} /> : null}
    </>
  );
}

export function VideoTile({
  record,
  onPlay,
  onRemove,
  videoIcon,
}: {
  record: ImageRecord;
  onPlay: (path: string, video: HTMLVideoElement | null) => void;
  onRemove: (path: string) => void;
  videoIcon: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => onRemove(record.path);
  }, [record.path, onRemove]);

  useEffect(() => {
    setFailed(false);
  }, [record.path]);

  return (
    <>
      <video
        ref={videoRef}
        src={mediaSrc(record.path)}
        muted
        loop
        playsInline
        controls={false}
        preload="metadata"
        draggable={false}
        className={classNames("tile-media", failed && "is-error")}
        onLoadedMetadata={(event) => primeTileVideoFrame(event.currentTarget)}
        onLoadedData={() => setFailed(false)}
        onSeeked={() => setFailed(false)}
        onError={() => setFailed(true)}
      />
      {failed ? <MediaPlaceholder path={record.path} /> : null}
      <span
        className="video-tile-hover-target"
        onMouseEnter={() => onPlay(record.path, videoRef.current)}
      >
        <span className="image-tile-badge video-tile-kind-mark">
          {videoIcon}
        </span>
      </span>
    </>
  );
}

export function PreviewOverlay({ preview, onClose }: { preview: PreviewState; onClose: () => void }) {
  if (!preview) return null;
  if (preview.type === "video") {
    return (
      <div className="preview video-preview" onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <video
          id="preview-video"
          controls
          autoPlay
          loop
          draggable={false}
          src={preview.src}
          style={{
            ["--video-ratio" as string]: String(preview.width / preview.height),
            ["--video-aspect" as string]: `${preview.width} / ${preview.height}`,
          }}
        />
      </div>
    );
  }

  return (
    <div className="preview image-preview" onClick={onClose}>
      <figure>
        <PreviewImage src={preview.src} path={preview.path} />
      </figure>
    </div>
  );
}

export function pauseVideoElement(video: HTMLVideoElement) {
  video.pause();
}

function primeTileVideoFrame(video: HTMLVideoElement) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  if (video.currentTime > 0) return;
  const targetTime = Math.min(TILE_VIDEO_PREVIEW_TIME, Math.max(0.001, video.duration * 0.02));
  try {
    video.currentTime = targetTime;
  } catch {
    // Some media backends reject early seeks before metadata is fully usable.
  }
}

function retryDelayMs(retryCount: number, options: ImageRetryOptions) {
  const baseDelay = Math.max(0, options.baseDelayMs);
  const maxDelay = Math.max(baseDelay, options.maxDelayMs);
  const exponentialDelay = baseDelay * (2 ** Math.max(0, retryCount - 1));
  const jitter = Math.floor(Math.random() * Math.min(500, baseDelay * 0.35 + 1));
  return Math.min(maxDelay, exponentialDelay + jitter);
}

function retryableImageSrc(src: string, retryCount: number) {
  if (retryCount <= 0) return src;
  try {
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return src;
    url.searchParams.set("galleryRetry", String(retryCount));
    return url.toString();
  } catch {
    return src;
  }
}
