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

// One draft per thing being edited. Changes meant for the published list are not the same
// changes as ones meant for a particular suggestion, and replaying either onto the other
// would be quietly wrong.
const keyFor = (source) => `${KEY}.${source}`;

export function loadDraft(source) {
  try {
    // Drafts from before there was more than one thing to edit belonged to the list itself.
    const old = localStorage.getItem(KEY);
    if (old && source === "main" && !localStorage.getItem(keyFor(source))) {
      localStorage.setItem(keyFor(source), old);
      localStorage.removeItem(KEY);
    }

    const raw = localStorage.getItem(keyFor(source));
    if (!raw) return null;

    const draft = JSON.parse(raw);
    if (draft.draftVersion !== VERSION || !Array.isArray(draft.intents)) {
      // Written by an older build. Throwing it away is kinder than replaying something
      // whose shape we can no longer reason about.
      localStorage.removeItem(keyFor(source));
      return null;
    }
    return draft;
  } catch (error) {
    return null;
  }
}

export function saveDraft({ source, version, intents }) {
  try {
    if (!intents.length) return clearDraft(source);
    localStorage.setItem(
      keyFor(source),
      JSON.stringify({ draftVersion: VERSION, version, savedAt: new Date().toISOString(), intents }),
    );
  } catch (error) {
    // Storage full, or blocked in this browser. Editing carries on; only the coming-back-
    // tomorrow part is lost, and saying so on every keystroke would be worse than silence.
  }
}

export function clearDraft(source) {
  try {
    localStorage.removeItem(keyFor(source));
  } catch (error) {
    /* nothing to do */
  }
}

/**
 * What is waiting under some other version, so the switcher can say so. Somebody who left
 * changes on the published list and went to look at a suggestion should not have to switch
 * back to find out whether they still have them.
 */
export function draftSummary(source) {
  try {
    const raw = localStorage.getItem(keyFor(source));
    if (!raw) return null;

    const draft = JSON.parse(raw);
    if (!Array.isArray(draft.intents) || !draft.intents.length) return null;
    return { count: draft.intents.length, savedAt: draft.savedAt };
  } catch (error) {
    return null;
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
