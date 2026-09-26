"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CloseIcon, CopyIcon, LogoIcon, SparkIcon } from "@/components/Icons";
import { Card, NumberField, SectionTitle, Slider, Toggle } from "@/components/Controls";
import { useApp } from "@/components/Providers";
import { api, cls, formatDate, timeAgo } from "@/lib/client";

type Stats = {
  totals: Record<string, number>;
  premiumUsers: {
    id: number;
    name: string;
    email: string;
    plan: string;
    planStartedAt: string | null;
    planExpiresAt: string | null;
    unlimited: boolean;
    folderAccess: boolean;
    totalSpent: number;
  }[];
  pendingPayments: PaymentRow[];
  payments: PaymentRow[];
  formatStats: { format: string; n: number }[];
  revenueByMethod: { method: string; total: number; n: number }[];
  daily: { day: string; n: number }[];
  recentUsers: { id: number; name: string; email: string; plan: string; createdAt: string }[];
  recentLogs: LogRow[];
  tickets: TicketRow[];
};

type PaymentRow = {
  id: number;
  userId: number;
  email: string | null;
  name: string | null;
  planName: string;
  planSlug: string;
  amount: number;
  currency: string;
  method: string;
  senderNumber: string | null;
  transactionId: string | null;
  status: string;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  provider: string;
  credits: number;
  plan: string;
  planExpiresAt: string | null;
  planStartedAt: string | null;
  unlimited: boolean;
  folderAccess: boolean;
  isBlocked: boolean;
  totalSpent: number;
  createdAt: string;
  apiKey: string | null;
  images: number;
};

type PlanRow = {
  id: number;
  slug: string;
  name: string;
  price: number;
  priceBdt: number;
  currency: string;
  period: string;
  credits: number;
  unlimited: boolean;
  folderAccess: boolean;
  features: string[];
  highlight: boolean;
  isActive: boolean;
  sortOrder: number;
};

type LogRow = {
  id: number;
  userId: number | null;
  kind: string;
  level: string;
  message: string;
  endpoint: string | null;
  durationMs: number | null;
  createdAt: string;
};

type TicketRow = {
  id: number;
  userId: number | null;
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  imageId: number | null;
  status: string;
  priority: string;
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

type WithdrawRow = {
  id: number;
  amount: number;
  method: string;
  accountNumber: string;
  status: string;
  note: string | null;
  createdAt: string;
};

const TABS = ["dashboard", "payments", "users", "support", "pricing", "settings", "logs", "withdraw", "usage"] as const;
type Tab = (typeof TABS)[number];

export function AdminClient() {
  const { toast } = useApp();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [withdrawals, setWithdrawals] = useState<{ rows: WithdrawRow[]; paid: number; pending: number }>({
    rows: [],
    paid: 0,
    pending: 0,
  });
  const [usage, setUsage] = useState<{
    byEndpoint: { endpoint: string | null; n: number; avgMs: number }[];
    keys: { id: number; key: string; userId: number; requestCount: number; isActive: boolean }[];
  } | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketFilter, setTicketFilter] = useState("all");
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");
  const [newPlan, setNewPlan] = useState({ name: "", price: 0, period: "monthly", credits: 0, unlimited: true, folderAccess: true });
  const [withdrawForm, setWithdrawForm] = useState({ amount: 0, method: "bkash", accountNumber: "" });
  const [notice, setNotice] = useState({ title: "", body: "" });

  const load = useCallback(
    async (which: Tab) => {
      try {
        if (which === "dashboard" || which === "payments") {
          setStats(await api<Stats>("/api/admin/stats"));
        } else if (which === "users") {
          const res = await api<{ users: UserRow[] }>(`/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
          setUsers(res.users);
        } else if (which === "pricing") {
          const res = await api<{ plans: PlanRow[] }>("/api/admin/plans");
          setPlans(res.plans);
        } else if (which === "settings") {
          const res = await api<{ settings: Record<string, Record<string, unknown>> }>("/api/admin/settings");
          setSettings(res.settings);
        } else if (which === "support") {
          const res = await api<{ tickets: TicketRow[] }>("/api/admin/support");
          setTickets(res.tickets);
        } else if (which === "logs") {
          const res = await api<{ logs: LogRow[] }>("/api/admin/logs");
          setLogs(res.logs);
        } else if (which === "withdraw") {
          const res = await api<{ withdrawals: WithdrawRow[]; paid: number; pending: number }>("/api/admin/withdrawals");
          setWithdrawals({ rows: res.withdrawals, paid: res.paid, pending: res.pending });
        } else if (which === "usage") {
          const res = await api<{
            byEndpoint: { endpoint: string | null; n: number; avgMs: number }[];
            keys: { id: number; key: string; userId: number; requestCount: number; isActive: boolean }[];
          }>("/api/admin/usage");
          setUsage({ byEndpoint: res.byEndpoint, keys: res.keys });
        }
      } catch (error) {
        toast((error as Error).message, "error");
      }
    },
    [query, toast],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load(tab);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, load]);

  const review = async (id: number, status: "approved" | "rejected") => {
    try {
      await api("/api/admin/payments", { method: "PATCH", body: JSON.stringify({ id, status }) });
      toast(status === "approved" ? "Payment approved – premium activated" : "Payment rejected", status === "approved" ? "success" : "info");
      await load("dashboard");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const updateTicket = async (id: number, patch: Record<string, unknown>) => {
    try {
      await api("/api/admin/support", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
      toast("Ticket updated", "success");
      await load("support");
      await load("dashboard");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const patchUser = async (id: number, patch: Record<string, unknown>) => {
    try {
      await api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
      toast("User updated", "success");
      await load("users");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const patchPlan = async (id: number, patch: Record<string, unknown>) => {
    try {
      await api("/api/admin/plans", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
      toast("Plan saved", "success");
      await load("pricing");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const saveSetting = async (key: string, value: Record<string, unknown>) => {
    try {
      await api("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ key, value }) });
      toast(`${key} settings saved`, "success");
      await load("settings");
    } catch (error) {
      toast((error as Error).message, "error");
    }
  };

  const totals = stats?.totals ?? {};
  const maxDaily = Math.max(1, ...(stats?.daily ?? []).map((d) => d.n));

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      <header className="border-b border-[#e5e7ee] bg-white px-4 py-3">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3">
          <LogoIcon size={24} />
          <span className="text-[15px] font-bold">AI Vectorizer · Admin</span>
          <span className="rounded-full bg-[#eef2ff] px-3 py-1 text-[11.5px] font-bold text-[#2f4ae0]">manual payment control</span>
          <Link
            href="/"
            className="ml-auto rounded-lg border border-[#e5e7ee] px-3 py-1.5 text-[12px] font-semibold text-[#4b5563] hover:border-[#3b5bfd]"
          >
            Back to site
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] px-4 py-6">
        <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm">
          {TABS.map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={cls(
                "rounded-lg px-4 py-2 text-[12.5px] font-semibold capitalize transition",
                tab === item ? "bg-[#3b5bfd] text-white" : "text-[#4b5563] hover:bg-[#f5f6fa]",
              )}
            >
              {item}
            </button>
          ))}
        </div>

        {tab === "dashboard" && stats && (
          <div className="mt-6 space-y-6">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {[
                ["Total users", totals.users],
                ["Premium users", totals.premiumUsers],
                ["Pending payments", totals.pendingPayments],
                ["Revenue (all time)", `$${totals.revenue}`],
                ["Revenue (30 days)", `$${totals.monthlyRevenue}`],
                ["Credits outstanding", totals.credits],
                ["Images processed", totals.processed],
                ["Downloads", totals.downloads],
                ["Open support tickets", totals.openTickets],
                ["Avg process time", `${totals.avgProcessMs} ms`],
                ["Profit (rev - withdrawn)", `$${totals.profit}`],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-[#eceef4] bg-white p-4">
                  <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#6b7280]">{label}</p>
                  <p className="mt-1.5 text-[20px] font-bold">{String(value ?? 0)}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <SectionTitle>Pending payments (bKash / Nagad manual verification)</SectionTitle>
                {stats.pendingPayments.length === 0 ? (
                  <p className="mt-3 text-[13px] text-[#6b7280]">No requests waiting.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {stats.pendingPayments.map((payment) => (
                      <div key={payment.id} className="rounded-xl border border-[#eceef4] p-3">
                        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                          <span className="font-bold">{payment.planName}</span>
                          <span className="rounded-full bg-[#f4f5f9] px-2 py-0.5 font-semibold">{payment.method}</span>
                          <span className="font-semibold">${payment.amount}</span>
                          <span className="text-[#6b7280]">{timeAgo(payment.createdAt)}</span>
                          <div className="ml-auto flex gap-2">
                            <button
                              onClick={() => void review(payment.id, "approved")}
                              className="flex items-center gap-1.5 rounded-lg bg-[#12864f] px-3 py-1.5 text-[11.5px] font-bold text-white"
                            >
                              <CheckIcon width={13} height={13} /> Approve
                            </button>
                            <button
                              onClick={() => void review(payment.id, "rejected")}
                              className="flex items-center gap-1.5 rounded-lg border border-[#e5484d] px-3 py-1.5 text-[11.5px] font-bold text-[#e5484d]"
                            >
                              <CloseIcon width={13} height={13} /> Reject
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-[12px] text-[#4b5563]">
                          {payment.name ?? "—"} · {payment.email ?? "—"} · sender {payment.senderNumber ?? "—"} · TrxID{" "}
                          <span className="font-mono font-semibold">{payment.transactionId ?? "—"}</span>
                        </p>
                        {payment.adminNote && <p className="mt-1 text-[11.5px] text-[#6b7280]">note: {payment.adminNote}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <SectionTitle>Who bought premium & when it expires</SectionTitle>
                <div className="mt-3 max-h-[320px] overflow-y-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead className="text-[11px] uppercase tracking-wider text-[#6b7280]">
                      <tr>
                        <th className="py-2">User</th>
                        <th className="py-2">Plan</th>
                        <th className="py-2">Bought</th>
                        <th className="py-2">Expires</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.premiumUsers.map((user) => (
                        <tr key={user.id} className="border-t border-[#f1f2f6]">
                          <td className="py-2">
                            <span className="font-semibold">{user.name}</span>
                            <br />
                            <span className="text-[11px] text-[#6b7280]">{user.email}</span>
                          </td>
                          <td className="py-2 capitalize">{user.plan.replace(/-/g, " ")}</td>
                          <td className="py-2">{formatDate(user.planStartedAt)}</td>
                          <td className="py-2">{formatDate(user.planExpiresAt)}</td>
                        </tr>
                      ))}
                      {stats.premiumUsers.length === 0 && (
                        <tr>
                          <td className="py-3 text-[#6b7280]" colSpan={4}>
                            No premium users yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card>
                <SectionTitle>Images per day (14 days)</SectionTitle>
                <div className="mt-4 flex h-[130px] items-end gap-1.5">
                  {stats.daily.map((day) => (
                    <div key={day.day} className="flex-1" title={`${day.day}: ${day.n}`}>
                      <div className="rounded-t bg-[#3b5bfd]" style={{ height: `${(day.n / maxDaily) * 118}px` }} />
                    </div>
                  ))}
                  {stats.daily.length === 0 && <p className="text-[12.5px] text-[#6b7280]">No data yet.</p>}
                </div>
              </Card>
              <Card>
                <SectionTitle>Downloads by format</SectionTitle>
                <div className="mt-3 space-y-2 text-[12.5px]">
                  {stats.formatStats.map((row) => (
                    <div key={row.format} className="flex items-center justify-between rounded-lg bg-[#fafbfd] px-3 py-2">
                      <span className="font-semibold uppercase">{row.format}</span>
                      <span>{row.n}</span>
                    </div>
                  ))}
                  {stats.formatStats.length === 0 && <p className="text-[#6b7280]">No downloads yet.</p>}
                </div>
                <SectionTitle>Revenue by method</SectionTitle>
                <div className="mt-3 space-y-2 text-[12.5px]">
                  {stats.revenueByMethod.map((row) => (
                    <div key={row.method} className="flex items-center justify-between rounded-lg bg-[#fafbfd] px-3 py-2">
                      <span className="font-semibold capitalize">{row.method}</span>
                      <span>
                        ${row.total} · {row.n} payments
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <SectionTitle>Latest activity</SectionTitle>
                <div className="mt-3 space-y-2 text-[12px]">
                  {stats.recentLogs.map((entry) => (
                    <div key={entry.id} className="rounded-lg bg-[#fafbfd] px-3 py-2">
                      <p className="font-medium text-[#374151]">{entry.message}</p>
                      <p className="text-[11px] text-[#6b7280]">
                        {entry.kind} {entry.endpoint ? `· ${entry.endpoint}` : ""} · {timeAgo(entry.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === "payments" && stats && (
          <Card className="mt-6">
            <SectionTitle>All payment requests</SectionTitle>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wider text-[#6b7280]">
                  <tr>
                    <th className="py-2">#</th>
                    <th className="py-2">User</th>
                    <th className="py-2">Plan</th>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Method</th>
                    <th className="py-2">Sender</th>
                    <th className="py-2">TrxID</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.payments.map((payment) => (
                    <tr key={payment.id} className="border-t border-[#f1f2f6]">
                      <td className="py-2">{payment.id}</td>
                      <td className="py-2">
                        {payment.name ?? "—"}
                        <br />
                        <span className="text-[11px] text-[#6b7280]">{payment.email ?? "—"}</span>
                      </td>
                      <td className="py-2">{payment.planName}</td>
                      <td className="py-2">
                        ${payment.amount} ({payment.currency})
                      </td>
                      <td className="py-2 capitalize">{payment.method}</td>
                      <td className="py-2 font-mono">{payment.senderNumber ?? "—"}</td>
                      <td className="py-2 font-mono font-semibold">{payment.transactionId ?? "—"}</td>
                      <td className="py-2">
                        <span
                          className={cls(
                            "rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                            payment.status === "approved"
                              ? "bg-[#eafaf1] text-[#12864f]"
                              : payment.status === "rejected"
                                ? "bg-[#fdf2f1] text-[#c0392b]"
                                : "bg-[#fff8e6] text-[#a06a00]",
                          )}
                        >
                          {payment.status}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1.5">
                          <button onClick={() => void review(payment.id, "approved")} className="rounded-md bg-[#12864f] px-2 py-1 text-[11px] font-bold text-white">
                            Approve
                          </button>
                          <button onClick={() => void review(payment.id, "rejected")} className="rounded-md border border-[#e5484d] px-2 py-1 text-[11px] font-bold text-[#e5484d]">
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === "users" && (
          <Card className="mt-6">
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle>User management</SectionTitle>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search email or name"
                className="ml-auto w-56 rounded-lg border border-[#dcdfe8] px-3 py-2 text-[12.5px]"
              />
              <button onClick={() => void load("users")} className="rounded-lg bg-[#111827] px-4 py-2 text-[12px] font-bold text-white">
                Search
              </button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wider text-[#6b7280]">
                  <tr>
                    <th className="py-2">User</th>
                    <th className="py-2">Credits</th>
                    <th className="py-2">Plan</th>
                    <th className="py-2">Expires</th>
                    <th className="py-2">Images</th>
                    <th className="py-2">Folder</th>
                    <th className="py-2">Spent</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-[#f1f2f6]">
                      <td className="py-2">
                        <input
                          defaultValue={user.name}
                          onBlur={(e) => {
                            if (e.target.value !== user.name) void patchUser(user.id, { name: e.target.value });
                          }}
                          className="w-32 rounded-md border border-transparent px-1 py-0.5 font-semibold hover:border-[#dcdfe8]"
                        />
                        <br />
                        <span className="text-[11px] text-[#6b7280]">
                          {user.email} {user.role === "admin" ? "· admin" : ""}
                        </span>
                      </td>
                      <td className="py-2">
                        <input
                          type="number"
                          defaultValue={user.credits}
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (next !== user.credits) void patchUser(user.id, { credits: next });
                          }}
                          className="w-20 rounded-md border border-[#dcdfe8] px-1 py-0.5"
                        />
                      </td>
                      <td className="py-2 capitalize">{user.plan.replace(/-/g, " ")}</td>
                      <td className="py-2">{formatDate(user.planExpiresAt)}</td>
                      <td className="py-2">{user.images}</td>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={user.folderAccess}
                          onChange={(e) => void patchUser(user.id, { folderAccess: e.target.checked })}
                        />
                      </td>
                      <td className="py-2">${user.totalSpent}</td>
                      <td className="py-2">
                        <span className={cls("rounded-full px-2 py-0.5 text-[10.5px] font-bold", user.isBlocked ? "bg-[#fdf2f1] text-[#c0392b]" : "bg-[#eafaf1] text-[#12864f]")}>
                          {user.isBlocked ? "blocked" : "active"}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => void patchUser(user.id, { isBlocked: !user.isBlocked })}
                            className={cls(
                              "rounded-md px-2 py-1 text-[11px] font-bold",
                              user.isBlocked ? "bg-[#12864f] text-white" : "border border-[#c0392b] text-[#c0392b]",
                            )}
                          >
                            {user.isBlocked ? "Unblock" : "Block"}
                          </button>
                          <button
                            onClick={() => void patchUser(user.id, { extendDays: 30, unlimited: true, plan: "standard-unlimited" })}
                            className="rounded-md border border-[#3b5bfd] px-2 py-1 text-[11px] font-bold text-[#3b5bfd]"
                          >
                            +30 days
                          </button>
                          <button
                            onClick={() => void patchUser(user.id, { unlimited: !user.unlimited })}
                            className="rounded-md border border-[#e5e7ee] px-2 py-1 text-[11px] font-bold text-[#4b5563]"
                          >
                            {user.unlimited ? "Remove unlimited" : "Make unlimited"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === "pricing" && (
          <div className="mt-6 space-y-5">
            <Card>
              <SectionTitle>Pricing plans (edit live)</SectionTitle>
              <div className="mt-4 space-y-3">
                {plans.map((plan) => (
                  <div key={plan.id} className="rounded-xl border border-[#eceef4] p-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <NumberField label="Price $" value={plan.price} min={0} step={1} onChange={(price) => void patchPlan(plan.id, { price })} />
                      <NumberField label="Price ৳ (bKash)" value={plan.priceBdt} min={0} step={50} onChange={(priceBdt) => void patchPlan(plan.id, { priceBdt })} />
                      <NumberField label="Credits" value={plan.credits} min={0} onChange={(credits) => void patchPlan(plan.id, { credits })} />
                      <NumberField label="Sort" value={plan.sortOrder} min={0} onChange={(sortOrder) => void patchPlan(plan.id, { sortOrder })} />
                      <label className="space-y-1.5">
                        <span className="block text-[13px] font-semibold text-[#374151]">Name</span>
                        <input
                          defaultValue={plan.name}
                          onBlur={(e) => e.target.value !== plan.name && void patchPlan(plan.id, { name: e.target.value })}
                          className="rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="block text-[13px] font-semibold text-[#374151]">Period</span>
                        <select
                          value={plan.period}
                          onChange={(e) => void patchPlan(plan.id, { period: e.target.value })}
                          className="rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                        >
                          <option value="none">one-off</option>
                          <option value="monthly">monthly</option>
                          <option value="semiannual">6 months</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4">
                      <Toggle label="Unlimited" checked={plan.unlimited} onChange={(unlimited) => void patchPlan(plan.id, { unlimited })} />
                      <Toggle label="Folder access" checked={plan.folderAccess} onChange={(folderAccess) => void patchPlan(plan.id, { folderAccess })} />
                      <Toggle label="Highlight" checked={plan.highlight} onChange={(highlight) => void patchPlan(plan.id, { highlight })} />
                      <Toggle label="Active" checked={plan.isActive} onChange={(isActive) => void patchPlan(plan.id, { isActive })} />
                      <button
                        onClick={async () => {
                          await api(`/api/admin/plans?id=${plan.id}`, { method: "DELETE" }).catch(() => undefined);
                          toast("Plan deleted", "info");
                          await load("pricing");
                        }}
                        className="ml-auto rounded-lg border border-[#e5484d] px-3 py-1.5 text-[11.5px] font-bold text-[#e5484d]"
                      >
                        Delete plan
                      </button>
                    </div>
                    <label className="mt-3 block space-y-1.5">
                      <span className="block text-[12.5px] font-semibold text-[#374151]">Features (one per line)</span>
                      <textarea
                        defaultValue={plan.features.join("\n")}
                        rows={3}
                        onBlur={(e) => void patchPlan(plan.id, { features: e.target.value.split("\n").filter(Boolean) })}
                        className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[12.5px]"
                      />
                    </label>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionTitle>Add a new plan / button</SectionTitle>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="space-y-1.5">
                  <span className="block text-[13px] font-semibold text-[#374151]">Name</span>
                  <input
                    value={newPlan.name}
                    onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
                    className="rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                  />
                </label>
                <NumberField label="Price $" value={newPlan.price} onChange={(price) => setNewPlan({ ...newPlan, price })} />
                <NumberField label="Credits" value={newPlan.credits} onChange={(credits) => setNewPlan({ ...newPlan, credits })} />
                <SegmentedPeriod value={newPlan.period} onChange={(period) => setNewPlan({ ...newPlan, period })} />
                <Toggle label="Unlimited" checked={newPlan.unlimited} onChange={(unlimited) => setNewPlan({ ...newPlan, unlimited })} />
                <Toggle label="Folder" checked={newPlan.folderAccess} onChange={(folderAccess) => setNewPlan({ ...newPlan, folderAccess })} />
                <button
                  onClick={async () => {
                    try {
                      await api("/api/admin/plans", { method: "POST", body: JSON.stringify(newPlan) });
                      toast("Plan created", "success");
                      setNewPlan({ name: "", price: 0, period: "monthly", credits: 0, unlimited: true, folderAccess: true });
                      await load("pricing");
                    } catch (error) {
                      toast((error as Error).message, "error");
                    }
                  }}
                  className="flex items-center gap-2 rounded-lg bg-[#3b5bfd] px-4 py-2.5 text-[12.5px] font-bold text-white"
                >
                  <SparkIcon width={15} height={15} /> Create plan
                </button>
              </div>
            </Card>

            <Card>
              <SectionTitle>Payment numbers & PayPal</SectionTitle>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["bkash", "bKash number"],
                  ["nogod", "Nagad number"],
                  ["paypal", "PayPal account"],
                ].map(([key, label]) => (
                  <label key={key} className="space-y-1.5">
                    <span className="block text-[13px] font-semibold text-[#374151]">{label}</span>
                    <input
                      defaultValue={String((settings.payment?.[key] as string) ?? "")}
                      onBlur={(e) => void saveSetting("payment", { [key]: e.target.value })}
                      className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                    />
                  </label>
                ))}
                <NumberField
                  label="BDT per USD"
                  value={Number(settings.payment?.bdtRate ?? 120)}
                  onChange={(bdtRate) => void saveSetting("payment", { bdtRate })}
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Toggle
                  label="Enable PayPal checkout"
                  checked={Boolean(settings.payment?.paypalEnabled)}
                  onChange={(paypalEnabled) => void saveSetting("payment", { paypalEnabled })}
                />
                <span className="text-[11.5px] text-[#6b7280]">
                  PayPal stays in the UI but is inactive until you tick this and configure a real merchant account.
                </span>
              </div>
              <label className="mt-4 block space-y-1.5">
                <span className="block text-[13px] font-semibold text-[#374151]">Payment instructions shown to users</span>
                <textarea
                  defaultValue={String(settings.payment?.instructions ?? "")}
                  rows={2}
                  onBlur={(e) => void saveSetting("payment", { instructions: e.target.value })}
                  className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[12.5px]"
                />
              </label>
            </Card>
          </div>
        )}

        {tab === "settings" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <SectionTitle>Vectorizer engine settings</SectionTitle>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="Max upload MB"
                  value={Number(settings.vectorizer?.maxUploadMB ?? 25)}
                  onChange={(maxUploadMB) => void saveSetting("vectorizer", { maxUploadMB })}
                />
                <NumberField
                  label="Max images per batch"
                  value={Number(settings.vectorizer?.maxBatch ?? 60)}
                  onChange={(maxBatch) => void saveSetting("vectorizer", { maxBatch })}
                />
                <NumberField
                  label="Free credits on signup"
                  value={Number(settings.vectorizer?.freeCredits ?? 5)}
                  onChange={(freeCredits) => void saveSetting("vectorizer", { freeCredits })}
                />
                <NumberField
                  label="Credits per image"
                  value={Number(settings.vectorizer?.creditsPerImage ?? 1)}
                  onChange={(creditsPerImage) => void saveSetting("vectorizer", { creditsPerImage })}
                />
                <NumberField
                  label="Guest free images / 24h"
                  value={Number(settings.vectorizer?.guestFreeImages ?? 3)}
                  onChange={(guestFreeImages) => void saveSetting("vectorizer", { guestFreeImages })}
                />
                <NumberField
                  label="Default detail level"
                  value={Number(settings.vectorizer?.detailLevel ?? 7)}
                  min={0}
                  max={10}
                  onChange={(detailLevel) => void saveSetting("vectorizer", { detailLevel })}
                />
                <NumberField
                  label="Default colour count"
                  value={Number(settings.vectorizer?.colorCount ?? 8)}
                  min={2}
                  max={32}
                  onChange={(colorCount) => void saveSetting("vectorizer", { colorCount })}
                />
                <NumberField
                  label="Default noise"
                  value={Number(settings.vectorizer?.noise ?? 3)}
                  min={0}
                  max={10}
                  onChange={(noise) => void saveSetting("vectorizer", { noise })}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-4">
                <Toggle
                  label="GPU processing"
                  checked={Boolean(settings.vectorizer?.gpuEnabled ?? true)}
                  onChange={(gpuEnabled) => void saveSetting("vectorizer", { gpuEnabled })}
                />
                <Toggle
                  label="Multi thread"
                  checked={Boolean(settings.vectorizer?.multiThread ?? true)}
                  onChange={(multiThread) => void saveSetting("vectorizer", { multiThread })}
                />
                <Toggle
                  label="Async queue"
                  checked={Boolean(settings.vectorizer?.asyncQueue ?? true)}
                  onChange={(asyncQueue) => void saveSetting("vectorizer", { asyncQueue })}
                />
                <Toggle
                  label="Redis cache"
                  checked={Boolean(settings.vectorizer?.redisCache ?? true)}
                  onChange={(redisCache) => void saveSetting("vectorizer", { redisCache })}
                />
                <Toggle
                  label="CDN"
                  checked={Boolean(settings.vectorizer?.cdnEnabled ?? true)}
                  onChange={(cdnEnabled) => void saveSetting("vectorizer", { cdnEnabled })}
                />
              </div>
            </Card>

            <div className="space-y-5">
              <Card>
                <SectionTitle>Homepage content</SectionTitle>
                <div className="mt-4 space-y-3">
                  {[
                    ["heroTitle", "Hero title"],
                    ["heroLine1", "Hero line 1"],
                    ["heroLine2", "Hero line 2"],
                    ["supportEmail", "Support email"],
                  ].map(([key, label]) => (
                    <label key={key} className="block space-y-1.5">
                      <span className="block text-[12.5px] font-semibold text-[#374151]">{label}</span>
                      <input
                        defaultValue={String((settings.site?.[key] as string) ?? "")}
                        onBlur={(e) => void saveSetting("site", { [key]: e.target.value })}
                        className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                      />
                    </label>
                  ))}
                </div>
              </Card>

              <Card>
                <SectionTitle>Publish a notice / new feature banner</SectionTitle>
                <div className="mt-4 space-y-3">
                  <input
                    value={notice.title}
                    onChange={(e) => setNotice({ ...notice, title: e.target.value })}
                    placeholder="Title (e.g. New: DXF 2021 support)"
                    className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                  />
                  <textarea
                    value={notice.body}
                    onChange={(e) => setNotice({ ...notice, body: e.target.value })}
                    rows={2}
                    placeholder="Short description shown on the homepage"
                    className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          await api("/api/admin/notices", { method: "POST", body: JSON.stringify(notice) });
                          toast("Notice published on the homepage", "success");
                          setNotice({ title: "", body: "" });
                        } catch (error) {
                          toast((error as Error).message, "error");
                        }
                      }}
                      className="rounded-lg bg-[#3b5bfd] px-4 py-2 text-[12.5px] font-bold text-white"
                    >
                      Publish notice
                    </button>
                    <button
                      onClick={async () => {
                        await api("/api/admin/notices", { method: "DELETE" }).catch(() => undefined);
                        toast("Notices cleared", "info");
                      }}
                      className="rounded-lg border border-[#e5e7ee] px-4 py-2 text-[12.5px] font-bold text-[#4b5563]"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              </Card>

              <Card>
                <SectionTitle>Manual premium grant</SectionTitle>
                <GrantForm onDone={() => void load("users")} />
              </Card>
            </div>
          </div>
        )}

        {tab === "support" && (
          <div className="mt-6 space-y-5">
            <Card>
              <div className="flex flex-wrap items-center gap-3">
                <SectionTitle>Support inbox</SectionTitle>
                <div className="ml-auto flex flex-wrap gap-1 rounded-xl bg-[#f4f5f9] p-1">
                  {["all", "open", "in_progress", "closed"].map((option) => (
                    <button
                      key={option}
                      onClick={() => setTicketFilter(option)}
                      className={cls(
                        "rounded-lg px-3 py-1.5 text-[12px] font-semibold capitalize",
                        ticketFilter === option ? "bg-white text-[#3b5bfd] shadow-sm" : "text-[#4b5563]",
                      )}
                    >
                      {option.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[12.5px] text-[#6b7280]">
                Every message from the Support page lands here. Reply and the answer is visible to the user instantly.
              </p>
              <div className="mt-4 space-y-3">
                {tickets
                  .filter((ticket) => ticketFilter === "all" || ticket.status === ticketFilter)
                  .map((ticket) => (
                    <div key={ticket.id} className="rounded-xl border border-[#eceef4] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-bold">
                          #{ticket.id} · {ticket.subject}
                        </span>
                        <span className="rounded-full bg-[#f4f5f9] px-2 py-0.5 text-[11px] font-semibold capitalize">
                          {ticket.category}
                        </span>
                        <span
                          className={cls(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                            ticket.status === "closed"
                              ? "bg-[#eafaf1] text-[#12864f]"
                              : ticket.status === "in_progress"
                                ? "bg-[#fff8e6] text-[#a06a00]"
                                : "bg-[#eef2ff] text-[#2f4ae0]",
                          )}
                        >
                          {ticket.status.replace("_", " ")}
                        </span>
                        <span className="text-[11.5px] text-[#6b7280]">{timeAgo(ticket.createdAt)}</span>
                        <div className="ml-auto flex gap-1.5">
                          <select
                            value={ticket.priority}
                            onChange={(e) => void updateTicket(ticket.id, { priority: e.target.value })}
                            className="rounded-md border border-[#dcdfe8] px-2 py-1 text-[11.5px]"
                          >
                            <option value="low">low</option>
                            <option value="normal">normal</option>
                            <option value="high">high</option>
                          </select>
                          <button
                            onClick={() => void updateTicket(ticket.id, { status: "in_progress" })}
                            className="rounded-md border border-[#3b5bfd] px-2 py-1 text-[11px] font-bold text-[#3b5bfd]"
                          >
                            In progress
                          </button>
                          <button
                            onClick={() => void updateTicket(ticket.id, { status: "closed" })}
                            className="rounded-md bg-[#12864f] px-2 py-1 text-[11px] font-bold text-white"
                          >
                            Close
                          </button>
                          <button
                            onClick={async () => {
                              await api(`/api/admin/support?id=${ticket.id}`, { method: "DELETE" }).catch(() => undefined);
                              await load("support");
                            }}
                            className="rounded-md border border-[#e5484d] px-2 py-1 text-[11px] font-bold text-[#e5484d]"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 text-[12.5px] leading-6 text-[#4b5563]">{ticket.message}</p>
                      <p className="mt-1 text-[11.5px] text-[#6b7280]">
                        {ticket.name} · {ticket.email}
                        {ticket.imageId ? ` · image #${ticket.imageId}` : ""}
                      </p>
                      {ticket.adminReply && (
                        <div className="mt-2 rounded-xl border border-[#dbe3ff] bg-[#f5f7ff] p-3 text-[12.5px] text-[#33407a]">
                          <span className="font-bold text-[#2f4ae0]">Replied {timeAgo(ticket.repliedAt)}:</span> {ticket.adminReply}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <input
                          value={replyDraft[ticket.id] ?? ticket.adminReply ?? ""}
                          onChange={(e) => setReplyDraft({ ...replyDraft, [ticket.id]: e.target.value })}
                          placeholder="Write a reply for the user…"
                          className="min-w-[240px] flex-1 rounded-lg border border-[#dcdfe8] px-3 py-2 text-[12.5px]"
                        />
                        <button
                          onClick={() => void updateTicket(ticket.id, { adminReply: replyDraft[ticket.id] ?? "", status: "closed" })}
                          className="rounded-lg bg-[#111827] px-4 py-2 text-[12px] font-bold text-white"
                        >
                          Send reply
                        </button>
                      </div>
                    </div>
                  ))}
                {tickets.length === 0 && <p className="text-[13px] text-[#6b7280]">No support messages yet.</p>}
              </div>
            </Card>
          </div>
        )}

        {tab === "logs" && (
          <Card className="mt-6">
            <div className="flex items-center gap-3">
              <SectionTitle>System logs</SectionTitle>
              <button
                onClick={async () => {
                  await api("/api/admin/logs?all=1", { method: "DELETE" }).catch(() => undefined);
                  setLogs([]);
                  toast("Logs cleared", "info");
                }}
                className="ml-auto rounded-lg border border-[#e5484d] px-3 py-1.5 text-[11.5px] font-bold text-[#e5484d]"
              >
                Clear all logs
              </button>
            </div>
            <div className="mt-3 max-h-[560px] overflow-y-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wider text-[#6b7280]">
                  <tr>
                    <th className="py-2">When</th>
                    <th className="py-2">Kind</th>
                    <th className="py-2">Message</th>
                    <th className="py-2">Endpoint</th>
                    <th className="py-2">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry) => (
                    <tr key={entry.id} className="border-t border-[#f1f2f6]">
                      <td className="py-2 whitespace-nowrap text-[#6b7280]">{formatDate(entry.createdAt)}</td>
                      <td className="py-2">
                        <span className="rounded-full bg-[#f4f5f9] px-2 py-0.5 text-[10.5px] font-bold">{entry.kind}</span>
                      </td>
                      <td className="py-2">{entry.message}</td>
                      <td className="py-2 font-mono text-[11px]">{entry.endpoint ?? "—"}</td>
                      <td className="py-2">{entry.durationMs ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === "withdraw" && (
          <div className="mt-6 grid gap-5 lg:grid-cols-[380px_1fr]">
            <Card>
              <SectionTitle>New withdraw request</SectionTitle>
              <div className="mt-4 space-y-3">
                <NumberField label="Amount $" value={withdrawForm.amount} onChange={(amount) => setWithdrawForm({ ...withdrawForm, amount })} />
                <label className="block space-y-1.5">
                  <span className="block text-[12.5px] font-semibold text-[#374151]">Method</span>
                  <select
                    value={withdrawForm.method}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, method: e.target.value })}
                    className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                  >
                    <option value="bkash">bKash</option>
                    <option value="nogod">Nagad</option>
                    <option value="bank">Bank transfer</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="block text-[12.5px] font-semibold text-[#374151]">Account number</span>
                  <input
                    value={withdrawForm.accountNumber}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, accountNumber: e.target.value })}
                    className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
                  />
                </label>
                <button
                  onClick={async () => {
                    try {
                      await api("/api/admin/withdrawals", { method: "POST", body: JSON.stringify(withdrawForm) });
                      toast("Withdraw request created", "success");
                      setWithdrawForm({ amount: 0, method: "bkash", accountNumber: "" });
                      await load("withdraw");
                    } catch (error) {
                      toast((error as Error).message, "error");
                    }
                  }}
                  className="w-full rounded-lg bg-[#111827] px-4 py-2.5 text-[12.5px] font-bold text-white"
                >
                  Create request
                </button>
                <div className="rounded-xl bg-[#fafbfd] p-3 text-[12px] text-[#4b5563]">
                  <p>
                    Paid out: <strong>${withdrawals.paid}</strong>
                  </p>
                  <p>
                    Pending: <strong>${withdrawals.pending}</strong>
                  </p>
                  <p>
                    Available profit: <strong>${totals.profit ?? 0}</strong>
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <SectionTitle>Withdraw history</SectionTitle>
              <table className="mt-3 w-full text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wider text-[#6b7280]">
                  <tr>
                    <th className="py-2">Amount</th>
                    <th className="py-2">Method</th>
                    <th className="py-2">Account</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Created</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.rows.map((row) => (
                    <tr key={row.id} className="border-t border-[#f1f2f6]">
                      <td className="py-2 font-semibold">${row.amount}</td>
                      <td className="py-2 capitalize">{row.method}</td>
                      <td className="py-2 font-mono">{row.accountNumber}</td>
                      <td className="py-2">{row.status}</td>
                      <td className="py-2 text-[#6b7280]">{formatDate(row.createdAt)}</td>
                      <td className="py-2">
                        <button
                          onClick={async () => {
                            await api("/api/admin/withdrawals", { method: "PATCH", body: JSON.stringify({ id: row.id, status: "paid" }) }).catch(
                              () => undefined,
                            );
                            await load("withdraw");
                          }}
                          className="rounded-md bg-[#12864f] px-2 py-1 text-[11px] font-bold text-white"
                        >
                          Mark paid
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {tab === "usage" && usage && (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <SectionTitle>API usage by endpoint</SectionTitle>
              <table className="mt-3 w-full text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wider text-[#6b7280]">
                  <tr>
                    <th className="py-2">Endpoint</th>
                    <th className="py-2">Calls</th>
                    <th className="py-2">Avg ms</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byEndpoint.map((row) => (
                    <tr key={row.endpoint ?? "none"} className="border-t border-[#f1f2f6]">
                      <td className="py-2 font-mono text-[11px]">{row.endpoint ?? "(client)"}</td>
                      <td className="py-2">{row.n}</td>
                      <td className="py-2">{Math.round(row.avgMs ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <SectionTitle>API keys</SectionTitle>
              <div className="mt-3 space-y-2">
                {usage.keys.map((key) => (
                  <div key={key.id} className="flex items-center gap-2 rounded-lg border border-[#eceef4] px-3 py-2 text-[12px]">
                    <code className="flex-1 truncate">{key.key}</code>
                    <span className="text-[#6b7280]">user #{key.userId}</span>
                    <span className="font-bold">{key.requestCount} calls</span>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(key.key);
                        toast("Key copied", "success");
                      }}
                      className="rounded-md border border-[#e5e7ee] p-1"
                    >
                      <CopyIcon width={13} height={13} />
                    </button>
                  </div>
                ))}
                {usage.keys.length === 0 && <p className="text-[12.5px] text-[#6b7280]">No API keys issued yet.</p>}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentedPeriod({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[13px] font-semibold text-[#374151]">Period</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]">
        <option value="none">one-off</option>
        <option value="monthly">monthly</option>
        <option value="semiannual">6 months</option>
      </select>
    </label>
  );
}

function GrantForm({ onDone }: { onDone: () => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ email: "", days: 30, credits: 0, unlimited: true, folderAccess: true });
  return (
    <div className="mt-4 space-y-3">
      <input
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="user@email.com"
        className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13px]"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Days of premium" value={form.days} onChange={(days) => setForm({ ...form, days })} />
        <NumberField label="Set credits" value={form.credits} onChange={(credits) => setForm({ ...form, credits })} />
      </div>
      <div className="flex gap-4">
        <Toggle label="Unlimited" checked={form.unlimited} onChange={(unlimited) => setForm({ ...form, unlimited })} />
        <Toggle label="Folder access" checked={form.folderAccess} onChange={(folderAccess) => setForm({ ...form, folderAccess })} />
      </div>
      <button
        onClick={async () => {
          try {
            await api("/api/admin/grant", { method: "POST", body: JSON.stringify(form) });
            toast("Premium granted manually", "success");
            onDone();
          } catch (error) {
            toast((error as Error).message, "error");
          }
        }}
        className="w-full rounded-lg bg-[#3b5bfd] px-4 py-2.5 text-[12.5px] font-bold text-white"
      >
        Grant premium now
      </button>
    </div>
  );
}

export const AdminSlider = Slider;
