/** Chrome Web Store listing URL (set when published). */
export const OPTIC_EXTENSION_CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_OPTIC_EXTENSION_CHROME_STORE_URL?.trim() || "";

/** Hosted zip for early-access / sideload install instructions. */
export const OPTIC_EXTENSION_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_OPTIC_EXTENSION_DOWNLOAD_URL?.trim() ||
  "/downloads/verza-optic-scout.zip";

export const OPTIC_EXTENSION_INSTALL_PATH = "/optic/extension";

export function getOpticExtensionInstallUrl(origin?: string): string {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${OPTIC_EXTENSION_INSTALL_PATH}`;
}

export function getOpticExtensionPrimaryInstallUrl(): string | null {
  if (OPTIC_EXTENSION_CHROME_STORE_URL) return OPTIC_EXTENSION_CHROME_STORE_URL;
  return OPTIC_EXTENSION_DOWNLOAD_URL;
}

export function isChromeWebStoreInstall(): boolean {
  return Boolean(OPTIC_EXTENSION_CHROME_STORE_URL);
}
