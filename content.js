console.log("📨 Email Assistant content script loaded.");

// -------------------------------------------------
// 1️⃣ Environment Detection
// -------------------------------------------------
function getEnvironment() {
  const host = location.hostname;
  if (host.includes("mail.google.com")) return "gmail";
  if (host.includes("outlook.office.com") || host.includes("outlook.live.com"))
    return "outlook";
  return "unknown";
}

// -------------------------------------------------
// 2️⃣ Outlook Compose Detection
// -------------------------------------------------
function findOutlookComposeArea() {
  const selectors = [
    '[aria-label="Message body"][contenteditable="true"]',
    '[data-id="contentContainer"]',
    "div[contenteditable='true'][role='textbox']",
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.isContentEditable && el.offsetParent !== null) {
      console.log("✅ Found Outlook compose area:", selector);
      return el;
    }
  }
  const all = document.querySelectorAll("div[contenteditable='true']");
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 300 && r.height > 80 && el.offsetParent !== null) return el;
  }
  return null;
}

// -------------------------------------------------
// 3️⃣ Get Email Editors
// -------------------------------------------------
function getEmailDraftEditors() {
  const env = getEnvironment();
  if (env === "gmail") {
    const selectors = ["div[aria-label='Message Body']", "div[role='textbox']"];
    for (const s of selectors) {
      const els = Array.from(document.querySelectorAll(s)).filter(
        (e) => e.isContentEditable && e.offsetParent !== null
      );
      if (els.length) return els;
    }
    return [];
  }
  if (env === "outlook") {
    const el = findOutlookComposeArea();
    return el ? [el] : [];
  }
  return [];
}

// -------------------------------------------------
// 4️⃣ Insert Draft
// -------------------------------------------------
function insertDraftIntoEditor(draftText) {
  const editors = getEmailDraftEditors();
  const compose = editors[0];
  if (!compose) return console.error("❌ No compose area found");
  compose.focus();
  compose.innerHTML = "";
  const div = document.createElement("div");
  div.textContent = draftText;
  compose.appendChild(div);
  console.log("✅ Draft inserted");
}

// -------------------------------------------------
// 5️⃣ Backend Calls
// -------------------------------------------------
async function generatePersonalizedDraft(draftText) {
  try {
    const resp = await fetch("http://127.0.0.1:5000/generate-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_email_content: draftText }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data.draft || data.suggestion || draftText;
  } catch (err) {
    console.error("❌ Error generating draft:", err);
    return draftText;
  }
}

async function parseMeeting(draft) {
  try {
    const resp = await fetch("http://127.0.0.1:5000/parse-meeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    console.error("❌ Error parsing meeting:", err);
    return null;
  }
}

// -------------------------------------------------
// 6️⃣ Notifications
// -------------------------------------------------
function showSuccessNotification(msg) {
  const n = document.createElement("div");
  n.textContent = msg;
  n.style =
    "position:fixed;top:20px;right:20px;background:#d4edda;color:#155724;padding:10px;border-radius:6px;z-index:9999;";
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 4000);
}

// -------------------------------------------------
// 7️⃣ Add Generate Button
// -------------------------------------------------
function addGenerateButton(editor) {
  document.querySelectorAll(".generate-btn").forEach((b) => b.remove());
  const btn = document.createElement("button");
  btn.textContent = "✨ Generate Reply";
  btn.className = "generate-btn";
  btn.style.cssText =
    "margin:8px 0;padding:6px 12px;background:#1a73e8;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;";
  btn.onmouseenter = () => (btn.style.background = "#1669c1");
  btn.onmouseleave = () => (btn.style.background = "#1a73e8");

  btn.addEventListener("click", async () => {
  const draftText = editor.textContent || editor.innerText || "";
  if (!draftText.trim()) return alert("Please write some text first!");
  const old = btn.textContent;
  btn.textContent = "⏳ Generating...";
  btn.disabled = true;

  try {
    // 1️⃣ Generate refined email
    const personalized = await generatePersonalizedDraft(draftText);
    insertDraftIntoEditor(personalized);

    // 2️⃣ Parse meeting info from the refined draft
    const meetingData = await parseMeeting(personalized);
    if (meetingData) {
      console.log("📅 Parsed meeting:", meetingData);

      // 3️⃣ Try sending event to background for calendar creation
      chrome.runtime.sendMessage(
        {
          action: "createCalendarEvent",
          eventData: {
            provider: "outlook",
            ...meetingData,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("⚠️ chrome.runtime.lastError:", chrome.runtime.lastError);
            showSuccessNotification("Meeting parsed, but background not reachable.");
          } else if (response?.success) {
            console.log("✅ Calendar event created:", response);
            showSuccessNotification("Event added to Outlook Calendar! 🎉");
          } else {
            console.error("❌ Calendar creation failed:", response);
            showSuccessNotification("Meeting parsed — check console for calendar error.");
          }
        }
      );
    } else {
      console.log("ℹ️ No meeting detected.");
      showSuccessNotification("Draft generated but no meeting detected.");
    }
  } catch (err) {
    console.error("💥 Error:", err);
    alert("Error: " + err.message);
  } finally {
    btn.textContent = old;
    btn.disabled = false;
  }
});


  editor.parentNode.insertBefore(btn, editor);
  console.log("✨ Button injected!");
}

// -------------------------------------------------
// 8️⃣ Initialization
// -------------------------------------------------
function initializeEmailAssistant() {
  const env = getEnvironment();
  console.log(`📬 Initializing for ${env}`);
  const check = () => {
    const editors = getEmailDraftEditors();
    if (editors.length) {
      editors.forEach((e) => {
        if (!e.hasAttribute("data-ai-observed")) {
          e.setAttribute("data-ai-observed", "1");
          addGenerateButton(e);
        }
      });
    }
  };
  setTimeout(check, env === "outlook" ? 2000 : 800);
  setInterval(check, 3000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeEmailAssistant);
} else {
  initializeEmailAssistant();
}
