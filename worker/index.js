// Swaps a GitHub authorisation code for a token, and does nothing else.
//
// This exists for one reason: GitHub's token endpoint sends no CORS headers, so a page with
// no server behind it cannot call it. Everything else the site does, it does from the
// browser with the token this hands back.
//
// It holds the client secret, so the two rules it lives by are: only ever answer the site's
// own origin, and never return anything but a token.

const ALLOWED = ["https://tjvl.github.io"];

const cors = (origin) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  vary: "Origin",
});

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(origin) },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED.includes(origin);

    if (request.method === "OPTIONS") {
      return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : forbidden();
    }
    if (!allowed) return forbidden();
    if (request.method !== "POST") return json({ error: "POST a code here." }, 405, origin);

    let code;
    try {
      ({ code } = await request.json());
    } catch {
      return json({ error: "That was not JSON." }, 400, origin);
    }
    if (!code || typeof code !== "string") return json({ error: "No code." }, 400, origin);

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const body = await response.json();
    if (!body.access_token) {
      // GitHub's own wording is aimed at developers, and an expired code is the usual cause.
      return json({ error: "That sign-in did not go through. Please try again." }, 400, origin);
    }

    // Deliberately not passing GitHub's whole response through: the site needs the token and
    // has no business with the rest.
    return json({ access_token: body.access_token }, 200, origin);
  },
};

const forbidden = () => new Response("Not for you.", { status: 403 });
