const form = document.getElementById('screening-form');
const loader = document.getElementById('loader');
const resultsBox = document.getElementById('results');

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

      return `
        <li class="source-item">
          <strong>${entry.source}</strong>
          <ul>${hits || '<li>No additional metadata available.</li>'}</ul>
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
  const { overview, sources, scores } = payload;

  resultsBox.innerHTML = `
    <div class="summary-box">
      <h3>${overview.query}</h3>
      <p>${overview.dataSummary}</p>
      <p>${overview.notes.join('<br>')}</p>
    </div>

    <div class="score-grid">
      ${renderCards(scores)}
    </div>

    ${renderSources(sources)}
  `;
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
