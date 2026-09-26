"use client";

import { InfoIcon } from "@/components/Icons";
import { cls } from "@/lib/client";

export function Label({ text, info }: { text: string; info?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#374151]">
      {text}
      {info && (
        <span className="group relative inline-flex cursor-help text-[#9ca3af]">
          <InfoIcon width={14} height={14} />
          <span className="pointer-events-none absolute bottom-5 left-1/2 z-30 hidden w-56 -translate-x-1/2 rounded-lg bg-[#111827] px-3 py-2 text-[11.5px] font-normal leading-5 text-white shadow-lg group-hover:block">
            {info}
          </span>
        </span>
      )}
    </span>
  );
}

export function Slider({
  label,
  info,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  info?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label text={label} info={info} />
        <span className="rounded-md bg-[#f4f5f9] px-2 py-0.5 text-[12px] font-semibold text-[#374151]">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#e5e7ee]"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  info,
  value,
  options,
  onChange,
  size = "md",
}: {
  label?: string;
  info?: string;
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="space-y-1.5">
      {label && <Label text={label} info={info} />}
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-[#f4f5f9] p-1">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            title={option.hint}
            className={cls(
              "rounded-lg font-semibold transition",
              size === "sm" ? "px-3 py-1 text-[12px]" : "px-3.5 py-1.5 text-[12.5px]",
              value === option.id ? "bg-[#3b5bfd] text-white shadow-sm" : "text-[#4b5563] hover:bg-white",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  info,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  info?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cls("flex items-center gap-3 text-left", disabled && "opacity-50")}
    >
      <span
        className={cls(
          "relative h-[22px] w-[40px] shrink-0 rounded-full transition",
          checked ? "bg-[#3b5bfd]" : "bg-[#d7dae3]",
        )}
      >
        <span
          className={cls(
            "absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all",
            checked ? "left-[20px]" : "left-[2px]",
          )}
        />
      </span>
      <span className="text-[13px] font-medium text-[#374151]">{label}</span>
      {info && <InfoIcon width={14} height={14} className="text-[#9ca3af]" />}
    </button>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 100000,
  step = 1,
  suffix,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="space-y-1.5">
      {label && <span className="block text-[13px] font-semibold text-[#374151]">{label}</span>}
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
          }}
          className="w-full rounded-lg border border-[#dcdfe8] px-3 py-2 text-[13.5px] outline-none focus:border-[#3b5bfd]"
        />
        {suffix && <span className="text-[12.5px] text-[#6b7280]">{suffix}</span>}
      </span>
    </label>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cls("rounded-2xl border border-[#eceef4] bg-white p-4", className)}>{children}</div>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#6b7280]">{children}</h3>;
}
