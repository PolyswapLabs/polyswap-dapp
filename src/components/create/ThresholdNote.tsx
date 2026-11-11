import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/icons";
import { describePostOnlyStatus } from "@/client/orders/quoteErrors";
import { suggestedThresholdPercent, type PostOnlyBuyCheck } from "@/shared/orders/postOnly";
import type { Side } from "@/shared/markets/categories";

interface Props {
  id: string;
  postOnlyEnabled: boolean;
  check: PostOnlyBuyCheck;
  side: Side;
  threshold: number;
  onUseSuggested: (threshold: number) => void;
}

/** One line under the threshold slider saying what the chosen value will do. */
export function ThresholdNote({
  id,
  postOnlyEnabled,
  check,
  side,
  threshold,
  onUseSuggested,
}: Props) {
  const message = describePostOnlyStatus(postOnlyEnabled, check, side, threshold);
  const crosses = postOnlyEnabled && check.status === "crosses";

  if (!crosses && postOnlyEnabled) {
    return (
      <p id={id} className="text-sm leading-snug text-ink-2">
        {message}
      </p>
    );
  }

  // The slider stops at 5%, so don't offer a value it can't show.
  const suggested =
    check.status === "crosses" && suggestedThresholdPercent(check) >= 5
      ? suggestedThresholdPercent(check)
      : null;

  return (
    <div
      id={id}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 border border-l-4 border-ink border-l-warn bg-paper-2 px-4 py-3"
    >
      <p className="flex min-w-0 flex-1 basis-64 items-start gap-2.5 text-sm leading-snug text-ink">
        <Icon.zap size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        {message}
      </p>
      {crosses && suggested !== null && (
        <Button
          variant="paper"
          size="sm"
          className="shrink-0"
          onClick={() => onUseSuggested(suggested / 100)}
        >
          Use {suggested}%
        </Button>
      )}
    </div>
  );
}
