import type { InputHTMLAttributes, ReactNode } from "react";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
}

export function Switch({ checked, onChange, label, style, ...rest }: SwitchProps) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-5)", cursor: "pointer", ...style }}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={onChange}
        {...rest}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          width: 32,
          height: 18,
          borderRadius: "var(--radius-pill)",
          padding: 2,
          background: checked ? "var(--accent)" : "var(--surface-3)",
          border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
          display: "inline-flex",
          alignItems: "center",
          transition: "background-color var(--dur-fast) var(--ease-out)",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "var(--radius-pill)",
            background: checked ? "var(--text-on-accent)" : "var(--text-secondary)",
            transform: checked ? "translateX(14px)" : "translateX(0)",
            transition: "transform var(--dur-fast) var(--ease-out)",
          }}
        />
      </span>
      {label ? <span style={{ fontSize: "var(--text-md)", color: "var(--text-body)" }}>{label}</span> : null}
    </label>
  );
}
