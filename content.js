console.log("Email Assistant content script loaded.");

// -------------------
// Helper functions
// -------------------

// Find Gmail draft editors
function getEmailDraftEditors() {
  return Array.from(document.querySelectorAll("div[role='textbox'][aria-label='Message Body']"));
}

// Update Gmail editor with formatted draft
function updateEditor(editor, suggestion) {
  editor.focus();
  const formatted = suggestion
    .trim()
    .split("\n")
    .map(line => `<div>${line}</div>`)
    .join("");
  editor.innerHTML = formatted;
}

// Send draft to backend and apply suggestion
async function sendDraftToBackend(editor, button) {
  const draft = editor.innerText;
  if (!draft) return;

  button.textContent = "⏳ Generating...";

  try {
    // 1️⃣ Generate AI-refined draft
    const response = await fetch("http://127.0.0.1:5000/generate-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
      mode: "cors"
    });

    const data = await response.json();

    if (data.suggestion) {
      updateEditor(editor, data.suggestion);
      console.log("Draft refined on button click.");
    }

    // 2️⃣ Parse for meeting info and send to background.js
    await checkForMeetingRequest(draft);

  } catch (err) {
    console.error("Error fetching suggestion:", err);
  }

  button.textContent = "✨ Generate Reply";
}

// -------------------
// Add button below each compose editor
// -------------------
function addGenerateButton(editor) {
  if (editor.parentElement.querySelector(".generate-btn")) return;

  const btn = document.createElement("button");
  btn.textContent = "✨ Generate Reply";
  btn.className = "generate-btn";
  btn.style.cssText = `
    margin-top: 8px;
    padding: 6px 12px;
    background: #4285f4;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    display: inline-block;
  `;

  btn.addEventListener("click", () => sendDraftToBackend(editor, btn));
  editor.parentElement.appendChild(btn);
}

// -------------------
// Observe Gmail compose windows dynamically
// -------------------
const observer = new MutationObserver(() => {
  const editors = getEmailDraftEditors();

  editors.forEach(editor => {
    if (!editor.hasAttribute("data-ai-observed")) {
      editor.setAttribute("data-ai-observed", "true");
      addGenerateButton(editor);
    }
  });
});

observer.observe(document.body, { childList: true, subtree: true });

console.log("Gmail draft observer initialized.");

// -------------------
// Detect and parse meeting details
// -------------------
async function checkForMeetingRequest(draft) {
  try {
    console.log("Sending draft to parse-meeting:", draft);

    const response = await fetch("http://127.0.0.1:5000/parse-meeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
      mode: "cors"
    });

    if (!response.ok) {
      console.error("parse-meeting failed:", response.status, response.statusText);
      return;
    }

    const data = await response.json();
    console.log("Parsed meeting data:", data);

    if (!data || !data.day) return;

    const now = new Date();
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let dayIndex = weekdays.indexOf(data.day.charAt(0).toUpperCase() + data.day.slice(1).toLowerCase());
    if (dayIndex === -1) return;

    let daysAhead = (dayIndex + 7 - now.getDay()) % 7;
    if (daysAhead === 0) daysAhead = 7;

    let eventHour = data.hour;
    if (data.ampm.toLowerCase() === "pm" && eventHour < 12) eventHour += 12;

    const eventDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, eventHour, data.minute || 0);
    const endDate = new Date(eventDate.getTime() + 60 * 60 * 1000);

    const eventData = {
      summary: data.summary || "Meeting",
      description: draft,
      start: eventDate.toISOString(),
      end: endDate.toISOString(),
      attendees: Array.isArray(data.attendees) ? data.attendees : []
    };

    console.log("Sending event data to background for Calendar creation:", eventData);

    // ✅ Send event data to background.js for Google Calendar
    chrome.runtime.sendMessage({ action: "createCalendarEvent", eventData }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Message error:", chrome.runtime.lastError.message);
      } else if (response?.success) {
        console.log("Event successfully created:", response.eventId);
        alert("✅ Event created! Check your Google Calendar.");
      } else {
        console.error("Event creation failed:", response?.error);
      }
    });

  } catch (err) {
    console.error("Error parsing or sending meeting event:", err);
  }
}
