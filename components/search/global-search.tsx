"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon, IconButton } from "@/components/design";
import { createClient } from "@/lib/supabase/client";

type SearchResult = {
  type: "collection" | "nft" | "profile";
  id: string;
  name: string;
  subtitle?: string;
  href: string;
};

const SEARCH_SYNTAX = /[%_*\\,().:]/g;
const MAX_SEARCH_LENGTH = 64;

function searchTerm(raw: string): string {
  return raw.toLowerCase().replace(SEARCH_SYNTAX, " ").trim().slice(0, MAX_SEARCH_LENGTH);
}

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!searchTerm(query)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous reset on empty query
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const search = async () => {
      const supabase = createClient();
      const q = searchTerm(query);

      const [collectionsRes, nftsRes, profilesRes] = await Promise.all([
        supabase
          .from("collections")
          .select("id, name")
          .ilike("name", `%${q}%`)
          .limit(5),
        supabase
          .from("nfts")
          .select("id, name, collections(name)")
          .ilike("name", `%${q}%`)
          .limit(5),
        supabase
          .from("profiles")
          .select("id, username, wallet_address")
          .ilike("username", `%${q}%`)
          .limit(5),
        supabase
          .from("profiles")
          .select("id, username, wallet_address")
          .ilike("wallet_address", `%${q}%`)
          .limit(5),
      ]).then(([collections, nfts, byUsername, byWallet]) => {
        const seen = new Set<string>();
        const merged = [...(byUsername.data ?? []), ...(byWallet.data ?? [])].filter((row) => {
          if (seen.has(row.id)) return false;
          seen.add(row.id);
          return true;
        });
        return [collections, nfts, { ...byUsername, data: merged.slice(0, 5) }] as const;
      });

      if (cancelled) return;

      const items: SearchResult[] = [];

      (collectionsRes.data ?? []).forEach((c) => {
        items.push({
          type: "collection",
          id: c.id,
          name: c.name,
          href: `/collections/${c.id}`,
        });
      });

      (nftsRes.data ?? []).forEach((n) => {
        const collection = Array.isArray(n.collections) ? n.collections[0] : n.collections;
        items.push({
          type: "nft",
          id: n.id,
          name: n.name,
          subtitle: collection?.name ?? undefined,
          href: `/nft/${n.id}`,
        });
      });

      (profilesRes.data ?? []).forEach((p) => {
        if (p.username) {
          items.push({
            type: "profile",
            id: p.id,
            name: `@${p.username}`,
            subtitle: p.wallet_address ? `${p.wallet_address.slice(0, 4)}…${p.wallet_address.slice(-4)}` : undefined,
            href: `/u/${p.username}`,
          });
        }
      });

      setResults(items);
      setLoading(false);
    };

    const timer = setTimeout(() => {
      void search();
    }, 300);
    
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const dismiss = () => {
    setIsOpen(false);
    setMobileOpen(false);
    setQuery("");
  };

  const inputStyle = {
    width: "100%",
    height: "var(--control-h-md)",
    paddingLeft: "var(--space-10)",
    paddingRight: "var(--space-5)",
    background: "var(--surface-2)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-control)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    color: "var(--text-primary)",
    outline: "none",
  } as const;

  const emptyStyle = {
    padding: "var(--space-7)",
    textAlign: "center",
    color: "var(--text-tertiary)",
    fontSize: "var(--text-sm)",
  } as const;

  const resultList = loading ? (
    <div style={emptyStyle}>Searching...</div>
  ) : results.length === 0 ? (
    <div style={emptyStyle}>No results found</div>
  ) : (
    <ul style={{ listStyle: "none", margin: 0, padding: "var(--space-3)" }}>
      {results.map((result) => (
        <li key={`${result.type}-${result.id}`}>
          <Link
            href={result.href}
            onClick={dismiss}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-5)",
              padding: "var(--space-5)",
              borderRadius: "var(--radius-sm)",
              textDecoration: "none",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon
              name={result.type === "collection" ? "layers" : result.type === "nft" ? "image" : "user"}
              size={16}
              color="var(--text-tertiary)"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-md)",
                  fontWeight: "var(--weight-medium)",
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {result.name}
              </div>
              {result.subtitle && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 2 }}>
                  {result.subtitle}
                </div>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <div ref={containerRef} className="sol-hide-sm" style={{ position: "relative" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Icon
            name="search"
            size={14}
            style={{ position: "absolute", left: "var(--space-5)", color: "var(--text-tertiary)", pointerEvents: "none" }}
          />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
            style={{ ...inputStyle, width: 240 }}
          />
        </div>

        {isOpen && (query.trim() || loading) && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--surface-overlay)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-overlay)",
              maxHeight: 400,
              overflowY: "auto",
            }}
          >
            {resultList}
          </div>
        )}
      </div>

      <IconButton className="sol-only-sm" icon="search" label="Search" onClick={() => setMobileOpen(true)} />

      {mobileOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 120,
                display: "flex",
                flexDirection: "column",
                background: "var(--bg-page)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-5)",
                  padding: "var(--space-6) var(--page-gutter)",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ position: "relative", display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
                  <Icon
                    name="search"
                    size={14}
                    style={{ position: "absolute", left: "var(--space-5)", color: "var(--text-tertiary)", pointerEvents: "none" }}
                  />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search collections, items, people"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <IconButton icon="x" label="Close search" onClick={dismiss} />
              </div>
              <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
                {query.trim() || loading ? (
                  resultList
                ) : (
                  <p style={{ margin: 0, padding: "var(--space-9)", textAlign: "center", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
                    Search collections, items and people.
                  </p>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
