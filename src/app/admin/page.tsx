import Link from "next/link";
import { AdminClient } from "@/components/AdminClient";
import { getCurrentUser } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await ensureSeed();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-20 text-center">
        <h1 className="text-[24px] font-bold">Admin access required</h1>
        <p className="mt-3 text-[14px] leading-6 text-[#4b5563]">
          This area is only for administrators. Log in with an admin account to manage users, payments, pricing and vectorizer
          settings.
        </p>
        <p className="mt-4 rounded-xl border border-[#dbe3ff] bg-[#f5f7ff] px-4 py-3 text-[13px] text-[#2f4ae0]">
          Default development admin: <strong>admin@vectorizer.ai</strong> / <strong>admin12345</strong>
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-xl bg-[#3b5bfd] px-6 py-3 text-[13px] font-bold text-white hover:bg-[#2f4ae0]"
        >
          Go to login
        </Link>
      </div>
    );
  }
  return <AdminClient />;
}
