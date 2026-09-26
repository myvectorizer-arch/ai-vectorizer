"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDownIcon, GlobeIcon, LogoIcon } from "@/components/Icons";
import { useApp } from "@/components/Providers";

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser, toast, settings } = useApp();
  const [langOpen, setLangOpen] = useState(false);
  const [lang, setLang] = useState("English");
  const [menuOpen, setMenuOpen] = useState(false);

  if (pathname.startsWith("/result")) return null;

  const languages = settings?.site?.languages ?? ["English", "বাংলা", "हिन्दी", "Español"];

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    toast("Logged out", "info");
    router.push("/");
  };

  const navLink = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={`hidden text-[15px] font-medium transition md:block ${
          active ? "text-[#3b5bfd]" : "text-[#4b5563] hover:text-[#111827]"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#eceef4] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2">
          <LogoIcon size={26} />
          <span className="text-[17px] font-bold tracking-tight text-[#111827]">Vectorizer.AI</span>
        </Link>
        <nav className="flex items-center gap-7">
          {navLink("/developers", "Developers")}
          {navLink("/pricing", "Pricing")}
          {navLink("/support", "Support")}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <div className="relative hidden md:block">
            <button
              onClick={() => setLangOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[15px] text-[#374151] hover:bg-[#f4f5f9]"
            >
              <GlobeIcon width={18} height={18} className="text-[#3b5bfd]" />
              <span>{lang}</span>
              <ChevronDownIcon width={15} height={15} />
            </button>
            {langOpen && (
              <div className="absolute right-0 mt-2 w-40 overflow-hidden rounded-xl border border-[#e5e7ee] bg-white py-1 shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
                {languages.map((l) => (
                  <button
                    key={l}
                    onClick={() => {
                      setLang(l);
                      setLangOpen(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-[#f5f6fa]"
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>

          {user ? (
            <div className="relative flex items-center gap-3">
              <Link
                href="/dashboard"
                className="hidden rounded-full bg-[#eef2ff] px-3 py-1.5 text-[13px] font-semibold text-[#3b5bfd] sm:block"
              >
                {user.unlimited ? `${user.plan.replace(/-/g, " ")} · Unlimited` : `${user.credits} credits`}
              </Link>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-[#e5e7ee] px-2 py-1.5 text-sm font-medium hover:bg-[#f7f8fb]"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#3b5bfd] text-[11px] font-bold text-white">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:block">{user.name.split(" ")[0]}</span>
                <ChevronDownIcon width={14} height={14} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-11 w-52 overflow-hidden rounded-xl border border-[#e5e7ee] bg-white py-1 shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
                  <Link href="/dashboard" className="block px-3 py-2 text-sm hover:bg-[#f5f6fa]" onClick={() => setMenuOpen(false)}>
                    Dashboard & history
                  </Link>
                  <Link href="/dashboard?tab=favorites" className="block px-3 py-2 text-sm hover:bg-[#f5f6fa]" onClick={() => setMenuOpen(false)}>
                    Favorites
                  </Link>
                  <Link href="/developers" className="block px-3 py-2 text-sm hover:bg-[#f5f6fa]" onClick={() => setMenuOpen(false)}>
                    API key
                  </Link>
                  {user.isAdmin && (
                    <Link href="/admin" className="block px-3 py-2 text-sm font-semibold text-[#3b5bfd] hover:bg-[#f5f6fa]" onClick={() => setMenuOpen(false)}>
                      Admin panel
                    </Link>
                  )}
                  <button onClick={logout} className="block w-full px-3 py-2 text-left text-sm text-[#c0392b] hover:bg-[#fdf2f1]">
                    Log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/register" className="text-[15px] font-medium text-[#4b5563] hover:text-[#111827]">
                Create Account
              </Link>
              <Link href="/login" className="text-[15px] font-medium text-[#4b5563] hover:text-[#111827]">
                Log In
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
