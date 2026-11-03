# Document Q&A

A small Streamlit app that reads PDF, DOCX, TXT, and Markdown documents, retrieves
relevant passages, and answers questions with citations using OpenAI. Without an
API key, it shows an extractive overview and matching source passages.

## Run locally

1. Install Python 3.10 or newer.
2. From this folder, create and activate a virtual environment:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

3. Install dependencies and start the app:

   ```powershell
   pip install -r requirements.txt
   streamlit run app.py
   ```

4. Open the local URL printed by Streamlit. Optionally enter an OpenAI API key
   in the sidebar for generated answers. The model defaults to `gpt-4o-mini`.
   Without a key, use **दस्तावेज़ का सारांश दिखाएँ** for a short overview
   made from original document sentences; Q&A shows matching source text.
   You can also set `OPENAI_API_KEY` and `OPENAI_MODEL` in the environment.

## Try the included demo

Upload `sample_docs/employee_handbook.txt` and ask:

- How many annual leave days do full-time employees receive?
- How often can employees work remotely?
- What approval is needed for expenses above $500?
- What should someone do about damaged equipment?

With an API key, answers are generated from retrieved passages and include
source labels such as `[S1]`. Without a key, the app provides an extractive
overview and matching original passages, not generated/paraphrased AI answers.

## How it works

1. The app extracts text locally from uploaded documents.
2. Text is split into overlapping passages to preserve nearby context.
3. A lightweight BM25-style ranker selects the most relevant passages.
4. When configured, only the question and selected passages are sent to the
   OpenAI Chat Completions API. The prompt requires grounded answers and citations.
5. The retrieved source passages are displayed for verification.

Scanned/image-only PDFs need OCR and are not currently supported. This prototype
keeps documents in the active Streamlit session; OpenAI receives the selected
passages only when you submit a question with an API key configured.

## Tests

Run the retrieval and text-processing tests with:

```powershell
python -m unittest discover -s tests -v
```
