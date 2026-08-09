// Turning a draft into a pull request, and the path for people who would rather not.
//
// Two things worth knowing before changing any of this:
//
// - The token lives in this module and nowhere else. Not in localStorage, not in
//   sessionStorage. A reload means signing in again, which is one click because GitHub
//   remembers the authorisation, and it means a shared computer does not keep it.
// - The file is rebuilt from the list as it stands on the server at the moment Propose is
//   pressed, never from the copy the contributor started with. Their intents are replayed
//   onto it, so whatever other people merged in the meantime survives.

import { AUTH_WORKER, CLIENT_ID, REPO, canSignIn } from "./config.js";
import { canonical } from "./canonical.js";
import { describe, replay } from "./intents.js";

const API = "https://api.github.com";
const STATE_KEY = "bigbalfolklist.oauth-state";

let token = null;
let user = null;

export const signedIn = () => Boolean(token);
export const whoami = () => user;

// ---------- signing in ----------

export function signIn() {
  if (!canSignIn()) throw new Error("This copy of the site has no GitHub app configured yet.");

  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("scope", "public_repo");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", location.origin + location.pathname);
  location.assign(url);
}

/**
 * Finish a sign-in we are coming back from. Safe to call on every load: it does nothing
 * unless GitHub has just sent us back with a code.
 */
export async function completeSignIn() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return false;

  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  // Someone else's redirect, or a stale tab. Either way it is not a sign-in we asked for.
  if (!expected || params.get("state") !== expected) {
    history.replaceState(null, "", location.pathname);
    return false;
  }

  const response = await fetch(AUTH_WORKER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });

  history.replaceState(null, "", location.pathname);
  if (!response.ok) throw new Error("GitHub would not complete the sign-in. Try again.");

  const body = await response.json();
  if (!body.access_token) throw new Error(body.error || "GitHub did not hand back a token.");

  token = body.access_token;
  user = await api("/user");
  return true;
}

export function signOut() {
  token = null;
  user = null;
}

// ---------- talking to GitHub ----------

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || `GitHub said ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

const utf8ToBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/** The list as some branch has it, with the blob it belongs to. */
async function fileFrom(repo, ref) {
  const file = await api(`/repos/${repo}/contents/dances.json?ref=${ref}`);
  if (!file) throw new Error("dances.json is not where it should be.");

  const text = new TextDecoder().decode(
    Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
  );
  return { list: JSON.parse(text), sha: file.sha };
}

export const latest = () => fileFrom(`${REPO.owner}/${REPO.name}`, REPO.branch);

/** The contributor's own suggestions that are still open, newest first. */
export async function mySuggestions() {
  if (!signedIn()) return [];

  const open = await api(`/repos/${REPO.owner}/${REPO.name}/pulls?state=open&per_page=100`);
  return (open || [])
    .filter((pull) => pull.user?.login === user.login && pull.head?.repo)
    .map((pull) => ({
      number: pull.number,
      title: pull.title,
      branch: pull.head.ref,
      repo: pull.head.repo.full_name,
      url: pull.html_url,
      updated: pull.updated_at,
    }));
}

/**
 * Replay a draft onto whatever it is going to be added to.
 *
 * Without a target that is the published list, so a new pull request starts from what is live.
 * With one it is that pull request's own branch, which matters: rebuilding a follow-up from
 * main would silently throw away the changes already sitting in it.
 */
export async function rebuild(intents, target) {
  const source = target
    ? { repo: target.repo, ref: target.branch }
    : { repo: `${REPO.owner}/${REPO.name}`, ref: REPO.branch };

  const { list, sha } = await fileFrom(source.repo, source.ref);
  // Kept before replaying, so the diff shown is against what it will be added to rather than
  // against the copy the page happened to load with.
  const before = JSON.parse(JSON.stringify(list));
  const result = replay(list, intents);
  return { before, list, sha, source, ...result };
}

// ---------- the pull request ----------

async function fork() {
  const mine = `${user.login}/${REPO.name}`;
  const existing = await api(`/repos/${mine}`);
  if (existing) return existing;

  await api(`/repos/${REPO.owner}/${REPO.name}/forks`, { method: "POST" });

  // Forking is asynchronous, and using the fork before GitHub has finished making it fails
  // in ways that read like a permissions problem.
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const ready = await api(`/repos/${mine}`);
    if (ready) return ready;
  }
  throw new Error("GitHub is still making your copy of the repository. Try again in a minute.");
}

const branchName = () => {
  const day = new Date().toISOString().slice(0, 10);
  return `suggestion-${day}-${Math.random().toString(36).slice(2, 6)}`;
};

/**
 * Open a pull request with the draft applied to the current list.
 * Returns the pull request, or the conflicts that stopped it.
 */
export async function propose(intents, target) {
  if (!signedIn()) throw new Error("Sign in first.");

  const { list, sha, applied, stale } = await rebuild(intents, target);
  if (!applied.length) return { stale, opened: null, added: false };

  const changes = applied.map(describe);
  const summary =
    changes.length === 1 ? changes[0].text : `${changes.length} changes to the dance list`;

  // Adding to something already open: commit onto its own branch and the pull request
  // updates itself. No second pull request, and nothing already in it is disturbed.
  if (target) {
    await api(`/repos/${target.repo}/contents/dances.json`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Also: ${summary}`,
        content: utf8ToBase64(canonical(list)),
        sha,
        branch: target.branch,
      }),
    });
    return { opened: { html_url: target.url, number: target.number }, stale, added: true };
  }

  const upstream = await api(`/repos/${REPO.owner}/${REPO.name}/git/ref/heads/${REPO.branch}`);
  const mine = await fork();
  const branch = branchName();

  // Forks share object storage with the repository they came from, so the branch can start
  // from upstream's tip even when the fork itself is years behind.
  await api(`/repos/${mine.full_name}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: upstream.object.sha }),
  });

  const current = await api(`/repos/${mine.full_name}/contents/dances.json?ref=${branch}`);

  await api(`/repos/${mine.full_name}/contents/dances.json`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Update the dance list: ${summary}`,
      content: utf8ToBase64(canonical(list)),
      sha: current.sha,
      branch,
    }),
  });

  const opened = await api(`/repos/${REPO.owner}/${REPO.name}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: summary.charAt(0).toUpperCase() + summary.slice(1),
      head: `${user.login}:${branch}`,
      base: REPO.branch,
      maintainer_can_modify: true,
      body: prose(changes, stale),
    }),
  });

  return { opened, stale, added: false };
}

const prose = (changes, stale) =>
  [
    "Suggested from the site.",
    "",
    ...changes.map((change) => `- ${change.text}`),
    ...(stale.length
      ? ["", "Left out, because the list had moved on:", ...stale.map((s) => `- ${s.reason}`)]
      : []),
  ].join("\n");

// ---------- for people without a GitHub account ----------

/**
 * A pre-filled issue. No sign-in, no fork, no branch: someone types what they mean and a
 * maintainer applies it. This is the path most dancers will take, so it is not a fallback.
 */
export function issueUrl(intents) {
  const changes = intents.map(describe);
  const body = [
    "I would like to suggest these changes to the dance list:",
    "",
    ...changes.map((change) => `- ${change.text}`),
    "",
    "(Written by the site. Please say if anything looks wrong.)",
  ].join("\n");

  const url = new URL(`https://github.com/${REPO.owner}/${REPO.name}/issues/new`);
  url.searchParams.set("title", `Suggestion: ${changes[0]?.text ?? "a change to the list"}`);
  url.searchParams.set("body", body);
  return url.toString();
}
