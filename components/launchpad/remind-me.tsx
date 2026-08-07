"use client";

import { useEffect, useState } from "react";

import { Button, Switch } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";

// "Remind me" for an upcoming drop (D§5). Notifications are an undesigned surface (D§8), so this is
// deliberately local-only: the preference is persisted to localStorage and confirmed with a toast.
// A real build would register a wallet/push notification; this records intent client-side.

type Remind = { early: boolean };

export function RemindMe({ collectionId, name }: { collectionId: string; name: string }) {
  const key = `solarium:remind:${collectionId}`;
  const { showToast } = useToast();
  const [state, setState] = useState<{ reminded: boolean; early: boolean }>({ reminded: false, early: true });
  const { reminded, early } = state;

  // Read persisted state after mount (avoids SSR/hydration mismatch on localStorage).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Remind;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydrate from localStorage
      setState({ reminded: true, early: parsed.early ?? true });
    } catch {
      // ignore unavailable/corrupt storage
    }
  }, [key]);

  const toggle = () => {
    try {
      if (reminded) {
        localStorage.removeItem(key);
        setState((s) => ({ ...s, reminded: false }));
        showToast({ type: "info", title: "Reminder removed", message: name });
      } else {
        localStorage.setItem(key, JSON.stringify({ early } satisfies Remind));
        setState((s) => ({ ...s, reminded: true }));
        showToast({ type: "success", title: "We'll remind you", message: `${name}${early ? " · 10 min early" : ""}` });
      }
    } catch {
      showToast({ type: "error", title: "Couldn't save", message: "Storage is unavailable." });
    }
  };

  const setEarlyPersist = (next: boolean) => {
    setState((s) => ({ ...s, early: next }));
    if (reminded) {
      try {
        localStorage.setItem(key, JSON.stringify({ early: next } satisfies Remind));
      } catch {
        // ignore
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <Button variant={reminded ? "secondary" : "primary"} block icon={reminded ? "check" : "bell"} onClick={toggle}>
        {reminded ? "Reminder set" : "Remind me"}
      </Button>
      <Switch checked={early} onChange={() => setEarlyPersist(!early)} label="Notify 10 min early" />
    </div>
  );
}
