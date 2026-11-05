/**
 * The local draft: the open diagram is kept in this browser so a refresh, a closed tab or a crash
 * loses nothing. Storage can be missing, full or blocked; every call says whether it worked, and the
 * page keeps running either way (the link in the address bar still holds short diagrams).
 */
import type { Workspace } from "../core/doc/project";

const DRAFT = "chalk:draft";
const PREVIOUS = "chalk:previous";

export interface Draft { text: string; savedAt: string; workspace?: Workspace }

function read(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Draft>;
    if (typeof v.text !== "string" || !v.text.trim()) return null;
    return { text: v.text, savedAt: typeof v.savedAt === "string" ? v.savedAt : "", ...(v.workspace && typeof v.workspace === "object" ? { workspace: v.workspace } : {}) };
  } catch {
    return null;
  }
}

function write(key: string, d: Draft): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export const loadDraft = (): Draft | null => read(DRAFT);
export const loadPrevious = (): Draft | null => read(PREVIOUS);

/** Save the open diagram. Returns false when the browser refused (private mode, quota, blocked storage). */
export function saveDraft(text: string, workspace: Workspace): boolean {
  return write(DRAFT, { text, savedAt: new Date().toISOString(), workspace });
}

/** Before a different diagram replaces the draft, keep the old one where "open" can find it. */
export function keepPrevious(): void {
  const d = read(DRAFT);
  if (d) write(PREVIOUS, d);
}
