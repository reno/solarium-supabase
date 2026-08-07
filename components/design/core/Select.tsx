"use client";

import { useState, type SelectHTMLAttributes } from "react";

import { Icon } from "./Icon";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: Array<string | SelectOption>;
  size?: "sm" | "md" | "lg";
}

export function Select({ options = [], value, onChange, size = "md", style, ...rest }: SelectProps) {
  const [hover, setHover] = useState(false);
  const h = size === "sm" ? "var(--control-h-sm)" : size === "lg" ? "var(--control-h-lg)" : "var(--control-h-md)";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        height: h,
        background: hover ? "var(--surface-hover)" : "var(--surface-2)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-control)",
        transition: "var(--transition-control)",
        ...style,
      }}
    >
      <select
        value={value}
        onChange={onChange}
        {...rest}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text-primary)",
          font: "var(--type-label)",
          fontSize: "var(--text-md)",
          padding: "0 30px 0 var(--space-5)",
          height: "100%",
          cursor: "pointer",
        }}
      >
        {options.map((o) => {
          const val = typeof o === "string" ? o : o.value;
          const lab = typeof o === "string" ? o : o.label;
          return (
            <option key={val} value={val} style={{ background: "var(--surface-overlay)" }}>
              {lab}
            </option>
          );
        })}
      </select>
      <Icon
        name="chevron-down"
        size={14}
        color="var(--text-tertiary)"
        style={{ position: "absolute", right: 9, pointerEvents: "none" }}
      />
    </div>
  );
}
