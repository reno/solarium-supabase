import { Icon } from "@/components/design";

export type ProgressStepDef = { key: string; label: string };
type MarkStatus = "done" | "current" | "pending" | "error";

export function ProgressSteps({
  steps,
  currentKey,
  status,
}: {
  steps: ProgressStepDef[];
  currentKey: string | null;
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      {steps.map((step, index) => {
        const markStatus = markStatuses[index];
        const active = markStatus === "done" || markStatus === "current";
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
            <StepMark status={markStatus} />
            <span
              style={{
                fontSize: "var(--text-sm)",
                color:
                  markStatus === "error"
                    ? "var(--price-down)"
                    : active
                      ? "var(--text-primary)"
                      : "var(--text-tertiary)",
                fontWeight: markStatus === "error" ? "var(--weight-semibold)" : undefined,
              }}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const MARK: React.CSSProperties = {
  width: 18,
  height: 18,
  flex: "0 0 auto",
  borderRadius: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function StepMark({ status }: { status: MarkStatus }) {
  if (status === "done") {
    return (
      <span style={{ ...MARK, background: "var(--accent)" }}>
        <Icon name="check" size={11} color="var(--text-on-accent)" />
      </span>
    );
  }
  if (status === "current") {
    return (
      <span
        style={{
          ...MARK,
          background: "var(--accent-quiet)",
          border: "1px solid var(--accent)",
          boxShadow: "var(--glow-live)",
        }}
      >
        <Icon name="loader-circle" size={11} color="var(--accent)" className="sol-spin" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span style={{ ...MARK, background: "var(--price-down)" }}>
        <Icon name="x" size={11} color="var(--text-on-accent)" />
      </span>
    );
  }
  return (
    <span style={{ ...MARK, background: "var(--surface-3)", border: "1px solid var(--border-subtle)" }} />
  );
}
