Project Overview
This project implements a **Chrome Extension (Manifest V3)** that integrates an AI-powered email assistant into **Gmail** and **Outlook**.  
The extension enhances email composition by generating refined, professional drafts and automatically identifying scheduling details to create calendar events.  

The frontend (popup + content scripts) communicates with a **local Flask backend**, which processes text through a **Language Model (AI Text Processor)**.  
When meeting-related information (such as date, time, or attendees) is detected, the system connects with **Google Calendar** or **Outlook Calendar** APIs to create events automatically.

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

**Important project-specific notes and conventions**
Endpoint Alignment
The frontend may POST to `/suggest` while the backend defines `/generate-suggestion`.  
To fix mismatches:
- Update the frontend fetch URL to match the backend route, **or**
- Rename the Flask route in `app.py` to `/suggest`.

Local Model Requirements
The backend expects a local AI runtime (e.g., Ollama CLI or similar).  
Ensure the model runtime is installed and accessible in your system’s PATH.  
If not found, the backend returns a `FileNotFoundError` or JSON 500 response.

Permissions
manifest.json includes the correct host_permissions for:
http://127.0.0.1:5000/*
https://mail.google.com/*
https://outlook.office.com/*
These allow secure cross-origin requests between the extension and backend.

**Installation and Setup**
Concrete run / debug steps (Windows)
1. Create & activate a virtualenv in `Backend` (optional but recommended):
   ```bash
   cd Backend
   python -m venv venv
   venv\Scripts\activate
2. Install dependencies:
   - pip install -r requirements.txt
3. Run the backend (from `Backend`):
   - python app.py
4. Confirm the backend is listening on 127.0.0.1:5000 (open http://127.0.0.1:5000/ in browser or curl).
5. Load the extension (unpacked) into Chrome/Chromium via chrome://extensions and toggle developer mode.
6. Open Gmail, open the popup and try the Suggest flow; if nothing happens, open DevTools for the page and the extension (and check the background service worker console) for errors.

Using the Extension
-Open Gmail or Outlook in Chrome.
-Click Compose or Reply to start an email.
-The “Generate Reply” button appears in the compose box.
-Type your draft or notes, then click Generate Reply.
-The text is sent to the Flask backend.
-The backend runs the Language Model, which returns a refined version of your email.
-If meeting details are detected, the Calendar Event Creation feature is triggered.
-The refined draft is automatically injected back into the compose window for review.

Calendar Event Creation Workflow
1. The backend analyzes your text for meeting intent and scheduling details, such as:
    -Date and time
    -Attendees or participants
    -Keywords like “meeting,” “call,” or “appointment”
2. The extracted information is formatted into a structured calendar event request.
3. Using authenticated credentials, the system connects to Google Calendar or Outlook Calendar.
4. The event is automatically created and confirmed.
5. A confirmation notification appears, verifying successful scheduling.
This integration unifies writing and scheduling in a single, automated workflow.

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
- Button not appearing in Gmail/Outlook
  -DOM may not be loaded, simply refresh or reopen compose window
-Calendar event not created
  -Invalid or missing credentials, re-authenticate calendar API access 

Where to change behavior (file pointers)
-Gmail editor selectors: popup.js / content.js → div[aria-label='Message Body']
-Backend route: Backend/app.py → @app.route("/generate-suggestion")
-Calendar logic: Inside app.py or calendar_service.py
-Model invocation: Adjust the subprocess.run() command to use your preferred local model runtime.
  
License/Notes
This project was developed for academic and educational purposes as part of a Senior Seminar Capstone Project.
It demonstrates local AI integration into a browser extension to support:
  -Email refinement
  -Automated meeting scheduling
  -User privacy via local processing
Future versions will support deployment to the Chrome Web Store for simplified installation.
