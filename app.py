from flask import Flask, request, jsonify
from flask_cors import CORS
from calendar_service import get_calendar_service
import subprocess
import ollama
import json

app = Flask(__name__)

# ✅ Allow requests from Gmail
CORS(app, resources={r"/*": {"origins": ["https://mail.google.com"]}}, supports_credentials=True)

# --------------------------
# Health check
# --------------------------
@app.route("/", methods=["GET"])
def health_check():
    return jsonify({"status": "ok", "service": "email-assistant-backend"})

# --------------------------
# Generate AI-refined draft
# --------------------------
@app.route("/generate-suggestion", methods=["POST"])
def generate_suggestion():
    data = request.json or {}
    draft = data.get("draft", "")

    prompt = f"""
Refine and improve the following email draft.
Keep the meaning intact, make it clear, professional, and polished.
Return only the improved draft text, without quotes, extra explanations:
\"\"\"{draft}\"\"\"
"""

    try:
        result = subprocess.run(
            ["ollama", "run", "llama3:latest"],  # Replace with your model
            input=prompt.encode("utf-8"),
            capture_output=True,
            check=False
        )
        suggestion = result.stdout.decode("utf-8").strip()

        # Remove enclosing quotes if AI added them
        if (suggestion.startswith('"') and suggestion.endswith('"')) or \
           (suggestion.startswith("'") and suggestion.endswith("'")):
            suggestion = suggestion[1:-1].strip()

    except FileNotFoundError:
        # Fallback for testing
        suggestion = draft

    return jsonify({"suggestion": suggestion})

# --------------------------
# Parse meeting using Ollama
# --------------------------
@app.route('/parse-meeting', methods=['POST'])
def parse_meeting():
    data = request.get_json()
    draft = data.get('draft', '')

    prompt = f"""
Extract meeting details from the following email draft.
Return JSON with fields:
- summary: short title of meeting
- day: day of the week (e.g., Monday)
- hour: 1-12
- minute: 0-59
- ampm: am or pm
- attendees: list of email addresses mentioned in the draft

Email draft:
{draft}
"""

    try:
        response = ollama.chat(model='llama3:latest', messages=[{"role": "user", "content": prompt}])
        parsed = response['choices'][0]['message']['content']
        parsed_json = json.loads(parsed)
    except Exception as e:
        print("Ollama parse error:", e)
        parsed_json = {
            "summary": "Meeting",
            "day": "Friday",
            "hour": 3,
            "minute": 0,
            "ampm": "pm",
            "attendees": []
        }

    return jsonify(parsed_json)

# --------------------------
# Add event to Google Calendar
# --------------------------
@app.route('/add_event', methods=['POST'])
def add_event():
    data = request.get_json()

    summary = data.get('summary', 'New Event')
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    attendees = data.get('attendees', [])

    service = get_calendar_service()
    event = {
        'summary': summary,
        'start': {'dateTime': start_time, 'timeZone': 'America/Chicago'},
        'end': {'dateTime': end_time, 'timeZone': 'America/Chicago'},
        'attendees': [{'email': email} for email in attendees],
    }

    created_event = service.events().insert(calendarId='primary', body=event).execute()
    return jsonify({'eventLink': created_event.get('htmlLink')})

# --------------------------
# Run Flask app
# --------------------------
if __name__ == '__main__':
    app.run(host="127.0.0.1", port=5000, debug=True)
