import { handleAnalyze } from "../../lib/analyze.js";

export function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return handleAnalyze(request, {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    mock: env.ARTIORE_MOCK === "true",
    upstream: env.ARTIORE_UPSTREAM_URL,
  });
}
