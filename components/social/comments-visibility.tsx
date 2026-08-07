"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { Icon } from "@/components/design";

type CommentsVisibilityContextValue = {
  expanded: boolean;
  toggle: () => void;
  count: number;
  setCount: (count: number) => void;
};

const CommentsVisibilityContext =
  createContext<CommentsVisibilityContextValue | null>(null);

// Lets the toggle button (in the top action row) and the comments section
// (rendered lower on the page) share expanded/count state without threading
// props through the server-rendered layout in between.
export function CommentsVisibilityProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(initialCount);
  return (
    <CommentsVisibilityContext.Provider
      value={{ expanded, toggle: () => setExpanded((v) => !v), count, setCount }}
    >
      {children}
    </CommentsVisibilityContext.Provider>
  );
}

function useCommentsVisibility(): CommentsVisibilityContextValue {
  const ctx = useContext(CommentsVisibilityContext);
  if (!ctx) {
    throw new Error(
      "useCommentsVisibility must be used within a CommentsVisibilityProvider"
    );
  }
  return ctx;
}

export function CommentsToggleButton() {
  const { expanded, toggle, count } = useCommentsVisibility();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={expanded}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-4)",
        height: "var(--control-h-md)",
        padding: "0 var(--space-6)",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${expanded ? "var(--accent-2)" : "var(--border-default)"}`,
        background: "var(--surface-2)",
        color: expanded ? "var(--accent-2)" : "var(--text-body)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-md)",
        fontWeight: "var(--weight-semibold)",
        cursor: "pointer",
        transition: "var(--transition-control)",
      }}
    >
      <Icon name="message-circle" size={15} />
      <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-xs)" }}>
        {count}
      </span>
    </button>
  );
}

export function CommentsVisibilityGate({ children }: { children: ReactNode }) {
  const { expanded } = useCommentsVisibility();
  if (!expanded) return null;
  return <>{children}</>;
}

export function useSyncCommentsCount(count: number) {
  const { setCount } = useCommentsVisibility();
  useEffect(() => setCount(count), [count, setCount]);
}
