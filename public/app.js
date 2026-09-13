const form = document.getElementById('screening-form');
const loader = document.getElementById('loader');
const resultsBox = document.getElementById('results');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const authStatus = document.getElementById('auth-status');
const registerBtn = document.getElementById('register-btn');
const loginBtn = document.getElementById('login-btn');
const saveAssessmentBtn = document.getElementById('save-assessment-btn');
const historyList = document.getElementById('history-list');
const sessionLabel = document.getElementById('session-label');
const reviewSummary = document.getElementById('review-summary');
const saveStatus = document.getElementById('save-status');
const wizardSteps = [...document.querySelectorAll('[data-step]')];
const stepIndicators = [...document.querySelectorAll('[data-step-indicator]')];
const backToAccountBtn = document.getElementById('back-to-account');
const newAssessmentBtn = document.getElementById('new-assessment-btn');
const continueReviewBtn = document.getElementById('continue-review-btn');
const backToResultsBtn = document.getElementById('back-to-results');
const accountBtn = document.getElementById('account-btn');
const installBtn = document.getElementById('install-btn');
const feedbackBtn = document.getElementById('feedback-btn');
const feedbackDialog = document.getElementById('feedback-dialog');
const feedbackForm = document.getElementById('feedback-form');
const feedbackStatus = document.getElementById('feedback-status');
const batchFile = document.getElementById('batch-file');
const batchStartBtn = document.getElementById('batch-start-btn');
const batchDownloadBtn = document.getElementById('batch-download-btn');
const batchStatus = document.getElementById('batch-status');
const batchPauseBtn = document.getElementById('batch-pause-btn');
const batchCancelBtn = document.getElementById('batch-cancel-btn');
const batchSpeed = document.getElementById('batch-speed');
const batchText = document.getElementById('batch-text');
const batchUseTextBtn = document.getElementById('batch-use-text-btn');

let currentToken = localStorage.getItem('toxicity_token') || '';
let latestResult = null;
let installPrompt = null;
let currentUserRole = 'user';
let batchEntries = [];
let batchResults = [];
let batchPaused = false;
let batchCancelled = false;

function parseBatchEntries(text) {
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(smiles|canonical_smiles|structure)$/i.test(trimmed)) continue;
    const firstColumn = trimmed.split(',')[0].trim().replace(/^"|"$/g, '');
    if (firstColumn && !/^(smiles|canonical_smiles|structure)$/i.test(firstColumn)) values.push(firstColumn);
  }
  return [...new Set(values)].slice(0, 100000);
}

function prepareBatch(text) {
  const entries = parseBatchEntries(text);
  batchEntries = entries;
  batchStartBtn.disabled = !batchEntries.length;
  batchStatus.textContent = `${batchEntries.length.toLocaleString()} unique entries ready.`;
  batchStatus.classList.remove('hidden');
  if (entries.length >= 100000) batchStatus.textContent += ' The 100,000-entry safety limit was applied.';
}

function updateBatchControls(running) {
  batchStartBtn.classList.toggle('hidden', running);
  batchPauseBtn.classList.toggle('hidden', !running);
  batchCancelBtn.classList.toggle('hidden', !running);
  batchDownloadBtn.classList.toggle('hidden', !batchResults.length || running);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installBtn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installBtn.classList.add('hidden');
});

function resetSession() {
  currentToken = '';
  latestResult = null;
  currentUserRole = 'user';
  localStorage.removeItem('toxicity_token');
  sessionLabel.textContent = 'Guest session';
  authStatus.textContent = '';
  authStatus.classList.add('hidden');
  showStep(1);
}

function showStep(stepNumber) {
  wizardSteps.forEach((step) => step.classList.toggle('active', step.dataset.step === String(stepNumber)));
  stepIndicators.forEach((indicator) => {
    const indicatorStep = Number(indicator.dataset.stepIndicator);
    indicator.classList.toggle('active', indicatorStep === stepNumber);
    indicator.classList.toggle('complete', indicatorStep < stepNumber);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function setAuthMessage(message, isError = false) {
  authStatus.textContent = message;
  authStatus.classList.remove('hidden');
  authStatus.style.borderColor = isError ? 'rgba(255, 107, 107, 0.5)' : 'rgba(79, 195, 247, 0.5)';
}

function renderBadge(score) {
  if (score >= 75) {
    return { label: 'High', className: 'score-high' };
  }
  if (score >= 55) {
    return { label: 'Moderate', className: 'score-medium' };
  }
  return { label: 'Low', className: 'score-low' };
}

function renderCards(scores) {
  const entries = [
    ['ToxiScreen hazard triage', scores.hazardTriage, 'Structural-alert triage'],
    ['Activity signal', scores.passPost, 'Public activity prioritization'],
    ['Toxicity signal', scores.toxicity, 'Public hazard context'],
    ['Mutagenicity signal', scores.mutagenicity, 'Alert-based signal'],
    ['ADME signal', scores.adme, 'Descriptor triage'],
  ];

  return entries
    .map(([label, score, description]) => {
      const badge = renderBadge(score);
      return `
        <article class="score-card">
          <h4>${label}</h4>
          <p class="score-description">${description}</p>
          <div class="score-value">${score}</div>
          <span class="score-tag ${badge.className}">${badge.label}</span>
        </article>
      `;
    })
    .join('');
}

function renderSources(sources) {
  if (!sources || !sources.length) {
    return '<p>No online database hits returned.</p>';
  }

  const html = sources
    .map((entry) => {
      const hits = (entry.hits || [])
        .slice(0, 3)
        .map((hit) => `<li><strong>${escapeHtml(hit.name || hit.chemblId || hit.dtxsid || 'Record')}</strong>${hit.smiles ? `<div class="hit-smiles">${escapeHtml(hit.smiles)}</div>` : ''}</li>`)
        .join('');

      const additional = entry.formula || entry.molecularWeight || entry.smiles
        ? `<li>Formula: ${escapeHtml(entry.formula || 'N/A')}</li><li>MW: ${escapeHtml(entry.molecularWeight || 'N/A')}</li>${entry.smiles ? `<li class="smiles-line"><span>SMILES:</span> ${escapeHtml(entry.smiles)}</li>` : ''}`
        : '';
      const image = entry.structureImage
        ? `<img class="structure-image" src="${escapeHtml(entry.structureImage)}" alt="2D structure for ${escapeHtml(entry.source)}" loading="lazy" />`
        : '';

      return `
        <li class="source-item">
          <strong>${escapeHtml(entry.source)}</strong>
          <div class="source-meta">${escapeHtml(entry.evidence || 'Public metadata available.')}</div>
          ${image}
          <ul>${additional}${hits || '<li>No additional metadata available.</li>'}</ul>
        </li>
      `;
    })
    .join('');

  return `
    <details class="sources-list">
      <summary>Public database evidence <span>${sources.length} sources</span></summary>
      <ul>${html}</ul>
    </details>
  `;
}

function renderProfileDetails(sources, scores) {
  const pubChem = sources.find((source) => source.source === 'PubChem') || {};
  const descriptor = (label, value) => `<div class="descriptor"><span>${label}</span><strong>${escapeHtml(value ?? 'N/A')}</strong></div>`;

  return `
    <div class="profile-details">
      <div class="profile-block">
        <p class="section-kicker">Compound properties</p>
        <div class="descriptor-grid">
          ${descriptor('Molecular weight', pubChem.molecularWeight ? `${pubChem.molecularWeight} g/mol` : null)}
          ${descriptor('XlogP', pubChem.xlogp)}
          ${descriptor('TPSA', pubChem.tpsa ? `${pubChem.tpsa} A²` : null)}
          ${descriptor('H-bond donors', pubChem.hBondDonors)}
          ${descriptor('H-bond acceptors', pubChem.hBondAcceptors)}
          ${descriptor('Rotatable bonds', pubChem.rotatableBonds)}
        </div>
      </div>
      <div class="profile-block">
        <p class="section-kicker">Safety alerts</p>
        <p class="profile-copy">${scores.alerts?.length ? `Structural/name alert terms detected: ${escapeHtml(scores.alerts.join(', '))}.` : 'No configured structural alert terms detected in the submitted query.'}</p>
      </div>
      <div class="profile-block">
        <p class="section-kicker">Activity context</p>
        <p class="profile-copy">Public ChEMBL matches are shown as activity context. This is a ToxiScreen view inspired by public activity screening tools.</p>
      </div>
    </div>
  `;
}

function renderToolReports(sources, scores) {
  const pubChem = sources.find((source) => source.source === 'PubChem') || {};
  const chembl = sources.find((source) => source.source === 'ChEMBL') || {};
  const badge = (score) => {
    const result = renderBadge(score);
    return `<span class="score-tag ${result.className}">${result.label}</span>`;
  };
  const descriptor = (label, value) => `<div class="report-metric"><span>${label}</span><strong>${escapeHtml(value ?? 'N/A')}</strong></div>`;
  const activityRows = (chembl.hits || []).slice(0, 5).map((hit) => `
    <tr><td>${escapeHtml(hit.name || hit.chemblId || 'Record')}</td><td>${escapeHtml(hit.chemblId || 'N/A')}</td><td>${escapeHtml(hit.maxPhase ?? 'N/A')}</td></tr>
  `).join('');
  const alerts = scores.alerts?.length
    ? scores.alerts.map((alert) => `<span class="alert-chip">${escapeHtml(alert)}</span>`).join('')
    : '<span class="muted">No configured alert terms detected.</span>';

  return `
    <div class="tool-reports">
      <div class="report-tabs" role="tablist" aria-label="Screening reports">
        <button type="button" class="report-tab active" data-report-tab="pass-report">Activity</button>
        <button type="button" class="report-tab" data-report-tab="adme-report">Properties</button>
        <button type="button" class="report-tab" data-report-tab="tox-report">Safety</button>
      </div>
      <section id="pass-report" class="report-panel active" data-report-panel>
        <div class="report-title"><div><p class="section-kicker">Public activity context</p><h3>Activity report</h3></div><div class="report-score">${scores.passPost}<small>/100</small>${badge(scores.passPost)}</div></div>
        <p class="report-explanation">Public compound matches and development-stage context related to this structure.</p>
        ${chembl.hits?.length ? `<table class="report-table"><thead><tr><th>Compound</th><th>ChEMBL ID</th><th>Max phase</th></tr></thead><tbody>${activityRows}</tbody></table>` : '<p class="muted">No ChEMBL activity context was returned.</p>'}
      </section>
      <section id="adme-report" class="report-panel" data-report-panel>
        <div class="report-title"><div><p class="section-kicker">Molecular descriptors</p><h3>Properties report</h3></div><div class="report-score">${scores.adme}<small>/100</small>${badge(scores.adme)}</div></div>
        <p class="report-explanation">Key molecular descriptors retrieved from public chemistry data.</p>
        <div class="report-metrics">
          ${descriptor('Molecular weight', pubChem.molecularWeight ? `${pubChem.molecularWeight} g/mol` : null)}
          ${descriptor('XlogP', pubChem.xlogp)}
          ${descriptor('TPSA', pubChem.tpsa ? `${pubChem.tpsa} A²` : null)}
          ${descriptor('H-bond donors', pubChem.hBondDonors)}
          ${descriptor('H-bond acceptors', pubChem.hBondAcceptors)}
          ${descriptor('Rotatable bonds', pubChem.rotatableBonds)}
        </div>
      </section>
      <section id="tox-report" class="report-panel" data-report-panel>
        <div class="report-title"><div><p class="section-kicker">Risk context</p><h3>Safety report</h3></div><div class="report-score">${scores.hazardTriage}<small>/100</small>${badge(scores.hazardTriage)}</div></div>
        <p class="report-explanation">Potential alerts and public toxicology context for further review.</p>
        <div class="alert-list">${alerts}</div>
        <div class="report-metrics">${descriptor('Mutagenicity signal', scores.mutagenicity)}${descriptor('Sources returned', sources.length)}${descriptor('Confidence', `${scores.confidence}/100`)}</div>
      </section>
    </div>
  `;
}

function renderResult(payload) {
  latestResult = payload;
  const { overview, sources, scores, limitations } = payload;

  resultsBox.innerHTML = `
    <div class="summary-box">
      <div class="result-heading"><div><p class="section-kicker">Screening snapshot</p><h3>${escapeHtml(overview.query)}</h3></div><span class="confidence-mark">${scores.confidence}<small>/100</small></span></div>
      <div class="result-status">${escapeHtml(overview.status)}</div>
      <p class="confidence-copy"><strong>Confidence:</strong> ${scores.confidence}/100 (${escapeHtml(overview.quality.label)})</p>
      <p>${escapeHtml(overview.dataSummary)}</p>
      <div class="notes-list">${overview.notes.map((note) => `<span>${escapeHtml(note)}</span>`).join('')}</div>
      <p class="methodology-note">${escapeHtml(limitations || 'Preliminary screening signals require expert and experimental confirmation.')}</p>
    </div>

    ${renderToolReports(sources, scores)}
    ${renderSources(sources)}
  `;

  saveAssessmentBtn.classList.toggle('hidden', !currentToken);
  resultsBox.querySelectorAll('[data-report-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      resultsBox.querySelectorAll('[data-report-tab]').forEach((item) => item.classList.toggle('active', item === tab));
      resultsBox.querySelectorAll('[data-report-panel]').forEach((panel) => panel.classList.toggle('active', panel.id === tab.dataset.reportTab));
    });
  });
}

function prepareReview() {
  if (!latestResult) return;

  const { overview, scores } = latestResult;
  reviewSummary.innerHTML = `
    <div class="review-summary-row"><span>Compound</span><strong>${escapeHtml(overview.query)}</strong></div>
    <div class="review-summary-row"><span>Screening status</span><strong>${escapeHtml(overview.status)}</strong></div>
    <div class="review-summary-row"><span>Confidence</span><strong>${scores.confidence}/100</strong></div>
    <div class="review-summary-row"><span>Evidence</span><strong>${overview.sourceCount} public sources</strong></div>
  `;
  saveStatus.classList.add('hidden');
  saveAssessmentBtn.classList.toggle('hidden', !currentToken);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

async function handleAuth(mode) {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    setAuthMessage('Username and password are required.', true);
    return;
  }

  try {
    const payload = await fetchJson(`/api/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    currentToken = payload.token || '';
    currentUserRole = payload.user.role || 'user';
    localStorage.setItem('toxicity_token', currentToken);
    sessionLabel.textContent = `${payload.user.username} · ${payload.user.role || 'user'}`;
    setAuthMessage(`${mode === 'register' ? 'Registered' : 'Logged in'} successfully for ${payload.user.username}.`);
    saveAssessmentBtn.classList.toggle('hidden', !currentToken);
    loadHistory();
    showStep(2);
  } catch (error) {
    setAuthMessage(error.message, true);
  }
}

async function loadHistory() {
  if (!currentToken) {
    historyList.innerHTML = '<p class="muted">Login to view your saved assessments.</p>';
    return;
  }

  try {
    const historyPath = ['admin', 'reviewer'].includes(currentUserRole) ? '/api/admin/assessments' : '/api/assessments';
    const payload = await fetchJson(`${historyPath}?token=${encodeURIComponent(currentToken)}`);
    const items = payload.assessments || [];

    if (!items.length) {
      historyList.innerHTML = '<p class="muted">No saved assessments yet.</p>';
      return;
    }

    historyList.innerHTML = items
      .map((item) => `
        <div class="history-item">
          <div class="history-topline"><strong>${escapeHtml(item.query)}</strong><span class="history-score">${item.scores.confidence || 0}</span></div>
          ${['admin', 'reviewer'].includes(currentUserRole) ? `<div class="muted">Submitted by ${escapeHtml(item.username || 'user')}</div>` : ''}
          <div class="muted">${new Date(item.createdAt).toLocaleString()}</div>
          <div class="history-meta"><span>Confidence</span><span>${escapeHtml(item.overview?.status || 'Not available')}</span></div>
        </div>
      `)
      .join('');
  } catch (error) {
    if (error.message === 'Authentication required.') {
      resetSession();
    }
    historyList.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

async function saveAssessment() {
  if (!currentToken || !latestResult) {
    saveStatus.textContent = 'Login first and run an assessment before saving.';
    saveStatus.classList.remove('hidden');
    return;
  }

  try {
    const payload = await fetchJson('/api/assessments', {
      method: 'POST',
      body: JSON.stringify({
        token: currentToken,
        query: latestResult.query,
        scores: latestResult.scores,
        overview: latestResult.overview,
      }),
    });

    saveStatus.textContent = `Assessment saved: ${payload.assessment.query}`;
    saveStatus.classList.remove('hidden');
    loadHistory();
  } catch (error) {
    saveStatus.textContent = error.message;
    saveStatus.classList.remove('hidden');
    saveStatus.style.borderColor = 'rgba(255, 107, 107, 0.5)';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const query = (formData.get('query') || '').toString().trim();
  const inputType = (formData.get('inputType') || 'auto').toString();

  if (!query) {
    resultsBox.innerHTML = '<p>Please enter a compound name or SMILES string.</p>';
    return;
  }

  loader.classList.remove('hidden');
  resultsBox.classList.remove('results-empty');
  resultsBox.innerHTML = '';

  try {
    const response = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, inputType }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Prediction request failed');
    }

    renderResult(payload);
    showStep(3);
  } catch (error) {
    resultsBox.innerHTML = `
      <div class="summary-box">
        <h3>Lookup failed</h3>
        <p>${error.message}</p>
      </div>
    `;
  } finally {
    loader.classList.add('hidden');
  }
});

registerBtn.addEventListener('click', () => handleAuth('register'));
loginBtn.addEventListener('click', () => handleAuth('login'));
saveAssessmentBtn.addEventListener('click', saveAssessment);
continueReviewBtn.addEventListener('click', () => {
  prepareReview();
  showStep(4);
});
backToResultsBtn.addEventListener('click', () => showStep(3));
backToAccountBtn.addEventListener('click', () => showStep(1));
newAssessmentBtn.addEventListener('click', () => {
  resultsBox.innerHTML = '<p>Enter a compound to retrieve screening data from public online databases.</p>';
  resultsBox.classList.add('results-empty');
  showStep(2);
});
accountBtn.addEventListener('click', resetSession);
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.classList.add('hidden');
});
batchFile.addEventListener('change', async () => {
  const file = batchFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  prepareBatch(text);
});
batchUseTextBtn.addEventListener('click', () => prepareBatch(batchText.value));
batchStartBtn.addEventListener('click', async () => {
  if (!batchEntries.length) return;
  batchStartBtn.disabled = true;
  batchPaused = false;
  batchCancelled = false;
  updateBatchControls(true);
  batchResults = [];
  let completed = 0;
  const queue = [...batchEntries.entries()];
  const worker = async () => {
    while (queue.length) {
      while (batchPaused && !batchCancelled) await new Promise((resolve) => setTimeout(resolve, 250));
      if (batchCancelled) return;
      const [, query] = queue.shift();
      try {
        const result = await fetchJson('/api/predict', {
          method: 'POST',
          body: JSON.stringify({ query, inputType: 'smiles' }),
        });
        batchResults.push({ query, status: result.overview.status, confidence: result.scores.confidence, toxicity: result.scores.toxicity, mutagenicity: result.scores.mutagenicity, adme: result.scores.adme, error: '' });
      } catch (error) {
        batchResults.push({ query, status: '', confidence: '', toxicity: '', mutagenicity: '', adme: '', error: error.message });
      }
      completed += 1;
      batchStatus.textContent = `Processed ${completed.toLocaleString()} of ${batchEntries.length.toLocaleString()} entries.`;
    }
  };
  const workerCount = Number(batchSpeed.value) || 10;
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  batchStatus.textContent = batchCancelled
    ? `Batch cancelled: ${batchResults.length.toLocaleString()} results retained.`
    : `Batch complete: ${batchResults.length.toLocaleString()} results ready.`;
  updateBatchControls(false);
  batchStartBtn.disabled = false;
});
batchPauseBtn.addEventListener('click', () => {
  batchPaused = !batchPaused;
  batchPauseBtn.textContent = batchPaused ? 'Resume' : 'Pause';
  batchStatus.textContent = batchPaused ? `Paused at ${batchResults.length.toLocaleString()} results.` : 'Resuming batch...';
});
batchCancelBtn.addEventListener('click', () => {
  batchCancelled = true;
  batchPaused = false;
});
batchDownloadBtn.addEventListener('click', () => {
  const headers = ['smiles', 'status', 'confidence', 'toxicity', 'mutagenicity', 'adme', 'error'];
  const csv = [headers, ...batchResults.map((row) => headers.map((header) => row[header] ?? ''))]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'toxiscreen-batch-results.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});
feedbackBtn.addEventListener('click', () => feedbackDialog.showModal());
document.getElementById('close-feedback-btn').addEventListener('click', () => feedbackDialog.close());
document.getElementById('cancel-feedback-btn').addEventListener('click', () => feedbackDialog.close());
feedbackForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = Object.fromEntries(new FormData(feedbackForm).entries());
  feedbackStatus.classList.add('hidden');

  try {
    await fetchJson('/api/feedback', { method: 'POST', body: JSON.stringify(feedback) });
    feedbackForm.reset();
    feedbackStatus.textContent = 'Thanks. Your feedback was submitted for review.';
    feedbackStatus.classList.remove('hidden');
  } catch (error) {
    feedbackStatus.textContent = error.message;
    feedbackStatus.classList.remove('hidden');
  }
});

showStep(1);
loadHistory();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}
