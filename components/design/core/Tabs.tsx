import type { CSSProperties } from "react";

export interface TabsProps {
  tabs: Array<string | { value: string; label: string }>;
  value: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  counts?: Record<string, number | string>;
  style?: CSSProperties;
}

export function Tabs({ tabs = [], value, onChange, size = "md", counts, style }: TabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        borderBottom: "1px solid var(--border-subtle)",
        ...style,
      }}
    >
      {tabs.map((t) => {
        const val = typeof t === "string" ? t : t.value;
        const lab = typeof t === "string" ? t : t.label;
        const sel = val === value;
        return (
          <button
            key={val}
            role="tab"
            aria-selected={sel}
            onClick={() => onChange?.(val)}
            style={{
              position: "relative",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: size === "sm" ? "var(--space-4) 0" : "var(--space-6) 0",
              color: sel ? "var(--text-primary)" : "var(--text-tertiary)",
              fontSize: size === "sm" ? "var(--text-md)" : "var(--text-base)",
              fontWeight: "var(--weight-semibold)",
              fontFamily: "var(--font-sans)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-4)",
              transition: "color var(--dur-fast) var(--ease-out)",
            }}
          >
            {lab}
            {counts && counts[val] != null ? (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                {counts[val]}
              </span>
            ) : null}
            <span
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: -1,
                height: 2,
                background: sel ? "var(--accent)" : "transparent",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
