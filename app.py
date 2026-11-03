import os
from typing import List

import streamlit as st
from openai import OpenAI

from docqa import (
    DocumentChunk,
    chunk_text,
    extract_document,
    extractive_summary,
    is_summary_question,
    rank_chunks,
)


LANGUAGE_LABELS = {
    "Hindi": "हिन्दी",
    "English": "English",
    "Spanish": "Español",
    "French": "Français",
    "German": "Deutsch",
    "Portuguese": "Português",
    "Italian": "Italiano",
    "Dutch": "Nederlands",
    "Russian": "Русский",
    "Arabic": "العربية",
    "Bengali": "বাংলা",
    "Chinese (Simplified)": "中文（简体）",
    "Japanese": "日本語",
    "Korean": "한국어",
    "Urdu": "اردو",
    "Punjabi": "ਪੰਜਾਬੀ",
    "Marathi": "मराठी",
    "Tamil": "தமிழ்",
    "Telugu": "తెలుగు",
    "Turkish": "Türkçe",
}


def show_summary(chunks: List[DocumentChunk], api_key: str, model: str, language: str) -> None:
    summary = extractive_summary(chunks)
    if not summary:
        st.info("दस्तावेज़ में सारांश के लिए text नहीं मिला।")
        return

    if api_key.strip():
        passages = "\n\n".join(
            f"[S{index}] {chunk.source} — passage {chunk.chunk_id}: {sentence}"
            for index, (chunk, sentence) in enumerate(summary, start=1)
        )
        try:
            response = OpenAI(api_key=api_key.strip()).chat.completions.create(
                model=model.strip() or "gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            f"Translate each supplied extractive summary sentence into {language}. "
                            "Preserve each [S#] label exactly and in order. Do not add, remove, "
                            "or infer facts. Return only the translated sentences with their labels."
                        ),
                    },
                    {"role": "user", "content": passages},
                ],
                temperature=0,
            )
            translated = response.choices[0].message.content
            if translated:
                st.subheader(f"दस्तावेज़ का सारांश — {LANGUAGE_LABELS[language]}")
                st.write(translated)
                return
            st.error("AI से खाली अनुवाद मिला। मूल summary नीचे दिखाया गया है।")
        except Exception as exc:
            st.error(f"Summary का अनुवाद नहीं हो सका: {exc}")

    st.subheader("दस्तावेज़ का extractive सारांश (मूल भाषा)")
    st.caption("अनुवाद के लिए sidebar में OpenAI API key दें। स्रोत वाक्य नहीं बदले गए हैं।")
    for source_chunk, sentence in summary:
        st.markdown(f"- {sentence}  \n*{source_chunk.source} — passage {source_chunk.chunk_id}*")


st.set_page_config(page_title="Document Q&A", page_icon="📚", layout="wide")

st.title("📚 Document Q&A")
st.caption("अपने दस्तावेज़ अपलोड करें और उनके बारे में सवाल पूछें।")

with st.sidebar:
    st.header("सेटअप")
    api_key = st.text_input(
        "OpenAI API key (AI answers के लिए)",
        value=os.getenv("OPENAI_API_KEY", ""),
        type="password",
        help="Key केवल इस session में इस्तेमाल होती है।",
    )
    model = st.text_input("Model", value=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
    language = st.selectbox(
        "जवाब / summary की भाषा",
        options=list(LANGUAGE_LABELS),
        format_func=LANGUAGE_LABELS.__getitem__,
    )
    st.caption(
        "दस्तावेज़ आपके browser session में process होते हैं। सवाल पूछने पर "
        "केवल चुने गए passages OpenAI को भेजे जाते हैं। AI जवाब और summary चुनी गई भाषा में होंगे।"
    )

uploaded_files = st.file_uploader(
    "दस्तावेज़ चुनें",
    type=["pdf", "docx", "txt", "md"],
    accept_multiple_files=True,
    help="PDF, Word (.docx), text (.txt) और Markdown (.md) समर्थित हैं।",
)

if uploaded_files is not None:
    chunks: List[DocumentChunk] = []
    errors = []
    for uploaded_file in uploaded_files:
        try:
            text = extract_document(uploaded_file.name, uploaded_file.getvalue())
            chunks.extend(chunk_text(text, uploaded_file.name))
        except (ValueError, RuntimeError) as exc:
            errors.append(f"{uploaded_file.name}: {exc}")

    st.session_state["document_chunks"] = chunks
    st.session_state["document_errors"] = errors
    for error in errors:
        st.error(error)
    if chunks:
        st.success(f"{len(uploaded_files) - len(errors)} file(s) पढ़ीं; {len(chunks)} passages तैयार।")

chunks = st.session_state.get("document_chunks", [])
if not chunks:
    for error in st.session_state.get("document_errors", []):
        st.error(error)
    st.info("शुरू करने के लिए एक या अधिक documents upload करें।")
    st.stop()

if not api_key.strip():
    st.info(
        "API key के बिना app document का extractive overview और matching passages "
        "मूल भाषा में दिखाता है। AI जवाब और summary का अनुवाद करने के लिए sidebar में OpenAI API key दें।"
    )

if st.button("दस्तावेज़ का सारांश दिखाएँ"):
    st.session_state["show_summary"] = True
if st.session_state.get("show_summary"):
    show_summary(chunks, api_key, model, language)

question = st.text_input("आपका सवाल", placeholder="उदाहरण: छुट्टी की policy क्या है?")
answer_button = st.button("जवाब खोजें", type="primary", disabled=not question.strip())

if answer_button:
    matches = rank_chunks(question, chunks, top_k=5)
    if not matches:
        matches = [(chunk, 0.0) for chunk in chunks[:3]]
        if not is_summary_question(question):
            st.warning(
                "इस सवाल के शब्दों से सीधा match नहीं मिला। बेहतर जवाब के लिए "
                "सवाल को document में मौजूद शब्दों से पूछें; नीचे document overview है।"
            )

    if is_summary_question(question):
        show_summary(chunks, api_key, model, language)
    elif api_key.strip():
        passages = []
        for index, (chunk, _) in enumerate(matches, start=1):
            passages.append(
                f"[S{index}] File: {chunk.source}; passage {chunk.chunk_id}\n{chunk.text}"
            )
        prompt = (
            "Answer the user's question using only the supplied document passages. "
            "If the passages do not contain the answer, say that the documents do not "
            "provide enough information. Do not invent facts. Cite supporting passages "
            f"with their exact [S#] labels. Answer entirely in {language}.\n\n"
            f"Question:\n{question.strip()}\n\n"
            f"Document passages:\n\n{chr(10).join(passages)}"
        )
        try:
            client = OpenAI(api_key=api_key.strip())
            response = client.chat.completions.create(
                model=model.strip() or "gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a careful document question-answering assistant.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0,
            )
            answer = response.choices[0].message.content
            if not answer:
                st.error("AI से खाली जवाब मिला। कृपया दोबारा कोशिश करें।")
            else:
                st.subheader("जवाब")
                st.write(answer)
        except Exception as exc:
            st.error(f"AI जवाब नहीं मिल सका: {exc}")
    else:
        st.warning(
            "AI-generated जवाब के लिए sidebar में OpenAI API key डालें। "
            "फिलहाल नीचे संबंधित मूल text दिया है।"
        )

    with st.expander("स्रोत passages", expanded=True):
        for index, (chunk, score) in enumerate(matches, start=1):
            st.markdown(f"**[S{index}] {chunk.source} — passage {chunk.chunk_id}**")
            st.caption(f"Relevance score: {score:.2f}")
            st.write(chunk.text)
