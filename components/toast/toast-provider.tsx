"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Toast, type ToastProps } from "./toast";

type ToastItem = ToastProps & { id: string };

type ToastContextValue = {
  showToast: (props: Omit<ToastProps, "onDismiss">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((props: Omit<ToastProps, "onDismiss">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...props, id }]);
    
    const duration = props.duration ?? 3200;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: "var(--space-8)",
          left: "var(--space-8)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onDismiss={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
