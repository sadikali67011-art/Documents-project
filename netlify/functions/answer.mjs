const jsonResponse = (status, body) =>
  Response.json(body, { status });
const SUPPORTED_LANGUAGES = new Set([
  "Hindi",
  "English",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Italian",
  "Dutch",
  "Russian",
  "Arabic",
  "Bengali",
  "Chinese (Simplified)",
  "Japanese",
  "Korean",
  "Urdu",
  "Punjabi",
  "Marathi",
  "Tamil",
  "Telugu",
  "Turkish",
]);

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Only POST requests are supported." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON." });
  }

  const mode = payload.mode ?? "answer";
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const language = payload.language;
  const passages = payload.passages;
  if (
    !["answer", "translate"].includes(mode)
    || (mode === "answer" && (!question || question.length > 2000))
    || !SUPPORTED_LANGUAGES.has(language)
    || !Array.isArray(passages)
    || passages.length < 1
    || passages.length > 5
  ) {
    return jsonResponse(400, { error: "A valid language and one to five passages are required." });
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
    return jsonResponse(503, { error: "AI answers and translations are not configured for this site." });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const context = passages.map((passage) => mode === "translate"
    ? `[${passage.label}] ${passage.text}`
    : `[${passage.label}] File: ${passage.source}; passage ${passage.chunkId}\n${passage.text}`
  ).join("\n\n");
  const systemPrompt = mode === "translate"
    ? `Translate every supplied summary sentence into ${language}. Preserve each [S#] label exactly and in order. Do not add, remove, or infer facts. Return only the translated sentences with their labels.`
    : `You are a careful document question-answering assistant. Answer using only the supplied passages. If they do not contain the answer, say there is not enough information. Do not invent facts. Cite supporting passages with their exact [S#] labels. Answer entirely in ${language}.`;
  const userPrompt = mode === "translate"
    ? `Translate these extractive summary sentences into ${language}:\n\n${context}`
    : `Question:\n${question}\n\nDocument passages:\n\n${context}`;
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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
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
