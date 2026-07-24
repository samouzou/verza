const REGION = "us-central1";
const FUNCTIONS_EMULATOR_ORIGIN = "http://localhost:5001";

export function resolveCallableUrl(
  projectId: string,
  name: string,
  useFunctionsEmulator: boolean
): string {
  if (useFunctionsEmulator) {
    return `${FUNCTIONS_EMULATOR_ORIGIN}/${projectId}/${REGION}/${name}`;
  }
  return `https://${REGION}-${projectId}.cloudfunctions.net/${name}`;
}

export async function callFunction<T>(
  projectId: string,
  name: string,
  idToken: string,
  data: Record<string, unknown>,
  useFunctionsEmulator = false
): Promise<T> {
  const url = resolveCallableUrl(projectId, name, useFunctionsEmulator);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Callable ${name} failed (${res.status})`);
  }
  return json.result as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
