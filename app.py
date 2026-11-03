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
    st.caption(
        "दस्तावेज़ आपके browser session में process होते हैं। सवाल पूछने पर "
        "केवल चुने गए passages OpenAI को भेजे जाते हैं।"
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
        "दिखाता है। Natural-language AI answers के लिए sidebar में OpenAI API key दें।"
    )

if st.button("दस्तावेज़ का सारांश दिखाएँ"):
    st.session_state["show_summary"] = True
if st.session_state.get("show_summary"):
    st.subheader("दस्तावेज़ का extractive सारांश")
    st.caption("यह मूल document से चुनी हुई lines हैं; AI द्वारा paraphrase नहीं की गईं।")
    for source_chunk, sentence in extractive_summary(chunks):
        st.markdown(f"- {sentence}  \n*{source_chunk.source} — passage {source_chunk.chunk_id}*")

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
        st.subheader("दस्तावेज़ का सारांश")
        for source_chunk, sentence in extractive_summary(chunks):
            st.markdown(
                f"- {sentence}  \n*{source_chunk.source} — passage {source_chunk.chunk_id}*"
            )
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
            "with their exact [S#] labels. Answer in the same language as the question.\n\n"
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
