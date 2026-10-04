import {EMAIL_BRAND_PRIMARY, emailButtonStyle} from "../emailBrand";

export type WeeklyCampaignRow = {
  title: string;
  qualified: number;
  reachedOut: number;
  inProgress: number;
  booked: number;
  readyToContact: number;
};

export type WeeklyReadyCreator = {
  name: string;
  matchScore: number | null;
  campaignTitle: string | null;
};

export type WeeklyDigestEmailData = {
  agencyName: string;
  recipientName: string;
  weekLabel: string;
  headline: string;
  quiet: boolean;
  totals: {qualified: number; reachedOut: number; inProgress: number; booked: number; readyToContact: number};
  /** Null on the first report (nothing to compare against). */
  deltas: {reachedOut: number; replies: number; rateCards: number; booked: number} | null;
  newLeads: number;
  contactedThisWeek: number;
  campaigns: WeeklyCampaignRow[];
  moreCampaigns: number;
  readyCreators: WeeklyReadyCreator[];
  credits: {balance: number; allowance: number; periodEndLabel: string | null} | null;
  appUrl: string;
  unsubscribeUrl: string;
};

/**
 * HTML-escapes user-provided text.
 * @param {string} value Raw text.
 * @return {string} Escaped text.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Whole-number percentage.
 * @param {number} part Numerator.
 * @param {number} whole Denominator.
 * @return {string} e.g. "86%".
 */
function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}

/**
 * Number with an explicit plus sign when positive.
 * @param {number} n Value.
 * @return {string} e.g. "+4".
 */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

const CELL = "padding: 10px 8px; font-size: 14px; color: #1a202c; text-align: right;";
const HEAD = "padding: 8px; font-size: 11px; color: #a0aec0; text-transform: uppercase; text-align: right;";

/**
 * One headline number cell.
 * @param {string} value Trusted HTML value.
 * @param {string} label Caption.
 * @return {string} Table cell HTML.
 */
function statTile(value: string, label: string): string {
  return `<td style="padding: 12px; text-align: center; width: 25%;">
    <div style="font-size: 24px; font-weight: 800; color: #1a202c;">${value}</div>
    <div style="font-size: 12px; color: #718096; margin-top: 2px;">${label}</div>
  </td>`;
}

/**
 * Subject line: leads with the campaign's most useful numbers.
 * @param {WeeklyDigestEmailData} d Digest data.
 * @return {string} Subject.
 */
export function weeklyDigestSubject(d: WeeklyDigestEmailData): string {
  const {inProgress, readyToContact, booked} = d.totals;
  if (d.quiet) {
    return readyToContact > 0 ?
      `Optic Weekly: ${readyToContact} creators ready to contact` :
      `Optic Weekly: a quiet week for ${d.agencyName}`;
  }
  const parts = [`${inProgress} in conversation`];
  if (booked > 0) parts.push(`${booked} booked`);
  if (readyToContact > 0) parts.push(`${readyToContact} ready to contact`);
  return `Optic Weekly: ${parts.join(", ")}`;
}

/**
 * Inline-styled HTML for the Monday Optic Weekly email.
 * @param {WeeklyDigestEmailData} d Digest data.
 * @return {string} HTML document.
 */
export function weeklyDigestHtml(d: WeeklyDigestEmailData): string {
  const t = d.totals;
  const vaultUrl = `${d.appUrl}/optic/vault`;

  const deltaLine = d.deltas ?
    `Since last week: ${signed(d.deltas.reachedOut)} reached out, ${signed(d.deltas.replies)} replies, ` +
      `${signed(d.deltas.rateCards)} rate cards, ${signed(d.deltas.booked)} booked.` :
    `This week: ${d.newLeads} new creators found, ${d.contactedThisWeek} contacted.`;

  const campaignRows = d.campaigns.map((c) => `<tr style="border-top: 1px solid #edf2f7;">
      <td style="padding: 10px 8px; font-size: 14px; color: #1a202c; font-weight: 600;">${esc(c.title)}</td>
      <td style="${CELL}">${c.reachedOut}/${c.qualified}</td>
      <td style="${CELL}">${c.inProgress}</td>
      <td style="${CELL}">${c.booked}</td>
      <td style="${CELL}">${c.readyToContact}</td>
    </tr>`).join("");

  const campaignsBlock = d.campaigns.length > 1 ? `
    <h2 style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #a0aec0; margin: 0 0 8px 0;">
      By campaign</h2>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
      <tr>
        <th style="${HEAD} text-align: left;">Campaign</th>
        <th style="${HEAD}">Reached</th>
        <th style="${HEAD}">In play</th>
        <th style="${HEAD}">Booked</th>
        <th style="${HEAD}">Ready</th>
      </tr>
      ${campaignRows}
    </table>
    ${d.moreCampaigns > 0 ?
    `<p style="font-size: 12px; color: #a0aec0; margin: 0 0 24px 0;">and ${d.moreCampaigns} more in the vault</p>` :
    "<div style=\"margin-bottom: 24px;\"></div>"}` : "";

  const readyBlock = d.readyCreators.length ? `
    <div style="background-color: #f0fdf7; border: 1px solid #c6f0dc; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 700; color: #1a202c;">
        ${t.readyToContact} creator${t.readyToContact === 1 ? " is" : "s are"} ready for a first touch</p>
      ${d.readyCreators.map((c) => `<p style="margin: 0 0 6px 0; font-size: 14px; color: #2d3748;">
        <strong>${esc(c.name)}</strong>${c.matchScore != null ? ` · ${c.matchScore}% match` : ""}${
  c.campaignTitle ? ` <span style="color: #718096;">· ${esc(c.campaignTitle)}</span>` : ""}</p>`).join("")}
      <div style="margin-top: 16px;"><a href="${vaultUrl}" style="${emailButtonStyle()}">Open the vault</a></div>
    </div>` : `
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="${vaultUrl}" style="${emailButtonStyle()}">Open the vault</a>
    </div>`;

  const creditsBlock = d.credits ? `
    <p style="font-size: 13px; color: #718096; margin: 0 0 24px 0; text-align: center;">
      ${d.credits.balance.toLocaleString("en-US")} of ${d.credits.allowance.toLocaleString("en-US")} included leads left${
  d.credits.periodEndLabel ? ` · renews ${esc(d.credits.periodEndLabel)}` : ""}${
  d.credits.allowance > 0 && d.credits.balance / d.credits.allowance <= 0.2 ?
    ` · <a href="${d.appUrl}/optic" style="color: ${EMAIL_BRAND_PRIMARY};">top up or upgrade</a>` : ""}
    </p>` : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="background-color: #f4f4f7; padding: 40px 20px;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 600px; margin: auto; padding: 40px; border: 1px solid #e2e8f0;
    border-radius: 16px; background-color: #ffffff;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="https://app.tryverza.com/verza-icon.svg" alt="Verza" width="24" height="18"
        style="vertical-align: middle; margin-right: 8px;">
      <span style="font-weight: bold; font-size: 22px; color: #000000; vertical-align: middle;">Optic Weekly</span>
      <p style="color: #a0aec0; font-size: 13px; margin: 8px 0 0 0;">${esc(d.agencyName)} · ${esc(d.weekLabel)}</p>
    </div>

    <p style="font-size: 16px; color: #2d3748; line-height: 1.6; margin: 0 0 24px 0;">
      Hi ${esc(d.recipientName)}, ${esc(d.headline)}</p>

    <table style="width: 100%; border-collapse: collapse; background-color: #f8fafc;
      border: 1px solid #edf2f7; border-radius: 12px; margin-bottom: 12px;">
      <tr>
        ${statTile(`${t.reachedOut}<span style="font-size: 14px; color: #718096;">/${t.qualified}</span>`,
    `reached out (${pct(t.reachedOut, t.qualified)})`)}
        ${statTile(String(t.inProgress), "in conversation")}
        ${statTile(String(t.booked), "booked")}
        ${statTile(String(t.readyToContact), "ready to contact")}
      </tr>
    </table>
    <p style="font-size: 13px; color: #718096; margin: 0 0 24px 0; text-align: center;">${esc(deltaLine)}</p>

    ${d.quiet ? "" : campaignsBlock}
    ${readyBlock}
    ${creditsBlock}

    <div style="text-align: center; border-top: 1px solid #edf2f7; padding-top: 24px;">
      <p style="color: #a0aec0; font-size: 12px; margin: 0;">
        Counts cover creators qualified for outreach: those with a public email and a match score of 70 or more,
        plus anyone you've already contacted.</p>
      <p style="color: #a0aec0; font-size: 12px; margin: 8px 0 0 0;">
        <a href="${d.unsubscribeUrl}" style="color: #a0aec0;">Unsubscribe from Optic Weekly</a></p>
    </div>
  </div>
</body>
</html>`;
}
