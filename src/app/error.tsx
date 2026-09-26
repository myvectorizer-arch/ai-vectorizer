"use client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-[560px] place-items-center px-4 text-center">
      <div>
        <h1 className="text-[22px] font-bold">Something went wrong</h1>
        <p className="mt-3 text-[13.5px] leading-6 text-[#4b5563]">{error.message}</p>
        <button onClick={reset} className="mt-6 rounded-xl bg-[#3b5bfd] px-5 py-2.5 text-[13px] font-bold text-white">
          Retry
        </button>
      </div>
    </div>
  );
}
