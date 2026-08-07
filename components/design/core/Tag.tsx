import type { HTMLAttributes, MouseEvent } from "react";

import { Icon } from "./Icon";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  onRemove?: (e: MouseEvent) => void;
  active?: boolean;
}

export function Tag({ children, onRemove, active, style, ...rest }: TagProps) {
  return (
    <span
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-4)",
        height: 26,
        padding: "0 var(--space-5)",
        borderRadius: "var(--radius-control)",
        background: active ? "var(--accent-quiet)" : "var(--surface-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
        color: active ? "var(--accent)" : "var(--text-body)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
      {onRemove ? (
        <span
          onClick={onRemove}
          role="button"
          aria-label="Remove filter"
          style={{ display: "inline-flex", cursor: "pointer", opacity: 0.7 }}
        >
          <Icon name="x" size={12} />
        </span>
      ) : null}
    </span>
  );
}
