import { Fragment } from "react";

export type ProgressStepDef = { key: string; label: string };
type MarkStatus = "done" | "current" | "pending" | "error";
type SegmentStatus = "done" | "active" | "pending";

export function ProgressSteps({
  steps,
  currentKey,
  status,
}: {
  steps: ProgressStepDef[];
  // null once the whole sequence is done (every step renders as "done").
  currentKey: string | null;
  // Status of the step at currentKey; ignored once currentKey is null.
  status: "active" | "error";
}) {
  const currentIndex =
    currentKey === null
      ? steps.length
      : steps.findIndex((step) => step.key === currentKey);

  const markStatuses: MarkStatus[] = steps.map((_, index) =>
    index < currentIndex
      ? "done"
      : index > currentIndex
        ? "pending"
        : status === "error"
          ? "error"
          : "current"
  );
  const segmentStatuses: SegmentStatus[] = steps.map((_, index) =>
    index < currentIndex
      ? "done"
      : index > currentIndex || status === "error"
        ? "pending"
        : "active"
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Marks and connecting lines: each mark is a fixed-size circle so the
          line touches it exactly, unaffected by label width. */}
      <div className="flex items-center">
        {steps.map((step, index) => (
          <Fragment key={step.key}>
            <StepMark status={markStatuses[index]} />
            {index < steps.length - 1 && (
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                {segmentStatuses[index] === "done" && (
                  <div className="absolute inset-0 rounded-full bg-zinc-900 dark:bg-zinc-50" />
                )}
                {segmentStatuses[index] === "active" && (
                  <div className="animate-progress-slide absolute inset-y-0 w-1/3 rounded-full bg-zinc-900 dark:bg-zinc-50" />
                )}
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* Labels: each sits in a slot matching its mark's width, but the text
          itself is absolutely positioned and free to overflow that slot so
          long labels don't widen the marks/lines row above. */}
      <div className="flex items-start">
        {steps.map((step, index) => {
          const markStatus = markStatuses[index];
          return (
            <Fragment key={step.key}>
              <div className="relative h-5 w-5 shrink-0">
                <span
                  className={`absolute top-0 left-1/2 w-20 -translate-x-1/2 text-center text-xs ${
                    markStatus === "pending"
                      ? "text-zinc-400 dark:text-zinc-600"
                      : markStatus === "error"
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "font-medium text-zinc-900 dark:text-zinc-50"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && <div className="flex-1" />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function StepMark({ status }: { status: MarkStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] text-white dark:bg-zinc-50 dark:text-black">
        ✓
      </span>
    );
  }
  if (status === "current") {
    return (
      <span className="h-5 w-5 shrink-0 rounded-full bg-zinc-900 dark:bg-zinc-50" />
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
        !
      </span>
    );
  }
  return (
    <span className="h-5 w-5 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-700" />
  );
}
