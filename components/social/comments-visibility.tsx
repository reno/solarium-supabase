"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-600 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
    >
      <span aria-hidden>💬</span>
      {count}
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
