// background.js
console.log("Background service worker loaded.");

// Listen for messages from the content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "createCalendarEvent") {
    console.log("Received event creation request:", message.eventData);

    (async () => {
      try {
        // Get OAuth token for Google Calendar access
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError || !token) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(token);
            }
          });
        });

        // Create event payload
        const event = {
          summary: message.eventData.summary || "New Event",
          description: message.eventData.description || "",
          start: {
            dateTime: message.eventData.start, // ISO string
            timeZone: "America/Chicago"
          },
          end: {
            dateTime: message.eventData.end, // ISO string
            timeZone: "America/Chicago"
          }
        };

        // Send request to Google Calendar API
        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(event)
          }
        );

        const data = await response.json();
        console.log("Calendar API response:", data);

        if (response.ok) {
          sendResponse({ success: true, eventId: data.id });
        } else {
          sendResponse({ success: false, error: data });
        }
      } catch (err) {
        console.error("Error creating calendar event:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    // ✅ Important: return true to keep message channel open for async
    return true;
  }
});
