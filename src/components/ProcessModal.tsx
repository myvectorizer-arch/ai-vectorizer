"use client";

export type Phase = { label: string; value: number };

export function ProcessModal({
  open,
  title,
  phases,
  onCancel,
  message,
}: {
  open: boolean;
  title?: string;
  phases: Phase[];
  onCancel?: () => void;
  message?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[rgba(15,23,42,0.25)] backdrop-blur-[2px]">
      <div className="w-[min(92vw,470px)] overflow-hidden rounded-lg bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
        {title && <div className="border-b border-[#eceef4] px-6 py-3 text-sm font-semibold">{title}</div>}
        <div className="space-y-4 px-6 py-6">
          {phases.map((phase) => (
            <div key={phase.label} className="grid grid-cols-[74px_1fr] items-center gap-4">
              <span className="text-[15px] text-[#374151]">{phase.label}</span>
              <span className="h-[18px] w-full overflow-hidden rounded-[3px] bg-[#f1f2f6]">
                <span
                  className="block h-full rounded-[3px] bg-[#3b5bfd] transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, phase.value))}%` }}
                />
              </span>
            </div>
          ))}
          {message && <p className="text-xs text-[#6b7280]">{message}</p>}
        </div>
        <div className="flex justify-end border-t border-[#eceef4] px-6 py-3">
          <button
            onClick={onCancel}
            disabled={!onCancel}
            className="rounded-full bg-[#e5484d] px-6 py-2 text-[13px] font-bold tracking-wide text-white transition hover:bg-[#cf3f44] disabled:opacity-50"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
