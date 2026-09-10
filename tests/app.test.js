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
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
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

test('predict endpoint rejects empty search input', async () => {
  const response = await request('/api/predict', { query: '' });
  assert.equal(response.status, 400);
  assert.match(response.body, /Please provide a valid compound/);
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
