import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { handleAnalyze } from "./functions/lib/analyze.js";

function devApi() {
  return {
    name: "artiore-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (url === "/api/health" && req.method === "GET") {
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(
            JSON.stringify({
              status: "ok",
              timestamp: new Date().toISOString(),
              message: "Hello World!",
            }),
          );
          return;
        }
        if (url !== "/api/artiore/analyze") return next();
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const request = new Request("http://localhost/api/artiore/analyze", {
          method: req.method || "GET",
          headers: {
            "content-type": req.headers["content-type"] || "application/json",
            "x-forwarded-for": req.socket?.remoteAddress || "127.0.0.1",
          },
          body: req.method === "POST" ? body : undefined,
        });
        const hasKey = Boolean(process.env.OPENAI_API_KEY);
        const upstream = process.env.ARTIORE_UPSTREAM_URL || "";
        const mock = process.env.ARTIORE_MOCK === "true" || (!hasKey && !upstream);
        const response = await handleAnalyze(request, {
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL,
          mock,
          upstream,
        });
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig({
  site: "https://artiore.com",
  trailingSlash: "never",
  markdown: {
    syntaxHighlight: false,
  },
  build: {
    // file format so /try is try.html and answers 200 with no trailing-slash redirect.
    format: "file",
    inlineStylesheets: "never",
  },
  redirects: {
    "/the-secret-affaire": "/about",
    "/blog/doctrine-foundation": "/blog/the-doctrine-foundation",
    "/blog/public-wifi-security": "/blog/quiet-cybersecurity-risk-public-wifi",
  },
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes("the-secret-affaire") &&
        !page.endsWith("/blog/doctrine-foundation") &&
        !page.endsWith("/blog/public-wifi-security"),
    }),
  ],
  vite: {
    plugins: [devApi()],
    build: {
      assetsInlineLimit: 0,
    },
  },
});
