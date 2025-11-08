Project Overview
- This repository contains a Chrome Extension (Manifest V3) that augments Gmail with AI-powered email suggestions.
The extension frontend (popup + content script) sends the current draft to a local Flask backend, which invokes a local LLM through the ollama CLI to generate contextual suggestions.

Folder Structure
  ├── manifest.json
  ├── popup.html
  ├── popup.js
  ├── content.js
  └── Backend/
    ├── app.py
    ├── run.bat
    └── venv/

Key components 
-manifest.json — Extension manifest (v3). Grants scripting, activeTab, and host_permissions for
http://127.0.0.1:5000/* and Gmail host.
-popup.html / popup.js — User-facing popup that injects a script into the Gmail page via
chrome.scripting.executeScript to read and modify the email body.
-content.js — Alternative content-script approach that queries the Gmail editor and performs a fetch to the local backend.
-Backend/app.py — Flask backend exposing an API endpoint that calls the ollama CLI using subprocess.run.
-Backend/run.bat — Helper batch script to activate the virtual environment and start the backend on Windows.

Important project-specific notes and conventions
-Endpoint mismatch
  The frontend currently POSTs to http://127.0.0.1:5000/suggest, while the backend defines
  @app.route("/generate-suggestion").
  Fix this by either:
    -updating the frontend fetch URL to generate-suggestion,or
    -renaming the Flask route to /suggest in Backend/main.py.
Local LLM requirement
The backend expects the ollama CLI to be installed and accessible in PATH.
If missing, requests will fail with a FileNotFoundError (a JSON 500 response is returned).

Permissions
manifest.json includes the correct host_permissions for http://127.0.0.1:5000/*,
allowing fetch requests from the extension to the backend.

Concrete run / debug steps (Windows)
1. Create & activate a virtualenv in `Backend` (optional but recommended):
   - python -m venv venv
   - venv\Scripts\activate
2. Install dependencies:
   - pip install flask
3. Run the backend (from `Backend`):
   - python app.py
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
- To change the backend API name or behavior: edit `Backend/app.py` (Flask route). Look for `@app.route("/generate-suggestion")` and the `subprocess.run(["ollama", "run", "llama2"])` call.

Minimal examples for agents
- If you need to make the simplest, low-risk change to make the extension work, update `popup.js`/`content.js` fetch URLs to match the backend route:
  - replace `http://127.0.0.1:5000/suggest` -> `http://127.0.0.1:5000/generate-suggestion`
- If you prefer renaming backend: rename `Backend/app.py` -> `Backend/app.py` and update `run.bat`/instructions accordingly.
License/Notes
-This project was developed for academic and educational purposes (Senior Seminar Capstone).
-It demonstrates integration of a local AI model into a privacy-focused Chrome extension.
