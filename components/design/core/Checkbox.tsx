"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";

import { Icon } from "./Icon";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: ReactNode;
  count?: number | string;
}

export function Checkbox({ checked, onChange, label, count, style, ...rest }: CheckboxProps) {
  const [hover, setHover] = useState(false);
  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-5)",
        cursor: "pointer",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-control)",
        background: hover ? "var(--surface-hover)" : "transparent",
        transition: "var(--transition-control)",
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={onChange}
        {...rest}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          width: 15,
          height: 15,
          flex: "0 0 auto",
          borderRadius: "var(--radius-xs)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? "var(--accent)" : "var(--surface-inset)",
          border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
          transition: "var(--transition-control)",
        }}
      >
        {checked ? <Icon name="check" size={11} color="var(--text-on-accent)" /> : null}
      </span>
      <span style={{ flex: 1, fontSize: "var(--text-md)", color: "var(--text-body)" }}>{label}</span>
      {count != null ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{count}</span>
      ) : null}
    </label>
  );
}
