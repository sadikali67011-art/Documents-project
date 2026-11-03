# Document Q&A

A document question-answering app with two front ends: the original Streamlit
app and a Netlify-ready browser app. Both read PDF, DOCX, TXT, and Markdown
documents, find relevant passages, and provide answers with citations using
OpenAI. Extractive summaries and matching passages are also available without
an API key.

## Netlify deployment

The Netlify version is a static browser app with a serverless function for AI
answers. Documents are extracted and searched in the browser; only the selected
passages and question are sent to the function when AI answers are requested.
The OpenAI API key stays in Netlify environment variables and is never included
in the browser code.

1. In Netlify, choose **Add new site → Import an existing project** and connect
   `sadikali67011-art/Documents-project`.
2. Keep the build settings from `netlify.toml` (`npm run build`, publish
   directory `dist`, functions directory `netlify/functions`).
3. Optionally add `OPENAI_API_KEY` under **Site configuration → Environment
   variables**. `OPENAI_MODEL` is optional and defaults to `gpt-4o-mini`.
4. Deploy the site. Without the API key, uploads, extractive summaries, and
   matching source passages still work.

Files are processed locally in the browser and are not saved to the server.
Each file is limited to 20 MB and total extracted text to 1 MB per selection.
Scanned/image-only PDFs need OCR and are not supported.

To build the Netlify site locally:

```powershell
npm install
npm run build
```

## Run the Streamlit version locally

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

Run the Netlify function tests with:

```powershell
npm test
```
