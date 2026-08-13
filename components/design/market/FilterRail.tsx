"use client";

import { useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";

import { Icon } from "../core/Icon";
import { Input } from "../core/Input";
import { Checkbox } from "../core/Checkbox";
import { Switch } from "../core/Switch";

export interface TraitValue {
  label: string;
  count: number | string;
}
export interface TraitGroup {
  name: string;
  values: TraitValue[];
}

export interface FilterRailProps {
  traits: TraitGroup[];
  selected?: Record<string, string[]>;
  onToggle?: (traitName: string, value: string) => void;
  buyNow?: boolean;
  onBuyNow?: (e: ChangeEvent<HTMLInputElement>) => void;
  priceRange?: { min?: string; max?: string };
  onPriceRange?: (range: { min?: string; max?: string }) => void;
  className?: string;
  header?: ReactNode;
  style?: CSSProperties;
}

function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "var(--space-6) var(--space-4)",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-md)",
          fontWeight: "var(--weight-semibold)",
        }}
      >
        <span>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-4)" }}>
          {count != null ? (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>{count}</span>
          ) : null}
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color="var(--text-tertiary)" />
        </span>
      </button>
      {open ? <div style={{ paddingBottom: "var(--space-6)" }}>{children}</div> : null}
    </div>
  );
}

export function FilterRail({ traits = [], selected = {}, onToggle, buyNow, onBuyNow, priceRange, onPriceRange, className, header, style }: FilterRailProps) {
  return (
    <aside
      className={className}
      style={{
        width: "var(--rail-w)",
        flex: "0 0 auto",
        alignSelf: "flex-start",
        position: "sticky",
        top: "calc(var(--nav-h) + var(--subnav-h))",
        maxHeight: "calc(100vh - var(--nav-h) - var(--subnav-h))",
        overflowY: "auto",
        paddingRight: "var(--space-6)",
        ...style,
      }}
    >
      {header}
      <div style={{ padding: "var(--space-6) var(--space-4)", borderBottom: "1px solid var(--border-subtle)" }}>
        <Switch checked={buyNow} onChange={onBuyNow} label="Buy now only" />
      </div>
      <Section title="Price">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "0 var(--space-4)" }}>
          <Input
            size="sm"
            numeric
            suffix="SOL"
            placeholder="Min"
            value={priceRange?.min ?? ""}
            onChange={(e) => onPriceRange?.({ ...priceRange, min: e.target.value })}
            containerStyle={{ flex: 1 }}
          />
          <span style={{ color: "var(--text-tertiary)" }}>–</span>
          <Input
            size="sm"
            numeric
            suffix="SOL"
            placeholder="Max"
            value={priceRange?.max ?? ""}
            onChange={(e) => onPriceRange?.({ ...priceRange, max: e.target.value })}
            containerStyle={{ flex: 1 }}
          />
        </div>
      </Section>
      {traits.map((t) => (
        <Section key={t.name} title={t.name} count={t.values.length}>
          <div style={{ padding: "0 var(--space-2)" }}>
            {t.values.map((v) => (
              <Checkbox
                key={v.label}
                label={v.label}
                count={v.count}
                checked={!!(selected[t.name] || []).includes(v.label)}
                onChange={() => onToggle?.(t.name, v.label)}
              />
            ))}
          </div>
        </Section>
      ))}
    </aside>
  );
}
