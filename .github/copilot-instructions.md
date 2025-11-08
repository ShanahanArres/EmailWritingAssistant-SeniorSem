Project summary
- This repository is a Chrome extension (Manifest V3) that augments Gmail with AI-powered email suggestions. The extension frontend (popup + content script) sends the current draft to a local Flask backend which calls an LLM via the `ollama` CLI.

Key components (big picture)
- `manifest.json` — extension manifest (v3). Grants `scripting`, `activeTab` and `host_permissions` for `http://127.0.0.1:5000/*` and Gmail host.
- `popup.html` + `popup.js` — user-facing popup that injects a function into the Gmail page via `chrome.scripting.executeScript` to read/write the message body.
- `content.js` — alternative content-script approach; it queries the Gmail editor and performs `fetch` to the local backend.
- `Backend/main.py.py` — Flask backend that exposes an endpoint and calls the `ollama` CLI via `subprocess.run` to generate suggestions.
- `Backend/run.bat.txt` — helper batch script to start the backend on Windows (expects a `venv` folder).

Important project-specific notes and conventions
- Endpoint name mismatch: frontend files (`popup.js` and `content.js`) POST to `http://127.0.0.1:5000/suggest`, but the backend defines `@app.route("/generate-suggestion")`. Align these by either:
  - updating the frontend fetch URLs to `/generate-suggestion`, or
  - changing the Flask route to `/suggest` in `Backend/main.py.py`.
- File name oddity: backend script is `main.py.py`. That double extension is likely unintended and can confuse tools/IDE runners. Consider renaming to `main.py` if you want normal Python tooling behavior.
- Local LLM integration: the backend expects the `ollama` CLI to be installed and in PATH. If `ollama` is missing a request will fail with a `FileNotFoundError` (the code now returns a JSON 500 error in that case).
- Permissions: `manifest.json` already includes `host_permissions` for `http://127.0.0.1:5000/*`, so the extension should be allowed to fetch to the backend.

Concrete run / debug steps (Windows)
1. Create & activate a virtualenv in `Backend` (optional but recommended):
   - python -m venv venv
   - venv\Scripts\activate
2. Install dependencies:
   - pip install flask
3. Run the backend (from `Backend`):
   - python main.py.py  # or python main.py if you rename the file
4. Confirm the backend is listening on 127.0.0.1:5000 (open http://127.0.0.1:5000/ in browser or curl).
5. Load the extension (unpacked) into Chrome/Chromium via chrome://extensions and toggle developer mode.
6. Open Gmail, open the popup and try the Suggest flow; if nothing happens, open DevTools for the page and the extension (and check the background service worker console) for errors.

Common error checklist (targeted, actionable)
- "Fetch fails" or network error:
  - Check the frontend fetch URL: `popup.js` and `content.js` currently use `/suggest` (see the endpoint mismatch note above).
  - Confirm the backend process is running and bound to 127.0.0.1:5000.
- "ollama CLI not found" or backend JSON error with message `ollama CLI not found`:
  - Install Ollama and ensure `ollama` is on PATH, or modify the backend to use a different LLM-invocation method (HTTP API or a Python client).
- "flask import not resolved" or ModuleNotFoundError:
  - Ensure you activate the correct virtualenv and `pip install flask`.
- Extension permission errors or CORS-like failures:
  - Confirm `manifest.json` contains `host_permissions` for the backend; background/service worker logs will show blocked requests.
- Windows run script problems:
  - `Backend/run.bat.txt` is a helper (text file) — open and make sure it calls the correct activate script path: `venv\Scripts\activate.bat`. Running it directly may require renaming to `run.bat`.

Where to change behavior (file pointers)
- To change UI/DOM selectors for Gmail editor: edit `popup.js` and `content.js` (they use `div[aria-label='Message Body']`).
- To change the backend API name or behavior: edit `Backend/main.py.py` (Flask route). Look for `@app.route("/generate-suggestion")` and the `subprocess.run(["ollama", "run", "llama2"])` call.

Minimal examples for agents
- If you need to make the simplest, low-risk change to make the extension work, update `popup.js`/`content.js` fetch URLs to match the backend route:
  - replace `http://127.0.0.1:5000/suggest` -> `http://127.0.0.1:5000/generate-suggestion`
- If you prefer renaming backend: rename `Backend/main.py.py` -> `Backend/main.py` and update `run.bat`/instructions accordingly.

If anything above is unclear or you want me to make a small, safe change (for example: rename `main.py.py` to `main.py`, or change frontend fetch URL to match backend), tell me which one and I will update the code and run quick checks.
