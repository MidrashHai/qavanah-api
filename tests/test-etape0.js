/**
 * QAVANAH API™ - Tests d'acceptation
 * TA-QAV-000 à TA-QAV-004
 * Etapes 0 à 8
 */

'use strict';

const http = require('http');

const BASE = process.env.QAVANAH_URL || 'http://localhost:3100';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.log(`  ✗  ${label}`);
    failed++;
  }
}

async function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function run() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  QAVANAH API™ - Tests d\'acceptation v0.1.0');
  console.log('  TA-QAV-000 → TA-QAV-004');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // ── TA-QAV-000 : Kernel ─────────────────────────────────────────────────
  console.log('── TA-QAV-000 · KERNEL ──');
  const health = await req('GET', '/health');
  assert(health.status === 200, 'GET /health → 200');
  assert(health.body.service === 'qavanah-api', 'service = qavanah-api');
  assert(health.body.status  === 'ok', 'status = ok');
  assert(health.body.version === '0.1.0', 'version = 0.1.0');
  assert(!health.body.llmDependency, 'aucune dépendance LLM déclarée');

  const version = await req('GET', '/version');
  assert(version.status === 200, 'GET /version → 200');
  assert(version.body.codex === 'QAV-0001', 'codex référencé');
  console.log('');

  // ── TA-QAV-001 : Trajectory Identity ────────────────────────────────────
  console.log('── TA-QAV-001 · TRAJECTORY IDENTITY ──');
  const trj = await req('POST', '/v1/trajectories', {
    intentContractId: 'IC-00001',
    intentVersion:    1,
    agentId:          'or-habayit',
    intentSource:     'USER_CONFIRMED'
  });
  assert(trj.status === 201, 'POST /v1/trajectories → 201');
  assert(trj.body.trajectoryId.startsWith('TRJ-'), 'trajectoryId format TRJ-*');
  assert(trj.body.assessmentId.startsWith('ASM-'), 'assessmentId format ASM-*');
  assert(trj.body.agentId === 'or-habayit', 'agentId correct');
  assert(trj.body.status === 'OPEN', 'status = OPEN');

  const TRJ_ID = trj.body.trajectoryId;

  const getTrj = await req('GET', `/v1/trajectories/${TRJ_ID}`);
  assert(getTrj.status === 200, `GET /v1/trajectories/${TRJ_ID} → 200`);
  assert(getTrj.body.trajectoryId === TRJ_ID, 'trajectoryId retrouvé');
  console.log('');

  // ── TA-QAV-002 : Intent Anchor ───────────────────────────────────────────
  console.log('── TA-QAV-002 · INTENT ANCHOR ──');
  const anchor = await req('POST', '/v1/intents/IC-00001/anchor', {
    trajectoryId: TRJ_ID,
    intentVersion: 1,
    source: 'USER_CONFIRMED',
    objectives: ['Rechercher et afficher Tano Atchimon'],
    scope: { allowedActions: ['SEARCH_PLACE', 'HIGHLIGHT_ROAD', 'FLY_TO'] }
  });
  assert(anchor.status === 201, 'POST /v1/intents/anchor → 201');
  assert(anchor.body.intentAnchor.sealed === true, 'ancre scellée');
  assert(anchor.body.intentAnchor.hash.startsWith('sha256:'), 'hash présent');
  assert(anchor.body.intentAnchor.version === 1, 'version = 1');

  const ANC_ID = anchor.body.intentAnchor.id;
  console.log('');

  // ── TA-QAV-003 : Context Snapshot ───────────────────────────────────────
  console.log('── TA-QAV-003 · CONTEXT SNAPSHOT ──');
  const ctx = await req('POST', '/v1/context/snapshot', {
    trajectoryId: TRJ_ID,
    icl: '1422|1032',
    place:   { name: 'Cocody', type: 'district' },
    state:   { mapZoom: 14, centerLat: 5.37, centerLon: -3.96 }
  });
  assert(ctx.status === 201, 'POST /v1/context/snapshot → 201');
  assert(ctx.body.contextId.startsWith('CTX-'), 'contextId format CTX-*');
  assert(ctx.body.icl === '1422|1032', 'ICL conservé');
  assert(ctx.body.frozen === true, 'contexte figé (Loi de Figement)');

  const CTX_ID = ctx.body.contextId;
  console.log('');

  // ── TA-QAV-004a : QAVANAH CHECK → ALLOW ─────────────────────────────────
  console.log('── TA-QAV-004a · QAVANAH CHECK → ALLOW ──');
  const chk1 = await req('POST', '/v1/qavanah/check', {
    trajectoryId: TRJ_ID,
    intent: {
      contractId: 'IC-00001',
      version:    1,
      anchorId:   ANC_ID,
      source:     'USER_CONFIRMED',
      scope:      { allowedActions: ['SEARCH_PLACE', 'HIGHLIGHT_ROAD', 'FLY_TO'] }
    },
    context: { contextId: CTX_ID, icl: '1422|1032', version: 1 },
    agent:   { id: 'or-habayit', model: 'claude-sonnet-4-6', step: 1 },
    action:  { id: 'ACT-TEST-01', type: 'SEARCH_PLACE', parameters: { query: 'Tano Atchimon' } }
  });
  assert(chk1.status === 200, 'POST /v1/qavanah/check → 200');
  assert(chk1.body.decision === 'ALLOW', 'décision = ALLOW (action conforme)');
  assert(chk1.body.next === 'EXECUTE', 'next = EXECUTE');
  assert(chk1.body.evidence.includes('ACTION_AUTHORIZED'), 'evidence : ACTION_AUTHORIZED');
  console.log('');

  // ── TA-QAV-004b : QAVANAH CHECK → BLOCK (action non autorisée) ───────────
  console.log('── TA-QAV-004b · QAVANAH CHECK → BLOCK ──');
  const chk2 = await req('POST', '/v1/qavanah/check', {
    trajectoryId: TRJ_ID,
    intent:  { contractId: 'IC-00001', version: 1, source: 'USER_CONFIRMED' },
    context: { contextId: CTX_ID, version: 1 },
    agent:   { id: 'or-habayit', step: 2 },
    action:  { type: 'DELETE_RESOURCE', parameters: {} }
  });
  assert(chk2.status === 200, 'POST /v1/qavanah/check → 200');
  assert(chk2.body.decision === 'BLOCK', 'décision = BLOCK (action non autorisée)');
  assert(chk2.body.next === 'STOP', 'next = STOP');
  assert(chk2.body.reasonCodes.includes('ACTION_NOT_AUTHORIZED'), 'reasonCode : ACTION_NOT_AUTHORIZED');
  console.log('');

  // ── TA-QAV-004c : QAVANAH CHECK → BLOCK (intent absent) ──────────────────
  console.log('── TA-QAV-004c · QAVANAH CHECK → BLOCK (intent absent) ──');
  const chk3 = await req('POST', '/v1/qavanah/check', {
    trajectoryId: TRJ_ID,
    intent:  null,
    context: { contextId: CTX_ID, version: 1 },
    agent:   { id: 'or-habayit', step: 3 },
    action:  { type: 'SEARCH_PLACE', parameters: { query: 'test' } }
  });
  assert(chk3.body.decision === 'BLOCK', 'décision = BLOCK (intent null)');
  assert(chk3.body.reasonCodes.includes('INTENT_MISSING'), 'reasonCode : INTENT_MISSING');
  console.log('');

  // ── TA-QAV-004d : Loi de Non-invention ───────────────────────────────────
  console.log('── TA-QAV-004d · LOI DE NON-INVENTION ──');
  const chk4 = await req('POST', '/v1/qavanah/check', {
    trajectoryId: TRJ_ID,
    intent:  { contractId: 'IC-00001', version: 1, source: 'USER_CONFIRMED' },
    context: { contextId: CTX_ID, version: 1 },
    agent:   { id: 'or-habayit', step: 4 },
    action:  { type: 'SEARCH_NUMBER', parameters: { query: '42', noData: true } }
  });
  assert(chk4.body.decision === 'BLOCK', 'décision = BLOCK (donnée PADA absente)');
  assert(chk4.body.reasonCodes.includes('NO_DATA_PADA'), 'reasonCode : NO_DATA_PADA');
  assert(chk4.body.evidence.includes('NON_INVENTION_LAW'), 'evidence : NON_INVENTION_LAW');
  console.log('');

  // ── Historique de trajectoire ─────────────────────────────────────────────
  console.log('── JOURNAL DE TRAJECTOIRE ──');
  const hist = await req('GET', `/v1/trajectories/${TRJ_ID}/history`);
  assert(hist.status === 200, 'GET /history → 200');
  assert(hist.body.events.length > 0, 'événements enregistrés');
  console.log('');

  // ── Résultat ─────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Résultat : ${passed} ✓  /  ${failed} ✗`);
  if (failed === 0) {
    console.log('  TA-QAV-000 → 004 : TOUS PASSÉS ✦');
    console.log('  Étape 0 à 8 : VALIDÉES');
  } else {
    console.log(`  ${failed} test(s) échoué(s) - vérifier les logs`);
  }
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('[TEST] Erreur :', err.message);
  console.error('  → Le service est-il démarré ? node src/server.js');
  process.exit(1);
});
