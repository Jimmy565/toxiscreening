const express = require('express');
const path = require('path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'toxicity_app.db');
const db = new DatabaseSync(dbPath);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ROLES = new Set(['tester', 'reviewer', 'admin']);

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || ADMIN_PASSWORD === 'admin123')) {
  throw new Error('Set a unique ADMIN_PASSWORD before starting in production.');
}

const hashPassword = (password) => crypto.createHash('sha256').update(String(password)).digest('hex');

const createToken = (username) => crypto
  .createHash('sha256')
  .update(`${Date.now()}-${username}-${Math.random()}`)
  .digest('hex');

const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      token TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      query TEXT NOT NULL,
      scores TEXT NOT NULL,
      overview TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      compound TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT '',
      expected TEXT NOT NULL,
      actual TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns = db.prepare('PRAGMA table_info(users)').all();
  const userColumnNames = new Set(columns.map((column) => column.name));

  if (!userColumnNames.has('role')) {
    db.exec('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT "user"');
  }

  db.prepare('UPDATE users SET role = ? WHERE role = ?').run('tester', 'user');

  const assessmentColumns = db.prepare('PRAGMA table_info(assessments)').all();
  const assessmentColumnNames = new Set(assessmentColumns.map((column) => column.name));

  if (!assessmentColumnNames.has('status')) {
    db.exec('ALTER TABLE assessments ADD COLUMN status TEXT NOT NULL DEFAULT "pending"');
  }

  if (!assessmentColumnNames.has('reviewer_note')) {
    db.exec('ALTER TABLE assessments ADD COLUMN reviewer_note TEXT NOT NULL DEFAULT ""');
  }

  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME);
  if (!existingAdmin) {
    db.prepare('INSERT INTO users (username, password_hash, token, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ADMIN_USERNAME, hashPassword(ADMIN_PASSWORD), createToken(ADMIN_USERNAME), 'admin', new Date().toISOString());
  }
};

initDb();

const dataSources = [
  {
    name: 'PubChem',
    type: 'Compound registry',
    description: 'Chemical identifiers, structures, and property metadata.',
    reliability: 'High',
  },
  {
    name: 'ChEMBL',
    type: 'Bioactivity database',
    description: 'Compound activity and medicinal chemistry references.',
    reliability: 'High',
  },
  {
    name: 'EPA CompTox',
    type: 'Toxicology inventory',
    description: 'Chemical hazard, exposure, and toxicology context metadata.',
    reliability: 'High',
  },
];

const alertTerms = {
  nitroso: 'nitroso',
  azide: 'azide',
  epoxide: 'epoxide',
  quinone: 'quinone',
  aryl: 'aryl',
  benzene: 'benzene',
  halo: 'halo',
  chlor: 'chlor',
  fluoro: 'fluoro',
  bromo: 'bromo',
  nitro: 'nitro',
  sulfonyl: 'sulfonyl',
};

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
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

const cleanQuery = (value = '') => String(value).trim();

const looksLikeSmiles = (value) => {
  const query = cleanQuery(value);
  return query.length >= 2
    && /[A-Za-z]/.test(query)
    && /[=#()\[\]\\/0-9]/.test(query)
    && !/\s/.test(query);
};

const getTokenFromRequest = (req) => {
  const bodyToken = req.body?.token || req.query?.token;
  const headerToken = req.headers.authorization || req.headers.Authorization;

  if (bodyToken) {
    return String(bodyToken);
  }

  if (headerToken && typeof headerToken === 'string' && headerToken.startsWith('Bearer ')) {
    return headerToken.replace('Bearer ', '');
  }

  return null;
};

const getUserByToken = (token) => {
  if (!token) {
    return null;
  }

  return db.prepare('SELECT * FROM users WHERE token = ?').get(String(token));
};

const normalizedRole = (role) => role === 'user' ? 'tester' : (ROLES.has(role) ? role : 'tester');
const userIsAdmin = (user) => user && normalizedRole(user.role) === 'admin';
const userCanReview = (user) => user && ['admin', 'reviewer'].includes(normalizedRole(user.role));

const normalizeSource = (sourceName, details) => ({
  source: sourceName,
  status: 'available',
  ...details,
});

const safeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const describeRisk = (score, label) => {
  if (score >= 75) {
    return `${label}: high priority review`;
  }
  if (score >= 55) {
    return `${label}: moderate priority review`;
  }
  return `${label}: low risk signal; confirm with assay`;
};

const getQualityBand = (score) => {
  if (score >= 85) return { label: 'High confidence', className: 'score-high' };
  if (score >= 60) return { label: 'Moderate confidence', className: 'score-medium' };
  return { label: 'Low confidence', className: 'score-low' };
};

async function queryPubChem(searchTerm, inputType = 'auto') {
  const lookupType = inputType === 'smiles' || (inputType === 'auto' && looksLikeSmiles(searchTerm)) ? 'smiles' : 'name';
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${lookupType}/${encodeURIComponent(searchTerm)}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,InChIKey/JSON`;
  const data = await fetchJson(url);
  const property = data?.PropertyTable?.Properties?.[0];

  if (!property) {
    return null;
  }

  return normalizeSource('PubChem', {
    cid: property.CID || null,
    formula: property.MolecularFormula || null,
    molecularWeight: safeNumber(property.MolecularWeight),
    smiles: property.CanonicalSMILES || property.ConnectivitySMILES || null,
    inchiKey: property.InChIKey || null,
    structureImage: property.CID
      ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${property.CID}/PNG`
      : null,
    evidence: 'Structure and composition metadata retrieved from PubChem.',
  });
}

async function queryChEMBL(searchTerm) {
  const exactUrl = `https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__iexact=${encodeURIComponent(searchTerm)}&limit=5`;
  const exactData = await fetchJson(exactUrl);
  let molecules = exactData?.molecules || [];

  if (!molecules.length) {
    const searchUrl = `https://www.ebi.ac.uk/chembl/api/data/molecule.json?search=${encodeURIComponent(searchTerm)}&limit=5`;
    const data = await fetchJson(searchUrl);
    molecules = data?.molecules || [];
  }

  if (!molecules.length) {
    return null;
  }

  return normalizeSource('ChEMBL', {
    count: molecules.length,
    hits: molecules.slice(0, 5).map((molecule) => ({
      name: molecule.pref_name || molecule.molecule_chembl_id || 'Unnamed molecule',
      chemblId: molecule.molecule_chembl_id || null,
      smiles: molecule.molecule_structures?.canonical_smiles || null,
      maxPhase: molecule.max_phase || null,
    })),
    evidence: 'Bioactivity and medicinal chemistry candidate records from ChEMBL.',
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
    evidence: 'Hazard and toxicological inventory context from CompTox.',
  });
}

function inferRiskSignals(query, smiles = '', sourceCount = 0, sourceNames = []) {
  const haystack = `${query} ${smiles}`.toLowerCase();
  const triggered = Object.keys(alertTerms).filter((term) => haystack.includes(term));
  const sourceBoost = sourceCount * 10;

  const stopTox = Math.min(92, 30 + sourceBoost + triggered.length * 8 + (haystack.length > 20 ? 8 : 0));
  const passPost = Math.min(90, 36 + sourceBoost + triggered.length * 6 + (sourceNames.includes('ChEMBL') ? 8 : 0));
  const toxicity = Math.min(96, 32 + sourceBoost + triggered.length * 11 + (sourceNames.includes('CompTox') ? 10 : 0));
  const mutagenicity = Math.min(94, 28 + sourceBoost + triggered.length * 12 + (sourceNames.includes('CompTox') ? 8 : 0));
  const adme = Math.min(88, 40 + sourceBoost + (sourceNames.includes('ChEMBL') ? 8 : 0) + (haystack.length > 18 ? 6 : 0));

  const confidence = Math.min(100, 50 + sourceCount * 18 + triggered.length * 4);

  return {
    stopTox: Math.round(stopTox),
    passPost: Math.round(passPost),
    toxicity: Math.round(toxicity),
    mutagenicity: Math.round(mutagenicity),
    adme: Math.round(adme),
    confidence: Math.round(confidence),
    alerts: triggered,
  };
}

function buildExpertSummary(query, sources, scores) {
  const quality = getQualityBand(scores.confidence);
  const status = scores.toxicity >= 75 || scores.mutagenicity >= 75 ? 'Requires hazard review' : 'Candidate for further evaluation';

  return {
    query,
    status,
    sourceCount: sources.length,
    dataSummary: sources.length
      ? `Cross-referenced with ${sources.length} public chemistry sources and a confidence score of ${scores.confidence}/100.`
      : 'No high-confidence public match could be confirmed from the selected online sources.',
    quality,
    analysisProfiles: {
      passPost: {
        label: 'PASS/POST-style prioritization',
        method: 'Heuristic activity-priority screen using public compound matches; not an official Way2Drug prediction.',
      },
      adme: {
        label: 'SwissADME-style descriptors',
        method: 'Public structure-property metadata and rule-based triage; not an official SwissADME calculation.',
      },
      toxicity: {
        label: 'STOPTOX-style structural-alert triage',
        method: 'Structure/name alert screening and public toxicology context; not an official STOPTOX result.',
      },
    },
    notes: [
      describeRisk(scores.stopTox, 'STOPTox'),
      describeRisk(scores.passPost, 'PASS/POST'),
      describeRisk(scores.toxicity, 'Toxicity'),
      describeRisk(scores.mutagenicity, 'Mutagenicity'),
      describeRisk(scores.adme, 'ADME'),
    ],
  };
}

app.get('/api/data-sources', (_req, res) => {
  res.json({ dataSources });
});

app.post('/api/feedback', (req, res) => {
  const fields = ['category', 'severity', 'compound', 'device', 'expected', 'actual', 'details', 'contact'];
  const feedback = Object.fromEntries(fields.map((field) => [field, cleanQuery(req.body?.[field] || '')]));

  if (!['bug', 'ux', 'scientific', 'feature', 'other'].includes(feedback.category)) {
    return res.status(400).json({ error: 'Choose a valid feedback category.' });
  }

  if (!['low', 'medium', 'high'].includes(feedback.severity)) {
    return res.status(400).json({ error: 'Choose a valid feedback severity.' });
  }

  if (!feedback.expected || !feedback.actual) {
    return res.status(400).json({ error: 'Expected and actual behavior are required.' });
  }

  if (fields.some((field) => feedback[field].length > 2000)) {
    return res.status(400).json({ error: 'Feedback fields must be 2,000 characters or fewer.' });
  }

  const result = db.prepare(`
    INSERT INTO feedback (category, severity, compound, device, expected, actual, details, contact, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    feedback.category,
    feedback.severity,
    feedback.compound,
    feedback.device,
    feedback.expected,
    feedback.actual,
    feedback.details,
    feedback.contact,
    new Date().toISOString(),
  );

  return res.status(201).json({ feedback: { id: result.lastInsertRowid, ...feedback } });
});

app.get('/api/admin/feedback', (req, res) => {
  const token = getTokenFromRequest(req);
  const user = getUserByToken(token);

  if (!user || !userCanReview(user)) {
    return res.status(403).json({ error: 'Reviewer access required.' });
  }

  const rows = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
  return res.json({ feedback: rows });
});

app.get('/api/admin/assessments', (req, res) => {
  const token = getTokenFromRequest(req);
  const user = getUserByToken(token);

  if (!user || !userCanReview(user)) {
    return res.status(403).json({ error: 'Reviewer access required.' });
  }

  const rows = db.prepare('SELECT a.*, u.username FROM assessments a JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC').all();

  return res.json({
    assessments: rows.map((row) => ({
      id: row.id,
      query: row.query,
      username: row.username,
      scores: JSON.parse(row.scores),
      overview: JSON.parse(row.overview),
      status: row.status || 'pending',
      reviewerNote: row.reviewer_note || '',
      createdAt: row.created_at,
    })),
  });
});

app.get('/api/admin/export/csv', (req, res) => {
  const token = getTokenFromRequest(req);
  const user = getUserByToken(token);

  if (!user || !userIsAdmin(user)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const rows = db.prepare('SELECT a.*, u.username FROM assessments a JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC').all();

  const csvRows = [
    ['id', 'username', 'query', 'status', 'confidence', 'toxicity', 'mutagenicity', 'adme', 'reviewer_note'],
    ...rows.map((row) => {
      const scores = JSON.parse(row.scores || '{}');
      return [
        row.id,
        row.username,
        row.query,
        row.status || 'pending',
        scores.confidence || '',
        scores.toxicity || '',
        scores.mutagenicity || '',
        scores.adme || '',
        row.reviewer_note || '',
      ];
    }),
  ];

  const csv = csvRows
    .map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="toxicity-assessments.csv"');
  return res.send(csv);
});

app.get('/api/admin/users', (req, res) => {
  const user = getUserByToken(getTokenFromRequest(req));

  if (!user || !userIsAdmin(user)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all();
  return res.json({ users: users.map((item) => ({
    id: item.id,
    username: item.username,
    role: normalizedRole(item.role),
    createdAt: item.created_at,
  })) });
});

app.patch('/api/admin/users/:id/role', (req, res) => {
  const user = getUserByToken(getTokenFromRequest(req));

  if (!user || !userIsAdmin(user)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const role = cleanQuery(req.body?.role || '');
  const userId = Number(req.params?.id);

  if (!ROLES.has(role) || !Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Role must be tester, reviewer, or admin and ID must be valid.' });
  }

  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!target) {
    return res.status(404).json({ error: 'User not found.' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return res.json({ user: { id: target.id, username: target.username, role } });
});

app.post('/api/register', (req, res) => {
  const username = cleanQuery(req.body?.username || '');
  const password = String(req.body?.password || '');

  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) {
    return res.status(409).json({ error: 'Username is already taken.' });
  }

  const token = createToken(username);
  const insert = db.prepare('INSERT INTO users (username, password_hash, token, created_at) VALUES (?, ?, ?, ?)');
  const result = insert.run(username, hashPassword(password), token, new Date().toISOString());

  return res.status(201).json({
    user: {
      id: result.lastInsertRowid,
      username,
      role: 'tester',
    },
    token,
  });
});

app.post('/api/login', (req, res) => {
  const username = cleanQuery(req.body?.username || '');
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  return res.json({
    user: {
      id: user.id,
      username: user.username,
      role: normalizedRole(user.role),
    },
    token: user.token,
  });
});

app.post('/api/assessments', (req, res) => {
  const token = getTokenFromRequest(req);
  const user = getUserByToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const query = cleanQuery(req.body?.query || '');
  const scores = req.body?.scores || {};
  const overview = req.body?.overview || {};

  if (!query) {
    return res.status(400).json({ error: 'Assessment query is required.' });
  }

  const insert = db.prepare('INSERT INTO assessments (user_id, query, scores, overview, status, reviewer_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const result = insert.run(user.id, query, JSON.stringify(scores), JSON.stringify(overview), 'pending', '', new Date().toISOString());

  return res.status(201).json({
    assessment: {
      id: result.lastInsertRowid,
      userId: user.id,
      query,
      scores,
      overview,
      status: 'pending',
      reviewerNote: '',
    },
  });
});

app.get('/api/assessments', (req, res) => {
  const token = getTokenFromRequest(req);
  const user = getUserByToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const rows = db.prepare('SELECT * FROM assessments WHERE user_id = ? ORDER BY created_at DESC').all(user.id);

  return res.json({
    assessments: rows.map((row) => ({
      id: row.id,
      query: row.query,
      scores: JSON.parse(row.scores),
      overview: JSON.parse(row.overview),
      status: row.status || 'pending',
      reviewerNote: row.reviewer_note || '',
      createdAt: row.created_at,
    })),
  });
});

app.post('/api/assessments/:id/review', (req, res) => {
  const token = getTokenFromRequest(req);
  const user = getUserByToken(token);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const assessmentId = Number(req.params?.id);
  if (!Number.isInteger(assessmentId)) {
    return res.status(400).json({ error: 'A valid assessment ID is required.' });
  }

  const status = String(req.body?.status || '').toLowerCase();
  const reviewerNote = String(req.body?.reviewerNote || '');

  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be one of: pending, approved, rejected.' });
  }

  const assessment = userCanReview(user)
    ? db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId)
    : db.prepare('SELECT * FROM assessments WHERE id = ? AND user_id = ?').get(assessmentId, user.id);
  if (!assessment) {
    return res.status(404).json({ error: 'Assessment not found.' });
  }

  if (userCanReview(user)) {
    db.prepare('UPDATE assessments SET status = ?, reviewer_note = ? WHERE id = ?').run(status, reviewerNote, assessmentId);
  } else {
    db.prepare('UPDATE assessments SET status = ?, reviewer_note = ? WHERE id = ? AND user_id = ?')
      .run(status, reviewerNote, assessmentId, user.id);
  }

  return res.json({
    assessment: {
      id: assessment.id,
      query: assessment.query,
      status,
      reviewerNote,
      scores: JSON.parse(assessment.scores),
      overview: JSON.parse(assessment.overview),
    },
  });
});

app.post('/api/predict', async (req, res) => {
  const query = cleanQuery(req.body?.query || '');
  const inputType = cleanQuery(req.body?.inputType || 'auto');

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Please provide a valid compound name or SMILES string.' });
  }

  if (!['auto', 'name', 'smiles'].includes(inputType)) {
    return res.status(400).json({ error: 'Input type must be auto, name, or smiles.' });
  }

  try {
    const [pubChemResult, chEMBLResult, compToxResult] = await Promise.allSettled([
      queryPubChem(query, inputType),
      queryChEMBL(query),
      queryComptox(query),
    ]);

    const sources = [
      pubChemResult.status === 'fulfilled' ? pubChemResult.value : null,
      chEMBLResult.status === 'fulfilled' ? chEMBLResult.value : null,
      compToxResult.status === 'fulfilled' ? compToxResult.value : null,
    ].filter(Boolean);

    const sourceNames = sources.map((source) => source.source);
    const primarySource = sources[0] || {
      source: 'Fallback',
      formula: null,
      molecularWeight: null,
      smiles: null,
      evidence: 'No direct match was confirmed in the primary online sources.',
    };

    const riskSignals = inferRiskSignals(query, primarySource.smiles || '', sources.length, sourceNames);
    const overview = buildExpertSummary(query, sources, riskSignals);

    res.json({
      query,
      overview,
      sources,
      scores: riskSignals,
      dataSources,
      limitations: 'These are preliminary screening signals, not official Way2Drug, SwissADME, or STOPTOX predictions and not a substitute for validated models or experimental testing.',
    });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({
      error: 'The external database lookup failed or the compound could not be resolved. Please validate the input and try again.',
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'toxicity-screening-app', sources: dataSources.length });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Toxicity screening app running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, dataSources };
