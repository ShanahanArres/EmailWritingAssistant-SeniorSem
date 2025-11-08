from __future__ import annotations

from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime, timedelta
import json
import re
import subprocess
import requests

# Optional Google Calendar helper (kept graceful if missing)
try:
    from calendar_service import get_calendar_service
except Exception:
    get_calendar_service = None

# -----------------------------
# Flask + CORS
# -----------------------------
app = Flask(__name__)
CORS(
    app,
    resources={
        r"/*": {
            "origins": [
                "https://mail.google.com",
                "https://outlook.office.com",
                "https://outlook.live.com",
                "chrome-extension://*",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
            ],
            "allow_headers": ["Content-Type", "Authorization"],
            "methods": ["GET", "POST", "OPTIONS"],
        }
    },
    supports_credentials=True,
)

# -----------------------------
# Constants
# -----------------------------
GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"
DEFAULT_TZ = "America/Chicago"
# NOTE: If you want automatic DST handling, we can switch to zoneinfo later.
DEFAULT_TZ_OFFSET = "-06:00"

# -----------------------------
# Utils
# -----------------------------
def graph_request(endpoint: str, token: str, method: str = "GET", payload: dict | None = None):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"{GRAPH_BASE_URL}{endpoint}"
    resp = requests.request(method, url, headers=headers, json=payload)
    if resp.status_code >= 400:
        print("⚠️ Microsoft Graph API error:", resp.text)
    return resp


def _ollama_chat_prompt(prompt: str) -> str:
    """
    Call Ollama via subprocess with UTF-8 decoding.
    """
    try:
        result = subprocess.run(
            ["ollama", "run", "emailsenglish2:latest"],
            input=prompt.encode("utf-8"),   # ✅ encode input
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        out = result.stdout.decode("utf-8", errors="ignore").strip()  # ✅ decode safely
        if not out:
            print("⚠️ Ollama returned empty stdout; stderr:", result.stderr.decode("utf-8", errors="ignore"))
        return out or ""
    except Exception as e:
        print("❌ Ollama execution error:", e)
        return ""


def _normalize_time_from_text_if_missing(text: str) -> tuple[int, int, str]:
    """
    If the LLM doesn't return time, try to infer from the email text:
    - explicit times like '6 pm', '6:30am'
    - keywords: noon, midnight, tonight, evening, morning, afternoon
    Returns (hour_12, minute, ampm)
    """
    t = text.lower()

    # 1) explicit clock times first
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", t)
    if m:
        h = int(m.group(1))
        mins = int(m.group(2) or 0)
        ap = m.group(3)
        return h, mins, ap

    # 2) numbers with no am/pm (assume pm after 8, else am)
    m2 = re.search(r"\b(\d{1,2})(?::(\d{2}))\b", t)
    if m2:
        h = int(m2.group(1))
        mins = int(m2.group(2) or 0)
        ap = "pm" if h >= 8 else "am"
        return h, mins, ap

    m3 = re.search(r"\b(\d{1,2})\s*(o'?clock)?\b", t)
    if m3:
        h = int(m3.group(1))
        ap = "pm" if h >= 6 else "am"
        return h, 0, ap

    # 3) keywords
    if "noon" in t:
        return 12, 0, "pm"
    if "midnight" in t:
        return 12, 0, "am"
    if "tonight" in t or "evening" in t:
        return 7, 0, "pm"
    if "afternoon" in t:
        return 3, 0, "pm"
    if "morning" in t:
        return 9, 0, "am"

    # default 6 pm
    return 6, 0, "pm"


def _compute_target_date(draft_text: str) -> datetime.date:
    """
    Smart natural-language date resolution:
    - tomorrow
    - next week
    - weekend
    - (this|next) <weekday>
    - today (implicit default)
    """
    text = draft_text.lower()
    today = datetime.now().date()
    weekdays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]

    def next_weekday(start_date, weekday_name, skip_current=False):
        target = weekdays.index(weekday_name)
        days_ahead = (target - start_date.weekday() + 7) % 7
        if days_ahead == 0 and skip_current:
            days_ahead = 7
        return start_date + timedelta(days=days_ahead)

    # Priority keywords
    if "tomorrow" in text:
        return today + timedelta(days=1)
    if "next week" in text:
        return today + timedelta(days=7)
    if "weekend" in text:
        return next_weekday(today, "saturday")

    # Explicit weekday handling
    for w in weekdays:
        # 'next friday' vs 'this friday' vs plain 'friday'
        if re.search(rf"\b(next\s+{w})\b", text):
            return next_weekday(today, w, skip_current=True)
        if re.search(rf"\b(this\s+{w})\b", text):
            return next_weekday(today, w, skip_current=False)
        if re.search(rf"\b{w}\b", text):
            return next_weekday(today, w, skip_current=False)

    # Fallback: today
    return today


def _to_iso_local(dt: datetime) -> str:
    return dt.strftime(f"%Y-%m-%dT%H:%M:%S{DEFAULT_TZ_OFFSET}")


# -----------------------------
# Health
# -----------------------------
@app.get("/")
def health_check():
    return jsonify({"status": "ok", "service": "email-assistant-backend"})


# -----------------------------
# ✨ Generate AI-refined Email Draft
# -----------------------------
@app.post("/generate-suggestion")
def generate_suggestion():
    data = request.get_json(silent=True) or {}
    draft = (data.get("new_email_content") or "").strip()

    print("📩 Received draft from extension:\n", draft)
    if not draft:
        return jsonify({"draft": "(Error: No email content received.)"}), 400

    prompt = f"""
You are an assistant that rewrites the user's email in a friendly, professional, natural tone.

FORMAT RULES:
Write in **true email format**:
    • Start with a natural greeting (e.g., "Hi [Name]," or "Hello team,").
    • Use short, conversational sentences.
    • Indent paragraphs with a single tab (\\t) for readability.
    • Add one blank line between paragraphs.
    • End with a warm and professional sign-off (e.g., "Best," / "Kind regards,").
- Preserve all details from the original message (names, dates, times, context).
- Do NOT add explanations, markdown, or quotes.
- Output ONLY the rewritten email body exactly as it should appear when pasted into an email editor.

Original email:
\"\"\"{draft}\"\"\"

Rewritten email:
""".strip()

    suggestion = _ollama_chat_prompt(prompt)
    if (suggestion.startswith('"') and suggestion.endswith('"')) or (
        suggestion.startswith("'") and suggestion.endswith("'")
    ):
        suggestion = suggestion[1:-1].strip()
    if not suggestion:
        suggestion = draft

    print("✅ Ollama output:", suggestion)
    return jsonify({"draft": suggestion})


# -----------------------------
# 📅 Parse Meeting Details (smart)
# -----------------------------
@app.post("/parse-meeting")
def parse_meeting():
    data = request.get_json(silent=True) or {}
    draft = data.get("draft", "")

    # -------------------------
    # 🧠 Step 1: Ask Ollama for structured meeting info (no dates)
    # -------------------------
    prompt = f"""
Extract meeting details from this email and return ONLY valid JSON.
Include:
- summary: short meeting title
- hour: 1–12
- minute: 0–59
- ampm: am/pm
- attendees: list of people or emails mentioned

Do NOT include any dates or day names — I will handle that part separately.
Email:
{draft}
""".strip()

    try:
        raw = _ollama_chat_prompt(prompt)
        print("🧩 Raw meeting parse:", raw)

        cleaned = raw.replace("```json", "").replace("```", "").strip()

        # ✅ Try to locate any JSON object in the text
        import re, json
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            parsed = json.loads(match.group(0))
        else:
            raise ValueError("No JSON object found")
    except Exception as e:
        print("⚠️ LLM parse failed, using defaults:", e)
        parsed = {}

    # -------------------------
    # 📅 Step 2: Compute target date from natural language
    # -------------------------
    text_lower = draft.lower()
    today = datetime.now()

    if "tomorrow" in text_lower:
        target_date = today + timedelta(days=1)
    elif "monday" in text_lower:
        target_date = today + timedelta((0 - today.weekday() + 7) % 7 or 7)
    elif "tuesday" in text_lower:
        target_date = today + timedelta((1 - today.weekday() + 7) % 7 or 7)
    elif "wednesday" in text_lower:
        target_date = today + timedelta((2 - today.weekday() + 7) % 7 or 7)
    elif "thursday" in text_lower:
        target_date = today + timedelta((3 - today.weekday() + 7) % 7 or 7)
    elif "friday" in text_lower:
        target_date = today + timedelta((4 - today.weekday() + 7) % 7 or 7)
    elif "saturday" in text_lower:
        target_date = today + timedelta((5 - today.weekday() + 7) % 7 or 7)
    elif "sunday" in text_lower:
        target_date = today + timedelta((6 - today.weekday() + 7) % 7 or 7)
    else:
        target_date = today

    # -------------------------
    # ⏰ Step 3: Normalize time fields
    # -------------------------
    hour = int(parsed.get("hour", 6))
    minute = int(parsed.get("minute", 0))
    ampm = str(parsed.get("ampm", "pm")).lower()

    if ampm == "pm" and 1 <= hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0

    start_dt = target_date.replace(hour=hour, minute=minute, second=0, microsecond=0)
    end_dt = start_dt + timedelta(hours=2)

    # -------------------------
    # 📦 Step 4: Construct final normalized output
    # -------------------------
    parsed_final = {
        "summary": parsed.get("summary", "Meeting"),
        "attendees": parsed.get("attendees", []),
        "date": target_date.strftime("%Y-%m-%d"),
        "hour": hour if hour <= 12 else hour - 12,
        "minute": minute,
        "ampm": ampm,
        "start_time": start_dt.strftime("%Y-%m-%dT%H:%M:%S-06:00"),
        "end_time": end_dt.strftime("%Y-%m-%dT%H:%M:%S-06:00"),
    }

    print("📅 Parsed meeting (smart):", parsed_final)
    return jsonify(parsed_final)


# -----------------------------
# 🗓️ Google Calendar Integration (server-side helper)
# -----------------------------
@app.post("/add_event")
def add_event():
    if not get_calendar_service:
        return jsonify({"error": "Google Calendar server helper not available"}), 501

    data = request.get_json(silent=True) or {}
    provider = data.get("provider", "google")
    summary = data.get("summary", "New Event")
    start_time = data.get("start_time")
    end_time = data.get("end_time")
    attendees = data.get("attendees", [])

    if provider != "google":
        return jsonify({"error": "Unsupported provider"}), 400
    if not start_time or not end_time:
        return jsonify({"error": "Missing start_time or end_time"}), 400

    service = get_calendar_service()
    event = {
        "summary": summary,
        "start": {"dateTime": start_time, "timeZone": DEFAULT_TZ},
        "end": {"dateTime": end_time, "timeZone": DEFAULT_TZ},
        "attendees": [{"email": a} for a in attendees if isinstance(a, str) and "@" in a],
    }
    created = service.events().insert(calendarId="primary", body=event).execute()
    return jsonify({"eventLink": created.get("htmlLink"), "provider": "google"})


# -----------------------------
# 🟩 Microsoft Graph Calendar (used by background.js)
#  background.js POSTs: { access_token: "...", event_data: {...} }
# -----------------------------
@app.post("/create-outlook-event")
def create_outlook_event():
    payload = request.get_json(silent=True) or {}
    access_token = payload.get("access_token")
    event_data = payload.get("event_data") or {}

    if not access_token:
        return jsonify({"error": "Missing access_token"}), 401

    start_time = event_data.get("start_time")
    end_time = event_data.get("end_time")
    if not start_time or not end_time:
        return jsonify({"error": "Missing start_time or end_time"}), 400

    # attendees: support ["a@b.com", ...] or [{"email":"a@b.com"}, ...]
    attendees_raw = event_data.get("attendees") or []
    attendees = []
    for a in attendees_raw:
        if isinstance(a, str) and "@" in a:
            attendees.append({"emailAddress": {"address": a, "name": a.split("@")[0]}, "type": "required"})
        elif isinstance(a, dict) and "email" in a and "@" in a["email"]:
            addr = a["email"]
            attendees.append({"emailAddress": {"address": addr, "name": addr.split("@")[0]}, "type": "required"})

    outlook_payload = {
        "subject": event_data.get("summary", "Meeting from Email Assistant"),
        "body": {
            "contentType": "HTML",
            "content": event_data.get("description", "Created automatically by Email Assistant"),
        },
        "start": {"dateTime": start_time, "timeZone": event_data.get("timeZone", DEFAULT_TZ)},
        "end": {"dateTime": end_time, "timeZone": event_data.get("timeZone", DEFAULT_TZ)},
    }
    if attendees:
        outlook_payload["attendees"] = attendees
    if event_data.get("location"):
        outlook_payload["location"] = {"displayName": event_data["location"]}

    print("📤 Creating Outlook event with payload:", outlook_payload)
    resp = graph_request("/me/events", access_token, method="POST", payload=outlook_payload)

    if resp.status_code == 201:
        body = resp.json()
        return jsonify({"id": body.get("id"), "webLink": body.get("webLink"), "message": "Event created"})
    elif resp.status_code in (401, 403):
        return jsonify({"error": "Unauthorized", "details": resp.text}), 401
    else:
        return jsonify({"error": f"Graph error {resp.status_code}", "details": resp.text}), resp.status_code


# -----------------------------
# Run
# -----------------------------
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
