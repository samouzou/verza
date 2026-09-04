/** Public Reelwright product (rebuilt AI Studio). */
export const REELWRIGHT_ORIGIN = "https://reelwright.art";

export function reelwrightUrl(params?: {from?: string; path?: string}): string {
  const url = new URL(REELWRIGHT_ORIGIN);
  url.searchParams.set("from", params?.from ?? "verza");
  if (params?.path) url.searchParams.set("path", params.path);
  return url.toString();
}
