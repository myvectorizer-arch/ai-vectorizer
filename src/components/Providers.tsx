"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { bootstrapAccessToken } from "@/lib/client";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  credits: number;
  plan: string;
  planPeriod: string;
  planExpiresAt: string | null;
  unlimited: boolean;
  folderAccess: boolean;
  apiKey: string | null;
  isBlocked: boolean;
  totalSpent: number;
  isAdmin: boolean;
};

type Toast = { id: number; message: string; tone: "info" | "success" | "error" };

type AppState = {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
  toast: (message: string, tone?: Toast["tone"]) => void;
  settings: PublicSettings | null;
};

export type PublicSettings = {
  payment?: {
    bkash?: string;
    nogod?: string;
    paypal?: string;
    paypalEnabled?: boolean;
    bdtRate?: number;
    instructions?: string;
  };
  site?: { supportEmail?: string; languages?: string[]; heroTitle?: string; heroLine1?: string; heroLine2?: string };
  vectorizer?: Record<string, number | boolean>;
  defaults?: { base: Record<string, unknown>; render: Record<string, unknown> };
  limits?: { maxUploadMB: number; maxBatch: number; guestFreeImages: number; creditsPerImage: number };
};

const AppContext = createContext<AppState | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as { user: SessionUser | null };
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // capture ?t=<access token> before any other request goes out
    bootstrapAccessToken();
    void refresh();
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PublicSettings) => setSettings(d))
      .catch(() => undefined);
  }, [refresh]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const value = useMemo<AppState>(
    () => ({ user, loading, refresh, setUser, toast, settings }),
    [user, loading, refresh, toast, settings],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`av-fade-up pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-[0_14px_40px_rgba(15,23,42,0.22)] ${
              t.tone === "error"
                ? "bg-[#c0392b] text-white"
                : t.tone === "success"
                  ? "bg-emerald-600 text-white"
                  : "bg-[#111827] text-white"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside Providers");
  return ctx;
}
