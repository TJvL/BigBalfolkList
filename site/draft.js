// The draft on this computer.
//
// Only intents are kept, never a copy of the edited list: replaying intents onto the current
// dances.json keeps whatever other people merged while the draft sat, and a stored copy would
// undo it. The version the draft was made against rides along so a stale one can say so.
//
// Nothing here is a secret. The list is public, and a signed-in contributor's token is
// deliberately never written to storage.

const KEY = "bigbalfolklist.draft";
const VERSION = 1;

export function loadDraft() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const draft = JSON.parse(raw);
    if (draft.draftVersion !== VERSION || !Array.isArray(draft.intents)) {
      // Written by an older build. Throwing it away is kinder than replaying something
      // whose shape we can no longer reason about.
      localStorage.removeItem(KEY);
      return null;
    }
    return draft;
  } catch (error) {
    return null;
  }
}

export function saveDraft({ version, intents }) {
  try {
    if (!intents.length) return clearDraft();
    localStorage.setItem(
      KEY,
      JSON.stringify({ draftVersion: VERSION, version, savedAt: new Date().toISOString(), intents }),
    );
  } catch (error) {
    // Storage full, or blocked in this browser. Editing carries on; only the coming-back-
    // tomorrow part is lost, and saying so on every keystroke would be worse than silence.
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch (error) {
    /* nothing to do */
  }
}

/** "3 days ago", for telling someone how old the draft they just resumed is. */
export function since(iso) {
  const then = Date.parse(iso);
  if (!then) return "earlier";

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
