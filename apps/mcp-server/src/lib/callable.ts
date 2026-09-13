import {getAuth} from "firebase-admin/auth";

export type CallableClientOptions = {
  projectId: string;
  /** Firebase Web API key (same as NEXT_PUBLIC_FIREBASE_API_KEY). */
  webApiKey: string;
  /** Cloud Functions region for callables (default us-central1). */
  region?: string;
};

type CachedIdToken = {uid: string; idToken: string; expiresAtMs: number};

/**
 * Invokes a Firebase callable HTTPS function as a specific user via custom token.
 */
export class VerzaCallableClient {
  private cache: CachedIdToken | null = null;
  private readonly region: string;

  constructor(private readonly opts: CallableClientOptions) {
    this.region = opts.region?.trim() || "us-central1";
  }

  private async idTokenForUid(uid: string): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.uid === uid && this.cache.expiresAtMs > now + 60_000) {
      return this.cache.idToken;
    }

    const customToken = await getAuth().createCustomToken(uid);
    const url =
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken` +
      `?key=${encodeURIComponent(this.opts.webApiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({token: customToken, returnSecureToken: true}),
    });
    const body = (await res.json()) as {
      idToken?: string;
      expiresIn?: string;
      error?: {message?: string};
    };
    if (!res.ok || !body.idToken) {
      throw new Error(
        `Firebase Auth custom-token exchange failed: ${body.error?.message || res.statusText}`
      );
    }
    const expiresInSec = Number.parseInt(body.expiresIn || "3600", 10);
    this.cache = {
      uid,
      idToken: body.idToken,
      expiresAtMs: now + Math.max(60, expiresInSec) * 1000,
    };
    return body.idToken;
  }

  async call<T = unknown>(uid: string, functionName: string, data: unknown): Promise<T> {
    const idToken = await this.idTokenForUid(uid);
    const url =
      `https://${this.region}-${this.opts.projectId}.cloudfunctions.net/${functionName}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({data}),
    });

    const payload = (await res.json()) as {
      result?: T;
      error?: {message?: string; status?: string};
    };

    if (!res.ok || payload.error) {
      const msg =
        payload.error?.message ||
        `Callable ${functionName} failed (${res.status} ${res.statusText})`;
      throw new Error(msg);
    }
    return payload.result as T;
  }
}
