"use client";

import { Button, Dialog, Icon } from "@/components/design";
import { ProgressSteps, type ProgressStepDef } from "@/components/progress-steps";

export function ProgressModal({
  title,
  steps,
  currentKey,
  status,
  errorMessage,
  onClose,
}: {
  title: string;
  steps: ProgressStepDef[];
  currentKey: string | null;
  status: "active" | "done" | "error";
  errorMessage?: string | null;
  onClose: () => void;
}) {
  const dismissible = status !== "active";

  return (
    <Dialog
      open
      onClose={dismissible ? onClose : undefined}
      title={title}
      footer={
        status === "done" ? (
          <Button variant="primary" block onClick={onClose}>
            Done
          </Button>
        ) : status === "error" ? (
          <Button variant="ghost" block onClick={onClose}>
            Close
          </Button>
        ) : undefined
      }
    >
      <ProgressSteps
        steps={steps}
        currentKey={status === "done" ? null : currentKey}
        status={status === "error" ? "error" : "active"}
      />

      {status === "active" && (
        <p style={{ margin: "var(--space-7) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
          Keep this open — don&apos;t close the tab until it finishes.
        </p>
      )}

      {status === "error" && errorMessage && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--space-4)",
            margin: "var(--space-7) 0 0",
            padding: "var(--space-5)",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface-inset)",
          }}
        >
          <Icon name="alert-circle" size={15} color="var(--price-down)" style={{ position: "relative", top: 1, flex: "0 0 auto" }} />
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--price-down)", wordBreak: "break-word" }}>
            {errorMessage}
          </p>
        </div>
      )}
    </Dialog>
  );
}
