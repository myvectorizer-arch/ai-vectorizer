"use client";

import Link from "next/link";

export default function ResultError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-[560px] place-items-center px-4 text-center">
      <div>
        <h1 className="text-[22px] font-bold">The vectorizer hit a problem</h1>
        <p className="mt-3 text-[13.5px] leading-6 text-[#4b5563]">{error.message}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={reset} className="rounded-xl bg-[#3b5bfd] px-5 py-2.5 text-[13px] font-bold text-white">
            Try again
          </button>
          <Link href="/" className="rounded-xl border border-[#e5e7ee] px-5 py-2.5 text-[13px] font-bold text-[#374151]">
            Back to upload
          </Link>
        </div>
      </div>
    </div>
  );
}
