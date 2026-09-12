/** Create drafts and send mail in the user's Gmail account. */
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

/** Read threads so the vault can show replies (add this scope on the OAuth consent screen). */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export const GMAIL_OAUTH_SCOPES = `${GMAIL_COMPOSE_SCOPE} ${GMAIL_READONLY_SCOPE}`;

export const GMAIL_CREDENTIAL_DOC_ID = "gmail";

export function gmailScopeListHasRead(scope: string | undefined): boolean {
  return typeof scope === "string" && scope.includes("gmail.readonly");
}
