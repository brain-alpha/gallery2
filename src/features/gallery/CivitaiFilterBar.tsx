import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icons } from "../../icons";
import type { CivitaiImageFilters, CivitaiImageSort, CivitaiPeriod } from "../../types";
import { classNames } from "../../utils";

interface CivitaiFilterBarProps {
  filters: CivitaiImageFilters;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  onApplyFilters: (filters: CivitaiImageFilters) => void;
}

interface CivitaiRequestParams {
  period: CivitaiPeriod;
  sort: CivitaiImageSort;
  browsingLevel: number;
}

const PERIOD_OPTIONS: Array<{ value: CivitaiPeriod; label: string }> = [
  { value: "Day", label: "今日" },
  { value: "Week", label: "本周" },
  { value: "Month", label: "本月" },
  { value: "Year", label: "今年" },
  { value: "AllTime", label: "全部时间" },
];

const SORT_OPTIONS: Array<{ value: CivitaiImageSort; label: string }> = [
  { value: "Most Reactions", label: "反应最多" },
  { value: "Most Comments", label: "评论最多" },
  { value: "Most Collected", label: "收藏最多" },
  { value: "Newest", label: "最新" },
  { value: "Oldest", label: "最早" },
];

const BROWSING_LEVEL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "PG" },
  { value: 2, label: "PG-13" },
  { value: 4, label: "R" },
  { value: 8, label: "X" },
  { value: 16, label: "XXX" },
];

export function CivitaiFilterBar({
  filters,
  panelOpen,
  onPanelOpenChange,
  onApplyFilters,
}: CivitaiFilterBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [draftParams, setDraftParams] = useState<CivitaiRequestParams>(() => paramsFromFilters(filters));

  useEffect(() => {
    if (!panelOpen) setDraftParams(paramsFromFilters(filters));
  }, [filters, panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node | null)) {
        onPanelOpenChange(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onPanelOpenChange(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onPanelOpenChange, panelOpen]);

  function applyDraft() {
    onApplyFilters({
      ...filters,
      ...draftParams,
    });
    onPanelOpenChange(false);
  }

  return (
    <div className="civitai-filter-bar" ref={rootRef}>
      <div className="civitai-filter-control">
        <button
          type="button"
          className={classNames("civitai-filter-button", panelOpen && "is-active")}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => onPanelOpenChange(!panelOpen)}
        >
          <Icons.SlidersHorizontal />
          <span>筛选</span>
        </button>
        {panelOpen ? (
          <div className="civitai-filter-popover" role="dialog" aria-label="Civitai 请求参数配置">
            <FilterField title="时间范围">
              <SegmentedOptions
                options={PERIOD_OPTIONS}
                value={draftParams.period}
                onChange={(period) => setDraftParams((current) => ({ ...current, period }))}
              />
            </FilterField>
            <FilterField title="排序方式">
              <SegmentedOptions
                options={SORT_OPTIONS}
                value={draftParams.sort}
                onChange={(sort) => setDraftParams((current) => ({ ...current, sort }))}
              />
            </FilterField>
            <FilterField title="分级等级">
              <BrowsingLevelOptions
                value={draftParams.browsingLevel}
                onChange={(browsingLevel) => setDraftParams((current) => ({ ...current, browsingLevel }))}
              />
            </FilterField>
            <div className="civitai-filter-actions">
              <button
                type="button"
                className="civitai-filter-secondary"
                onClick={() => setDraftParams(paramsFromFilters(filters))}
              >
                还原
              </button>
              <button type="button" className="civitai-filter-apply" onClick={applyDraft}>
                应用
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FilterField({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="civitai-filter-field">
      <div className="civitai-filter-field-title">{title}</div>
      {children}
    </section>
  );
}

function SegmentedOptions<TValue extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="civitai-segmented-options">
      {options.map((option) => (
        <button
          type="button"
          className={classNames("civitai-segment", option.value === value && "is-active")}
          key={String(option.value)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BrowsingLevelOptions({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  function toggleLevel(level: number) {
    const nextValue = hasBrowsingLevel(value, level) ? value & ~level : value | level;
    if (nextValue !== 0) onChange(nextValue);
  }

  return (
    <div className="civitai-segmented-options">
      {BROWSING_LEVEL_OPTIONS.map((option) => (
        <button
          type="button"
          className={classNames("civitai-segment", hasBrowsingLevel(value, option.value) && "is-active")}
          key={String(option.value)}
          aria-pressed={hasBrowsingLevel(value, option.value)}
          onClick={() => toggleLevel(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function hasBrowsingLevel(value: number, level: number) {
  return (value & level) !== 0;
}

function paramsFromFilters(filters: CivitaiImageFilters): CivitaiRequestParams {
  return {
    period: filters.period,
    sort: filters.sort,
    browsingLevel: filters.browsingLevel,
  };
}
