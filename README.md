# Jira Capture Tool

Jira Capture Tool is a Chrome (or Chromium) extension that fetches Jira issue details, formats and sanitizes them as clean text, and sends them to the OpenAI API for AI-assisted prompts.

## Features
- Fetch Jira issue data (fields, rendered content, comments)
- Convert rich text (HTML) to plain text
- Redact sensitive information (UUIDs, passwords, links)
- Send formatted content to OpenAI models via configurable prompts
- Save and copy AI responses
- Copy raw Jira JSON payload
- Manage custom prompts (add, edit, delete)
- Import/export prompts as CSV

## Installation
1. Clone this repository locally.
2. Open Google Chrome (or Chromium) and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the extension directory.
5. The **Jira Capture Tool** icon will appear in the toolbar.

## Usage
1. Navigate to any Jira issue page (URL containing `/browse/ISSUE-KEY`).
2. Click the **Jira Capture Tool** extension icon.
3. In the popup:
   - Select a prompt from the dropdown.
   - Click **Send to AI Playground** to fetch and send the formatted issue data.
4. View the AI response in the textarea.
   - **Copy Response** to copy the result.
   - **Copy Jira Ticket** to copy the raw JSON payload.
   - **Clear** to reset the response for the current issue.
   - **⚙️ Settings** to open the configuration page.

## Configuration
Open **Settings** from the popup to:
- Set your **OpenAI API Key** and **model** (e.g., `gpt-4`, `gpt-3.5-turbo`).
- Add, edit, or delete custom prompts.
- Export prompts to a `.csv` file (columns: `Title,Prompt`).
- Import prompts from a `.csv` file (with header row), merging or replacing duplicates.

## File Structure
```
.
├── manifest.json       # Extension manifest (Manifest V3)
├── popup.html          # Popup UI markup
├── popup.js            # Popup logic and API interactions
├── options.html        # Settings UI markup
├── options.js          # Settings logic (prompts management)
└── icons/              # Extension icons (16×16, 32×32, 48×48, 128×128)
```

## Development
This is a static extension—no build tools are required.
Edit source files directly and reload the extension in Chrome.
Ensure you have a valid OpenAI API Key before sending requests.

## Browser Compatibility
- Google Chrome or Chromium (Manifest V3 support required).

## License
Add a license as needed for your project.
