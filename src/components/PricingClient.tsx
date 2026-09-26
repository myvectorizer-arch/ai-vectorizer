"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, ChevronDownIcon, CloseIcon, CopyIcon, InfoIcon } from "@/components/Icons";
import { Label, Segmented } from "@/components/Controls";
import { useApp } from "@/components/Providers";
import { api, cls, formatDate } from "@/lib/client";

export type PlanDto = {
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
};

export function PricingClient({ plans }: { plans: PlanDto[] }) {
  const router = useRouter();
  const { user, toast, settings, refresh } = useApp();
  const [checkout, setCheckout] = useState<PlanDto | null>(null);
  const [method, setMethod] = useState<"bkash" | "nogod" | "paypal">("bkash");
  const [senderNumber, setSenderNumber] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState("");

  const payment = settings?.payment ?? {};
  const bdtRate = payment.bdtRate ?? 120;
  const number = method === "nogod" ? payment.nogod : method === "paypal" ? payment.paypal : payment.bkash;
  // manual bKash / Nagad checkout is always settled in BDT
  const bdtAmount = checkout
    ? Math.round(checkout.priceBdt > 0 ? checkout.priceBdt : checkout.price * bdtRate)
    : 0;

  const submit = async () => {
    if (!checkout) return;
    setSubmitting(true);
    setError("");
    try {
      await api("/api/payments", {
        method: "POST",
        body: JSON.stringify({
          planSlug: checkout.slug,
          method,
          senderNumber,
          transactionId,
          note,
          amount: bdtAmount,
          currency: "BDT",
        }),
      });
      setDone(true);
      await refresh();
      toast("Payment submitted – the admin panel now shows it as pending", "success");
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-10">
      <header className="text-center">
        <h1 className="text-[clamp(1.9rem,4.4vw,2.9rem)] font-bold tracking-tight">Simple pricing, manual verification</h1>
        <p className="mx-auto mt-4 max-w-[680px] text-[15.5px] leading-7 text-[#4b5563]">
          Pay with bKash or Nagad, submit your Transaction ID, and the admin unlocks your plan instantly. Accounts start with 5
          free credits — no card required.
        </p>
      </header>

      <div className="mx-auto mt-8 max-w-[860px] rounded-2xl border-2 border-[#f0d9b5] bg-[#fffaf0] p-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wider text-[#8a5a10]">bKash · Send Money</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[24px] font-bold tracking-wide text-[#111827]">{payment.bkash ?? "01616362908"}</span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(payment.bkash ?? "01616362908");
                  toast("bKash number copied", "success");
                }}
                className="flex items-center gap-1 rounded-lg border border-[#e2c79a] px-2 py-1 text-[11.5px] font-semibold text-[#8a5a10]"
              >
                <CopyIcon width={13} height={13} /> Copy
              </button>
            </div>
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wider text-[#8a5a10]">Nagad · Send Money</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[24px] font-bold tracking-wide text-[#111827]">{payment.nogod ?? "01616362908"}</span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(payment.nogod ?? "01616362908");
                  toast("Nagad number copied", "success");
                }}
                className="flex items-center gap-1 rounded-lg border border-[#e2c79a] px-2 py-1 text-[11.5px] font-semibold text-[#8a5a10]"
              >
                <CopyIcon width={13} height={13} /> Copy
              </button>
            </div>
          </div>
          <p className="max-w-[280px] text-[12px] leading-5 text-[#8a5a10]">
            Send the exact BDT amount of the plan you want (Personal → Send Money), then submit your mobile number + TrxID.
            Admin approves manually.
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cls(
              "relative flex flex-col rounded-2xl border-2 bg-white p-5",
              plan.highlight ? "border-[#3b5bfd] shadow-[0_18px_46px_rgba(59,91,253,0.16)]" : "border-[#e5e7ee]",
            )}
          >
            {plan.highlight && (
              <span className="absolute -top-3 left-5 rounded-full bg-[#3b5bfd] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                Most popular
              </span>
            )}
            <h3 className="text-[16px] font-bold">{plan.name}</h3>
            <p className="mt-3 text-[30px] font-bold leading-none">
              ${plan.price}
              <span className="ml-1 text-[13px] font-medium text-[#6b7280]">
                {plan.period === "monthly" ? "/ month" : plan.period === "semiannual" ? "/ 6 months" : plan.credits ? "one-off" : ""}
              </span>
            </p>
            {plan.price > 0 && (
              <p className="mt-1 text-[12px] font-semibold text-[#8a5a10]">
                Pay ৳{(plan.priceBdt > 0 ? plan.priceBdt : Math.round(plan.price * bdtRate)).toLocaleString()} by bKash / Nagad
              </p>
            )}
            <ul className="mt-4 flex-1 space-y-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2 text-[12.5px] leading-5 text-[#4b5563]">
                  <CheckIcon width={14} height={14} className="mt-0.5 shrink-0 text-[#3b5bfd]" />
                  <span>{feature}</span>
                </li>
              ))}
              <li className="flex gap-2 text-[12.5px] leading-5">
                <CheckIcon width={14} height={14} className={cls("mt-0.5 shrink-0", plan.folderAccess ? "text-[#3b5bfd]" : "text-[#cbd0dc]")} />
                <span className={plan.folderAccess ? "text-[#4b5563]" : "text-[#9ca3af] line-through"}>
                  Folder upload & batch .zip download
                </span>
              </li>
            </ul>
            {plan.price === 0 ? (
              <Link
                href={user ? "/" : "/register"}
                className="mt-5 rounded-xl border border-[#d8dbe6] px-4 py-2.5 text-center text-[13px] font-bold text-[#374151] hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
              >
                {user ? "Start vectorizing" : "Create free account"}
              </Link>
            ) : (
              <button
                onClick={() => {
                  if (!user) {
                    toast("Create a free account first (5 free credits) – then submit your bKash number + TrxID", "info");
                    setTimeout(() => router.push(`/register?plan=${plan.slug}`), 700);
                    return;
                  }
                  setCheckout(plan);
                  setDone(false);
                  setTerms(false);
                  setError("");
                }}
                className="mt-5 rounded-xl bg-[#3b5bfd] px-4 py-2.5 text-[13px] font-bold text-white transition hover:bg-[#2f4ae0]"
              >
                Choose {plan.name}
              </button>
            )}
          </div>
        ))}
      </div>

      <section className="mt-12 grid gap-5 lg:grid-cols-3">
        {[
          {
            title: "1. Send the money",
            body: "bKash or Nagad → Send Money to the company number shown in checkout, using the BDT amount on your chosen plan.",
          },
          {
            title: "2. Submit Transaction ID",
            body: "Enter the number you paid from plus the TrxID. Your request lands in the admin's Pending Payments list.",
          },
          {
            title: "3. Instant unlock on approval",
            body: "The admin verifies and approves. Premium activates immediately with an expiry date (1 month or 6 months) that auto-deactivates when the period ends.",
          },
        ].map((step) => (
          <div key={step.title} className="rounded-2xl border border-[#eceef4] bg-white p-5">
            <h3 className="text-[14px] font-bold text-[#111827]">{step.title}</h3>
            <p className="mt-2 text-[13px] leading-6 text-[#4b5563]">{step.body}</p>
          </div>
        ))}
      </section>

      {checkout && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(8,9,12,0.62)] p-4 backdrop-blur-sm">
          <div className="thin-scroll max-h-[94vh] w-full max-w-[900px] overflow-y-auto rounded-2xl border border-[#2a2c33] bg-[#141519] p-6 text-white shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e6e8ee" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6l7-3Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <h2 className="text-[20px] font-bold">Secure Checkout</h2>
              </div>
              <button onClick={() => setCheckout(null)} className="rounded-lg p-1.5 text-[#9aa0ad] hover:bg-[#22242a]">
                <CloseIcon width={18} height={18} />
              </button>
            </div>

            <p className="mt-3 text-[14px] text-[#b9bdc7]">
              You are subscribing to the <span className="font-bold text-white">{checkout.name}</span> plan for{" "}
              <span className="font-bold text-white">৳{bdtAmount.toLocaleString()}</span>.
            </p>

            {done ? (
              <div className="mt-6 rounded-xl border border-[#2a3a2e] bg-[#16211a] p-5 text-[13.5px] text-[#8fe0ae]">
                <p className="font-bold">Payment submitted for verification ✅</p>
                <p className="mt-2 leading-6 text-[#a9c9b6]">
                  We received TrxID <strong className="text-white">{transactionId}</strong> for {checkout.name}. The admin
                  verifies it manually and your premium activates with an expiry date — track it on your dashboard.
                </p>
                <Link href="/dashboard" className="mt-3 inline-block font-semibold text-white underline">
                  Go to dashboard →
                </Link>
              </div>
            ) : (
              <>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {/* Step 1 – send money */}
                  <section className="rounded-xl border border-[#2a2c33] bg-[#191b20] p-5">
                    <h3 className="flex items-center gap-2.5 text-[15px] font-bold">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2b2e36] text-[12px]">1</span>
                      Send Money (Personal)
                    </h3>
                    <dl className="mt-5 space-y-4 text-[13.5px]">
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-[#b9bdc7]">Provider</dt>
                        <dd>
                          <div className="relative">
                            <select
                              value={method}
                              onChange={(e) => setMethod(e.target.value as "bkash" | "nogod" | "paypal")}
                              className="rounded-lg border border-[#3a3d45] bg-[#202329] px-9 py-2 text-[13.5px] font-medium text-white outline-none"
                            >
                              <option value="bkash">bKash</option>
                              <option value="nogod">Nagad</option>
                              <option value="paypal">PayPal</option>
                            </select>
                            <ChevronDownIcon width={15} height={15} className="pointer-events-none absolute top-2.5 left-3 text-[#9aa0ad]" />
                          </div>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-[#b9bdc7]">Number</dt>
                        <dd className="flex items-center gap-2">
                          <span className="font-bold tracking-wide">{number ?? "—"}</span>
                          <button
                            onClick={() => {
                              void navigator.clipboard.writeText(number ?? "");
                              toast("Number copied", "success");
                            }}
                            className="rounded-md p-1 text-[#9aa0ad] hover:bg-[#262a31]"
                            title="Copy number"
                          >
                            <CopyIcon width={15} height={15} />
                          </button>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-[#b9bdc7]">Amount</dt>
                        <dd className="font-bold">৳{bdtAmount.toLocaleString()}</dd>
                      </div>
                    </dl>
                    <p className="mt-4 text-[11.5px] leading-5 text-[#8d929d]">
                      {method === "paypal"
                        ? "PayPal is temporarily disabled – please use bKash or Nagad."
                        : payment.instructions ?? "Open the app → Send Money → Personal, then submit your number + TrxID."}
                    </p>
                  </section>

                  {/* Step 2 – verify payment */}
                  <section className="rounded-xl border border-[#2a2c33] bg-[#191b20] p-5">
                    <h3 className="flex items-center gap-2.5 text-[15px] font-bold">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2b2e36] text-[12px]">2</span>
                      Verify Payment
                    </h3>
                    <div className="mt-5 space-y-4">
                      <label className="block space-y-2">
                        <span className="block text-[13px] text-[#b9bdc7]">Sender Number (Your Number)</span>
                        <input
                          value={senderNumber}
                          onChange={(e) => setSenderNumber(e.target.value)}
                          placeholder="e.g. 017XXXXXXXX"
                          className="w-full rounded-lg border border-[#3a3d45] bg-[#202329] px-3.5 py-2.5 text-[13.5px] text-white placeholder:text-[#6f747f] outline-none focus:border-[#3b5bfd]"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="block text-[13px] text-[#b9bdc7]">Transaction ID (TrxID)</span>
                        <input
                          value={transactionId}
                          onChange={(e) => setTransactionId(e.target.value.toUpperCase())}
                          placeholder="e.g. 8A7B6C5D4E"
                          className="w-full rounded-lg border border-[#3a3d45] bg-[#202329] px-3.5 py-2.5 text-[13.5px] text-white placeholder:text-[#6f747f] outline-none focus:border-[#3b5bfd]"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="block text-[13px] text-[#b9bdc7]">Note (optional)</span>
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Anything the admin should know"
                          className="w-full rounded-lg border border-[#3a3d45] bg-[#202329] px-3.5 py-2.5 text-[13.5px] text-white placeholder:text-[#6f747f] outline-none focus:border-[#3b5bfd]"
                        />
                      </label>
                    </div>
                  </section>
                </div>

                <button
                  onClick={() => setTerms(!terms)}
                  className="mt-5 flex items-center gap-2.5 text-left text-[13px] text-[#b9bdc7]"
                >
                  <span
                    className={cls(
                      "grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                      terms ? "border-[#3b5bfd] bg-[#3b5bfd]" : "border-[#5b606b]",
                    )}
                  >
                    {terms && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  I accept the{" "}
                  <Link href="/support" className="font-semibold text-[#e0574a] underline" target="_blank">
                    Terms and Conditions
                  </Link>
                </button>

                {error && <p className="mt-3 text-[12.5px] font-medium text-[#ff8a80]">{error}</p>}

                <div className="mt-6 flex items-center justify-end gap-6">
                  <button onClick={() => setCheckout(null)} className="text-[13.5px] font-semibold text-[#b9bdc7] hover:text-white">
                    Cancel
                  </button>
                  <button
                    onClick={() => void submit()}
                    disabled={submitting || !terms || !senderNumber || transactionId.length < 4 || method === "paypal"}
                    className="flex items-center gap-2 rounded-lg bg-[#e6e8ee] px-5 py-2.5 text-[13.5px] font-bold text-[#141519] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
                    </svg>
                    {submitting ? "Submitting…" : "Confirm Payment"}
                  </button>
                </div>
              </>
            )}

            {user && (
              <p className="mt-4 text-[11.5px] text-[#8d929d]">
                Signed in as {user.email}
                {user.planExpiresAt ? ` · current plan expires ${formatDate(user.planExpiresAt)}` : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
