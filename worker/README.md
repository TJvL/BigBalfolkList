# The sign-in worker

Twenty lines of glue. GitHub's token endpoint sends no CORS headers, so the site — which has
no server of its own — cannot exchange an authorisation code for a token by itself. This does
that one exchange and nothing else.

Everything else the site does with GitHub, it does straight from the browser using the token
this returns.

## Deploying it

1. **Make an OAuth app** at *Settings → Developer settings → OAuth Apps → New*.
   - Homepage: `https://tjvl.github.io/BigBalfolkList/`
   - Authorization callback: `https://tjvl.github.io/BigBalfolkList/`
   - Note the client id, and generate a client secret.

2. **Deploy**, from this directory:

   ```bash
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_CLIENT_SECRET   # paste the secret; it is never committed
   ```

   Put the client id in `wrangler.toml` under `[vars]` and deploy again.

3. **Point the site at it**: put the same client id and the deployed URL into
   `site/config.js`.

The free plan covers 100,000 requests a day. This is a handful a month.

## What it will not do

- Answer any origin but the site's own. `ALLOWED` in `index.js` is the list, and it is
  checked before anything else happens.
- Return anything except the token, whatever else GitHub says.
- Hold state. There is no database, no session, nothing to leak if it is ever compromised
  beyond the secret itself, which is rotated from the OAuth app page.

The token itself is never written to storage in the browser either: it lives in memory for
the tab, so closing it signs you out.
