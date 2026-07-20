import { useEffect, useMemo, useRef, useState } from "react";

import { GITHUB_SPARKLINE_HEIGHT, GITHUB_SPARKLINE_WIDTH } from "../app/constants";
import type { UsageChartData } from "../app/hooks/useUsageHeatmapPolling";
import type { ClaudeUsageSnapshot, CodexUsageSnapshot } from "../app/types";
import { OctopusGlyph } from "./EmptyOctopus";

type RuntimeStatusStripProps = {
  sparklinePoints: string;
  usageData: UsageChartData | null;
  claudeUsage: ClaudeUsageSnapshot | null;
  codexUsage?: CodexUsageSnapshot | null;
  isRefreshingClaudeUsage?: boolean;
  isRefreshingCodexUsage?: boolean;
  onRefreshClaudeUsage?: () => void;
  onRefreshCodexUsage?: () => void;
};

const MINI_USAGE_WIDTH = 160;
const MINI_USAGE_HEIGHT = 28;
const MINI_BAR_GAP = 1;

type MiniBar = { x: number; y: number; width: number; height: number };

const buildUsageBars = (data: UsageChartData): MiniBar[] => {
  const days = Array.isArray(data.days) ? data.days.slice(-30) : [];
  if (days.length === 0) return [];

  const totals = days.map((day) => (typeof day.totalTokens === "number" ? day.totalTokens : 0));
  const max = Math.max(...totals, 1);
  const visibleDaySlots = 30;
  const leadingEmptySlots = Math.max(0, visibleDaySlots - days.length);
  const barSlot = MINI_USAGE_WIDTH / visibleDaySlots;
  const barWidth = Math.max(1, barSlot - MINI_BAR_GAP);

  return days.map((day, index) => {
    const totalTokens = typeof day.totalTokens === "number" ? day.totalTokens : 0;
    const h = Math.max(0.5, (totalTokens / max) * (MINI_USAGE_HEIGHT - 2));
    return {
      x: (leadingEmptySlots + index) * barSlot,
      y: MINI_USAGE_HEIGHT - h,
      width: barWidth,
      height: h,
    };
  });
};

const usageHistoryLabel = (data: UsageChartData | null, hasBars: boolean) => {
  if (!hasBars) {
    return "TOKEN HISTORY —";
  }

  return data?.estimated ? "EST. TOKENS/DAY · LAST 30 DAYS" : "CLAUDE TOKENS/DAY · LAST 30 DAYS";
};

const pct = (value: number | null | undefined, loading?: boolean): string => {
  if (loading) return "···";
  return value == null ? "NA" : `${Math.round(value)}%`;
};

type ProviderUsageState = {
  provider: "Claude" | "Codex";
  loading: boolean;
  primaryLabel: string;
  primaryPercent: number | null | undefined;
  secondaryLabel: string;
  secondaryPercent: number | null | undefined;
  message?: string;
};

const claudeUsageState = (claudeUsage: ClaudeUsageSnapshot | null): ProviderUsageState => {
  if (claudeUsage === null) {
    return {
      provider: "Claude",
      loading: true,
      primaryLabel: "Session",
      primaryPercent: 0,
      secondaryLabel: "Week",
      secondaryPercent: 0,
    };
  }

  const label = claudeUsage.source === "oauth-api" ? "5h" : "Session";
  if (claudeUsage.status === "ok") {
    return {
      provider: "Claude",
      loading: false,
      primaryLabel: label,
      primaryPercent: claudeUsage.primaryUsedPercent,
      secondaryLabel: "Week",
      secondaryPercent: claudeUsage.secondaryUsedPercent,
    };
  }

  return {
    provider: "Claude",
    loading: false,
    primaryLabel: label,
    primaryPercent: null,
    secondaryLabel: "Week",
    secondaryPercent: null,
    message: claudeUsage.message ?? "Claude usage unavailable",
  };
};

const codexUsageState = (codexUsage: CodexUsageSnapshot | null | undefined): ProviderUsageState => {
  if (codexUsage == null) {
    return {
      provider: "Codex",
      loading: true,
      primaryLabel: "5h",
      primaryPercent: 0,
      secondaryLabel: "Week",
      secondaryPercent: 0,
    };
  }

  if (codexUsage.status === "ok") {
    return {
      provider: "Codex",
      loading: false,
      primaryLabel: "5h",
      primaryPercent: codexUsage.primaryUsedPercent,
      secondaryLabel: codexUsage.creditsUnlimited ? "Credits" : "Week",
      secondaryPercent: codexUsage.creditsUnlimited ? null : codexUsage.secondaryUsedPercent,
    };
  }

  return {
    provider: "Codex",
    loading: false,
    primaryLabel: "5h",
    primaryPercent: null,
    secondaryLabel: "Week",
    secondaryPercent: null,
    message: codexUsage.message ?? "Codex usage unavailable",
  };
};

const isAvailableUsageSnapshot = (
  usage: ClaudeUsageSnapshot | CodexUsageSnapshot | null | undefined,
) => usage?.status === "ok";

const shouldShowProviderUsage = (
  usage: ClaudeUsageSnapshot | CodexUsageSnapshot | null | undefined,
  hasAvailableProvider: boolean,
) => usage == null || usage.status === "ok" || !hasAvailableProvider;

const UsageProviderRows = ({ state }: { state: ProviderUsageState }) => (
  <div className="console-status-provider-usage-provider">
    <span className="console-status-provider-usage-provider-label">{state.provider}</span>
    <div className="console-status-provider-usage-bars">
      <UsageRail
        label={state.primaryLabel}
        percent={state.primaryPercent}
        loading={state.loading}
        {...(state.message ? { title: state.message } : {})}
      />
      <UsageRail
        label={state.secondaryLabel}
        percent={state.secondaryPercent}
        loading={state.loading}
        {...(state.message ? { title: state.message } : {})}
      />
    </div>
  </div>
);

const UsageRail = ({
  label,
  percent,
  loading,
  title,
}: {
  label: string;
  percent: number | null | undefined;
  loading?: boolean;
  title?: string;
}) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  const showTooltip = (clientX: number, clientY: number) => {
    if (!title) return;
    setTooltip({ x: clientX, y: clientY });
  };

  return (
    <div
      className="console-status-usage-row"
      data-has-tooltip={title ? "true" : undefined}
      tabIndex={title ? 0 : -1}
      onMouseEnter={(event) => showTooltip(event.clientX, event.clientY)}
      onMouseMove={(event) => showTooltip(event.clientX, event.clientY)}
      onMouseLeave={() => setTooltip(null)}
      onBlur={() => setTooltip(null)}
      onFocus={(event) => {
        if (!title) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setTooltip({ x: rect.left + 24, y: rect.bottom + 8 });
      }}
    >
      <span className="console-status-usage-row-meta">
        <span className="console-status-usage-row-label">{label}</span>
        <span className="console-status-usage-row-value">{pct(percent, loading)}</span>
      </span>
      <span className="console-status-usage-rail">
        <span
          className="console-status-usage-rail-fill"
          style={{ width: `${Math.min(100, percent ?? 0)}%` }}
        />
      </span>
      {title && tooltip ? (
        <span
          className="console-status-usage-tooltip"
          style={{
            left: `${Math.max(8, tooltip.x - 260)}px`,
            top: `${Math.min(window.innerHeight - 80, tooltip.y + 14)}px`,
          }}
        >
          {title}
        </span>
      ) : null}
    </div>
  );
};

export const RuntimeStatusStrip = ({
  sparklinePoints,
  usageData,
  claudeUsage,
  codexUsage,
  isRefreshingClaudeUsage = false,
  isRefreshingCodexUsage = false,
  onRefreshClaudeUsage,
  onRefreshCodexUsage,
}: RuntimeStatusStripProps) => {
  const usageBars = useMemo(() => (usageData ? buildUsageBars(usageData) : []), [usageData]);
  const usageHistoryHasBars = usageBars.length > 0;
  const usageHistoryTitle = usageHistoryLabel(usageData, usageHistoryHasBars);
  const claudeState = claudeUsageState(claudeUsage);
  const codexState = codexUsageState(codexUsage);
  const hasAvailableProvider =
    isAvailableUsageSnapshot(claudeUsage) || isAvailableUsageSnapshot(codexUsage);
  const visibleProviderStates = [
    shouldShowProviderUsage(claudeUsage, hasAvailableProvider) ? claudeState : null,
    shouldShowProviderUsage(codexUsage, hasAvailableProvider) ? codexState : null,
  ].filter((state): state is ProviderUsageState => state !== null);
  const [showRefreshSpin, setShowRefreshSpin] = useState(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshHideTimerRef = useRef<number | null>(null);
  const isRefreshingUsage = isRefreshingClaudeUsage || isRefreshingCodexUsage;
  const handleRefreshUsage = onRefreshClaudeUsage ?? onRefreshCodexUsage;

  useEffect(() => {
    return () => {
      if (refreshHideTimerRef.current !== null) {
        window.clearTimeout(refreshHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isRefreshingUsage) {
      if (refreshHideTimerRef.current !== null) {
        window.clearTimeout(refreshHideTimerRef.current);
        refreshHideTimerRef.current = null;
      }
      refreshStartedAtRef.current = Date.now();
      setShowRefreshSpin(true);
      return;
    }

    if (refreshStartedAtRef.current === null) {
      setShowRefreshSpin(false);
      return;
    }

    const elapsedMs = Date.now() - refreshStartedAtRef.current;
    const remainingMs = Math.max(0, 450 - elapsedMs);
    refreshHideTimerRef.current = window.setTimeout(() => {
      setShowRefreshSpin(false);
      refreshStartedAtRef.current = null;
      refreshHideTimerRef.current = null;
    }, remainingMs);
  }, [isRefreshingUsage]);

  return (
    <section className="console-status-strip" aria-label="Runtime status strip">
      <div className="console-status-main">
        <OctopusGlyph
          className="console-status-octopus-icon"
          animation="sway"
          expression="normal"
          scale={2}
        />
        <span className="console-status-brand">OCTOGENT</span>
      </div>
      <div className="console-status-charts">
        <div className="console-status-sparkline" aria-label="Commits per day over last 30 days">
          <div className="console-status-sparkline-chart">
            <svg
              viewBox={`0 0 ${GITHUB_SPARKLINE_WIDTH} ${GITHUB_SPARKLINE_HEIGHT}`}
              role="presentation"
            >
              <polyline points={sparklinePoints} />
            </svg>
          </div>
          <span className="console-status-sparkline-label">COMMITS/DAY · LAST 30 DAYS</span>
        </div>
        <div
          className="console-status-usage-mini"
          aria-label={
            usageHistoryHasBars
              ? usageData?.estimated
                ? "Estimated token usage last 30 days"
                : "Claude token usage last 30 days"
              : "Token usage history unavailable"
          }
        >
          {usageHistoryHasBars ? (
            <>
              <div className="console-status-usage-mini-chart">
                <svg viewBox={`0 0 ${MINI_USAGE_WIDTH} ${MINI_USAGE_HEIGHT}`} role="presentation">
                  {usageBars.map((bar, index) => (
                    <rect
                      key={`${index}-${bar.x}-${bar.height}`}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      rx={0.5}
                    />
                  ))}
                </svg>
              </div>
              <span className="console-status-sparkline-label">{usageHistoryTitle}</span>
            </>
          ) : (
            <span className="console-status-sparkline-label">{usageHistoryTitle}</span>
          )}
        </div>
      </div>
      <div className="console-status-provider-usage" aria-label="Agent usage limits">
        {handleRefreshUsage && (
          <button
            type="button"
            className="console-status-provider-usage-refresh"
            onClick={() => {
              onRefreshClaudeUsage?.();
              onRefreshCodexUsage?.();
            }}
            aria-label="Refresh agent usage"
            title="Refresh agent usage"
            data-refreshing={showRefreshSpin ? "true" : "false"}
          >
            ↻
          </button>
        )}
        <span className="console-status-provider-usage-title">
          AGENT
          <br />
          LIMITS
        </span>
        <div className="console-status-provider-usage-list">
          {visibleProviderStates.map((state) => (
            <UsageProviderRows key={state.provider} state={state} />
          ))}
        </div>
      </div>
    </section>
  );
};
