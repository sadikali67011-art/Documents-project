import assert from "node:assert/strict";
import test from "node:test";
import handler from "../netlify/functions/answer.mjs";

const readBody = (response) => JSON.parse(response.body);
const originalApiKey = process.env.OPENAI_API_KEY;

test("rejects non-POST requests", async () => {
  const response = await handler({ method: "GET", body: "" });
  assert.equal(response.statusCode, 405);
});

test("rejects malformed or incomplete requests", async () => {
  const malformed = await handler({ method: "POST", body: "{" });
  assert.equal(malformed.statusCode, 400);

  const incomplete = await handler({
    method: "POST",
    body: JSON.stringify({ question: "What is in this file?", passages: [] }),
  });
  assert.equal(incomplete.statusCode, 400);
});

test("reports when AI answers are not configured", async () => {
  delete process.env.OPENAI_API_KEY;
  const response = await handler({
    method: "POST",
    body: JSON.stringify({
      question: "What is the leave policy?",
      passages: [{ label: "S1", source: "policy.txt", chunkId: 1, text: "20 days leave." }],
    }),
  });
  assert.equal(response.statusCode, 503);
  assert.match(readBody(response).error, /not configured/u);
});

test("forwards selected passages to OpenAI without returning the API key", async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-for-production";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-key-not-for-production");
    const request = JSON.parse(options.body);
    assert.match(request.messages[1].content, /\[S1\] File: policy\.txt/u);
    return Response.json({
      choices: [{ message: { content: "Employees receive 20 days [S1]." } }],
    });
  };

  try {
    const response = await handler({
      method: "POST",
      body: JSON.stringify({
        question: "How many leave days?",
        passages: [{ label: "S1", source: "policy.txt", chunkId: 1, text: "20 days leave." }],
      }),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(readBody(response), { answer: "Employees receive 20 days [S1]." });
    assert.equal(response.body.includes("test-key-not-for-production"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});
