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

let currentToken = localStorage.getItem('toxicity_token') || '';
let latestResult = null;
let installPrompt = null;

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
    ['STOPTox', scores.stopTox],
    ['PASS / POST', scores.passPost],
    ['Toxicity', scores.toxicity],
    ['Mutagenicity', scores.mutagenicity],
    ['ADME', scores.adme],
  ];

  return entries
    .map(([label, score]) => {
      const badge = renderBadge(score);
      return `
        <article class="score-card">
          <h4>${label}</h4>
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
        .map((hit) => `<li>${escapeHtml(hit.name || hit.chemblId || hit.dtxsid || 'Record')}</li>`)
        .join('');

      const additional = entry.formula || entry.molecularWeight ? `<li>Formula: ${entry.formula || 'N/A'}</li><li>MW: ${entry.molecularWeight || 'N/A'}</li>` : '';

      return `
        <li class="source-item">
          <strong>${escapeHtml(entry.source)}</strong>
          <div class="source-meta">${escapeHtml(entry.evidence || 'Public metadata available.')}</div>
          <ul>${additional}${hits || '<li>No additional metadata available.</li>'}</ul>
        </li>
      `;
    })
    .join('');

  return `
    <div class="sources-list">
      <h3>Public database hits</h3>
      <ul>${html}</ul>
    </div>
  `;
}

function renderResult(payload) {
  latestResult = payload;
  const { overview, sources, scores } = payload;

  resultsBox.innerHTML = `
    <div class="summary-box">
      <div class="result-heading"><div><p class="section-kicker">Screening snapshot</p><h3>${escapeHtml(overview.query)}</h3></div><span class="confidence-mark">${scores.confidence}<small>/100</small></span></div>
      <div class="result-status">${escapeHtml(overview.status)}</div>
      <p class="confidence-copy"><strong>Confidence:</strong> ${scores.confidence}/100 (${escapeHtml(overview.quality.label)})</p>
      <p>${escapeHtml(overview.dataSummary)}</p>
      <div class="notes-list">${overview.notes.map((note) => `<span>${escapeHtml(note)}</span>`).join('')}</div>
    </div>

    <div class="score-grid">
      ${renderCards(scores)}
    </div>

    ${renderSources(sources)}
  `;

  saveAssessmentBtn.classList.toggle('hidden', !currentToken);
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
    const payload = await fetchJson(`/api/assessments?token=${encodeURIComponent(currentToken)}`);
    const items = payload.assessments || [];

    if (!items.length) {
      historyList.innerHTML = '<p class="muted">No saved assessments yet.</p>';
      return;
    }

    historyList.innerHTML = items
      .map((item) => `
        <div class="history-item">
          <div class="history-topline"><strong>${escapeHtml(item.query)}</strong><span class="history-score">${item.scores.confidence || 0}</span></div>
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
      body: JSON.stringify({ query }),
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

showStep(1);
loadHistory();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}
