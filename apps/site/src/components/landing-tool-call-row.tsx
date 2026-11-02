import { LandingEditFileLineDeltaBadge } from "@/components/landing-edit-file-line-delta-badge";
import type { EditFileLineDelta, ToolCardsToolPhase } from "@/lib/landing-tool-cards-demo-script";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

function toolCallPhaseShowsShimmer(phase: ToolCardsToolPhase): boolean {
  return phase === "running";
}

function ToolCallSummary({
  headline,
  detail,
  shimmerActive,
}: {
  headline: string;
  detail?: string;
  shimmerActive: boolean;
}) {
  const shimmerClass = shimmerActive
    ? `spirit-thinking-shimmer-text ${FONT_WEIGHT_NORMAL} tracking-wide`
    : "text-muted-foreground";

  return (
    <span className="min-w-0 break-words text-xs leading-relaxed">
      <span className={shimmerClass}>{headline}</span>
      {detail ? (
        <>
          {" "}
          <span className="text-foreground-subtle">{detail}</span>
        </>
      ) : null}
    </span>
  );
}

export function LandingToolCallRow({
  headline,
  detail,
  phase,
  delta,
}: {
  headline: string;
  detail: string;
  phase: ToolCardsToolPhase;
  delta?: EditFileLineDelta;
}) {
  const shimmerActive = toolCallPhaseShowsShimmer(phase);

  return (
    <div className="flex w-full justify-start">
      <p className="inline-flex min-h-7 min-w-0 max-w-full items-center gap-2 py-0.5 text-xs leading-relaxed">
        <ToolCallSummary headline={headline} detail={detail} shimmerActive={shimmerActive} />
        {delta ? (
          <span className="shrink-0">
            <LandingEditFileLineDeltaBadge delta={delta} />
          </span>
        ) : null}
      </p>
    </div>
  );
}
