/** Ink + Evergreen hex tokens for inline HTML emails (clients ignore CSS variables). */
export const EMAIL_BRAND_PRIMARY = "#0E7C5A";
export const EMAIL_BRAND_ACCENT = "#16C088";
export const EMAIL_BRAND_INK = "#0B100E";

/** Standard CTA button inline style for transactional emails. */
export function emailButtonStyle(borderRadius = "8px"): string {
  return (
    `background-color: ${EMAIL_BRAND_PRIMARY}; color: white; padding: 12px 24px; ` +
    `text-decoration: none; border-radius: ${borderRadius}; font-weight: bold; display: inline-block;`
  );
}
