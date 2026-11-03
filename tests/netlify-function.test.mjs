import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import handler from "../netlify/functions/answer.mjs";

const makeRequest = (method, body) =>
  new Request("https://example.test/.netlify/functions/answer", {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body,
  });
const originalApiKey = process.env.OPENAI_API_KEY;

test("provides exactly 20 distinct output language choices", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const options = [...html.matchAll(/<option value="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(options.length, 20);
  assert.equal(new Set(options).size, 20);
});

test("rejects non-POST requests", async () => {
  const response = await handler(makeRequest("GET"));
  assert.equal(response.status, 405);
});

test("rejects malformed or incomplete requests", async () => {
  const malformed = await handler(makeRequest("POST", "{"));
  assert.equal(malformed.status, 400);

  const incomplete = await handler(makeRequest("POST", JSON.stringify({
    question: "What is in this file?",
    passages: [],
  })));
  assert.equal(incomplete.status, 400);
});

test("reports when AI answers are not configured", async () => {
  delete process.env.OPENAI_API_KEY;
  const response = await handler(makeRequest("POST", JSON.stringify({
    question: "What is the leave policy?",
    language: "Hindi",
    passages: [{ label: "S1", source: "policy.txt", chunkId: 1, text: "20 days leave." }],
  })));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/u);
});

test("forwards selected passages to OpenAI without returning the API key", async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-for-production";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-key-not-for-production");
    const request = JSON.parse(options.body);
    assert.match(request.messages[1].content, /\[S1\] File: policy\.txt/u);
    assert.match(request.messages[0].content, /entirely in English/u);
    return Response.json({
      choices: [{ message: { content: "Employees receive 20 days [S1]." } }],
    });
  };

  try {
    const response = await handler(makeRequest("POST", JSON.stringify({
      mode: "answer",
      question: "How many leave days?",
      language: "English",
      passages: [{ label: "S1", source: "policy.txt", chunkId: 1, text: "20 days leave." }],
    })));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { answer: "Employees receive 20 days [S1]." });
    assert.equal(body.includes("test-key-not-for-production"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test("rejects output languages outside the supported 20", async () => {
  const response = await handler(makeRequest("POST", JSON.stringify({
    question: "How many leave days?",
    language: "Klingon",
    passages: [{ label: "S1", source: "policy.txt", chunkId: 1, text: "20 days leave." }],
  })));
  assert.equal(response.status, 400);
});

test("accepts every language offered by the selector", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const languages = [...html.matchAll(/<option value="([^"]+)"/gu)].map((match) => match[1]);
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    for (const language of languages) {
      const response = await handler(makeRequest("POST", JSON.stringify({
        question: "What is in this document?",
        language,
        passages: [{ label: "S1", source: "notes.txt", chunkId: 1, text: "Example text." }],
      })));
      assert.equal(response.status, 503, `${language} should be accepted by the function`);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("translates summary passages into the selected language", async () => {
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-key-not-for-production";
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /Translate every supplied summary sentence into Hindi/u);
    assert.match(request.messages[1].content, /\[S1\] Employees receive 20 paid leave days\./u);
    return Response.json({
      choices: [{ message: { content: "[S1] कर्मचारियों को 20 दिन की छुट्टी मिलती है।" } }],
    });
  };

  try {
    const response = await handler(makeRequest("POST", JSON.stringify({
      mode: "translate",
      question: "",
      language: "Hindi",
      passages: [{ label: "S1", source: "policy.txt", chunkId: 1, text: "Employees receive 20 paid leave days." }],
    })));
    assert.equal(response.status, 200);
    assert.match((await response.json()).answer, /कर्मचारियों को 20 दिन/u);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});
