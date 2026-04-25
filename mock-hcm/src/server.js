/**
 * Mock HCM Server
 * 
 * Simulates an external Human Capital Management system for testing.
 * Features:
 * - In-memory balance store per employee+location+leaveType
 * - Deduction and restore endpoints with idempotency
 * - Configurable error modes (silent accept, downtime, latency)
 * - Simulation endpoints for anniversary bonuses and year resets
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ========== In-Memory Data Store ==========
const balances = new Map(); // key: "employeeId|locationId|leaveType" -> { balanceDays }
const processedKeys = new Set(); // idempotency keys already processed
let errorMode = false; // When true, HCM silently accepts invalid deductions
let downtimeMode = false; // When true, returns 503 for everything
let latencyMs = 0; // Artificial delay in ms

// Helper to build balance key
function balanceKey(employeeId, locationId, leaveType) {
  return `${employeeId}|${locationId}|${leaveType}`;
}

// Middleware: simulate latency and downtime
app.use((req, res, next) => {
  if (downtimeMode && !req.path.startsWith('/api/hcm/simulate') && !req.path.startsWith('/api/hcm/seed') && !req.path.startsWith('/api/hcm/reset')) {
    return res.status(503).json({ error: 'HCM is currently unavailable' });
  }
  if (latencyMs > 0) {
    setTimeout(next, latencyMs);
  } else {
    next();
  }
});

// ========== Balance Endpoints ==========

// GET /api/hcm/balance/:employeeId/:locationId/:leaveType
app.get('/api/hcm/balance/:employeeId/:locationId/:leaveType', (req, res) => {
  const { employeeId, locationId, leaveType } = req.params;
  const key = balanceKey(employeeId, locationId, leaveType);
  const entry = balances.get(key);

  if (!entry) {
    return res.status(404).json({
      error: 'Balance not found',
      message: `No balance found for ${employeeId} at ${locationId} (${leaveType})`,
    });
  }

  res.json({
    employeeId,
    locationId,
    leaveType,
    balanceDays: entry.balanceDays,
  });
});

// POST /api/hcm/deduct
app.post('/api/hcm/deduct', (req, res) => {
  const { employeeId, locationId, leaveType, days } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  // Check idempotency
  if (idempotencyKey && processedKeys.has(idempotencyKey)) {
    return res.json({
      referenceId: `hcm_ref_${idempotencyKey}`,
      message: 'Already processed (idempotent)',
    });
  }

  const key = balanceKey(employeeId, locationId, leaveType);
  const entry = balances.get(key);

  if (!entry) {
    return res.status(400).json({
      error: 'INVALID_COMBINATION',
      message: `No balance found for ${employeeId} at ${locationId} (${leaveType})`,
    });
  }

  // Check sufficient balance (unless error mode is on)
  if (!errorMode && entry.balanceDays < days) {
    return res.status(400).json({
      error: 'INSUFFICIENT_BALANCE',
      message: `Balance is ${entry.balanceDays} but ${days} days requested`,
    });
  }

  // Deduct
  entry.balanceDays -= days;
  const referenceId = `hcm_ref_${uuidv4().slice(0, 8)}`;

  if (idempotencyKey) {
    processedKeys.add(idempotencyKey);
  }

  res.json({ referenceId });
});

// POST /api/hcm/restore
app.post('/api/hcm/restore', (req, res) => {
  const { employeeId, locationId, leaveType, days } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  // Check idempotency
  if (idempotencyKey && processedKeys.has(idempotencyKey)) {
    return res.json({
      referenceId: `hcm_restore_${idempotencyKey}`,
      message: 'Already processed (idempotent)',
    });
  }

  const key = balanceKey(employeeId, locationId, leaveType);
  const entry = balances.get(key);

  if (!entry) {
    return res.status(400).json({
      error: 'INVALID_COMBINATION',
      message: `No balance found for ${employeeId} at ${locationId} (${leaveType})`,
    });
  }

  entry.balanceDays += days;
  const referenceId = `hcm_restore_${uuidv4().slice(0, 8)}`;

  if (idempotencyKey) {
    processedKeys.add(idempotencyKey);
  }

  res.json({ referenceId });
});

// ========== Simulation Endpoints ==========

// POST /api/hcm/simulate/anniversary — adds bonus days
app.post('/api/hcm/simulate/anniversary', (req, res) => {
  const { employeeId, locationId, leaveType, bonusDays } = req.body;
  const key = balanceKey(employeeId, locationId, leaveType || 'PTO');
  const entry = balances.get(key);

  if (!entry) {
    return res.status(404).json({ error: 'Employee balance not found' });
  }

  const previousBalance = entry.balanceDays;
  entry.balanceDays += (bonusDays || 5);

  res.json({
    employeeId,
    locationId,
    leaveType: leaveType || 'PTO',
    previousBalance,
    newBalance: entry.balanceDays,
    event: 'WORK_ANNIVERSARY',
  });
});

// POST /api/hcm/simulate/year-reset — resets balances to a new amount
app.post('/api/hcm/simulate/year-reset', (req, res) => {
  const { resetBalances } = req.body;
  // resetBalances: [{ employeeId, locationId, leaveType, balanceDays }]

  const results = [];
  for (const item of (resetBalances || [])) {
    const key = balanceKey(item.employeeId, item.locationId, item.leaveType);
    const previous = balances.get(key)?.balanceDays || 0;
    balances.set(key, { balanceDays: item.balanceDays });
    results.push({
      ...item,
      previousBalance: previous,
    });
  }

  res.json({ reset: results.length, results });
});

// POST /api/hcm/simulate/error-mode — toggle silent accept mode
app.post('/api/hcm/simulate/error-mode', (req, res) => {
  errorMode = req.body.enabled !== undefined ? req.body.enabled : !errorMode;
  res.json({ errorMode });
});

// POST /api/hcm/simulate/downtime — toggle downtime mode
app.post('/api/hcm/simulate/downtime', (req, res) => {
  downtimeMode = req.body.enabled !== undefined ? req.body.enabled : !downtimeMode;
  res.json({ downtimeMode });
});

// POST /api/hcm/simulate/latency — set artificial latency
app.post('/api/hcm/simulate/latency', (req, res) => {
  latencyMs = req.body.ms || 0;
  res.json({ latencyMs });
});

// ========== Seed & Reset ==========

// POST /api/hcm/seed — seed balances
app.post('/api/hcm/seed', (req, res) => {
  const { entries } = req.body;
  // entries: [{ employeeId, locationId, leaveType, balanceDays }]

  for (const entry of (entries || [])) {
    const key = balanceKey(entry.employeeId, entry.locationId, entry.leaveType);
    balances.set(key, { balanceDays: entry.balanceDays });
  }

  res.json({ seeded: (entries || []).length, totalBalances: balances.size });
});

// DELETE /api/hcm/reset — reset everything
app.delete('/api/hcm/reset', (req, res) => {
  balances.clear();
  processedKeys.clear();
  errorMode = false;
  downtimeMode = false;
  latencyMs = 0;
  res.json({ message: 'HCM mock state reset' });
});

// GET /api/hcm/state — debug: view all state
app.get('/api/hcm/state', (req, res) => {
  const allBalances = {};
  for (const [key, value] of balances) {
    allBalances[key] = value;
  }
  res.json({
    balances: allBalances,
    processedKeys: Array.from(processedKeys),
    errorMode,
    downtimeMode,
    latencyMs,
  });
});

// ========== Start Server ==========
const PORT = process.env.PORT || 3001;

// Only start if not being required by tests
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mock HCM server running on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log('  GET    /api/hcm/balance/:empId/:locId/:leaveType');
    console.log('  POST   /api/hcm/deduct');
    console.log('  POST   /api/hcm/restore');
    console.log('  POST   /api/hcm/simulate/anniversary');
    console.log('  POST   /api/hcm/simulate/year-reset');
    console.log('  POST   /api/hcm/simulate/error-mode');
    console.log('  POST   /api/hcm/simulate/downtime');
    console.log('  POST   /api/hcm/simulate/latency');
    console.log('  POST   /api/hcm/seed');
    console.log('  DELETE /api/hcm/reset');
    console.log('  GET    /api/hcm/state');
  });
}

module.exports = app;
