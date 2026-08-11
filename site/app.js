// What the page does.
//
// One state object, one render. Every change goes through store.run(), which records the
// intent and saves the draft, so nothing here has to remember to keep those in step.

import { $, button, el } from "./dom.js";
import { fold } from "./fold.js";
import { draftSummary, since } from "./draft.js";
import { createStore } from "./store.js";
import { matches, renderCard, renderCloud } from "./browse.js";
import { bulkBar, familyDialog, newDanceDialog, renderOpenCard } from "./editor.js";
import { renderTags } from "./tags.js";
import { renderWords } from "./words.js";
import * as github from "./github.js";
import * as config from "./config.js";
import { canonical } from "./canonical.js";

const ui = {
  editing: false,
  view: "dances",
  expanded: null,
  picked: new Set(),
  selected: new Set(),
  combine: "any",
  query: "",
  tagFilter: "",
  wordFilter: "",
};

let store;
let openSuggestions = [];
let editable = true;

const actions = {
  toggleTag(tag) {
    ui.selected.has(tag) ? ui.selected.delete(tag) : ui.selected.add(tag);
    render();
  },
  expand(slug) {
    ui.expanded = slug;
    render();
  },
  deselectAll() {
    ui.picked.clear();
    render();
  },
  filterTags(value) {
    ui.tagFilter = value.trim().toLowerCase();
    render();
    const again = document.querySelector(".tagbar input");
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  },
  filterWords(value) {
    ui.wordFilter = value.trim().toLowerCase();
    render();
    const again = document.querySelector(".tagbar input");
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  },
  rerender(after) {
    render();
    if (after) requestAnimationFrame(after);
  },
};

// ---------- rendering ----------

function card(dance, index) {
  const open = ui.editing && ui.expanded === dance.slug;
  const node = el("article", "card");
  node.dataset.slug = dance.slug;
  node.style.animationDelay = Math.min(index, 24) * 8 + "ms";
  if (open) node.classList.add("open");
  if (ui.picked.has(dance.slug)) node.classList.add("picked");
  if (ui.editing && touched(dance)) node.classList.add("touched");

  const slug = el("div", "slug");
  const identity = el("span", "slug-text", dance.slug);
  identity.title = dance.slug;
  slug.append(identity);
  if (open) slug.append(el("span", "fixed", "permanent"));
  node.append(slug);

  if (ui.editing) {
    const acts = el("div", "card-acts");

    if (!open) {
      acts.append(
        button(null, "edit", () => actions.expand(dance.slug), {
          title: "Open this dance for editing",
        }),
      );
    }

    acts.append(
      button(null, ui.picked.has(dance.slug) ? "selected" : "select", () => {
        ui.picked.has(dance.slug) ? ui.picked.delete(dance.slug) : ui.picked.add(dance.slug);
        render();
      }, { pressed: ui.picked.has(dance.slug) }),
    );

    if (open) {
      acts.append(
        button(null, "make a tag", () => familyDialog($("family"), store, dance), {
          title: "This name covers several dances, not one",
        }),
        button(null, "delete", () => {
          store.run({ op: "dance.remove", slug: dance.slug });
          ui.expanded = null;
          render();
        }),
        button(null, "close", () => {
          ui.expanded = null;
          render();
        }),
      );
    }

    node.append(acts);
  }

  if (open) renderOpenCard(node, store, dance, actions);
  else renderCard(node, store, dance, ui, actions);

  return node;
}

/**
 * Go to a card and put the cursor in it.
 *
 * The list is sorted by short name, so a dance added at the top of the alphabet or the bottom
 * lands wherever it belongs — which, on a page this long, is usually off screen. Without this
 * the only sign that anything happened is the change count ticking up.
 */
function reveal(slug) {
  requestAnimationFrame(() => {
    const card = document.querySelector(`.card[data-slug="${CSS.escape(slug)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.querySelector(".token-input")?.focus({ preventScroll: true });
  });
}

function touched(dance) {
  const before = store.published.dances.find((d) => d.slug === dance.slug);
  if (!before) return true;
  return (
    before.names.join("|") !== dance.names.join("|") || before.tags.join("|") !== dance.tags.join("|")
  );
}

function render() {
  document.body.classList.toggle("editing", ui.editing);
  $("tray").hidden = !ui.editing;
  $("views").hidden = !ui.editing;
  $("strap").hidden = ui.editing;

  const listView = ui.editing && ui.view !== "dances";
  $("searchbox").hidden = listView;
  $("shell").classList.toggle("wide", listView);
  $("rail").hidden = listView;

  const main = $("main");
  main.replaceChildren();

  if (listView) {
    const words = ui.view === "words";
    main.append(words ? renderWords(store, ui, actions) : renderTags(store, ui, actions));
    $("tally").innerHTML = words
      ? `<b>${store.words().length}</b> words`
      : `<b>${store.list.tags.length}</b> tags`;
    renderTray();
    return;
  }

  if (ui.editing && ui.picked.size) main.append(bulkBar(store, ui.picked, actions));

  const shown = store.list.dances.filter((d) => matches(store, d, ui));
  if (ui.expanded && !shown.some((d) => d.slug === ui.expanded)) ui.expanded = null;

  const grid = el("div", "grid");
  shown.forEach((dance, i) => grid.append(card(dance, i)));
  main.append(grid);

  if (!shown.length) {
    main.append(el("div", "empty", "Nothing under that combination. Try any instead of all."));
  }

  refreshSourceLabels();
  renderCloud($("cloud"), store, ui, actions);
  $("clear").hidden = ui.selected.size === 0;

  const filtering = ui.selected.size || ui.query;
  $("tally").innerHTML = filtering
    ? `<b>${shown.length}</b> of ${store.list.dances.length} dances`
    : `<b>${store.list.dances.length}</b> dances · <b>${store.list.tags.length}</b> tags`;
  $("qclear").hidden = !ui.query;

  renderTray();
}

function renderTray() {
  const changes = store.changes();
  $("tray-count").innerHTML = `<b>${changes.length}</b> change${changes.length === 1 ? "" : "s"}`;
  $("propose").disabled = changes.length === 0;
  $("discard").disabled = changes.length === 0;
  $("draft").hidden = changes.length === 0;

  const list = $("log");
  list.replaceChildren();
  for (const change of [...changes].reverse()) {
    const item = el("li");
    item.append(el("span", "verb", change.verb), el("span", null, change.text));
    list.append(item);
  }
}

/** One line at the top of the page, for something the reader has to know right now. */
function say(message) {
  const banner = $("resumed");
  banner.replaceChildren(
    el("p", "stale-head", message),
    button("btn quiet", "Got it", () => (banner.hidden = true)),
  );
  banner.hidden = false;
}

/** A resumed draft says what it could not put back, rather than dropping it in silence. */
function renderResumed() {
  const banner = $("resumed");
  if (!store.intents.length && !store.stale.length) return (banner.hidden = true);
  if (!store.resumedAt) return (banner.hidden = true);

  banner.replaceChildren();
  banner.append(
    el(
      "p",
      null,
      `Picked up where you left off ${since(store.resumedAt)}, on the list as it stands now.`,
    ),
  );

  if (store.stale.length) {
    const list = el("ul", "stale");
    for (const { intent, reason } of store.stale) {
      list.append(el("li", null, `${describeShort(intent)} — ${reason}`));
    }
    banner.append(
      el("p", "stale-head", `${store.stale.length} of your changes no longer fit and were left out:`),
      list,
    );
  }

  banner.append(
    button("btn quiet", "Got it", () => {
      store.dismissStale();
      banner.hidden = true;
    }),
  );
  banner.hidden = false;
}

const describeShort = (intent) =>
  intent.op.startsWith("name")
    ? `${intent.value} on ${intent.slug}`
    : intent.op.startsWith("tag")
      ? `${intent.tag || intent.from} on ${intent.slug || "the tag list"}`
      : intent.op.startsWith("word")
        ? `${intent.word} in the word lists`
        : intent.slug;

// ---------- the proposal ----------

const jsonLine = (dance) =>
  "  " + JSON.stringify({ slug: dance.slug, names: dance.names, tags: dance.tags }) + ",";

function buildDiff(against) {
  const diff = $("diff");
  const { rows, tagsChanged, before, after, wordsChanged, wordsBefore, wordsAfter } =
    against || store.diff();

  diff.replaceChildren();
  diff.append(el("span", "file", "dances.json\n"));

  if (wordsChanged) {
    for (const [kind, list] of [
      ["del", wordsBefore],
      ["add", wordsAfter],
    ]) {
      const mark = kind === "del" ? "- " : "+ ";
      diff.append(el("span", kind, mark + '  "ignoredWords": ' + JSON.stringify(list.ignoredWords) + ",\n"));
      diff.append(el("span", kind, mark + '  "numberWords": ' + JSON.stringify(list.numberWords) + ",\n"));
    }
  }

  if (tagsChanged) {
    diff.append(el("span", "del", '-   "tags": ' + JSON.stringify(before) + ",\n"));
    diff.append(el("span", "add", '+   "tags": ' + JSON.stringify(after) + ",\n"));
  }

  for (const row of rows) {
    diff.append(el("span", row.kind, (row.kind === "del" ? "- " : "+ ") + jsonLine(row.dance) + "\n"));
  }

  if (!rows.length && !tagsChanged && !wordsChanged) {
    diff.append(el("span", "file", "(nothing changed)"));
  }
}

/**
 * Opening the dialog rebuilds the draft on the list as the server has it this second, so the
 * line promising exactly that is true rather than decorative.
 */
/** Which open pull request these changes join, or none for a fresh one. */
let target = null;

async function openProposal(options = {}) {
  buildDiff();
  $("pr-go").disabled = false;
  $("pr-go").textContent = goLabel();
  $("pr").showModal();

  const choice = await renderWhere();
  await refreshProposal();

  // Coming back from signing in, the press that sent us there still stands. Carrying on
  // finishes what was asked for, unless signing in has just revealed a question only the
  // contributor can answer: which of their open suggestions these changes belong to.
  if (options.send && !choice) await openPullRequest();
}

/**
 * Somebody with a suggestion still open usually means the follow-up to belong to it. Offering
 * both beats guessing: a second pull request is right when the subjects are unrelated, and
 * wrong when it is more of the same.
 *
 * Says whether it actually asked anything, so nothing sends over the top of a question.
 */
async function renderWhere() {
  const where = $("where");
  where.hidden = true;
  where.replaceChildren();

  // Editing a suggestion: there is nowhere else these could go.
  if (store.suggestion) {
    target = store.suggestion;
    where.append(
      el("span", "eyebrow", "Where these go"),
      el("p", "hint", `Onto suggestion #${store.suggestion.number}, which is what you have been editing.`),
    );
    where.hidden = false;
    return false;
  }

  if (!github.signedIn()) return false;

  let mine = [];
  try {
    mine = (await github.suggestions()).filter(github.mine);
  } catch (error) {
    return false;
  }
  if (!mine.length) return false;

  target = mine[0];
  where.append(el("span", "eyebrow", "Where these go"));

  const group = el("div", "choice");
  const option = (value, checked, title, why) => {
    const label = el("label");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "where";
    radio.checked = checked;
    radio.addEventListener("change", () => {
      target = value;
      refreshProposal();
    });
    label.append(radio, el("strong", null, title), el("span", "why", why));
    group.append(label);
  };

  for (const suggestion of mine) {
    option(
      suggestion,
      suggestion === target,
      `Add to your open suggestion #${suggestion.number}`,
      suggestion.title,
    );
  }
  option(null, false, "Open a separate pull request", "For changes that have nothing to do with the above.");

  where.append(group);
  where.hidden = false;
  return true;
}

/**
 * What the button will do, said before it does it. Signing in leaves the page, and a button
 * that promised a pull request instead of saying so reads as the press having done nothing.
 */
function goLabel() {
  const send = target ? `add to #${target.number}` : "open pull request";
  const label = github.signedIn() ? send : `sign in and ${send}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Rebuild the diff against whatever the changes are going to be added to. */
async function refreshProposal() {
  const note = $("rebuilt");
  note.textContent = "Checking for changes by other people…";
  note.classList.remove("bad");
  $("pr-go").textContent = goLabel();

  try {
    const rebuilt = await github.rebuild(store.intents, target);
    buildDiff(compare(rebuilt.before, rebuilt.list));

    const { stale } = rebuilt;
    const base = target
      ? `your open suggestion #${target.number}`
      : "the list as it stands right now";
    note.textContent = stale.length
      ? `Rebuilt on ${base}. ${stale.length} of your changes no longer fit and will be left out.`
      : `Rebuilt a moment ago on ${base}, so anything that changed while you were working is already in.`;
    note.classList.toggle("bad", stale.length > 0);
  } catch (error) {
    if (error.gone) {
      // Saying "fine to send" here would be a lie: there is nothing left to send it to.
      target = null;
      note.textContent = `${error.message} Your changes are safe, and will open a new suggestion instead.`;
      note.classList.add("bad");
      $("pr-go").textContent = goLabel();
      return;
    }
    // Rate limited, or offline. The proposal still works; it is the reassurance that does not.
    note.textContent = "Could not reach GitHub to check for newer changes. Yours are still fine to send.";
  }
}

async function openPullRequest() {
  const button_ = $("pr-go");
  const note = $("rebuilt");

  if (!config.canSignIn()) {
    note.textContent = "This copy of the site has no GitHub app set up yet, so use the other button for now.";
    note.classList.add("bad");
    return;
  }

  if (!github.signedIn()) {
    // Leaves the page. The draft is in localStorage, so it is waiting on the way back, and
    // start() reopens this dialog and finishes the send, rather than asking for the press again.
    note.textContent =
      "Taking you to GitHub to sign in. Your changes are kept, and this carries straight on afterwards.";
    note.classList.remove("bad");
    button_.disabled = true;
    button_.textContent = "Signing in…";
    rememberViewing();
    github.signIn();
    return;
  }

  button_.disabled = true;
  try {
    button_.textContent = target ? "Adding…" : "Opening…";
    const { opened, stale, added } = await github.propose(store.intents, target);

    if (!opened) {
      note.textContent = "None of your changes still apply to the list. Nothing was sent.";
      note.classList.add("bad");
      return;
    }

    store.discard();
    $("pr").close();
    showOpened(opened.html_url, stale.length, added, opened.number);

    // The switcher is filled once, at load. A suggestion opened since then is missing from it,
    // which reads as the switcher having lost it rather than never having seen it.
    openSuggestions = await github.suggestions().catch(() => openSuggestions);
    renderSource();
  } catch (error) {
    if (error.gone) {
      // Falls back to a new suggestion rather than losing the work; one more press sends it.
      target = null;
      note.textContent = `${error.message} Press again to open a new one with these changes.`;
    } else {
      note.textContent = error.message;
    }
    note.classList.add("bad");
  } finally {
    button_.disabled = false;
    button_.textContent = goLabel();
  }
}

function showOpened(url, leftOut, added, number) {
  const banner = $("resumed");
  banner.replaceChildren();
  banner.append(el("p", null, "Sent. Thank you."));

  const link = el("a", null, `suggestion #${number}`);
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";

  const line = el("p", null, added ? "Added to " : "Someone will look at it: ");
  line.append(link);
  banner.append(line);

  if (leftOut) {
    banner.append(el("p", "stale-head", `${leftOut} changes were left out because the list had moved on.`));
  }

  banner.append(button("btn quiet", "Got it", () => (banner.hidden = true)));
  banner.hidden = false;
}

/** The same shape store.diff() returns, for any two versions of the list. */
function compare(before, after) {
  const was = new Map(before.dances.map((d) => [d.slug, d]));
  const is = new Map(after.dances.map((d) => [d.slug, d]));
  const same = (a, b) =>
    a && b && a.names.join("|") === b.names.join("|") && a.tags.join("|") === b.tags.join("|");

  const rows = [];
  for (const [slug, dance] of is) {
    if (same(was.get(slug), dance)) continue;
    if (was.has(slug)) rows.push({ kind: "del", dance: was.get(slug) });
    rows.push({ kind: "add", dance });
  }
  for (const [slug, dance] of was) {
    if (!is.has(slug)) rows.push({ kind: "del", dance });
  }

  // Sorted, or a word removed and added back would read as a change purely because its key
  // landed at the other end of the object.
  const words = (list) =>
    JSON.stringify([
      [...(list.ignoredWords || [])].sort(),
      Object.keys(list.numberWords || {})
        .sort()
        .map((word) => [word, list.numberWords[word]]),
    ]);

  return {
    rows,
    wordsChanged: words(before) !== words(after),
    wordsBefore: before,
    wordsAfter: after,
    tagsChanged: before.tags.join("|") !== after.tags.join("|"),
    before: before.tags,
    after: after.tags,
  };
}

// ---------- wiring ----------

function setMode(editing) {
  // Somebody else's suggestion is theirs to change, so it can be read and nothing else.
  ui.editing = editing && editable;
  $("mode-edit").disabled = !editable;
  $("mode-edit").title = editable ? "" : "Only the person who made this suggestion can change it";
  if (!editing) {
    ui.expanded = null;
    ui.picked.clear();
    ui.view = "dances";
  }
  $("mode-browse").setAttribute("aria-pressed", String(!editing));
  $("mode-edit").setAttribute("aria-pressed", String(editing));
  setView(ui.view);
}

const VIEWS = ["dances", "tags", "words"];

function setView(view) {
  ui.view = view;
  for (const name of VIEWS) {
    $(`view-${name}`).setAttribute("aria-pressed", String(view === name));
  }
  render();
}

function setCombine(combine) {
  ui.combine = combine;
  $("combine-any").setAttribute("aria-pressed", String(combine === "any"));
  $("combine-all").setAttribute("aria-pressed", String(combine === "all"));
  render();
}

function theme() {
  const box = $("theme");
  const read = () => {
    try {
      return localStorage.getItem("bigbalfolklist.theme") || "system";
    } catch (error) {
      return "system";
    }
  };

  const paint = (choice) => {
    if (choice === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", choice);
    for (const node of box.querySelectorAll("button")) {
      node.setAttribute("aria-pressed", String(node.dataset.themeChoice === choice));
    }
  };

  for (const node of box.querySelectorAll("button")) {
    node.addEventListener("click", () => {
      const choice = node.dataset.themeChoice;
      try {
        if (choice === "system") localStorage.removeItem("bigbalfolklist.theme");
        else localStorage.setItem("bigbalfolklist.theme", choice);
      } catch (error) {
        /* the choice still applies for this visit */
      }
      paint(choice);
    });
  }

  paint(read());
}

function wire() {
  $("mode-browse").addEventListener("click", () => setMode(false));
  $("mode-edit").addEventListener("click", () => setMode(true));

  $("export").addEventListener("click", () => {
    // Exactly what the site would commit, so it can be dropped straight into the repository
    // or fed to anything else that wants the list.
    const text = canonical(store.list);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));

    const link = document.createElement("a");
    link.href = url;
    link.download = "dances.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  $("source").addEventListener("change", async (event) => {
    const chosen = openSuggestions.find((s) => String(s.number) === event.target.value);
    try {
      await load(chosen || null);
      render();
    } catch (error) {
      // Merged or closed while this page sat open. Say so, drop it from the menu, and stay
      // where we were rather than leaving a dead selection behind.
      openSuggestions = await github.suggestions().catch(() => openSuggestions);
      renderSource();
      event.target.value = store.suggestion ? String(store.suggestion.number) : "main";
      say(error.gone ? error.message : "That could not be loaded. Try again in a moment.");
    }
  });
  for (const name of VIEWS) {
    $(`view-${name}`).addEventListener("click", () => setView(name));
  }
  $("combine-any").addEventListener("click", () => setCombine("any"));
  $("combine-all").addEventListener("click", () => setCombine("all"));

  $("q").addEventListener("input", (event) => {
    ui.query = fold(event.target.value);
    render();
  });
  $("qclear").addEventListener("click", () => {
    $("q").value = "";
    ui.query = "";
    $("q").focus();
    render();
  });
  $("clear").addEventListener("click", () => {
    ui.selected.clear();
    render();
  });

  $("new-dance").addEventListener("click", () => {
    newDanceDialog($("new"), store, (slug) => {
      // Any filter still on would hide the dance that was just added.
      ui.expanded = slug;
      ui.picked.clear();
      ui.selected.clear();
      ui.query = "";
      $("q").value = "";
      render();
      reveal(slug);
    });
  });

  $("toggle-log").addEventListener("click", () => {
    const log = $("tray-log");
    log.hidden = !log.hidden;
    $("toggle-log").textContent = log.hidden ? "Show changes" : "Hide changes";
  });

  $("discard").addEventListener("click", () => {
    const count = store.changes().length;
    $("confirm-what").textContent =
      count === 1
        ? "One change goes, and the list returns to how you found it."
        : `${count} changes go, and the list returns to how you found it.`;
    $("confirm").showModal();
  });
  $("confirm-no").addEventListener("click", () => $("confirm").close());
  $("confirm-yes").addEventListener("click", () => {
    $("confirm").close();
    store.discard();
  });

  $("propose").addEventListener("click", openProposal);
  $("pr-cancel").addEventListener("click", () => $("pr").close());
  $("pr-go").addEventListener("click", openPullRequest);

  $("pr-issue").addEventListener("click", () => {
    // No sign-in, no fork, no branch: the words go to a maintainer to apply.
    window.open(github.issueUrl(store.intents), "_blank", "noreferrer");
    $("pr").close();
  });
}

/**
 * Load a version of the list: the published one, or what a suggestion proposes.
 * Anyone may look at any of them; whether they may change it is decided separately.
 */
async function load(suggestion) {
  store = await createStore(suggestion);
  editable = await github.mayEdit(suggestion);

  if (!editable) {
    ui.editing = false;
    ui.expanded = null;
    ui.picked.clear();
  }

  store.subscribe(render);
  target = suggestion || null;
  renderSource();
  renderBranchBanner();
  setMode(ui.editing && editable);
  renderResumed();
}

const sourceOf = (value) => (value === "main" ? "main" : `pull-${value}`);

/**
 * A version with unsent changes is marked, so nothing is left behind by accident.
 * Labels are rewritten in place rather than rebuilding the menu, which would fight anyone
 * who has it open.
 */
function refreshSourceLabels() {
  for (const option of $("source").options) {
    const waiting = draftSummary(sourceOf(option.value));
    const label = option.dataset.label;
    const trimmed = label.length > 40 ? label.slice(0, 39) + "…" : label;
    option.textContent = waiting ? `• ${trimmed} — ${waiting.count} unsent` : trimmed;
  }
}

function renderSource() {
  const select = $("source");
  select.replaceChildren();

  const published = new Option("", "main", true, !store.suggestion);
  published.dataset.label = "the published list";
  select.append(published);

  for (const suggestion of openSuggestions) {
    // Whose it is comes before what it says: two people's suggestions otherwise read alike.
    const option = new Option(
      "",
      String(suggestion.number),
      false,
      store.suggestion?.number === suggestion.number,
    );
    option.dataset.label = `#${suggestion.number} · ${suggestion.author} · ${suggestion.title}`;
    select.append(option);
  }

  refreshSourceLabels();
  $("viewing").hidden = openSuggestions.length === 0;
}

function renderBranchBanner() {
  const banner = $("on-branch");
  const inner = banner.querySelector(".inner");
  inner.replaceChildren();

  if (!store.suggestion) return (banner.hidden = true);

  const suggestion = store.suggestion;
  inner.append(
    el("span", null, `You are looking at suggestion #${suggestion.number}, by ${suggestion.author}, as it currently stands.`),
  );

  const link = el("a", null, "see it on GitHub");
  link.href = suggestion.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  inner.append(link);

  if (editable) {
    inner.append(el("span", "locked", "you can change this one"));
  } else if (github.signedIn() || !config.canSignIn()) {
    inner.append(el("span", "locked", "read only — it is not yours"));
  } else {
    // Saying "sign in" without offering anywhere to do it is a dead end: the only other way in
    // is the proposal dialog, and a page nobody may change never has changes to propose.
    inner.append(el("span", "locked", "read only — sign in if it is yours"));
    inner.append(
      button("btn", "Sign in", () => {
        rememberViewing();
        github.signIn();
      }, { title: "Sign in with GitHub, and come back to this suggestion" }),
    );
  }

  banner.hidden = false;
}

const VIEWING_KEY = "bigbalfolklist.viewing";

/**
 * Which version is on screen, kept across the sign-in redirect.
 *
 * GitHub sends the contributor back to the bare page address, so without this, signing in to
 * edit a suggestion lands on the published list — having done exactly what was asked and
 * appearing to have ignored it.
 */
function rememberViewing() {
  try {
    sessionStorage.setItem(VIEWING_KEY, store.suggestion ? String(store.suggestion.number) : "main");
  } catch (error) {
    /* the sign-in still works; it just comes back on the published list */
  }
}

function takeRememberedViewing() {
  try {
    const value = sessionStorage.getItem(VIEWING_KEY);
    sessionStorage.removeItem(VIEWING_KEY);
    return value;
  } catch (error) {
    return null;
  }
}

async function start() {
  try {
    // Before anything is drawn, so the switcher is complete the first time it appears.
    openSuggestions = await github.suggestions().catch(() => []);
    store = await createStore();
  } catch (error) {
    $("main").replaceChildren(
      el("div", "empty", "The list could not be loaded. Reload the page, or try again shortly."),
    );
    console.error(error);
    return;
  }

  wire();
  theme();
  store.subscribe(render);
  renderSource();
  renderResumed();
  render();

  // Coming back from GitHub: finish the sign-in, then carry straight on to the pull request
  // the contributor was in the middle of making.
  try {
    if (await github.completeSignIn()) {
      openSuggestions = await github.suggestions().catch(() => []);

      // Back to whatever was being looked at, which the redirect dropped.
      const was = takeRememberedViewing();
      const again = openSuggestions.find((s) => String(s.number) === was);
      if (again) {
        await load(again);
      } else {
        editable = await github.mayEdit(store.suggestion);
        renderSource();
        renderBranchBanner();
      }

      setMode(true);
      if (store.intents.length) openProposal({ send: true });
    }
  } catch (error) {
    console.error(error);
  }
}

start();
