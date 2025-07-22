// Popup script: load prompts and API key, fetch cleaned Jira content, send to OpenAI

// Helper to parse Jira issue URL and extract domain and issue key
function parseJiraUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    // Expect path like /browse/PROJECT-123
    if (parts.length > 2 && parts[1].toLowerCase() === 'browse') {
      const key = parts[2];
      if (/^[A-Z][A-Z0-9_]+-\d+$/i.test(key)) {
        return { domain: u.host, issueKey: key.toUpperCase() };
      }
    }
  } catch (e) {}
  return null;
}

async function fetchJiraContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab.url;
  const parsed = parseJiraUrl(url);
  let outText;
  if (parsed) {
    const { domain, issueKey } = parsed;
    const apiUrl = `https://${domain}/rest/api/2/issue/${issueKey}?fields=*all&expand=renderedFields,names`;
    const jiraResp = await fetch(apiUrl, { credentials: 'include' });
    if (!jiraResp.ok) throw new Error('Jira API HTTP ' + jiraResp.status);
    const data = await jiraResp.json();
    const names = data.names || {};
    const fields = data.fields || {};
    const rendered = data.renderedFields || {};
    const outLines = [];
    outLines.push(`Issue Key: ${data.key}`);
    if (fields.summary) outLines.push(`Summary: ${fields.summary}`);
    outLines.push(`URL: ${url}`);
    outLines.push('');
    for (const [fieldKey, displayName] of Object.entries(names)) {
      if (fieldKey === 'comment' || fieldKey === 'attachment') continue;
      const value = fields[fieldKey];
      if (value == null || (Array.isArray(value) && value.length === 0)) continue;
      let textValue = '';
      if (rendered[fieldKey]) {
        const tmp = new DOMParser().parseFromString(rendered[fieldKey], 'text/html');
        textValue = tmp.body.textContent || '';
      } else if (typeof value === 'string' || typeof value === 'number') {
        textValue = value.toString();
      } else if (Array.isArray(value)) {
        if (typeof value[0] === 'string' || typeof value[0] === 'number') {
          textValue = value.join(', ');
        } else {
          textValue = value.map(item => item.name || item.value || '').filter(Boolean).join(', ');
        }
      } else if (typeof value === 'object') {
        textValue = value.name || value.displayName || value.value || JSON.stringify(value);
      } else {
        textValue = String(value);
      }
      outLines.push(`${displayName}: ${textValue}`);
    }
    if (rendered.comment && rendered.comment.comments && rendered.comment.comments.length) {
      outLines.push('');
      outLines.push('Comments:');
      rendered.comment.comments.forEach(c => {
        const author = (c.author && (c.author.displayName || c.author.name)) || 'Unknown';
        const created = c.created || '';
        outLines.push(`${author}${created ? ' (' + created + ')' : ''}:`);
        const tmpC = new DOMParser().parseFromString(c.body || '', 'text/html');
        outLines.push(tmpC.body.textContent || '');
        outLines.push('');
      });
    }
    outText = outLines.join('\n');
  } else {
    const resp = await fetch(url, { cache: 'reload' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) console.warn('XML parse errors');
    let outLines = [];
    const cfEls = doc.querySelectorAll('customfield');
    if (cfEls.length) {
      const itemTitleEl = doc.querySelector('item > title');
      if (itemTitleEl) outLines.push(itemTitleEl.textContent.trim());
      const summaryEl = doc.querySelector('item > summary');
      if (summaryEl) outLines.push(summaryEl.textContent.trim());
      const itemLinkEl = doc.querySelector('item > link');
      if (itemLinkEl) outLines.push(itemLinkEl.textContent.trim());
      const descEl = doc.querySelector('item > description');
      if (descEl) {
        const ps = descEl.querySelectorAll('p');
        if (ps.length) {
          ps.forEach(p => { const t = p.textContent.trim(); if (t) outLines.push(t); });
        } else if (descEl.textContent.trim()) {
          outLines.push(descEl.textContent.trim());
        }
      }
      if (outLines.length) outLines.push('');
      cfEls.forEach(cf => {
        const nameEl = cf.querySelector('customfieldname');
        const name = nameEl ? nameEl.textContent.trim() : '';
        cf.querySelectorAll('customfieldvalue').forEach(valEl => {
          let v = valEl.textContent || '';
          v = v.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
          if (name || v) outLines.push((name ? name + ': ' : '') + v);
        });
      });
    } else {
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.nodeValue.trim();
        if (t) outLines.push(t);
      }
    }
    outText = outLines.join('\n');
  }
  // Normalize and redact
  let out = outText;
  out = out.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).join('\n');
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[REDACTED-UUID]');
  out = out.replace(/(password\s*[:=]\s*)([^\n]+)/gi, '$1[REDACTED]');
  out = out.replace(/(passcode\s*[:=]\s*)([^\n]+)/gi, '$1[REDACTED]');
  out = out.replace(/(<password>)([\s\S]*?)(<\/password>)/gi, '$1[REDACTED]$3');
  out = out.replace(/(<passcode\b[^>]*>)([\s\S]*?)(<\/passcode>)/gi, '$1[REDACTED]$3');
  out = out.replace(/https?:\/\/([^\/\s]+)[^\s]*/gi, '[$1 REDACTED LINK]');
  out = out.replace(/<br\s*\/?>/gi, '');
  out = out.replace(/<\/?p\b[^>]*>/gi, '');
  return out;
}

document.addEventListener('DOMContentLoaded', () => {
  const openOptionsButton = document.getElementById('openOptions');
  const promptSelect = document.getElementById('promptSelect');
  const sendButton = document.getElementById('sendButton');
  const responseTextarea = document.getElementById('response');
  const copyResponseButton = document.getElementById('copyResponse');
  const clearResponseButton = document.getElementById('clearResponse');

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  clearResponseButton.addEventListener('click', () => {
    // Reset the response textarea to initial state
    responseTextarea.value = 'Ready!';
    // Also clear stored last response for this issue
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const url = tabs[0].url || '';
          const parsed = parseJiraUrl(url);
          const issueKey = parsed ? parsed.issueKey : null;
      if (issueKey) {
        chrome.storage.local.get({ lastResponses: {} }, ({ lastResponses }) => {
          delete lastResponses[issueKey];
          chrome.storage.local.set({ lastResponses });
        });
      }
    });
  });

  // Wrap chrome.storage.sync.get in a Promise
  function getStorage(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  (async () => {
    // Identify current Jira issue key
    const [tab] = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    const url = tab.url;
    const parsedGlobal = parseJiraUrl(url);
    const issueKey = parsedGlobal ? parsedGlobal.issueKey : null;

    const { apiKey, prompts, lastResponses, model } = await getStorage({ apiKey: '', prompts: [], lastResponses: {}, model: '' });
    // Sort prompts alphabetically by title
    if (Array.isArray(prompts)) {
      prompts.sort((a, b) => a.title.localeCompare(b.title));
    }

    // Show last response or ready state
    if (issueKey && lastResponses[issueKey]) {
      responseTextarea.value = lastResponses[issueKey];
    } else {
      responseTextarea.value = 'Ready!';
    }

    let valid = true;
    // Ensure API key is set
    if (!apiKey) {
      responseTextarea.value = 'No API key set. Please configure in Settings.';
      sendButton.disabled = true;
      valid = false;
    }
    // Ensure model is set
    if (!model) {
      responseTextarea.value = 'No model set. Please configure in Settings.';
      sendButton.disabled = true;
      valid = false;
    }
    // Ensure prompts are defined
    if (!prompts || prompts.length === 0) {
      responseTextarea.value = 'No prompts defined. Please add prompts in Settings.';
      sendButton.disabled = true;
      valid = false;
    }

    promptSelect.innerHTML = '';
    if (prompts && prompts.length > 0) {
      const placeholder = document.createElement('option');
      placeholder.textContent = 'Select a prompt';
      placeholder.disabled = true;
      placeholder.selected = true;
      promptSelect.appendChild(placeholder);
      prompts.forEach((p, idx) => {
        const option = document.createElement('option');
        option.value = idx;
        option.textContent = p.title;
        promptSelect.appendChild(option);
      });
    }

    if (!valid) {
      return;
    }

    // Only proceed on a Jira issue page
    if (!issueKey) {
      responseTextarea.value = 'Please open this on a Jira issue page.';
      sendButton.disabled = true;
      return;
    }

    let jiraContent;
    try {
      jiraContent = await fetchJiraContent();
    } catch (err) {
      responseTextarea.value = 'Error fetching Jira content: ' + err.message;
      sendButton.disabled = true;
      return;
    }

    sendButton.addEventListener('click', async () => {
      const selectedIndex = promptSelect.value;
      const systemPrompt = prompts[selectedIndex].prompt;
      responseTextarea.value = 'Sending to OpenAI...';
      sendButton.disabled = true;
      try {
        // const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        const resp = await fetch('https://gateway-internal.ai.acquia.io/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: jiraContent }
            ]
          })
        });
        if (!resp.ok) throw new Error('OpenAI API HTTP ' + resp.status);
        const data = await resp.json();
        const aiText = data.choices?.[0]?.message?.content || 'No response';
        responseTextarea.value = aiText;
        // Persist response for this issue
        if (issueKey) {
          lastResponses[issueKey] = aiText;
          chrome.storage.local.set({ lastResponses });
        }
      } catch (err) {
        responseTextarea.value = 'Error: ' + err.message;
      } finally {
        sendButton.disabled = false;
      }
    });

    copyResponseButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(responseTextarea.value);
        alert('Response copied to clipboard!');
      } catch {
        alert('Copy failed');
      }
    });
    // Copy processed Jira content (flattened)
    const copyJiraTicketButton = document.getElementById('copyJiraTicket');
    copyJiraTicketButton.addEventListener('click', async () => {
      try {
        const jiraText = await fetchJiraContent();
        await navigator.clipboard.writeText(jiraText);
        alert('Jira content copied to clipboard!');
      } catch (err) {
        alert('Copy Jira content failed: ' + (err.message || err));
      }
    });
  })();
});
