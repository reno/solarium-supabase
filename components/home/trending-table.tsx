"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Card, Select, Tabs, TrendingRow } from "@/components/design";

const COLS = "34px 1fr 96px 74px 104px 74px 78px 92px";
const HEADERS: Array<[string, boolean]> = [
  ["#", false],
  ["Collection", false],
  ["Floor", false],
  ["24h", false],
  ["Volume", true],
  ["Listed", true],
  ["Owners", true],
  ["Trend", true],
];

export type TrendingEntry = {
  collectionId: string;
  rank: number;
  name: string;
  verified: boolean;
  image?: string;
  floor: string;
  delta: string;
  listed: string;
  owners: string;
  series: number[];
  vol24: number;
  vol7d: number;
  vol30: number;
  deltaBps: number;
  createdAt: number;
};

const RANGES = ["24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

export function TrendingTable({ rows }: { rows: TrendingEntry[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("Trending");
  const [range, setRange] = useState<Range>("7d");

  const volFor = (r: TrendingEntry) => (range === "24h" ? r.vol24 : range === "30d" ? r.vol30 : r.vol7d);
  const fmtVol = (v: number) => (v > 0 ? `${v < 1 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")} SOL` : "—");

  const sorted = useMemo(() => {
    const arr = [...rows];
    if (tab === "Top") arr.sort((a, b) => volFor(b) - volFor(a));
    else if (tab === "New") arr.sort((a, b) => b.createdAt - a.createdAt);
    else arr.sort((a, b) => b.deltaBps - a.deltaBps);
    return arr.map((r, i) => ({ ...r, rank: i + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- volFor closes over `range`
  }, [rows, tab, range]);

  return (
    <div>
      <div className="sol-wrap" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--space-5)", marginBottom: "var(--space-7)" }}>
        <Tabs tabs={["Trending", "Top", "New"]} value={tab} onChange={setTab} size="sm" style={{ border: "none" }} />
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          <Select size="sm" options={[...RANGES]} value={range} onChange={(e) => setRange(e.target.value as Range)} />
          <span className="sol-hide-sm">
            <Select size="sm" options={["All chains · Solana"]} />
          </span>
        </div>
      </div>
      <Card padding={0}>
        <div className="sol-row sol-row-trending" style={{ display: "grid", gridTemplateColumns: COLS, gap: "var(--space-6)", padding: "var(--space-6) var(--space-7)", borderBottom: "1px solid var(--border-subtle)" }}>
          {HEADERS.map(([h, hideSm]) => (
            <span key={h} className={hideSm ? "sol-label sol-hide-sm" : "sol-label"} style={{ fontSize: "var(--text-2xs)" }}>{h}</span>
          ))}
        </div>
        {sorted.map((r, i) => (
          <TrendingRow
            key={r.collectionId}
            rank={r.rank}
            name={r.name}
            verified={r.verified}
            image={r.image}
            floor={r.floor}
            delta={r.delta}
            volume={fmtVol(volFor(r))}
            listed={r.listed}
            owners={r.owners}
            series={r.series}
            onClick={() => router.push(`/collections/${r.collectionId}`)}
            style={i === sorted.length - 1 ? { borderBottom: "none" } : undefined}
          />
        ))}
        {sorted.length === 0 && (
          <p style={{ margin: 0, padding: "var(--space-8)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No collections yet.</p>
        )}
      </Card>
    </div>
  );
}
