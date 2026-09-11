const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../app.js');

const request = async (path, payload) => {
  const server = app.listen(0);
  const { port } = await new Promise((resolve) => server.once('listening', () => resolve(server.address())));

  try {
    const http = require('http');
    const body = JSON.stringify(payload || null);

    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port,
        path,
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });

      req.on('error', reject);
      if (payload) {
        req.write(body);
      }
      req.end();
    });

    return response;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('health endpoint responds successfully', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.match(response.body, /"ok":true/);
});

test('health endpoint includes baseline security headers', async () => {
  const response = await request('/api/health');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
});

test('predict endpoint rejects empty search input', async () => {
  const response = await request('/api/predict', { query: '' });
  assert.equal(response.status, 400);
  assert.match(response.body, /Please provide a valid compound/);
});

test('feedback endpoint stores structured tester feedback', async () => {
  const response = await request('/api/feedback', {
    category: 'ux',
    severity: 'medium',
    compound: 'aspirin',
    device: 'test browser',
    expected: 'Results should be easy to read.',
    actual: 'The result card is crowded.',
  });
  assert.equal(response.status, 201);
  assert.match(response.body, /"category":"ux"/);
});

test('register endpoint creates a user account', async () => {
  const username = `demo_user_${Date.now()}`;
  const response = await request('/api/register', { username, password: 'demo123' });
  assert.equal(response.status, 201);
  const payload = JSON.parse(response.body);
  assert.equal(payload.user.username, username);
  assert.ok(payload.token);
});

test('assessment history endpoint returns saved entries for the user', async () => {
  const username = `history_user_${Date.now()}`;
  const registerResponse = await request('/api/register', { username, password: 'demo123' });
  const token = JSON.parse(registerResponse.body).token;

  await request('/api/assessments', {
    token,
    query: 'acetaminophen',
    scores: { stopTox: 30, passPost: 40, toxicity: 50, mutagenicity: 45, adme: 60, confidence: 70 },
    overview: { status: 'Candidate for further evaluation' }
  });

  const historyResponse = await request(`/api/assessments?token=${encodeURIComponent(token)}`);
  assert.equal(historyResponse.status, 200);
  const history = JSON.parse(historyResponse.body);
  assert.ok(Array.isArray(history.assessments));
  assert.ok(history.assessments.length >= 1);
});

test('review endpoint updates an assessment status and note', async () => {
  const username = `review_user_${Date.now()}`;
  const registerResponse = await request('/api/register', { username, password: 'demo123' });
  const token = JSON.parse(registerResponse.body).token;

  const created = await request('/api/assessments', {
    token,
    query: 'benzene',
    scores: { stopTox: 80, passPost: 60, toxicity: 90, mutagenicity: 88, adme: 70, confidence: 82 },
    overview: { status: 'Requires hazard review' }
  });

  const assessmentId = JSON.parse(created.body).assessment.id;
  const reviewResponse = await request(`/api/assessments/${assessmentId}/review`, {
    token,
    status: 'approved',
    reviewerNote: 'Accepted after manual review.'
  });

  assert.equal(reviewResponse.status, 200);
  const reviewPayload = JSON.parse(reviewResponse.body);
  assert.equal(reviewPayload.assessment.status, 'approved');
  assert.match(reviewPayload.assessment.reviewerNote, /manual review/);
});

test('admin can list all assessments and export csv', async () => {
  const adminLogin = await request('/api/login', { username: 'admin', password: 'admin123' });
  const adminToken = JSON.parse(adminLogin.body).token;

  await request('/api/admin/assessments?token=' + encodeURIComponent(adminToken));
  const feedbackResponse = await request('/api/admin/feedback?token=' + encodeURIComponent(adminToken));
  const exportResponse = await request(`/api/admin/export/csv?token=${encodeURIComponent(adminToken)}`);

  assert.equal(feedbackResponse.status, 200);
  assert.match(feedbackResponse.body, /"feedback"/);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.body, /query/i);
});
