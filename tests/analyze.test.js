import assert from "node:assert/strict";
import test from "node:test";
import { createLimiter, handleAnalyze, normalizeAnalysis } from "../functions/lib/analyze.js";

function post(body, headers = {}) {
  return new Request("https://artiore.example/api/artiore/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(extra = {}) {
  return { limiter: createLimiter({ limit: 8, windowMs: 60_000, now: () => 1_000_000 }), ...extra };
}

test("rejects an empty question", async () => {
  const response = await handleAnalyze(post({ question: "  ", mode: "clarity" }), { mock: true }, deps());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "A question is required." });
});

test("rejects an unknown mode", async () => {
  const response = await handleAnalyze(post({ question: "Should I wait?", mode: "quick" }), { mock: true }, deps());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Mode must be either "executive" or "clarity".');
});

test("rejects a question over 2000 characters", async () => {
  const response = await handleAnalyze(post({ question: "a".repeat(2001), mode: "executive" }), { mock: true }, deps());
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /2000/);
});

test("rejects invalid JSON", async () => {
  const response = await handleAnalyze(post("not-json"), { mock: true }, deps());
  assert.equal(response.status, 400);
});

test("mock response uses the five-part shape and does not pretend to be a model", async () => {
  const response = await handleAnalyze(post({ question: "Should I relocate for this role?", mode: "clarity" }), { mock: true }, deps());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.mode, "clarity");
  assert.equal(data.confidenceLevel, "Low");
  assert.equal(data.nextSteps.length, 2);
  assert.match(data.limits, /sample response/);
  assert.match(data.evidence, /relocate/);
  for (const key of ["evidence", "assumptions", "tradeoffs", "limits"]) {
    assert.equal(typeof data[key], "string");
    assert.ok(data[key].length > 0);
  }
});

test("rate limit returns 429", async () => {
  const limiter = createLimiter({ limit: 1, windowMs: 60_000, now: () => 5_000 });
  const options = { mock: true };
  const first = await handleAnalyze(post({ question: "One", mode: "clarity" }), options, { limiter });
  const second = await handleAnalyze(post({ question: "Two", mode: "clarity" }), options, { limiter });
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.ok(second.headers.get("retry-after"));
});

test("OpenAI success is normalized and the key is not returned", async () => {
  const secret = "sk-test-secret-should-not-leak";
  let seenAuth = "";
  const fetchImpl = async (url, init) => {
    seenAuth = init.headers.authorization;
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-5.2");
    assert.equal(body.messages[1].content, "Should I wait a week?");
    assert.match(body.messages[0].content, /evidence/);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                evidence: "The person asked whether to wait a week.",
                assumptions: "A week is available.",
                tradeoffs: "Waiting costs time.",
                nextSteps: ["Name the decision."],
                limits: "The model cannot choose.",
                confidenceLevel: "medium",
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const response = await handleAnalyze(
    post({ question: "Should I wait a week?", mode: "executive" }),
    { apiKey: secret, mock: false },
    deps({ fetch: fetchImpl }),
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.confidenceLevel, "Medium");
  assert.equal(data.mode, "executive");
  assert.equal(seenAuth, `Bearer ${secret}`);
  assert.equal(JSON.stringify(data).includes(secret), false);
});

test("OpenAI failure does not leak the key", async () => {
  const secret = "sk-another-secret";
  const fetchImpl = async () => {
    throw new Error(`network down ${secret}`);
  };
  const response = await handleAnalyze(
    post({ question: "Hello", mode: "clarity" }),
    { apiKey: secret },
    deps({ fetch: fetchImpl }),
  );
  const data = await response.json();
  assert.equal(response.status, 502);
  assert.equal(JSON.stringify(data).includes(secret), false);
});

test("incomplete model JSON becomes a 502", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"evidence":"only this"}' } }] }), { status: 200 });
  const response = await handleAnalyze(
    post({ question: "Hello", mode: "clarity" }),
    { apiKey: "sk-test" },
    deps({ fetch: fetchImpl }),
  );
  assert.equal(response.status, 502);
});

test("upstream fallback forwards question and mode", async () => {
  let forwarded = null;
  const fetchImpl = async (url, init) => {
    forwarded = { url: String(url), body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        mode: "clarity",
        evidence: "Known.",
        assumptions: "Assumed.",
        tradeoffs: "Costs.",
        nextSteps: ["One option."],
        limits: "Cannot decide.",
        confidenceLevel: "Medium",
      }),
      { status: 200 },
    );
  };
  const response = await handleAnalyze(
    post({ question: "Map this.", mode: "clarity" }),
    { upstream: "https://artiore.com" },
    deps({ fetch: fetchImpl }),
  );
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "https://artiore.com/api/artiore/analyze");
  assert.deepEqual(forwarded.body, { question: "Map this.", mode: "clarity" });
  assert.equal((await response.json()).confidenceLevel, "Medium");
});

test("missing configuration returns 503", async () => {
  const response = await handleAnalyze(post({ question: "Hello", mode: "clarity" }), {}, deps());
  assert.equal(response.status, 503);
});

test("normalizeAnalysis accepts fenced JSON", () => {
  const data = normalizeAnalysis(
    '```json\n{"evidence":"e","assumptions":"a","tradeoffs":"t","nextSteps":["n"],"limits":"l","confidenceLevel":"High"}\n```',
    "clarity",
  );
  assert.equal(data.confidenceLevel, "High");
  assert.equal(data.mode, "clarity");
});
