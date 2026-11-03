import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "./style.css";

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "was",
  "what", "when", "where", "which", "who", "why", "with", "my", "me",
  "hai", "hain", "ka", "ki", "ko", "kya", "mein", "meri", "mujhe",
  "ke", "ye", "yeh", "iska", "iski", "के", "की", "को", "में", "है",
  "क्या", "यह", "ये", "मेरी", "मेरा", "बताओ",
]);
const SUMMARY_TERMS = new Set([
  "experience", "education", "skills", "projects", "certification",
  "certifications", "qualification", "degree", "employment", "studied",
  "university", "college", "अनुभव", "शिक्षा", "कौशल",
]);
const SUMMARY_PHRASES = [
  "what is this", "what is my cv", "what does my cv", "summarize", "summary",
  "overview", "describe this", "about my cv", "meri cv", "meri resume",
  "cv ke bare", "cv ke baare", "kya hai ye", "ye kya hai", "my cv",
  "cv details", "cv ditals", "resume details", "resume ditals", "cv me kya",
  "cv mein kya", "बताओ", "सारांश", "के बारे में",
];
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TOTAL_TEXT = 1_000_000;

const fileInput = document.querySelector("#files");
const fileStatus = document.querySelector("#file-status");
const fileErrors = document.querySelector("#file-errors");
const questionInput = document.querySelector("#question");
const questionForm = document.querySelector("#question-form");
const askButton = document.querySelector("#ask-button");
const summaryButton = document.querySelector("#summary-button");
const messages = document.querySelector("#messages");
const answerSection = document.querySelector("#answer-section");
const answerContent = document.querySelector("#answer-content");
const sourcesSection = document.querySelector("#sources-section");
const sourcesContent = document.querySelector("#sources-content");

let chunks = [];

function tokenize(text) {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((token) => !STOP_WORDS.has(token));
}

function splitIntoChunks(text, source, maxChars = 1200, overlap = 180) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) return [];

  const result = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(" ", end);
      if (boundary > start + maxChars / 2) end = boundary;
    }
    const excerpt = normalized.slice(start, end).trim();
    if (excerpt) result.push({ source, chunkId: result.length + 1, text: excerpt });
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return result;
}

function rankChunks(question, sourceChunks, topK = 5) {
  const queryTerms = new Set(tokenize(question));
  if (!queryTerms.size || !sourceChunks.length || topK <= 0) return [];

  const tokenized = sourceChunks.map((chunk) => tokenize(chunk.text));
  const documentFrequencies = new Map();
  for (const terms of tokenized) {
    for (const term of new Set(terms)) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
    }
  }
  const averageLength = tokenized.reduce((sum, terms) => sum + terms.length, 0) / tokenized.length;
  const scored = sourceChunks.map((chunk, index) => {
    const frequencies = new Map();
    for (const term of tokenized[index]) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
    let score = 0;
    for (const term of queryTerms) {
      const frequency = frequencies.get(term) ?? 0;
      if (!frequency) continue;
      const documentFrequency = documentFrequencies.get(term);
      const inverseFrequency = Math.log(
        1 + (sourceChunks.length - documentFrequency + 0.5) / (documentFrequency + 0.5),
      );
      const denominator = frequency + 1.2 * (
        1 - 0.75 + 0.75 * tokenized[index].length / Math.max(averageLength, 1)
      );
      score += inverseFrequency * frequency * 2.2 / denominator;
    }
    return { chunk, score };
  });
  return scored.filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

function extractiveSummary(sourceChunks, maxSentences = 5) {
  const sentences = [];
  for (const chunk of sourceChunks) {
    for (const sentence of chunk.text.split(/(?<=[.!?।])\s+/u)) {
      const text = sentence.trim();
      if (!text) continue;
      const terms = new Set(tokenize(text));
      const score = [...SUMMARY_TERMS].filter((term) => terms.has(term)).length;
      sentences.push({ chunk, text, score });
    }
  }
  return sentences.map((item, index) => ({ ...item, index }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxSentences)
    .sort((left, right) => left.index - right.index);
}

function isSummaryQuestion(question) {
  const normalized = question.toLocaleLowerCase().trim();
  return SUMMARY_PHRASES.some((phrase) => normalized.includes(phrase));
}

async function extractText(file) {
  const extension = file.name.toLocaleLowerCase().split(".").pop();
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("फ़ाइल 20 MB से बड़ी है; छोटी फ़ाइल अपलोड करें।");
  }
  if (extension === "txt" || extension === "md") {
    return new TextDecoder("utf-8").decode(await file.arrayBuffer()).replace(/^\uFEFF/u, "").trim();
  }
  if (extension === "pdf") {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return pages.join("\n\n").trim();
  }
  if (extension === "docx") {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value.trim();
  }
  throw new Error("यह file format समर्थित नहीं है।");
}

function addMessage(container, text, type = "info") {
  const item = document.createElement("div");
  item.className = `message message-${type}`;
  item.textContent = text;
  container.append(item);
}

function showSources(matches) {
  sourcesContent.replaceChildren();
  for (let index = 0; index < matches.length; index += 1) {
    const { chunk, score } = matches[index];
    const card = document.createElement("article");
    card.className = "source";
    const title = document.createElement("div");
    title.className = "source-title";
    title.textContent = `[S${index + 1}] ${chunk.source} — passage ${chunk.chunkId}`;
    const relevance = document.createElement("span");
    relevance.className = "source-score";
    relevance.textContent = `Relevance score: ${score.toFixed(2)}`;
    const text = document.createElement("p");
    text.className = "source-text";
    text.textContent = chunk.text;
    card.append(title, relevance, text);
    sourcesContent.append(card);
  }
  sourcesSection.hidden = matches.length === 0;
}

function showSummary() {
  const summary = extractiveSummary(chunks);
  answerContent.replaceChildren();
  if (!summary.length) {
    addMessage(messages, "दस्तावेज़ में सारांश के लिए text नहीं मिला।", "warning");
    answerSection.hidden = true;
    return;
  }

  const list = document.createElement("ul");
  for (const { chunk, text } of summary) {
    const item = document.createElement("li");
    item.textContent = `${text} (${chunk.source} — passage ${chunk.chunkId})`;
    list.append(item);
  }
  answerContent.append(list);
  document.querySelector("#answer-title").textContent = "दस्तावेज़ का extractive सारांश";
  answerSection.hidden = false;
  showSources(summary.map((item) => ({ chunk: item.chunk, score: 0 })));
}

async function handleFiles(files) {
  fileErrors.replaceChildren();
  messages.replaceChildren();
  chunks = [];
  const errors = [];
  let totalText = 0;

  for (const file of files) {
    try {
      const text = await extractText(file);
      totalText += text.length;
      if (totalText > MAX_TOTAL_TEXT) {
        throw new Error("कुल documents में बहुत अधिक text है (अधिकतम 1 MB)।");
      }
      const extracted = splitIntoChunks(text, file.name);
      if (!extracted.length) throw new Error("इस file में पढ़ने योग्य text नहीं मिला।");
      chunks.push(...extracted);
    } catch (error) {
      errors.push(`${file.name}: ${error.message || "फ़ाइल पढ़ने में समस्या हुई।"}`);
    }
  }

  for (const error of errors) addMessage(fileErrors, error, "error");
  const successfulFiles = files.length - errors.length;
  fileStatus.textContent = successfulFiles
    ? `${successfulFiles} फ़ाइल पढ़ीं; ${chunks.length} passages तैयार।`
    : "शुरू करने के लिए दस्तावेज़ अपलोड करें।";
  questionInput.disabled = chunks.length === 0;
  summaryButton.disabled = chunks.length === 0;
  askButton.disabled = chunks.length === 0 || !questionInput.value.trim();
  answerSection.hidden = true;
  sourcesSection.hidden = true;
}

async function answerQuestion(question) {
  messages.replaceChildren();
  answerSection.hidden = true;
  const matches = rankChunks(question, chunks);
  let selected = matches;
  if (!selected.length) {
    selected = chunks.slice(0, 3).map((chunk) => ({ chunk, score: 0 }));
    if (!isSummaryQuestion(question)) {
      addMessage(
        messages,
        "सीधा match नहीं मिला। बेहतर जवाब के लिए सवाल में document के शब्दों का उपयोग करें।",
        "warning",
      );
    }
  }

  if (isSummaryQuestion(question)) {
    showSummary();
    return;
  }

  try {
    askButton.disabled = true;
    askButton.textContent = "जवाब तैयार हो रहा है…";
    const response = await fetch("/.netlify/functions/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question.trim(),
        passages: selected.map(({ chunk }, index) => ({
          label: `S${index + 1}`,
          source: chunk.source,
          chunkId: chunk.chunkId,
          text: chunk.text,
        })),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 503) {
        addMessage(
          messages,
          "AI जवाब के लिए Netlify में OPENAI_API_KEY सेट करें। नीचे संबंधित मूल text दिया है।",
          "warning",
        );
      } else {
        throw new Error(result.error || "AI जवाब नहीं मिल सका।");
      }
    } else {
      answerContent.textContent = result.answer;
      document.querySelector("#answer-title").textContent = "जवाब";
      answerSection.hidden = false;
    }
  } catch (error) {
    addMessage(messages, error.message || "AI जवाब नहीं मिल सका।", "error");
  } finally {
    showSources(selected);
    askButton.disabled = !chunks.length || !questionInput.value.trim();
    askButton.textContent = "जवाब खोजें";
  }
}

fileInput.addEventListener("change", (event) => {
  void handleFiles(Array.from(event.target.files ?? []));
});
questionInput.addEventListener("input", () => {
  askButton.disabled = !chunks.length || !questionInput.value.trim();
});
summaryButton.addEventListener("click", () => {
  messages.replaceChildren();
  showSummary();
});
questionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (chunks.length && questionInput.value.trim()) {
    void answerQuestion(questionInput.value);
  }
});
