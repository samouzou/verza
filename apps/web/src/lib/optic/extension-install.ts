/** Chrome Web Store listing — default is the published Optic Scout page. */
export const OPTIC_EXTENSION_CHROME_STORE_URL =
  process.env.NEXT_PUBLIC_OPTIC_EXTENSION_CHROME_STORE_URL?.trim() ||
  "https://chromewebstore.google.com/detail/verza-optic-scout/gadlmiiglpoifbofgncjnhfkcifhkkia";

/** Hosted zip fallback for sideload / early-access installs. */
export const OPTIC_EXTENSION_DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_OPTIC_EXTENSION_DOWNLOAD_URL?.trim() ||
  "/downloads/verza-optic-scout.zip";

export const OPTIC_EXTENSION_INSTALL_PATH = "/optic/extension";

export function getOpticExtensionInstallUrl(origin?: string): string {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${OPTIC_EXTENSION_INSTALL_PATH}`;
}

/** Prefer the Chrome Web Store when published; zip is the sideload fallback. */
export function getOpticExtensionPrimaryInstallUrl(): string | null {
  if (OPTIC_EXTENSION_CHROME_STORE_URL) return OPTIC_EXTENSION_CHROME_STORE_URL;
  return OPTIC_EXTENSION_DOWNLOAD_URL;
}

export function isChromeWebStoreInstall(): boolean {
  return Boolean(OPTIC_EXTENSION_CHROME_STORE_URL);
}
