"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoIcon } from "@/components/Icons";
import { useApp } from "@/components/Providers";
import { api } from "@/lib/client";

export function AuthForm({ mode, initialError }: { mode: "login" | "register"; initialError?: string }) {
  const router = useRouter();
  const { setUser, toast } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ user: never }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(mode === "register" ? { name, email, password } : { email, password }),
      });
      void res;
      const me = await api<{ user: never }>("/api/auth/me");
      setUser(me.user);
      toast(mode === "register" ? "Account created – 5 free credits added" : "Welcome back!", "success");
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-14 lg:grid-cols-[minmax(0,440px)_1fr] lg:items-start">
      <div className="rounded-2xl border border-[#eceef4] bg-white p-7 shadow-[0_18px_46px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-2">
          <LogoIcon size={26} />
          <span className="text-[16px] font-bold">Vectorizer.AI</span>
        </div>
        <h1 className="mt-5 text-[24px] font-bold">{mode === "register" ? "Create your free account" : "Log in"}</h1>
        <p className="mt-2 text-[13.5px] leading-6 text-[#4b5563]">
          {mode === "register"
            ? "5 free credits are added instantly. No card required."
            : "Continue vectorizing your images and manage your plan."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <label className="block space-y-1.5">
              <span className="block text-[13px] font-semibold text-[#374151]">Full name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[14px] outline-none focus:border-[#3b5bfd]"
              />
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-semibold text-[#374151]">Gmail / email address</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[14px] outline-none focus:border-[#3b5bfd]"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-[13px] font-semibold text-[#374151]">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2.5 text-[14px] outline-none focus:border-[#3b5bfd]"
            />
          </label>

          {error && <p className="rounded-lg bg-[#fdf2f1] px-3 py-2 text-[12.5px] font-medium text-[#c0392b]">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[#3b5bfd] px-4 py-3 text-[13.5px] font-bold text-white transition hover:bg-[#2f4ae0] disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "register" ? "Create account" : "Log in"}
          </button>
        </form>

        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- API route, needs a full navigation */}
        <a
          href="/api/auth/google"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[#dcdfe8] px-4 py-3 text-[13px] font-semibold text-[#374151] transition hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
            <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1A10 10 0 0 0 2 12c0 1.6.4 3.2 1.1 4.6L6.4 14Z" />
            <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.6 9.4 5.9 12 5.9Z" />
          </svg>
          Continue with Google
        </a>

        <p className="mt-5 text-center text-[13px] text-[#4b5563]">
          {mode === "register" ? (
            <>
              Already registered?{" "}
              <Link href="/login" className="font-semibold text-[#3b5bfd] underline">
                Log in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/register" className="font-semibold text-[#3b5bfd] underline">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="space-y-5">
        <div className="rounded-2xl border border-[#eceef4] bg-white p-6">
          <h2 className="text-[16px] font-bold">Everything included with your account</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              "SVG 1.0 / 1.1 / Tiny 1.2 / SVG 2 + Adobe mode",
              "PDF 1.0 → 2.0, EPS 1 → 3, DXF R12 → 2021",
              "Batch & whole-folder vectorization",
              "One .zip download for every image",
              "History, favorites and re-download forever",
              "Manual bKash / Nagad premium activation",
            ].map((item) => (
              <li key={item} className="rounded-xl bg-[#fafbfd] px-4 py-3 text-[12.5px] font-medium text-[#374151]">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-[#dbe3ff] bg-[#f5f7ff] p-6 text-[13px] leading-6 text-[#2f4ae0]">
          <p className="font-bold">Admin access</p>
          <p className="mt-1">
            Development administrator: <strong>admin@vectorizer.ai</strong> / <strong>admin12345</strong> — change it via the
            ADMIN_EMAIL and ADMIN_PASSWORD environment variables.
          </p>
        </div>
      </div>
    </div>
  );
}
