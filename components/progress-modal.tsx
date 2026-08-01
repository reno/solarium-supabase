"use client";

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-8 text-xl font-medium">{title}</h2>
        <ProgressSteps
          steps={steps}
          currentKey={status === "done" ? null : currentKey}
          status={status === "error" ? "error" : "active"}
        />
        {status === "error" && errorMessage && (
          <p className="mt-6 text-sm text-red-600 dark:text-red-400">
            {errorMessage}
          </p>
        )}
        {status !== "active" && (
          <button
            type="button"
            onClick={onClose}
            className="mt-8 w-full rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
          >
            {status === "error" ? "Close" : "Done"}
          </button>
        )}
      </div>
    </div>
  );
}
