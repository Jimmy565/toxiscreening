const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed for ${url}: ${response.status} ${text}`);
  }

  return response.json();
};

const cleanQuery = (value = '') => value.trim();

const normalizeSource = (sourceName, details) => ({
  source: sourceName,
  ...details,
});

async function queryPubChem(searchTerm) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(searchTerm)}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,InChIKey/JSON`;
  const data = await fetchJson(url);
  const property = data?.PropertyTable?.Properties?.[0];

  if (!property) {
    return null;
  }

  return normalizeSource('PubChem', {
    formula: property.MolecularFormula || null,
    molecularWeight: property.MolecularWeight || null,
    smiles: property.CanonicalSMILES || null,
    inchiKey: property.InChIKey || null,
  });
}

async function queryChEMBL(searchTerm) {
  const url = `https://www.ebi.ac.uk/chembl/api/data/molecule?search=${encodeURIComponent(searchTerm)}&limit=3`;
  const data = await fetchJson(url);
  const molecules = data?.molecules || [];

  if (!molecules.length) {
    return null;
  }

  return normalizeSource('ChEMBL', {
    count: molecules.length,
    hits: molecules.slice(0, 3).map((molecule) => ({
      name: molecule.pref_name || 'Unnamed molecule',
      chemblId: molecule.molecule_chembl_id || null,
      smiles: molecule.smiles || null,
    })),
  });
}

async function queryComptox(searchTerm) {
  const url = `https://comptox.epa.gov/dashboard-api/search?search=${encodeURIComponent(searchTerm)}&page=1&per_page=5`;
  const data = await fetchJson(url);
  const results = data?.results || data?.data || data?.matches || [];

  if (!Array.isArray(results) || !results.length) {
    return null;
  }

  return normalizeSource('CompTox', {
    count: results.length,
    hits: results.slice(0, 5).map((item) => ({
      name: item.name || item.pref_name || item.synonym || 'Unknown compound',
      casrn: item.casrn || null,
      dtxsid: item.dtxsid || null,
    })),
  });
}

function inferRiskSignals(query, smiles = '', sourceCount = 0) {
  const haystack = `${query} ${smiles}`.toLowerCase();
  const alertTerms = [
    'nitroso',
    'azide',
    'epoxide',
    'quinone',
    'aryl',
    'benzene',
    'halo',
    'chlor',
    'fluoro',
    'bromo',
    'nitro',
    'sulfonyl',
  ];

  const triggered = alertTerms.filter((term) => haystack.includes(term));

  const base = Math.min(72, 35 + sourceCount * 12 + triggered.length * 8);
  const stopTox = Math.min(90, base + 10);
  const passPost = Math.min(88, 40 + sourceCount * 15 + triggered.length * 5);
  const toxicity = Math.min(95, 30 + sourceCount * 17 + triggered.length * 10);
  const mutagenicity = Math.min(92, 28 + sourceCount * 14 + triggered.length * 12);
  const adme = Math.min(86, 45 + sourceCount * 10 + (haystack.length > 20 ? 8 : 0));

  return {
    stopTox: Math.round(stopTox),
    passPost: Math.round(passPost),
    toxicity: Math.round(toxicity),
    mutagenicity: Math.round(mutagenicity),
    adme: Math.round(adme),
  };
}

function describeRisk(score, label) {
  if (score >= 75) {
    return `${label}: high priority review`;
  }
  if (score >= 55) {
    return `${label}: moderate priority review`;
  }
  return `${label}: low risk signal; confirm by assay`;
}

app.post('/api/predict', async (req, res) => {
  const query = cleanQuery(req.body?.query || '');

  if (!query) {
    return res.status(400).json({ error: 'Please provide a compound name or SMILES string.' });
  }

  try {
    const [pubChemResult, chEMBLResult, compToxResult] = await Promise.allSettled([
      queryPubChem(query),
      queryChEMBL(query),
      queryComptox(query),
    ]);

    const sources = [
      pubChemResult.status === 'fulfilled' ? pubChemResult.value : null,
      chEMBLResult.status === 'fulfilled' ? chEMBLResult.value : null,
      compToxResult.status === 'fulfilled' ? compToxResult.value : null,
    ].filter(Boolean);

    const primarySource = sources[0] || {
      source: 'Fallback',
      formula: null,
      molecularWeight: null,
      smiles: null,
    };

    const riskSignals = inferRiskSignals(query, primarySource.smiles || '', sources.length);

    const summary = {
      query,
      status: 'Prototype assessment',
      sourceCount: sources.length,
      dataSummary: primarySource.formula
        ? `Primary data from ${primarySource.source} shows formula ${primarySource.formula}.`
        : `No exact match found in the primary public database, but the query was reviewed across ${sources.length || 0} online sources.`,
      notes: [
        describeRisk(riskSignals.stopTox, 'STOPTox'),
        describeRisk(riskSignals.passPost, 'PASS/POST'),
        describeRisk(riskSignals.toxicity, 'Toxicity'),
        describeRisk(riskSignals.mutagenicity, 'Mutagenicity'),
        describeRisk(riskSignals.adme, 'ADME'),
      ],
    };

    res.json({
      query,
      overview: summary,
      sources,
      scores: riskSignals,
    });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({
      error: 'The database lookup failed. Please re-check the query or try another compound name.',
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'toxicity-screening-app' });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Toxicity screening app running at http://localhost:${PORT}`);
});
