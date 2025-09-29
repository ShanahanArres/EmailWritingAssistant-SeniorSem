console.log("Email Assistant content script loaded.");

// Find Gmail draft editors
function getEmailDraftEditors() {
    return Array.from(document.querySelectorAll("div[role='textbox'][aria-label='Message Body']"));
}

// Debounce helper (waits 2 seconds after typing stops)
function debounce(func, wait = 2000) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
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
async function sendDraftToBackend(editor) {
    const draft = editor.innerText;
    if (!draft) return;

    try {
        const response = await fetch("http://127.0.0.1:5000/generate-suggestion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft })
        });

        const data = await response.json();

        if (data.suggestion) {
            updateEditor(editor, data.suggestion);
            console.log("Draft refined automatically.");
        }
    } catch (err) {
        console.error("Error fetching suggestion:", err);
    }
}

// Observe Gmail compose windows
const observer = new MutationObserver(() => {
    const editors = getEmailDraftEditors();

    editors.forEach(editor => {
        if (!editor.hasAttribute("data-ai-observed")) {
            editor.setAttribute("data-ai-observed", "true");

            // Debounced call: refine once after typing stops
            const debouncedSend = debounce(() => sendDraftToBackend(editor), 2000);
            editor.addEventListener("input", debouncedSend);
        }
    });
});

// Start observing Gmail body
observer.observe(document.body, { childList: true, subtree: true });
