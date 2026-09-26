"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, FormatBadge, HeartIcon, TrashIcon, UploadIcon } from "@/components/Icons";
import { Card, SectionTitle } from "@/components/Controls";
import { useApp } from "@/components/Providers";
import { api, cls, formatBytes, formatDate, logEvent, shortName, sourceUrl, timeAgo, withToken } from "@/lib/client";

type HistoryImage = {
  id: number;
  batchId: string;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  status: string;
  favorite: boolean;
  stats: { shapes?: number; colors?: number; bytes?: number } | null;
  createdAt: string;
};

type PaymentRow = {
  id: number;
  planName: string;
  amount: number;
  currency: string;
  method: string;
  senderNumber: string | null;
  transactionId: string | null;
  status: string;
  createdAt: string;
};

type ApiKeyRow = { id: number; key: string; label: string; isActive: boolean; requestCount: number; createdAt: string };

const TABS = ["overview", "history", "favorites", "api", "payments"] as const;
type Tab = (typeof TABS)[number];

export function DashboardClient({ initialTab = "overview" }: { initialTab?: Tab }) {
  const { user, refresh, toast } = useApp();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [history, setHistory] = useState<HistoryImage[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hist, pays] = await Promise.all([
        api<{ images: HistoryImage[] }>("/api/history?limit=200"),
        user ? api<{ payments: PaymentRow[] }>("/api/payments") : Promise.resolve({ payments: [] }),
      ]);
      setHistory(hist.images ?? []);
      setPayments(pays.payments ?? []);
      if (user) {
        const k = await api<{ keys: ApiKeyRow[] }>("/api/api-keys");
        setKeys(k.keys ?? []);
      }
    } catch {
      /* keep the page usable */
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const favorites = history.filter((item) => item.favorite);
  const shown = tab === "favorites" ? favorites : history;

  const download = async (image: HistoryImage, format = "svg") => {
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [image.id], format, settings: {} }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${image.filename.replace(/\.[^.]+$/, "")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      logEvent(`History download ${format} for image #${image.id}`, "api");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const toggleFavorite = async (image: HistoryImage) => {
    setHistory((prev) => prev.map((i) => (i.id === image.id ? { ...i, favorite: !i.favorite } : i)));
    try {
      await api(`/api/images/${image.id}`, { method: "PATCH", body: JSON.stringify({ favorite: !image.favorite }) });
    } catch {
      toast("Could not update favorite", "error");
    }
  };

  const remove = async (image: HistoryImage) => {
    setHistory((prev) => prev.filter((i) => i.id !== image.id));
    try {
      await api(`/api/images/${image.id}`, { method: "DELETE" });
      toast("Deleted", "info");
    } catch {
      toast("Could not delete image", "error");
    }
  };

  const expiry = user?.planExpiresAt ? new Date(user.planExpiresAt) : null;
  const daysLeft = expiry ? Math.ceil((expiry.getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[26px] font-bold">Your dashboard</h1>
          <p className="mt-1 text-[13.5px] text-[#4b5563]">
            {user ? `${user.name} · ${user.email}` : "Guest session – log in to keep permanent history"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl bg-[#3b5bfd] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#2f4ae0]"
          >
            <UploadIcon width={16} height={16} /> New vectorization
          </Link>
          <Link
            href="/pricing"
            className="rounded-xl border border-[#e5e7ee] px-5 py-2.5 text-[13px] font-bold text-[#374151] hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
          >
            Upgrade plan
          </Link>
        </div>
      </header>

      <div className="mt-6 flex gap-1 overflow-x-auto rounded-xl bg-[#f4f5f9] p-1">
        {TABS.map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={cls(
              "rounded-lg px-4 py-2 text-[12.5px] font-semibold capitalize transition",
              tab === item ? "bg-white text-[#3b5bfd] shadow-sm" : "text-[#4b5563] hover:bg-white/60",
            )}
          >
            {item === "api" ? "API key" : item}
            {item === "favorites" && favorites.length ? ` (${favorites.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <SectionTitle>Plan & credits</SectionTitle>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-[#fafbfd] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#6b7280]">Current plan</p>
                <p className="mt-1 text-[17px] font-bold capitalize">
                  {user?.plan ? user.plan.replace(/-/g, " ") : "guest"}
                </p>
              </div>
              <div className="rounded-xl bg-[#fafbfd] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#6b7280]">Credits</p>
                <p className="mt-1 text-[17px] font-bold">{user?.unlimited ? "Unlimited ∞" : (user?.credits ?? 0)}</p>
              </div>
              <div className="rounded-xl bg-[#fafbfd] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-[#6b7280]">Renews / expires</p>
                <p className="mt-1 text-[17px] font-bold">{expiry ? `${daysLeft} days` : "—"}</p>
              </div>
            </div>
            <p className="mt-3 text-[12.5px] leading-6 text-[#4b5563]">
              {expiry
                ? `Premium is active until ${formatDate(expiry)}. When the period ends the plan deactivates automatically until the next verified payment.`
                : "Credit packs never expire. Premium plans are activated manually after bKash / Nagad verification."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-semibold">
              <span className={cls("rounded-full px-3 py-1.5", user?.unlimited ? "bg-[#eafaf1] text-[#12864f]" : "bg-[#f4f5f9] text-[#6b7280]")}>
                Unlimited processing {user?.unlimited ? "on" : "off"}
              </span>
              <span className={cls("rounded-full px-3 py-1.5", user?.folderAccess ? "bg-[#eafaf1] text-[#12864f]" : "bg-[#f4f5f9] text-[#6b7280]")}>
                Folder / batch .zip {user?.folderAccess ? "on" : "off"}
              </span>
              <span className="rounded-full bg-[#f4f5f9] px-3 py-1.5 text-[#6b7280]">Total spent ${user?.totalSpent ?? 0}</span>
            </div>
          </Card>

          <Card>
            <SectionTitle>Activity</SectionTitle>
            <div className="mt-4 space-y-2 text-[13px]">
              {[
                ["Images stored", history.length],
                ["Favorites", favorites.length],
                ["Downloads", history.reduce((sum, item) => sum + (item.stats ? 1 : 0), 0)],
                ["Pending payments", payments.filter((p) => p.status === "pending").length],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex items-center justify-between rounded-lg bg-[#fafbfd] px-3 py-2">
                  <span className="text-[#4b5563]">{label}</span>
                  <span className="font-bold">{value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {(tab === "history" || tab === "favorites") && (
        <div className="mt-6">
          <div className="flex items-center gap-3">
            <SectionTitle>{tab === "favorites" ? "Favorites" : "Vectorization history"}</SectionTitle>
            {history.length > 0 && (
              <button
                onClick={async () => {
                  await api("/api/history?all=1", { method: "DELETE" }).catch(() => undefined);
                  setHistory([]);
                  toast("History cleared", "info");
                }}
                className="ml-auto text-[12px] font-semibold text-[#c0392b] underline"
              >
                clear all
              </button>
            )}
          </div>
          {loading ? (
            <p className="mt-4 text-[13px] text-[#6b7280]">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-[#d8dbe6] px-4 py-10 text-center text-[13px] text-[#6b7280]">
              Nothing here yet —{" "}
              <Link href="/" className="font-semibold text-[#3b5bfd] underline">
                vectorize your first image
              </Link>
            </p>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((image) => (
                <div key={image.id} className="rounded-2xl border border-[#eceef4] bg-white p-3">
                  <div className="checkerboard relative h-[150px] overflow-hidden rounded-xl">
                    {image.status === "done" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sourceUrl(image.id)} alt={image.filename} className="h-full w-full object-contain p-2" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sourceUrl(image.id)} alt={image.filename} className="h-full w-full object-contain p-2 opacity-40" />
                    )}
                    <span className="absolute top-2 left-2">
                      <FormatBadge format="svg" size={22} />
                    </span>
                    {image.favorite && (
                      <span className="absolute top-2 right-2 text-[#e5484d]">
                        <HeartIcon width={17} height={17} filled />
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-[13px] font-semibold">{shortName(image.filename, 30)}</p>
                  <p className="text-[11.5px] text-[#6b7280]">
                    {image.width} x {image.height} px · {formatBytes(image.sizeBytes)} · {timeAgo(image.createdAt)}
                  </p>
                  <p className="mt-1 text-[11.5px] text-[#6b7280]">
                    {image.stats?.shapes ? `${image.stats.shapes} shapes · ${image.stats.colors} colours` : image.status}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={withToken(`/result?ids=${image.id}`)}
                      className="rounded-lg border border-[#e5e7ee] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#374151] hover:border-[#3b5bfd]"
                    >
                      Open
                    </Link>
                    <Link
                      href={withToken(`/download?ids=${image.id}&current=${image.id}`)}
                      className="rounded-lg border border-[#e5e7ee] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#374151] hover:border-[#3b5bfd]"
                    >
                      Options
                    </Link>
                    <button
                      onClick={() => void download(image, "svg")}
                      className="flex items-center gap-1.5 rounded-lg bg-[#3b5bfd] px-2.5 py-1.5 text-[11.5px] font-semibold text-white"
                    >
                      <DownloadIcon width={13} height={13} /> SVG
                    </button>
                    <button
                      onClick={() => void download(image, "pdf")}
                      className="rounded-lg border border-[#e5e7ee] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#374151] hover:border-[#3b5bfd]"
                    >
                      PDF
                    </button>
                    <button
                      onClick={() => void toggleFavorite(image)}
                      className={cls(
                        "rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold",
                        image.favorite ? "border-[#e5484d] text-[#e5484d]" : "border-[#e5e7ee] text-[#374151]",
                      )}
                    >
                      <HeartIcon width={13} height={13} filled={image.favorite} />
                    </button>
                    <button
                      onClick={() => void remove(image)}
                      className="rounded-lg border border-[#e5e7ee] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#c0392b]"
                    >
                      <TrashIcon width={13} height={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "api" && (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Card>
            <SectionTitle>API keys</SectionTitle>
            {!user ? (
              <p className="mt-3 text-[13px] text-[#6b7280]">Log in to manage API keys.</p>
            ) : (
              <>
                <div className="mt-3 space-y-2">
                  {keys.map((key) => (
                    <div key={key.id} className="flex items-center gap-2 rounded-xl border border-[#eceef4] px-3 py-2">
                      <code className="flex-1 truncate text-[12.5px]">{key.key}</code>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(key.key);
                          toast("API key copied", "success");
                        }}
                        className="rounded-lg border border-[#e5e7ee] p-1.5 text-[#4b5563]"
                        title="Copy"
                      >
                        <CopyIcon width={14} height={14} />
                      </button>
                      <span className={cls("rounded-full px-2 py-0.5 text-[11px] font-semibold", key.isActive ? "bg-[#eafaf1] text-[#12864f]" : "bg-[#f4f5f9] text-[#6b7280]")}>
                        {key.isActive ? "active" : "revoked"}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={async () => {
                    try {
                      const res = await api<{ key: ApiKeyRow }>("/api/api-keys", { method: "POST" });
                      setKeys((prev) => [{ ...res.key, requestCount: 0 }, ...prev]);
                      await refresh();
                      toast("New API key generated", "success");
                    } catch (error) {
                      toast((error as Error).message, "error");
                    }
                  }}
                  className="mt-4 w-full rounded-xl bg-[#111827] px-4 py-2.5 text-[12.5px] font-bold text-white"
                >
                  Rotate / generate new key
                </button>
              </>
            )}
          </Card>
          <Card>
            <SectionTitle>Quick start</SectionTitle>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#0f172a] p-4 text-[11.5px] leading-5 text-[#d6e4ff]">
{`curl -X POST http://localhost:3000/api/vectorize \\
  -H "content-type: application/json" \\
  -H "x-api-key: ${user?.apiKey ?? "av_your_key"}" \\
  -d '{"imageId": 12, "settings": {"colorCount": 8}}'

curl -X POST http://localhost:3000/api/export \\
  -H "content-type: application/json" \\
  -d '{"ids":[12],"format":"dxf","version":"R12"}' \\
  -o vector.dxf`}
            </pre>
          </Card>
        </div>
      )}

      {tab === "payments" && (
        <div className="mt-6">
          <SectionTitle>Payment requests</SectionTitle>
          {payments.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-[#d8dbe6] px-4 py-10 text-center text-[13px] text-[#6b7280]">
              No payments yet —{" "}
              <Link href="/pricing" className="font-semibold text-[#3b5bfd] underline">
                see pricing
              </Link>
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-[#eceef4] bg-white">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-[#fafbfd] text-[11.5px] uppercase tracking-wider text-[#6b7280]">
                  <tr>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">TrxID</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-t border-[#f1f2f6]">
                      <td className="px-4 py-3 font-semibold">{payment.planName}</td>
                      <td className="px-4 py-3">
                        {payment.currency === "BDT" ? "৳" : "$"}
                        {payment.amount}
                      </td>
                      <td className="px-4 py-3 capitalize">{payment.method}</td>
                      <td className="px-4 py-3 font-mono text-[11.5px]">{payment.transactionId}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cls(
                            "rounded-full px-2.5 py-1 text-[11px] font-bold",
                            payment.status === "approved"
                              ? "bg-[#eafaf1] text-[#12864f]"
                              : payment.status === "rejected"
                                ? "bg-[#fdf2f1] text-[#c0392b]"
                                : "bg-[#fff8e6] text-[#a06a00]",
                          )}
                        >
                          {payment.status === "pending" ? "waiting for admin" : payment.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{formatDate(payment.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {user?.isAdmin && (
        <Card className="mt-6 border-[#dbe3ff] bg-[#f5f7ff]">
          <div className="flex items-center gap-3 text-[13px] text-[#2f4ae0]">
            <CheckIcon width={16} height={16} />
            You are signed in as an administrator.
            <Link href="/admin" className="font-bold underline">
              Open the admin panel →
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
