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

let currentToken = localStorage.getItem('toxicity_token') || '';
let latestResult = null;

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
        .map((hit) => `<li>${hit.name || hit.chemblId || hit.dtxsid || 'Record'}</li>`)
        .join('');

      const additional = entry.formula || entry.molecularWeight ? `<li>Formula: ${entry.formula || 'N/A'}</li><li>MW: ${entry.molecularWeight || 'N/A'}</li>` : '';

      return `
        <li class="source-item">
          <strong>${entry.source}</strong>
          <div class="source-meta">${entry.evidence || 'Public metadata available.'}</div>
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
      <h3>${overview.query}</h3>
      <p><strong>Status:</strong> ${overview.status}</p>
      <p><strong>Confidence:</strong> ${scores.confidence}/100 (${overview.quality.label})</p>
      <p>${overview.dataSummary}</p>
      <p>${overview.notes.join('<br>')}</p>
    </div>

    <div class="score-grid">
      ${renderCards(scores)}
    </div>

    ${renderSources(sources)}
  `;

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
    setAuthMessage(`${mode === 'register' ? 'Registered' : 'Logged in'} successfully for ${payload.user.username}.`);
    saveAssessmentBtn.classList.toggle('hidden', !currentToken);
    loadHistory();
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
          <strong>${item.query}</strong>
          <div class="muted">${new Date(item.createdAt).toLocaleString()}</div>
          <div>Confidence: ${item.scores.confidence || 0}/100</div>
          <div>Status: ${item.overview?.status || 'Not available'}</div>
        </div>
      `)
      .join('');
  } catch (error) {
    historyList.innerHTML = `<p class="muted">${error.message}</p>`;
  }
}

async function saveAssessment() {
  if (!currentToken || !latestResult) {
    setAuthMessage('Login first and run an assessment before saving.', true);
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

    setAuthMessage(`Assessment saved: ${payload.assessment.query}`);
    loadHistory();
  } catch (error) {
    setAuthMessage(error.message, true);
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

loadHistory();
