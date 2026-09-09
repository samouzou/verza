/** Fetch + downscale a profile image in-page so Cloud Functions can upload it. */
export async function fetchAvatarAsJpegDataUrl(
  src: string,
  maxSide = 256
): Promise<string | null> {
  try {
    const res = await fetch(src, {credentials: "omit", mode: "cors", cache: "force-cache"});
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size < 32) return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrl.length > 1_600_000) return null;
    return dataUrl;
  } catch {
    return null;
  }
}
