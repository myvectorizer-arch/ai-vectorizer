"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckIcon, InfoIcon } from "@/components/Icons";
import { Card, SectionTitle } from "@/components/Controls";
import { useApp } from "@/components/Providers";
import { api, cls, formatDate, timeAgo } from "@/lib/client";

type Ticket = {
  id: number;
  subject: string;
  category: string;
  message: string;
  status: string;
  priority: string;
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

const CATEGORIES = [
  { id: "general", label: "General question" },
  { id: "payment", label: "Payment / premium" },
  { id: "bug", label: "Bug report" },
  { id: "feature", label: "Feature request" },
];

const FAQ = [
  {
    q: "I paid with bKash — how long until premium activates?",
    a: "The admin verifies every bKash / Nagad TrxID manually. It is usually approved within a few hours. Your dashboard shows the plan status and the pending request.",
  },
  {
    q: "Which number do I send money to?",
    a: "The checkout on the pricing page shows the current bKash and Nagad number (Send Money, personal). Never share your PIN with anyone — we only need the TrxID.",
  },
  {
    q: "Can I download all images at once?",
    a: "Yes. Upload a whole folder (or many images), then use “Download all (.zip)” on the result page. The folder + batch option is included from Standard Unlimited ($25) and above.",
  },
  {
    q: "Which output versions can I choose?",
    a: "SVG 1.0 / 1.1 / Tiny 1.2 / SVG 2 / Adobe mode, PDF 1.0 → 2.0, EPS 1 → 3 and DXF R12 → 2021, plus clean PNG bitmaps.",
  },
];

export function SupportClient() {
  const { user, toast } = useApp();
  const [form, setForm] = useState({ name: "", email: "", subject: "", category: "general", message: "" });
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    if (user) {
      setForm((prev) => ({ ...prev, name: prev.name || user.name, email: prev.email || user.email }));
    }
    api<{ tickets: Ticket[] }>("/api/support")
      .then((res) => setTickets(res.tickets ?? []))
      .catch(() => undefined);
  }, [user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ ticket: Ticket }>("/api/support", { method: "POST", body: JSON.stringify(form) });
      setTickets((prev) => [res.ticket, ...prev]);
      setSent(true);
      setForm((prev) => ({ ...prev, subject: "", message: "" }));
      toast("Message sent – the admin can now see it in the admin panel", "success");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10">
      <header className="max-w-[720px]">
        <h1 className="text-[clamp(1.8rem,4.2vw,2.6rem)] font-bold tracking-tight">Support</h1>
        <p className="mt-4 text-[15.5px] leading-7 text-[#4b5563]">
          Send a message and it lands directly in the admin panel inbox — the admin replies from the Support tab. For payment
          issues always include your bKash / Nagad Transaction ID.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <SectionTitle>Send us a message</SectionTitle>
          {sent && (
            <p className="mt-3 flex items-center gap-2 rounded-xl border border-[#c9ecd8] bg-[#eafaf1] px-4 py-3 text-[13px] font-medium text-[#12864f]">
              <CheckIcon width={15} height={15} /> Thank you! Your ticket is now in the admin panel queue.
            </p>
          )}
          <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-[13px] font-semibold text-[#374151]">Your name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[13.5px] outline-none focus:border-[#3b5bfd]"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-[13px] font-semibold text-[#374151]">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[13.5px] outline-none focus:border-[#3b5bfd]"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-[13px] font-semibold text-[#374151]">Category</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[13.5px] outline-none focus:border-[#3b5bfd]"
              >
                {CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="block text-[13px] font-semibold text-[#374151]">Subject</span>
              <input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                required
                placeholder="e.g. bKash payment not activated"
                className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[13.5px] outline-none focus:border-[#3b5bfd]"
              />
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <span className="block text-[13px] font-semibold text-[#374151]">Message</span>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                required
                rows={6}
                placeholder="Describe your issue. For payments add the mobile number you sent from and the Transaction ID."
                className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[13.5px] outline-none focus:border-[#3b5bfd]"
              />
            </label>
            <div className="flex items-center gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-[#3b5bfd] px-6 py-3 text-[13px] font-bold text-white transition hover:bg-[#2f4ae0] disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send message"}
              </button>
              <span className="flex items-center gap-1.5 text-[11.5px] text-[#6b7280]">
                <InfoIcon width={13} height={13} /> Seen by the admin panel within seconds
              </span>
            </div>
          </form>

          {tickets.length > 0 && (
            <div className="mt-8">
              <SectionTitle>Your messages</SectionTitle>
              <div className="mt-3 space-y-3">
                {tickets.map((ticket) => (
                  <div key={ticket.id} className="rounded-xl border border-[#eceef4] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-bold">#{ticket.id} · {ticket.subject}</span>
                      <span className="rounded-full bg-[#f4f5f9] px-2 py-0.5 text-[11px] font-semibold capitalize">{ticket.category}</span>
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
                      <span className="ml-auto text-[11.5px] text-[#6b7280]">{timeAgo(ticket.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-[12.5px] leading-6 text-[#4b5563]">{ticket.message}</p>
                    {ticket.adminReply && (
                      <div className="mt-3 rounded-xl border border-[#dbe3ff] bg-[#f5f7ff] p-3">
                        <p className="text-[12px] font-bold text-[#2f4ae0]">Admin reply · {formatDate(ticket.repliedAt)}</p>
                        <p className="mt-1 text-[12.5px] leading-6 text-[#33407a]">{ticket.adminReply}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <SectionTitle>FAQ</SectionTitle>
            <div className="mt-3 divide-y divide-[#f1f2f6]">
              {FAQ.map((item, index) => (
                <div key={item.q} className="py-3">
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="flex w-full items-start gap-2 text-left text-[13px] font-semibold text-[#111827]"
                  >
                    <span className="text-[#3b5bfd]">{openFaq === index ? "−" : "+"}</span>
                    {item.q}
                  </button>
                  {openFaq === index && <p className="mt-2 pl-4 text-[12.5px] leading-6 text-[#4b5563]">{item.a}</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card className="bg-[#f5f7ff]">
            <SectionTitle>Quick links</SectionTitle>
            <div className="mt-3 space-y-2 text-[13px]">
              <Link href="/pricing" className="block rounded-lg bg-white px-3 py-2 font-semibold text-[#3b5bfd]">
                Pricing & bKash / Nagad checkout →
              </Link>
              <Link href="/developers" className="block rounded-lg bg-white px-3 py-2 font-semibold text-[#3b5bfd]">
                Developers & API reference →
              </Link>
              <Link href="/dashboard" className="block rounded-lg bg-white px-3 py-2 font-semibold text-[#3b5bfd]">
                Your dashboard, history & payments →
              </Link>
              <a href="/api/health" className="block rounded-lg bg-white px-3 py-2 font-semibold text-[#3b5bfd]">
                Service status →
              </a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
