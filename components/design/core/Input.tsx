"use client";

import { useState, type CSSProperties, type InputHTMLAttributes } from "react";

import { Icon } from "./Icon";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  icon?: string;
  suffix?: string;
  size?: "sm" | "md" | "lg";
  numeric?: boolean;
  invalid?: boolean;
  containerStyle?: CSSProperties;
}

export function Input({ icon, suffix, size = "md", numeric, invalid, style, containerStyle, ...rest }: InputProps) {
  const [focus, setFocus] = useState(false);
  const h = size === "sm" ? "var(--control-h-sm)" : size === "lg" ? "var(--control-h-lg)" : "var(--control-h-md)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        height: h,
        padding: "0 var(--space-5)",
        background: "var(--surface-inset)",
        border: `1px solid ${invalid ? "var(--price-down)" : focus ? "var(--border-focus)" : "var(--border-default)"}`,
        borderRadius: "var(--radius-control)",
        transition: "var(--transition-control)",
        ...containerStyle,
      }}
    >
      {icon ? <Icon name={icon} size={14} color="var(--text-tertiary)" /> : null}
      <input
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        {...rest}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text-primary)",
          fontSize: "var(--text-md)",
          fontFamily: numeric ? "var(--font-mono)" : "var(--font-sans)",
          fontVariantNumeric: numeric ? "tabular-nums" : undefined,
          ...style,
        }}
      />
      {suffix ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{suffix}</span>
      ) : null}
    </div>
  );
}
