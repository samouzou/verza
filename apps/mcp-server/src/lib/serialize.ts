/** Serialize Firestore-ish values to JSON-safe structures. */
export function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as {toDate?: () => Date}).toDate === "function") {
    try {
      return (value as {toDate: () => Date}).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = jsonSafe(v);
  }
  return out;
}

export function toolText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(jsonSafe(data), null, 2),
      },
    ],
  };
}

export function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true as const,
    content: [{type: "text" as const, text: message}],
  };
}
