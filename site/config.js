// Where this copy of the site points.
//
// Both values below are public by design: an OAuth client id is not a secret, and the worker
// URL is just an address. The client *secret* lives in the worker and never comes near the
// browser, which is the whole reason the worker exists.
//
// With these left empty the site still works: browsing, editing and drafts need no account at
// all, and suggesting a change through an issue needs no sign-in either. Only the "open a pull
// request for me" button waits on them.

export const REPO = { owner: "TJvL", name: "BigBalfolkList", branch: "main" };

/** From Settings → Developer settings → OAuth Apps on GitHub. */
export const CLIENT_ID = "";

/** The deployed worker from worker/, e.g. https://bigbalfolklist-auth.<you>.workers.dev */
export const AUTH_WORKER = "";

export const canSignIn = () => Boolean(CLIENT_ID && AUTH_WORKER);
