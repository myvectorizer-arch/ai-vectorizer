export default function Loading() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 bg-[#f7f8fb]">
      <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#dbe3ff] border-t-[#3b5bfd]" />
      <p className="text-[13.5px] font-semibold text-[#4b5563]">Preparing the vectorizer…</p>
      <p className="text-[12px] text-[#9ca3af]">Background remove → quantize → trace → Bezier fit</p>
    </div>
  );
}
