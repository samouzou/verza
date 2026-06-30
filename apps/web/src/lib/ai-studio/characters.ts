import type { Character } from "@/types";

export function buildCharacterPortraitPrompt(
  name: string,
  description: string,
  style: string
): string {
  return (
    `Character reference portrait for "${name}": ${description}. ` +
    `Single character, centered composition, neutral studio background, ${style} style, ` +
    "consistent character design suitable for reuse across scenes. No text, logos, or watermarks."
  );
}

export function applyCharacterToPrompt(
  prompt: string,
  character: Character,
  mode: "text" | "image-reference"
): string {
  const identity = `Featuring "${character.name}" (${character.description}).`;
  if (mode === "image-reference") {
    return `${identity} Using this exact character reference, create: ${prompt}`;
  }
  return `${identity} ${prompt}`;
}
