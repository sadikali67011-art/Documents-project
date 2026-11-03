import io
import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import List, Sequence, Tuple


_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
    "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "was",
    "what", "when", "where", "which", "who", "why", "with", "my", "me",
    "hai", "hain", "ka", "ki", "ko", "kya", "mein", "meri", "mujhe",
    "ke", "ye", "yeh", "iska", "iski", "के", "की", "को", "में", "है",
    "क्या", "यह", "ये", "मेरी", "मेरा", "बताओ",
}
_SUMMARY_TERMS = {
    "experience", "education", "skills", "projects", "certification",
    "certifications", "qualification", "degree", "employment", "studied",
    "university", "college", "अनुभव", "शिक्षा", "कौशल",
}


@dataclass(frozen=True)
class DocumentChunk:
    source: str
    chunk_id: int
    text: str


def extract_document(filename: str, content: bytes) -> str:
    extension = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if extension in {"txt", "md"}:
        text = content.decode("utf-8-sig", errors="replace")
    elif extension == "pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise RuntimeError(f"PDF पढ़ने में समस्या: {exc}") from exc
    elif extension == "docx":
        try:
            from docx import Document

            document = Document(io.BytesIO(content))
            text = "\n\n".join(paragraph.text for paragraph in document.paragraphs)
        except Exception as exc:
            raise RuntimeError(f"DOCX पढ़ने में समस्या: {exc}") from exc
    else:
        raise ValueError("यह file format समर्थित नहीं है।")

    text = text.strip()
    if not text:
        raise ValueError("इस file में पढ़ने योग्य text नहीं मिला।")
    return text


def chunk_text(
    text: str, source: str, max_chars: int = 1200, overlap: int = 180
) -> List[DocumentChunk]:
    if max_chars <= 0 or overlap < 0 or overlap >= max_chars:
        raise ValueError("max_chars positive होना चाहिए और overlap उससे छोटा होना चाहिए।")

    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []

    chunks = []
    start = 0
    while start < len(normalized):
        end = min(start + max_chars, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start, end)
            if boundary > start + max_chars // 2:
                end = boundary
        excerpt = normalized[start:end].strip()
        if excerpt:
            chunks.append(DocumentChunk(source, len(chunks) + 1, excerpt))
        if end >= len(normalized):
            break
        start = max(start + 1, end - overlap)
    return chunks


def _tokens(text: str) -> List[str]:
    return [
        token
        for token in re.findall(r"\w+", text.lower(), flags=re.UNICODE)
        if token not in _STOP_WORDS
    ]


def is_summary_question(question: str) -> bool:
    normalized = question.lower().strip()
    summary_phrases = (
        "what is this",
        "what is my cv",
        "what does my cv",
        "summarize",
        "summary",
        "overview",
        "describe this",
        "about my cv",
        "meri cv",
        "meri resume",
        "cv ke bare",
        "cv ke baare",
        "kya hai ye",
        "ye kya hai",
        "my cv",
        "cv details",
        "cv ditals",
        "resume details",
        "resume ditals",
        "cv me kya",
        "cv mein kya",
        "बताओ",
        "सारांश",
        "के बारे में",
    )
    return any(phrase in normalized for phrase in summary_phrases)


def extractive_summary(
    chunks: Sequence[DocumentChunk], max_sentences: int = 5
) -> List[Tuple[DocumentChunk, str]]:
    sentences = []
    for chunk in chunks:
        parts = re.split(r"(?<=[.!?।])\s+", chunk.text)
        for sentence in parts:
            sentence = sentence.strip()
            if sentence:
                terms = set(_tokens(sentence))
                score = sum(term in terms for term in _SUMMARY_TERMS)
                sentences.append((chunk, sentence, score))

    ranked = sorted(
        enumerate(sentences),
        key=lambda item: (-item[1][2], item[0]),
    )[:max_sentences]
    return [(item[1][0], item[1][1]) for item in sorted(ranked)]


def rank_chunks(
    question: str, chunks: Sequence[DocumentChunk], top_k: int = 5
) -> List[Tuple[DocumentChunk, float]]:
    query_terms = set(_tokens(question))
    if not query_terms or not chunks or top_k <= 0:
        return []

    tokenized = [_tokens(chunk.text) for chunk in chunks]
    document_frequencies = Counter(
        term for terms in tokenized for term in set(terms)
    )
    average_length = sum(map(len, tokenized)) / len(tokenized)
    scored = []
    for chunk, terms in zip(chunks, tokenized):
        frequencies = Counter(terms)
        score = 0.0
        for term in query_terms:
            frequency = frequencies[term]
            if frequency:
                inverse_frequency = math.log(
                    1
                    + (len(chunks) - document_frequencies[term] + 0.5)
                    / (document_frequencies[term] + 0.5)
                )
                denominator = frequency + 1.2 * (
                    1 - 0.75 + 0.75 * len(terms) / max(average_length, 1)
                )
                score += inverse_frequency * frequency * 2.2 / denominator
        if score > 0:
            scored.append((chunk, score))

    scored.sort(key=lambda result: result[1], reverse=True)
    return scored[:top_k]
