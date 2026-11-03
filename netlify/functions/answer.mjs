const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Only POST requests are supported." });
  }

  let payload;
  try {
    payload = JSON.parse(request.body || "");
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON." });
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const passages = payload.passages;
  if (!question || question.length > 2000 || !Array.isArray(passages) || passages.length < 1 || passages.length > 5) {
    return jsonResponse(400, { error: "A question and one to five passages are required." });
  }
  if (passages.some((passage) =>
    !passage
    || typeof passage.label !== "string"
    || typeof passage.source !== "string"
    || typeof passage.text !== "string"
    || passage.text.length > 5000
  )) {
    return jsonResponse(400, { error: "Passages contain invalid or oversized data." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse(503, { error: "AI answers are not configured for this site." });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const context = passages.map((passage) =>
    `[${passage.label}] File: ${passage.source}; passage ${passage.chunkId}\n${passage.text}`
  ).join("\n\n");
  let response;
  let result;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "You are a careful document question-answering assistant. Answer using only the supplied passages. If they do not contain the answer, say there is not enough information. Do not invent facts. Cite supporting passages with their exact [S#] labels and answer in the same language as the question.",
          },
          {
            role: "user",
            content: `Question:\n${question}\n\nDocument passages:\n\n${context}`,
          },
        ],
      }),
    });
    result = await response.json();
  } catch (error) {
    console.error("OpenAI request failed:", error);
    return jsonResponse(502, { error: "Could not reach the AI service. Please try again." });
  }
  if (!response.ok) {
    const detail = result.error?.message || `OpenAI returned HTTP ${response.status}.`;
    return jsonResponse(502, { error: `AI answer failed: ${detail}` });
  }

  const answer = result.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    return jsonResponse(502, { error: "AI returned an empty answer." });
  }
  return jsonResponse(200, { answer });
};
