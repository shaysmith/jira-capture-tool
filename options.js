document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveApiKeyBtn = document.getElementById('saveApiKey');
  const modelInput = document.getElementById('model');
  const promptsListEl = document.getElementById('promptsList');
  const promptTitleInput = document.getElementById('promptTitle');
  const promptContentInput = document.getElementById('promptContent');
  const savePromptBtn = document.getElementById('savePrompt');
  const cancelEditBtn = document.getElementById('cancelEdit');
  const exportPromptsBtn = document.getElementById('exportPrompts');
  const importPromptsBtn = document.getElementById('importPrompts');
  const importFileInput = document.getElementById('importFileInput');
  let prompts = [];
  let editingIndex = null;
  chrome.storage.local.get({ apiKey: '', prompts: [], model: '' }, (data) => {
    apiKeyInput.value = data.apiKey || '';
    modelInput.value = data.model || '';
    prompts = data.prompts || [];
    renderPromptsList();
  });
  saveApiKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const model = modelInput.value.trim();
    chrome.storage.local.set({ apiKey: key, model: model }, () => { alert('API Key and model saved'); });
  });
  function renderPromptsList() {
    // Sort prompts alphabetically by title
    if (Array.isArray(prompts)) {
      prompts.sort((a, b) => a.title.localeCompare(b.title));
    }
    promptsListEl.innerHTML = '';
    if (prompts.length === 0) {
      promptsListEl.textContent = 'No prompts defined yet.';
      return;
    }
    const ul = document.createElement('ul');
    prompts.forEach((p, index) => {
      const li = document.createElement('li');
      li.textContent = p.title + ' ';
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => startEditPrompt(index));
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deletePrompt(index));
      li.appendChild(editBtn);
      li.appendChild(delBtn);
      ul.appendChild(li);
    });
    promptsListEl.appendChild(ul);
  }
  function startEditPrompt(index) {
    editingIndex = index;
    promptTitleInput.value = prompts[index].title;
    promptContentInput.value = prompts[index].prompt;
    savePromptBtn.textContent = 'Update Prompt';
  }
  function deletePrompt(index) {
    if (!confirm(`Delete prompt "${prompts[index].title}"?`)) return;
    prompts.splice(index, 1);
      chrome.storage.local.set({ prompts }, renderPromptsList);
  }
  cancelEditBtn.addEventListener('click', () => {
    editingIndex = null;
    promptTitleInput.value = '';
    promptContentInput.value = '';
    savePromptBtn.textContent = 'Save Prompt';
  });
  savePromptBtn.addEventListener('click', () => {
    const title = promptTitleInput.value.trim();
    const promptContent = promptContentInput.value.trim();
    if (!title || !promptContent) { alert('Both title and prompt are required'); return; }
    if (editingIndex !== null) {
      prompts[editingIndex] = { title, prompt: promptContent };
    } else {
      prompts.push({ title, prompt: promptContent });
    }
    chrome.storage.local.set({ prompts }, () => {
      renderPromptsList();
      editingIndex = null;
      promptTitleInput.value = '';
      promptContentInput.value = '';
      savePromptBtn.textContent = 'Save Prompt';
    });
  });
  // Export prompts as CSV file
  exportPromptsBtn.addEventListener('click', () => {
    if (!Array.isArray(prompts) || prompts.length === 0) {
      alert('No prompts to export.');
      return;
    }
    const header = ['Title', 'Prompt'];
    const csvLines = [];
    // Header row
    csvLines.push(header.join(','));
    // Data rows with CSV escaping
    prompts.forEach(p => {
      const titleEsc = p.title.replace(/"/g, '""');
      const promptEsc = p.prompt.replace(/"/g, '""');
      csvLines.push('"' + titleEsc + '","' + promptEsc + '"');
    });
    const csvContent = csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'prompts.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
  // Import prompts from CSV file
  importPromptsBtn.addEventListener('click', () => {
    importFileInput.click();
  });
  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result || '';
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) { alert('CSV file contains no prompt entries.'); return; }
      const imported = [];
      // Parse CSV rows, skipping header
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        let vals = [];
        let cur = '';
        let inQ = false;
        for (let chIdx = 0; chIdx < line.length; chIdx++) {
          const ch = line[chIdx];
          if (ch === '"') {
            if (inQ && line[chIdx+1] === '"') { cur += '"'; chIdx++; }
            else { inQ = !inQ; }
          } else if (ch === ',' && !inQ) {
            vals.push(cur); cur = '';
          } else { cur += ch; }
        }
        vals.push(cur);
        if (vals.length >= 2) {
          imported.push({ title: vals[0], prompt: vals[1] });
        }
      }
      if (imported.length === 0) {
        alert('No valid prompts parsed from CSV.');
        return;
      }
      // Identify duplicates (existing titles) and new prompts
      const existingTitles = prompts.map(p => p.title);
      const duplicates = imported.filter(p => existingTitles.includes(p.title));
      // Ask before replacing duplicates
      let proceedReplace = true;
      if (duplicates.length > 0) {
        const dupNames = duplicates.map(p => p.title).join(', ');
        proceedReplace = confirm(
          `The following prompts already exist and will be replaced:\n${dupNames}\n` +
          `OK to replace, Cancel to keep existing ones.`
        );
      }
      // Merge prompts: replace duplicates if confirmed, add new prompts
      const merged = [...prompts];
      imported.forEach(p => {
        const idx = merged.findIndex(x => x.title === p.title);
        if (idx >= 0) {
          if (proceedReplace) merged[idx] = p;
        } else {
          merged.push(p);
        }
      });
      prompts = merged;
      chrome.storage.local.set({ prompts }, () => {
        renderPromptsList();
        alert('Prompts imported successfully.');
      });
    };
    reader.onerror = () => { alert('Error reading file'); };
    reader.readAsText(file);
    importFileInput.value = '';
  });
});
