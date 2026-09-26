"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderIcon, ImagesIcon, UploadIcon } from "@/components/Icons";
import { ProcessModal } from "@/components/ProcessModal";
import { useApp } from "@/components/Providers";
import { cls, logEvent } from "@/lib/client";
import { ACCEPT_ATTR, isImageFile, rememberGuestImages, storeAccessToken, uploadFiles } from "@/lib/upload";

export function HeroUpload({
  title,
  line1,
  line2,
  maxUploadMB,
  maxBatch,
  guestFreeImages,
  notices,
}: {
  title: string;
  line1: string;
  line2: string;
  maxUploadMB: number;
  maxBatch: number;
  guestFreeImages: number;
  notices: { id: number; title: string; body: string }[];
}) {
  const router = useRouter();
  const { user, toast, settings } = useApp();
  const [dragging, setDragging] = useState(false);
  const [blocked, setBlocked] = useState<{ message: string; kind: "limit" | "folder" | "error" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [label, setLabel] = useState("Preparing…");
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const limits = settings?.limits;

  useEffect(() => {
    const el = folderInput.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const dragDepth = useRef(0);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setBlocked(null);
      const images = files.filter(isImageFile);
      if (!images.length) {
        setBlocked({ message: "Please drop PNG, JPG, JPEG, WEBP, BMP, GIF or TIFF images.", kind: "error" });
        toast("Please drop PNG, JPG, JPEG, WEBP, BMP, GIF or TIFF images", "error");
        return;
      }
      // A real folder upload keeps a nested relative path (sub-folders).
      // Selecting/dropping lots of loose images never needs the premium option.
      const nested = images.some((file) => {
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
        return rel.includes("/");
      });
      const folderAccess = Boolean(user?.folderAccess || user?.role === "admin" || user?.isAdmin);
      if (nested && !folderAccess) {
        setBlocked({
          message:
            "Uploading a whole folder tree (with sub-folders) is part of Standard Unlimited ($25). Dropping many images at once works on every plan.",
          kind: "folder",
        });
        toast("Folder trees need the $25 plan – try dropping the images directly", "error");
        return;
      }
      if (images.length > (limits?.maxBatch ?? maxBatch)) {
        setBlocked({ message: `A batch can hold at most ${limits?.maxBatch ?? maxBatch} images.`, kind: "error" });
        toast(`A batch can hold at most ${limits?.maxBatch ?? maxBatch} images`, "error");
        return;
      }
      setUploading(true);
      setPercent(0);
      setLabel(`Uploading ${images.length} image${images.length === 1 ? "" : "s"}…`);
      try {
        const res = await uploadFiles(images, {
          folder: nested,
          onProgress: (p) => setPercent(p),
        });
        if (res.errors?.length) {
          toast(`${res.errors.length} file(s) rejected: ${res.errors[0].error}`, "error");
        }
        if (!res.images.length) {
          setUploading(false);
          setBlocked({ message: res.errors?.[0]?.error ?? "No image could be read – please try another file.", kind: "error" });
          return;
        }
        logEvent(`Uploaded ${res.images.length} image(s) via drag & drop`, "api");
        const idList = res.images.map((i) => i.id);
        rememberGuestImages(idList);
        storeAccessToken(res.accessToken);
        const ids = idList.join(",");
        const token = res.accessToken ? `&t=${encodeURIComponent(res.accessToken)}` : "";
        setLabel("Opening the vectorizer…");
        setPercent(100);
        // close the modal first so the user always lands on the result page,
        // even when a very large batch takes a moment to analyse.
        setUploading(false);
        router.push(`/result?ids=${ids}${token}`);
        router.refresh();
      } catch (error) {
        const err = error as Error & { status?: number; code?: string };
        setUploading(false);
        toast(err.message, "error");
        const kind = err.code === "guest_limit" ? "limit" : err.code === "folder_locked" ? "folder" : "error";
        setBlocked({ message: err.message, kind });
      }
    },
    [limits, maxBatch, router, toast, user],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        event.preventDefault();
        toast("Vectorizing pasted image…", "info");
        void handleFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFiles, toast]);

  return (
    <section className="mx-auto max-w-[1180px] px-4 pb-10 pt-8">
      {notices.length > 0 && (
        <div className="mx-auto mb-6 max-w-[760px] space-y-2">
          {notices.slice(0, 2).map((notice) => (
            <div key={notice.id} className="rounded-xl border border-[#dbe3ff] bg-[#f5f7ff] px-4 py-3 text-sm">
              <span className="font-semibold text-[#3b5bfd]">{notice.title}</span>
              <span className="ml-2 text-[#4b5563]">{notice.body}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mx-auto mb-5 w-fit rounded-[4px] bg-[#3b5bfd] px-2.5 py-1 text-[12px] font-bold text-white">
        File Picker
      </div>
      <h1 className="text-center text-[clamp(2rem,5.4vw,3.6rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[#111827]">
        {title}
      </h1>
      <p className="mx-auto mt-6 max-w-[720px] text-center text-[17px] leading-7 text-[#4b5563]">{line1}</p>
      <p className="mx-auto mt-2 max-w-[720px] text-center text-[17px] leading-7 text-[#4b5563]">{line2}</p>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const files = Array.from(e.dataTransfer?.files ?? []);
          void handleFiles(files);
        }}
        className={cls(
          "mx-auto mt-9 flex w-full max-w-[820px] cursor-pointer items-center justify-center gap-6 rounded-xl border-2 border-dashed px-6 py-9 transition",
          dragging ? "dropzone-active border-[#3b5bfd]" : "border-[#3b5bfd] bg-white",
        )}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop images here to vectorize"
      >
        <div className="relative hidden h-[104px] w-[120px] shrink-0 sm:block">
          {[
            { ext: ".png", x: 0, r: "-8deg", z: 1 },
            { ext: ".jpg", x: 38, r: "0deg", z: 3 },
            { ext: ".webp", x: 76, r: "8deg", z: 2 },
          ].map((card) => (
            <div
              key={card.ext}
              className="absolute bottom-0 h-[92px] w-[46px] rounded-md border border-[#e5e7ee] bg-white shadow-[0_8px_20px_rgba(15,23,42,0.10)]"
              style={{ left: card.x, transform: `rotate(${card.r})`, zIndex: card.z, animation: "av-float 3.6s ease-in-out infinite" }}
            >
              <div className="mt-3 flex justify-center text-[#3b5bfd]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 16l4-4 4 3 3-3 5 5" />
                  <path d="M5 3h9l5 5v13H5z" />
                  <path d="M14 3v5h5" />
                </svg>
              </div>
              <p className="mt-2 text-center text-[10px] font-semibold text-[#6b7280]">{card.ext}</p>
            </div>
          ))}
        </div>
        <p className="text-center text-[clamp(1.05rem,3vw,1.6rem)] font-bold uppercase tracking-[0.12em] text-[#3b5bfd]">
          DRAG IMAGE HERE TO BEGIN
        </p>
      </div>

      <div className="mx-auto mt-7 flex w-full max-w-[820px] flex-wrap items-center justify-center gap-5">
        <button
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-2 rounded-full bg-[#3b5bfd] px-7 py-3 text-[13px] font-bold uppercase tracking-wider text-white shadow-[0_10px_26px_rgba(59,91,253,0.35)] transition hover:bg-[#2f4ae0]"
        >
          <UploadIcon width={18} height={18} />
          PICK IMAGE TO VECTORIZE
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-2 rounded-full border border-[#d8dbe6] px-5 py-3 text-[13px] font-semibold text-[#374151] transition hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
        >
          <ImagesIcon width={17} height={17} /> Multiple images
        </button>
        <button
          onClick={() => {
            const folderAccess = Boolean(user?.folderAccess || user?.role === "admin" || user?.isAdmin);
            if (!folderAccess) {
              setBlocked({
                message:
                  "Uploading a whole folder tree (with sub-folders) is part of Standard Unlimited ($25) and above. You can still drop or pick many images at once on any plan.",
                kind: "folder",
              });
              return;
            }
            folderInput.current?.click();
          }}
          className="flex items-center gap-2 rounded-full border border-[#d8dbe6] px-5 py-3 text-[13px] font-semibold text-[#374151] transition hover:border-[#3b5bfd] hover:text-[#3b5bfd]"
        >
          <FolderIcon width={17} height={17} /> Whole folder (batch)
        </button>
        <span className="flex items-center gap-2 text-[15px] font-semibold text-[#6b7280]">
          Paste:
          <kbd className="rounded-md border border-[#3b5bfd] px-2 py-1 text-[13px] font-bold text-[#3b5bfd]">CTRL</kbd>
          +
          <kbd className="rounded-md border border-[#3b5bfd] px-2 py-1 text-[13px] font-bold text-[#3b5bfd]">V</kbd>
        </span>
      </div>

      {blocked && (
        <div
          className={cls(
            "mx-auto mt-6 flex w-full max-w-[820px] flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[13px]",
            blocked.kind === "limit" ? "border-[#f0d9b5] bg-[#fffaf0] text-[#8a5a10]" : "border-[#f3c7c4] bg-[#fdf4f3] text-[#8a3b34]",
          )}
        >
          <span className="flex-1">{blocked.message}</span>
          {blocked.kind === "limit" && (
            <Link href="/register" className="rounded-lg bg-[#3b5bfd] px-4 py-2 text-[12.5px] font-bold text-white">
              Create free account
            </Link>
          )}
          {blocked.kind === "folder" && (
            <Link href="/pricing" className="rounded-lg bg-[#3b5bfd] px-4 py-2 text-[12.5px] font-bold text-white">
              See pricing
            </Link>
          )}
          <button onClick={() => setBlocked(null)} className="text-[12px] font-semibold underline">
            dismiss
          </button>
        </div>
      )}

      <p className="mt-5 text-center text-[13px] text-[#6b7280]">
        PNG · JPG · JPEG · WEBP · BMP · GIF · TIFF · AVIF — up to {maxUploadMB} MB each, {limits?.maxBatch ?? maxBatch} per
        batch. Guests get {limits?.guestFreeImages ?? guestFreeImages} free images, accounts start with 5 credits.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void handleFiles(files);
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void handleFiles(files);
        }}
      />

      <ProcessModal
        open={uploading}
        title="Vectorizing"
        phases={[
          { label: "Upload", value: percent },
          { label: "Process", value: Math.max(0, (percent - 55) * 1.4) },
          { label: "Fetch", value: Math.max(0, (percent - 80) * 2) },
        ]}
        message={label}
        onCancel={() => {
          setUploading(false);
          toast("Upload cancelled", "info");
        }}
      />
    </section>
  );
}
