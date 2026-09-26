"use client";

/**
 * The signed access token is kept in memory first, then mirrored to
 * localStorage. Some browsers block storage entirely (private mode, embedded
 * previews) – reading it from the URL into memory makes every later request
 * work even when no storage is available at all.
 */
let memoryToken: string | null = null;

export function bootstrapAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("t");
  if (fromUrl) {
    memoryToken = fromUrl;
    try {
      window.localStorage.setItem("av_access_token", fromUrl);
    } catch {
      /* storage blocked – the in-memory copy is enough */
    }
    return fromUrl;
  }
  if (memoryToken) return memoryToken;
  try {
    memoryToken = window.localStorage.getItem("av_access_token");
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

/** Install a token handed over by the server (works with all storage blocked). */
export function setAccessToken(token: string | null | undefined) {
  if (!token) return;
  memoryToken = token;
  try {
    window.localStorage.setItem("av_access_token", token);
  } catch {
    /* storage blocked – the in-memory copy is enough for this page view */
  }
}

export function getAccessToken(): string | null {
  return memoryToken ?? bootstrapAccessToken();
}

function guestHeader(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = window.localStorage.getItem("av_guest_images");
    if (raw) {
      const list = JSON.parse(raw) as number[];
      if (Array.isArray(list) && list.length) out["x-guest-images"] = list.join(",");
    }
  } catch {
    /* storage blocked – the token below still proves ownership */
  }
  const token = getAccessToken();
  if (token) out["x-access-token"] = token;
  return out;
}

/** Append the current access token to an internal link. */
export function withToken(path: string): string {
  const token = getAccessToken();
  if (!token) return path;
  return `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

/** Token-aware URL for the original image (used by <img> tags). */
export function sourceUrl(id: number): string {
  const token = getAccessToken();
  return `/api/images/${id}/source${token ? `?t=${encodeURIComponent(token)}` : ""}`;
}

/** api() with automatic retry/backoff for transient rate limits (HTTP 429). */
export async function apiRetry<T>(url: string, init?: RequestInit, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await api<T>(url, init);
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number }).status;
      if (status !== 429 || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...(typeof window === "undefined" ? {} : {}),
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(typeof window === "undefined" ? {} : guestHeader()),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return data as T;
}

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

export function timeAgo(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins} minute${Math.abs(mins) === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours} hour${Math.abs(hours) === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortName(name: string, max = 42): string {
  if (name.length <= max) return name;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}

export function fetchWithGuest(url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: { ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...guestHeader(), ...(init?.headers ?? {}) },
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function logEvent(message: string, kind = "log", meta?: unknown) {
  void fetch("/api/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, kind, meta }),
  }).catch(() => undefined);
}
