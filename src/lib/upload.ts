"use client";

export type UploadedImage = {
  id: number;
  batchId: string;
  filename: string;
  width: number;
  height: number;
  sizeBytes: number;
  status: string;
};

export type UploadResponse = {
  batchId: string;
  images: UploadedImage[];
  accessToken?: string;
  errors: { filename: string; error: string }[];
  guest: boolean;
  guestRemaining: number;
  durationMs: number;
  limits?: { creditsPerImage: number };
};

/** XHR based upload so the modal can show a real progress bar. */
export function uploadFiles(
  files: File[],
  opts: { folder?: boolean; onProgress?: (percent: number) => void },
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);
    form.append("folder", opts.folder ? "1" : "0");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && opts.onProgress) {
        opts.onProgress((event.loaded / event.total) * 100);
      }
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || "{}") as UploadResponse & { error?: string };
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(Object.assign(new Error(data.error ?? "Upload failed"), { status: xhr.status }));
      } catch {
        reject(new Error("Upload failed – unexpected server response"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(form);
  });
}

const GUEST_KEY = "av_guest_images";

export function rememberGuestImages(ids: number[]) {
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    const prev = raw ? (JSON.parse(raw) as number[]) : [];
    const merged = Array.from(new Set([...(Array.isArray(prev) ? prev : []), ...ids])).slice(-60);
    window.localStorage.setItem(GUEST_KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable – cookies still work */
  }
}

export function storeAccessToken(token?: string) {
  if (!token) return;
  try {
    window.localStorage.setItem("av_access_token", token);
  } catch {
    /* blocked storage – the token also travels in the URL */
  }
}

export function guestImageHeader(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (!raw) return {};
    const list = JSON.parse(raw) as number[];
    if (!Array.isArray(list) || !list.length) return {};
    return { "x-guest-images": list.join(",") };
  } catch {
    return {};
  }
}

export const ACCEPTED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff", "tif", "avif"];
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ACCEPTED_EXTENSIONS.includes(ext);
}
