document.getElementById("suggestBtn").addEventListener("click", () => {
    // Get the active tab (where Gmail is open)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
                // This code runs in the context of the Gmail page
                const editor = document.querySelector("div[aria-label='Message Body']");
                const draft = editor ? editor.innerText : "";

                if (!draft) return;

                fetch("http://127.0.0.1:5000/generate-suggestion", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ draft: draft })
                })
                .then(response => response.json())
                .then(data => {
                    if (!data) return console.error("No data from suggestion endpoint");
                    if (data.suggestion && editor) {
                        editor.innerText = data.suggestion;
                    } else if (data.error) {
                        console.error("Suggestion endpoint error:", data.error, data);
                    } else {
                        console.error("Suggestion response missing suggestion field", data);
                    }
                })
                .catch(err => console.error("Error fetching suggestion:", err));
            }
        });
    });
});
