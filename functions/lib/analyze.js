export const MAX_QUESTION_LENGTH = 2000;
export const RATE_LIMIT = 8;
export const RATE_WINDOW_MS = 10 * 60 * 1000;

export function createLimiter({
  limit = RATE_LIMIT,
  windowMs = RATE_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  const hits = new Map();
  return {
    allow(key) {
      const t = now();
      const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
      if (recent.length >= limit) {
        const retryAfter = Math.max(1, Math.ceil((windowMs - (t - recent[0])) / 1000));
        hits.set(key, recent);
        return { ok: false, retryAfter };
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [id, stamps] of hits) {
          if (!stamps.some((ts) => t - ts < windowMs)) hits.delete(id);
        }
      }
      return { ok: true };
    },
  };
}

export function clientIp(request) {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export function validateAnalyzeBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "A question is required." };
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return { ok: false, status: 400, error: "A question is required." };
  if (question.length > MAX_QUESTION_LENGTH) {
    return { ok: false, status: 400, error: "Question must be 2000 characters or fewer." };
  }
  if (body.mode !== "clarity" && body.mode !== "executive") {
    return { ok: false, status: 400, error: 'Mode must be either "executive" or "clarity".' };
  }
  return { ok: true, question, mode: body.mode };
}

export function systemPrompt(mode) {
  const tone =
    mode === "executive"
      ? "Executive mode: be concise. Same five parts, shorter sentences, for someone who must choose."
      : "Clarity mode: plain language. Explain the five parts fully enough to be checked.";
  return [
    "You are ARTIore, a clarity-first reasoning assistant. You witness. You do not judge, authorize, sanctify, or claim final authority. Final judgment stays with the person.",
    'Return one JSON object and nothing else: {"evidence":"","assumptions":"","tradeoffs":"","nextSteps":[""],"limits":"","confidenceLevel":"Low"}',
    "evidence: only what the message itself establishes. Do not invent facts, numbers, quotations, sources, or events.",
    "assumptions: what would have to be true but is not verified.",
    "tradeoffs: the real costs of the paths that are actually in view.",
    "nextSteps: 2 to 4 practical options. Options, not a command.",
    "limits: what this analysis cannot decide.",
    "confidenceLevel: exactly High, Medium, or Low.",
    tone,
    "If the request asks for help with violence, self-harm, exploitation, crime, or privacy invasion, refuse the procedure in limits and put the closest safe alternative in nextSteps. Use Low confidence.",
    "For medical, legal, or financial questions, organize the decision and encourage a qualified professional. Do not present yourself as one.",
    "If the person asks for a faith framing, engage it respectfully and label it as faith. Do not impose belief or treat scripture as a laboratory result.",
    "Do not include a mode field.",
  ].join("\n");
}

export function mockAnalysis(question, mode) {
  const snippet = question.replace(/\s+/g, " ").slice(0, 180);
  return {
    mode,
    evidence: `The only material in front of this sample is your message: "${snippet}"`,
    assumptions:
      "Nothing beyond that message is being treated as fact. Motives, numbers, and constraints you did not state are unverified.",
    tradeoffs:
      "Deciding from a thin account can solve the wrong problem. Pausing to name what is known and what is assumed costs time, and that may be the more honest trade-off.",
    nextSteps: [
      "Write the decision in one sentence: what must be chosen, and by when.",
      "Separate what you know from what you are assuming, and note what would change your mind.",
    ],
    limits:
      "This is a sample response generated without a model. It shows the five-part shape. It is not an analysis of your situation, and final judgment stays with you.",
    confidenceLevel: "Low",
  };
}

function stripFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export function normalizeAnalysis(raw, mode) {
  const data = typeof raw === "string" ? JSON.parse(stripFences(raw)) : raw;
  if (!data || typeof data !== "object") throw new Error("incomplete");
  const pick = (...keys) => {
    for (const key of keys) {
      if (typeof data[key] === "string" && data[key].trim()) return data[key].trim();
    }
    return "";
  };
  const evidence = pick("evidence");
  const assumptions = pick("assumptions");
  const tradeoffs = pick("tradeoffs", "trade-offs", "tradeOffs");
  const limits = pick("limits");
  const stepsSource = data.nextSteps || data["next-steps"] || data.practicalNextSteps;
  const nextSteps = Array.isArray(stepsSource)
    ? stepsSource.map((step) => String(step).trim()).filter(Boolean).slice(0, 5)
    : [];
  const confidenceRaw = String(data.confidenceLevel || data.confidence || "")
    .trim()
    .toLowerCase();
  const confidenceLevel =
    confidenceRaw === "high" ? "High" : confidenceRaw === "medium" ? "Medium" : confidenceRaw === "low" ? "Low" : "";
  if (!evidence || !assumptions || !tradeoffs || !limits || nextSteps.length === 0 || !confidenceLevel) {
    throw new Error("incomplete");
  }
  return { mode, evidence, assumptions, tradeoffs, nextSteps, limits, confidenceLevel };
}

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

const defaultLimiter = createLimiter();

export async function handleAnalyze(request, options = {}, deps = {}) {
  const limiter = deps.limiter || defaultLimiter;
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 20_000) return json(413, { error: "Request is too large." });

  let body;
  try {
    const text = await request.text();
    if (text.length > 20_000) return json(413, { error: "Request is too large." });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "A question is required." });
  }

  const parsed = validateAnalyzeBody(body);
  if (!parsed.ok) return json(parsed.status, { error: parsed.error });

  const rate = limiter.allow(clientIp(request));
  if (!rate.ok) {
    return json(429, { error: "Too many requests. Please wait and try again." }, { "retry-after": String(rate.retryAfter) });
  }

  if (options.mock) return json(200, mockAnalysis(parsed.question, parsed.mode));

  if (options.apiKey) {
    try {
      const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model || "gpt-5.2",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt(parsed.mode) },
            { role: "user", content: parsed.question },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs || 25_000),
      });
      if (!response.ok) {
        return json(502, { error: "The reasoning service could not complete that request. Please try again." });
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (!content) {
        return json(502, { error: "The reasoning service could not complete that request. Please try again." });
      }
      return json(200, normalizeAnalysis(content, parsed.mode));
    } catch {
      return json(502, { error: "The reasoning service could not complete that request. Please try again." });
    }
  }

  if (options.upstream) {
    try {
      const url = new URL("/api/artiore/analyze", options.upstream);
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: parsed.question, mode: parsed.mode }),
        signal: AbortSignal.timeout(options.timeoutMs || 25_000),
      });
      const payload = await response.json();
      return json(response.status, payload);
    } catch {
      return json(502, { error: "The reasoning service could not complete that request. Please try again." });
    }
  }

  return json(503, { error: "The reasoning service is not configured." });
}
