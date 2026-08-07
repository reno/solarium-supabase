"use client";

import { useState, type HTMLAttributes } from "react";

import { Icon } from "../core/Icon";

export function truncate(address: string, lead = 4, tail = 4): string {
  if (!address || address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export interface AddressChipProps extends HTMLAttributes<HTMLSpanElement> {
  address: string;
  avatar?: boolean;
  copyable?: boolean;
  ens?: string;
}

export function AddressChip({ address, avatar = true, copyable, ens, style, ...rest }: AddressChipProps) {
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        if (copyable) {
          setCopied(true);
          setTimeout(() => setCopied(false), 900);
        }
      }}
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-4)",
        height: 26,
        padding: avatar ? "0 var(--space-5) 0 3px" : "0 var(--space-5)",
        borderRadius: "var(--radius-pill)",
        background: hover ? "var(--surface-hover)" : "var(--surface-2)",
        border: "1px solid var(--border-default)",
        cursor: copyable ? "pointer" : "default",
        transition: "var(--transition-control)",
        ...style,
      }}
    >
      {avatar ? (
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "var(--radius-pill)",
            flex: "0 0 auto",
            background: "conic-gradient(from 180deg, var(--solar-2), var(--cyan-2), var(--solar-3))",
          }}
        />
      ) : null}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{ens || truncate(address)}</span>
      {copyable ? <Icon name={copied ? "check" : "copy"} size={12} color={copied ? "var(--price-up)" : "var(--text-tertiary)"} /> : null}
    </span>
  );
}
