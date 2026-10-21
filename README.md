# ARTIore

Clarity-first reasoning. ARTIore helps people understand a situation, separate evidence from assumptions, and choose a next step without false certainty. Final judgment stays with the person.

Every response has five parts: **Evidence, Assumptions, Trade-offs, Practical next steps, and Limits**, plus a confidence level (High, Medium, or Low).

The tagline is **Allah Alone is Enough**. The founder is **Zain Ul Abdin**.

This repository is a static rebuild of [artiore.com](https://artiore.com). It does not change DNS and it does not replace the live site until you point the domain yourself.

## Measured locally

Lighthouse 12.8.2 on the production build, served the way Cloudflare Pages serves clean URLs (200 for `/` and `/try`, no trailing-slash redirect). 21 Oct 2026.

| Page | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| Home, phone | 100 | 100 | 100 | 100 |
| Home, desktop | 100 | 100 | 100 | 100 |
| /try, phone | 100 | 100 | 100 | 100 |
| /try, desktop | 100 | 100 | 100 | 100 |

`/try` was also exercised in a browser: an example loads into the field, Analyze returns Evidence, Assumptions, Trade-offs, Practical next steps, and Limits, and the field and button are the elements under the pointer on a 390 px screen.

## Stack

- **Astro 5** pre-renders every page to HTML. The only client script is the `/try` tool.
- **Cloudflare Pages + Pages Functions** for hosting. The domain is already on Cloudflare, so a Pages project can sit beside the current origin and take the hostname later without a new DNS provider. Functions are the serverless piece: they hold the OpenAI key, validate input, and rate-limit. No key is committed.
- **GitHub Actions** runs tests, `astro check`, and the production build.

The previous site was a GoDaddy Airo app. Every page was the same HTML shell: an empty `<div id="app">`, one title (`ARTIore — Allah Alone is Enough`), and the same JavaScript on every route. Measured on 21 Oct 2026, that JavaScript was 2,425,434 bytes uncompressed (492,316 bytes gzipped): `vendor` 1,933,094, `main` 488,012, plus a small loader and `analytics.js`. CSS was another 92,817 bytes, and the page also loaded Google Fonts. This build ships no script on content pages. `/try` loads one script, 3,298 bytes (1.30 KB gzipped), and one CSS file of about 10 KB. No analytics and no web fonts.

## Local development

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open http://localhost:4321. With no secrets, `/try` uses a **sample response** so you can see the five-part layout. The sample says it was generated without a model.

```bash
npm test          # analyze validation, rate limit, mock, OpenAI, upstream
npm run lint      # astro check
npm run build     # static site in dist/, then HTML checks
npm run preview   # serve dist/
```

### How `/try` chooses a backend

The browser posts to `PUBLIC_ANALYZE_URL`. The default is `/api/artiore/analyze` (this site's function).

| Variable | Where | Effect |
| --- | --- | --- |
| `OPENAI_API_KEY` | server secret | The function calls OpenAI. Never put this in the frontend or in git. |
| `OPENAI_MODEL` | server secret, optional | Defaults to `gpt-5.2`. |
| `ARTIORE_UPSTREAM_URL` | server secret, optional | If there is no key, the function forwards `{ question, mode }` to `{ARTIORE_UPSTREAM_URL}/api/artiore/analyze`. Use `https://artiore.com` to use the current live endpoint. |
| `ARTIORE_MOCK` | server secret | `true` forces the sample response. Leave unset on the public site. |
| `PUBLIC_ANALYZE_URL` | **build** environment | Baked into the `/try` page. Default `/api/artiore/analyze`. |

`npm run dev` uses the sample when neither `OPENAI_API_KEY` nor `ARTIORE_UPSTREAM_URL` is set. To develop against the current live API:

```bash
ARTIORE_UPSTREAM_URL=https://artiore.com npm run dev
```

The live endpoint does not send CORS headers, so a browser on another origin cannot call `https://artiore.com/api/artiore/analyze` directly. The server-side `ARTIORE_UPSTREAM_URL` fallback is the one that works from localhost and from a preview hostname. `PUBLIC_ANALYZE_URL` is there for a same-origin or CORS-enabled endpoint.

Copy `.env.example` to `.env` for local secrets. `.env` is gitignored.

## Request shape

`POST /api/artiore/analyze`

```json
{ "question": "…", "mode": "clarity" }
```

`mode` is `clarity` or `executive`. `question` is required and at most 2,000 characters.

```json
{
  "mode": "clarity",
  "evidence": "…",
  "assumptions": "…",
  "tradeoffs": "…",
  "nextSteps": ["…"],
  "limits": "…",
  "confidenceLevel": "Medium"
}
```

`GET /api/health` returns `{ "status": "ok", "message": "Hello World!" }`.

The function rejects bad input, allows 8 requests per 10 minutes per IP (in memory, per isolate), and does not log the question. The key stays in the worker environment.

## Deploy to Cloudflare Pages

Do this when you want a preview. It does **not** move artiore.com.

1. Create a Cloudflare API token with **Account / Cloudflare Pages / Edit**, and copy the account id.
2. In the GitHub repo settings, add secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. In Cloudflare, create a Pages project named `artiore` (or change `--project-name` in `.github/workflows/deploy.yml` to match). Connect this GitHub repo if you prefer Cloudflare's own builds instead of the manual workflow. Build command: `npm run build`. Output directory: `dist`.
4. Pages Functions are the `functions/` directory. Wrangler publishes them with the static files. `wrangler.toml` sets `pages_build_output_dir = "dist"`.
5. In the Pages project, set environment variables (production):
   - `OPENAI_API_KEY` — secret
   - `OPENAI_MODEL` — optional, `gpt-5.2`
   - Leave `ARTIORE_MOCK` unset
   - `ARTIORE_UPSTREAM_URL` — optional, only if you want the function to call the old endpoint until the key is ready
   - `PUBLIC_ANALYZE_URL` — only if it should not be `/api/artiore/analyze`. This one is read at **build** time, so set it before the build, not only at runtime.
6. Run the **Deploy** GitHub Action manually (`workflow_dispatch`), or push through Cloudflare's Git integration. The action runs tests and `npm run build`, then `npx wrangler pages deploy dist --project-name artiore`.
7. Open the `*.pages.dev` URL Cloudflare gives you. Check `/`, `/try`, `/privacy`, and `/api/health` before any domain change.

### Point artiore.com at the new host later

Only after the preview looks right:

1. In the Cloudflare dashboard, open the Pages project → **Custom domains** → add `artiore.com` and `www.artiore.com` if you use it.
2. Because the domain is already on this Cloudflare account, Pages will offer the DNS records. That step replaces the current origin (the GoDaddy Airo app behind Cloudflare). Do not do it until you mean to.
3. Remove or pause the old origin only after the new site answers on the hostname.
4. Confirm `/api/artiore/analyze` and `/api/health` hit the Pages Function, not the old Express app.
5. Read the draft privacy policy and the terms banner, then edit them if the company details or the model name should change.

Nothing in this repo changes DNS by itself.

## Routes

Every URL from the previous sitemap is a real page, plus `/donate` and `/uae-dossier` (they were linked in the old navigation but missing from the sitemap). `/the-secret-affaire` redirects to `/about`, which is what the old page did.

Main navigation: Try, How it works, Use cases, Blog, About, Donate. Doctrine, Philosophy, Safety Charter, Dossier, and the UAE Dossier are under **Foundations**. Other recovered pages stay in the footer.

## Content that could not be carried over as it was

- Six gallery photographs (`/assets/FB_IMG_*.jpg`) returned 404. The gallery page keeps the titles and descriptions.
- `Artiore_Companion_Handbook_V1.0.pdf` and `Artiore_Grand_Zero_Drft_V1.1.pdf` returned 404. The grand-prompt download uses `/data/artiore-grand-zero-v1.1.pdf`, which did exist. The handbook text is on the page.
- The Sovereign Engine audio instrument (Web Audio, breathing guide, timers) is described, not loaded. Only `/try` runs client JavaScript. The user guide is at `/data/sovereign-engine-guide.md`.
- The language menu and the accessibility toolbar were not rebuilt. Page bodies were English. A small set of translated chrome strings existed; full translations of the essays did not.
- Related-reading links on a few security essays pointed at `/blog/password-managers`, `/blog/two-factor-authentication`, and `/blog/software-updates`. Those titles are in the old JavaScript, but no essay body was published and they are not in the sitemap. The links now go to published essays. `/blog/doctrine-foundation` and `/blog/public-wifi-security` redirect to the published posts with those subjects.
- The chat widget and analytics cookies are gone.
- `POST /api/access/request` used to accept a name and email. This site does not store that. The access page asks people to email contact@artiore.com.
- `/chatbot-config` and `/export` were builder screens, not in the sitemap, and are not included.
- The framework still describes an Archives layer that would preserve sessions. This site does not store sessions. The privacy draft says so.
- Case-study figures (costs, percentages) are copied from the previous page. They were not remeasured.
- The privacy page is a **draft for the owner to review**. The terms page is the previous legal text, with a banner noting Quick Mode / Deep Mode, the accessibility toolbar, and eight languages, which this rebuild does not ship.

## Related

From the previous repository README: [artiais.com](https://artiais.com), [artioreconsortium.com](https://artioreconsortium.com), [X](https://x.com/Artiore), [LinkedIn](https://www.linkedin.com/company/artiore/), [Discord](https://discord.gg/ZTFDuuAmB), artiste@artiore.com.
