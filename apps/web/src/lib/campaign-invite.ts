export const inviteCreatorStorageKey = (gigId: string) => `verza.inviteCreator.${gigId}`;

export function peekInviteCreatorId(gigId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(inviteCreatorStorageKey(gigId));
  } catch {
    return null;
  }
}

export function storeInviteCreatorId(gigId: string, creatorId: string) {
  try {
    window.sessionStorage.setItem(inviteCreatorStorageKey(gigId), creatorId);
  } catch {
    // ignore quota / private mode
  }
}

export function clearInviteCreatorId(gigId: string) {
  try {
    window.sessionStorage.removeItem(inviteCreatorStorageKey(gigId));
  } catch {
    // ignore
  }
}
