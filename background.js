// -------------------------------------------------
// 🟢 Email Assistant Background Service Worker
// -------------------------------------------------

console.log("📅 Background service worker loaded and ready.");
console.log(`⏱️ Service worker started at ${new Date().toISOString()}`);

// -------------------------------------------------
// 🔧 Email Validator
// -------------------------------------------------
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// -------------------------------------------------
// 💾 Outlook Token Management
// -------------------------------------------------
async function getStoredOutlookToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["outlook_access_token", "outlook_token_expiry"], (result) => {
      const token = result.outlook_access_token;
      const expiry = result.outlook_token_expiry;

      if (token && expiry && Date.now() < expiry) {
        console.log("🔑 Valid Outlook token found");
        resolve(token);
      } else {
        if (token) {
          console.log("🗑️ Clearing expired Outlook token");
          chrome.storage.local.remove(["outlook_access_token", "outlook_token_expiry"]);
        }
        resolve(null);
      }
    });
  });
}

async function saveOutlookToken(token, expiresIn = 3600) {
  const expiryTime = Date.now() + expiresIn * 1000;
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        outlook_access_token: token,
        outlook_token_expiry: expiryTime,
      },
      () => {
        console.log("💾 Outlook token stored securely with expiry.");
        resolve();
      }
    );
  });
}

async function clearOutlookToken() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(["outlook_access_token", "outlook_token_expiry"], () => {
      console.log("🗑️ Outlook tokens cleared.");
      resolve();
    });
  });
}

// -------------------------------------------------
// 🔔 Notifications
// -------------------------------------------------
function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
    title,
    message,
    priority: 2,
  });
}

// -------------------------------------------------
// 🟦 Google Calendar Integration
// -------------------------------------------------
async function createGoogleEvent(eventData, sendResponse) {
  try {
    console.log("🟦 Starting Google Calendar event creation...", eventData);

    if (!eventData.start_time || !eventData.end_time) {
      throw new Error("Missing start or end time for event");
    }

    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!token) reject(new Error("No authentication token"));
        else resolve(token);
      });
    });

    const validAttendees = (eventData.attendees || []).filter(isValidEmail).map((email) => ({ email }));

    const event = {
      summary: eventData.summary || "Meeting from Email Assistant",
      description: eventData.description || "Created automatically by Email Assistant",
      start: { dateTime: eventData.start_time, timeZone: eventData.timeZone || "America/Chicago" },
      end: { dateTime: eventData.end_time, timeZone: eventData.timeZone || "America/Chicago" },
      attendees: validAttendees,
      reminders: { useDefault: true },
    };

    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `Google API error ${response.status}`);
    }

    const data = await response.json();
    console.log("✅ Google event created:", data.htmlLink);
    showNotification("Google Event Created! 🎉", `${event.summary} added to your calendar.`);

    sendResponse?.({ success: true, provider: "google", link: data.htmlLink, eventId: data.id });
  } catch (err) {
    console.error("💥 Google Calendar event creation error:", err);
    sendResponse?.({ success: false, provider: "google", error: err.message });
  }
}

// -------------------------------------------------
// 🟩 Outlook Calendar Integration (PKCE Flow)
// -------------------------------------------------
async function openOutlookAuthPKCE(pendingEventId, eventData, sendResponse) {
  const CLIENT_ID = "c12019d0-653a-4ba8-b179-507b9314c95d";
  const REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient";
  const SCOPES = "https://graph.microsoft.com/Calendars.ReadWrite offline_access";

  // Create PKCE verifier/challenge
  const verifier = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const challengeBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  await new Promise((r) =>
    chrome.storage.local.set({ pkce_verifier: verifier, [pendingEventId]: eventData }, r)
  );

  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256` +
    `&prompt=select_account`;

  console.log("🔐 Opening Outlook PKCE auth window...");
  chrome.tabs.create({ url: authUrl, active: true });

  sendResponse?.({
    success: false,
    requiresAuth: true,
    message: "Outlook authentication window opened. Please sign in, then retry.",
    pendingEventId,
  });
}

async function createOutlookEvent(eventData, sendResponse) {
  const CLIENT_ID = "c12019d0-653a-4ba8-b179-507b9314c95d";
  try {
    console.log("🟩 Starting Outlook event creation...", eventData);

    if (!eventData.start_time || !eventData.end_time) {
      throw new Error("Missing start or end time for event");
    }

    let token = await getStoredOutlookToken();
    console.log("🔑 Outlook token available:", !!token);

    if (!token) {
      const pendingEventId = "pending_event_" + Date.now();
      await openOutlookAuthPKCE(pendingEventId, eventData, sendResponse);
      return;
    }

    const outlookEvent = {
      summary: eventData.summary || "Meeting from Email Assistant",
      description: eventData.description || "Created automatically by Email Assistant",
      start_time: eventData.start_time,
      end_time: eventData.end_time,
      attendees: eventData.attendees || [],
      timeZone: eventData.timeZone || "America/Chicago",
    };

    console.log("📤 Sending Outlook event to Flask backend...", outlookEvent);
    const response = await fetch("http://127.0.0.1:5000/create-outlook-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token, event_data: outlookEvent }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      if (response.status === 401) {
        await clearOutlookToken();
        sendResponse?.({
          success: false,
          requiresAuth: true,
          error: "Outlook session expired, please reauthenticate.",
        });
        return;
      }
      throw new Error(errorData.error || `Backend error: ${response.status}`);
    }

    const data = await response.json();
    console.log("✅ Outlook event created via Flask:", data);
    showNotification("Outlook Event Created! 🎉", `${outlookEvent.summary} added to your calendar.`);
    sendResponse?.({
      success: true,
      provider: "outlook",
      link: data.webLink || data.link || "(No link returned)",
      eventId: data.id,
    });
  } catch (err) {
    console.error("💥 Outlook event creation failed:", err);
    sendResponse?.({ success: false, provider: "outlook", error: err.message });
  }
}

// -------------------------------------------------
// 📨 Message Relay (content.js → background)
// -------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  console.log("📩 Received message:", message.action);
  const eventData = message.eventData || {};
  const provider = (eventData.provider || "outlook").toLowerCase();

  if (message.action === "createCalendarEvent" || message.action === "relayCalendarEvent") {
    console.log(`📅 Relay: Creating ${provider} event...`);
    if (provider === "google") createGoogleEvent(eventData, sendResponse);
    else createOutlookEvent(eventData, sendResponse);
    return true; // keep port open
  }
});

// -------------------------------------------------
// 🔄 OAuth Redirect Capture (Outlook PKCE redirect)
// -------------------------------------------------
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const url = changeInfo.url;

  if (url.includes("https://login.microsoftonline.com/common/oauth2/nativeclient") && url.includes("?code=")) {
    console.log("🔄 Detected Outlook PKCE redirect...");
    const params = new URLSearchParams(new URL(url).search);
    const authCode = params.get("code");
    if (!authCode) return console.error("❌ No auth code found in redirect URL");

    const { pkce_verifier } = await new Promise((r) => chrome.storage.local.get(["pkce_verifier"], r));
    if (!pkce_verifier) return console.error("❌ Missing PKCE verifier");

    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "c12019d0-653a-4ba8-b179-507b9314c95d",
        scope: "https://graph.microsoft.com/Calendars.ReadWrite offline_access",
        redirect_uri: "https://login.microsoftonline.com/common/oauth2/nativeclient",
        grant_type: "authorization_code",
        code: authCode,
        code_verifier: pkce_verifier,
      }),
    });

    const data = await tokenResponse.json();
    console.log("🔑 Token exchange response:", data);

    if (data.access_token) {
      await saveOutlookToken(data.access_token, parseInt(data.expires_in) || 3600);
      chrome.tabs.remove(tabId);
      showNotification("Outlook Connected! ✅", "Authentication complete. You can now create calendar events.");
      await processPendingEvents();
    } else {
      console.error("💥 Token exchange failed:", data);
      showNotification("Outlook Auth Failed", JSON.stringify(data));
    }
  }
});

// -------------------------------------------------
// 🕓 Pending Event Processor
// -------------------------------------------------
// -------------------------------------------------
// 🕓 Pending Event Processor (fixed to prevent loops)
// -------------------------------------------------
async function processPendingEvents() {
  const storage = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
  const pendingKeys = Object.keys(storage).filter((k) => k.startsWith("pending_event_"));
  if (!pendingKeys.length) {
    console.log("✅ No pending events to process");
    return;
  }

  console.log(`🔄 Found ${pendingKeys.length} pending events to process...`);
  let processed = 0;

  // Process sequentially to avoid overlapping writes
  for (const key of pendingKeys) {
    const eventData = storage[key];
    if (!eventData) continue;

    console.log("📆 Processing pending event:", key, eventData);

    try {
      await new Promise((resolve) =>
        createOutlookEvent(eventData, (response) => {
          console.log("✅ Pending event result:", response);
          resolve(response);
        })
      );
    } catch (err) {
      console.error("💥 Error processing pending event:", key, err);
    }

    // Explicitly delete each after processing
    await new Promise((r) => chrome.storage.local.remove(key, r));
    processed++;
  }

  console.log(`✅ Finished processing ${processed} pending events`);
}

