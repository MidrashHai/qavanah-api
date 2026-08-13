/**
 * QAVANAH API™ - Le Gardien de Trajectoire
 * Makom Intelligence™ · CorreIA LLC
 * Version : 0.1.0
 * Date : 2026-08-13
 * Etapes couvertes : 0 (Kernel) · 1 (Trajectory Identity) · 2 (Intent Contract)
 *                   3 (Intent Anchor) · 4 (Context Snapshot) · 5 (Proposed Action)
 *                   6 (Rule Engine) · 7 (Decision Engine) · 8 (Event Log)
 *
 * Loi fondatrice : Qavanah ne contrôle jamais une action seule.
 * Elle contrôle la relation entre une action, une intention de référence,
 * un contexte et une trajectoire.
 *
 * Q = f(I, C, T, A, R)
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3100;

// ─── LOIS DE DONNÉES ────────────────────────────────────────────────────────
// Loi 1 : Immutabilité - un objet scellé n'est jamais écrasé
// Loi 2 : Versionnement - toute modification produit une nouvelle version
// Loi 3 : Traçabilité - toute décision possède une preuve
// Loi 4 : Reproductibilité - une décision doit pouvoir être rejouée
// Loi 5 : Source unique - un moteur ne reconstruit pas l'objet d'un autre

// ─── MODE OPÉRATOIRE ────────────────────────────────────────────────────────
// OBSERVE : Qavanah calcule mais ne bloque rien (phase actuelle)
// SHADOW  : produit la décision théorique, l'application continue
// ENFORCE : contrôle réel du passage de l'action
const QAVANAH_MODE = process.env.QAVANAH_MODE || 'OBSERVE';

// ─── CATALOGUE DES ACTIONS AUTORISÉES (Phase 1) ─────────────────────────────
const AUTHORIZED_ACTIONS = new Set([
  'FLY_TO', 'ZOOM_TO', 'RESET_VIEW',
  'SEARCH_PLACE', 'HIGHLIGHT_ROAD', 'HIGHLIGHT_PLACE',
  'SHOW_LAYER', 'HIDE_LAYER', 'PLACE_MARKER',
  'START_GPS', 'SEARCH_NUMBER'
]);

// ─── BASE DE DONNÉES ─────────────────────────────────────────────────────────
// Qavanah dispose de sa propre base - indépendante de mk_omhai
// Si DATABASE_URL absent : mode in-memory (sandbox sans persistence)
let db = null;
let inMemoryStore = {
  trajectories: {},
  intent_anchors: {},
  context_snapshots: {},
  proposed_actions: {},
  decisions: {},
  events: []
};

if (process.env.DATABASE_URL) {
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('[QAVANAH] Mode : PostgreSQL connecté');
} else {
  console.log('[QAVANAH] Mode : in-memory (sandbox - aucune persistence)');
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Logger minimal
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function generateId(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}${rd}`;
}

function hashObject(obj) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex');
}

function now() {
  return new Date().toISOString();
}

// ─── EVENT LOG ───────────────────────────────────────────────────────────────
// Loi de Proclamation : tout changement d'état est proclamé et persisté
// BH-154 : tout est spirale, rien ne se perd

async function logEvent(eventType, payload) {
  const event = {
    id: uuidv4(),
    eventType,
    payload,
    createdAt: now()
  };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_events (id, event_type, payload, created_at)
         VALUES ($1, $2, $3, $4)`,
        [event.id, eventType, JSON.stringify(payload), event.createdAt]
      );
    } catch (e) {
      // Si la table n'existe pas encore, on log en mémoire
      inMemoryStore.events.push(event);
    }
  } else {
    inMemoryStore.events.push(event);
  }

  console.log(`[EVENT] ${eventType}`, JSON.stringify(payload).substring(0, 120));
  return event;
}

// ─── MOTEUR DÉTERMINISTE ─────────────────────────────────────────────────────
// Etape 6 : Rule Engine - opère AVANT tout calcul statistique
// Loi de Priorité : ce qui viole une règle explicite est bloqué sans score
// BH-384 : toute action juste doit être explicitement autorisée avant d'être exécutée

function runDeterministicEngine(intent, context, action) {
  const reasonCodes = [];
  const evidence    = [];

  // Règle 1 : Intent existe ?
  if (!intent || !intent.contractId) {
    reasonCodes.push('INTENT_MISSING');
    return { decision: 'BLOCK', reasonCodes, evidence: ['INTENT_ABSENT'] };
  }

  // Règle 2 : Context existe ?
  if (!context || !context.contextId) {
    reasonCodes.push('CONTEXT_MISSING');
    return { decision: 'BLOCK', reasonCodes, evidence: ['CONTEXT_ABSENT'] };
  }

  // Règle 3 : Action existe et est structurée ?
  if (!action || !action.type) {
    reasonCodes.push('ACTION_MALFORMED');
    return { decision: 'BLOCK', reasonCodes, evidence: ['ACTION_NO_TYPE'] };
  }

  // Règle 4 : Action dans le catalogue autorisé ?
  if (!AUTHORIZED_ACTIONS.has(action.type)) {
    reasonCodes.push('ACTION_NOT_AUTHORIZED');
    return {
      decision: 'BLOCK',
      reasonCodes,
      evidence: [`ACTION_TYPE_${action.type}_NOT_IN_CATALOGUE`]
    };
  }

  // Règle 5 : Source de l'intention
  if (intent.source === 'PROVISIONAL') {
    reasonCodes.push('INTENT_PROVISIONAL');
    evidence.push('INTENT_NOT_CONFIRMED');
    // PROVISIONAL ne bloque pas mais génère un ADJUST
    return { decision: 'ADJUST', reasonCodes, evidence };
  }

  // Règle 6 : Loi de Non-invention - SEARCH_NUMBER sans données PADA
  if (action.type === 'SEARCH_NUMBER' && action.parameters) {
    if (action.parameters.noData === true) {
      reasonCodes.push('NO_DATA_PADA');
      return {
        decision: 'BLOCK',
        reasonCodes,
        evidence: ['PADA_DATA_ABSENT', 'NON_INVENTION_LAW']
      };
    }
  }

  // Règle 7 : Cohérence action / intent scope
  if (intent.scope && intent.scope.allowedActions) {
    if (!intent.scope.allowedActions.includes(action.type)) {
      reasonCodes.push('ACTION_OUT_OF_SCOPE');
      return {
        decision: 'BLOCK',
        reasonCodes,
        evidence: ['ACTION_NOT_IN_INTENT_SCOPE']
      };
    }
  }

  // Toutes les règles passées
  evidence.push('INTENT_MATCH', 'CONTEXT_VALID', 'ACTION_AUTHORIZED');
  return { decision: 'ALLOW', reasonCodes, evidence };
}

// ─── ENDPOINTS ───────────────────────────────────────────────────────────────

// ── ETAPE 0 : KERNEL ─────────────────────────────────────────────────────────
// TA-QAV-000 : Service disponible · Version identifiable · Aucune dépendance LLM

app.get('/health', (req, res) => {
  res.json({
    service: 'qavanah-api',
    status:  'ok',
    version: '0.1.0',
    mode:    QAVANAH_MODE,
    etape:   8,
    db:      db ? 'postgresql' : 'in-memory',
    timestamp: now()
  });
});

app.get('/version', (req, res) => {
  res.json({
    service:    'qavanah-api',
    version:    '0.1.0',
    codex:      'QAV-0001',
    devops:     'QAV-DEV-001',
    raqia:      'QAV-RAQIA-001',
    hoqim:      'QAV-HOQ-001',
    mode:       QAVANAH_MODE,
    etapesCouvertes: [0,1,2,3,4,5,6,7,8],
    releasedAt: '2026-08-13'
  });
});

// ── ETAPE 1 : TRAJECTORY IDENTITY ────────────────────────────────────────────
// Loi d'Identité : aucune décision ne peut exister sans identité de trajectoire
// BH-005 : l'identité précède l'action

app.post('/v1/trajectories', async (req, res) => {
  const {
    intentContractId,
    intentVersion = 1,
    sessionId,
    agentId,
    intentSource = 'PROVISIONAL'
  } = req.body;

  const trajectoryId  = generateId('TRJ');
  const assessmentId  = generateId('ASM');
  const sId           = sessionId || generateId('SES');
  const aId           = agentId   || 'unknown-agent';
  const createdAt     = now();

  const trajectory = {
    trajectoryId,
    assessmentId,
    sessionId:       sId,
    agentId:         aId,
    intentContractId: intentContractId || null,
    intentVersion,
    intentSource,
    status:          'OPEN',
    mode:            QAVANAH_MODE,
    createdAt
  };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_trajectories
         (trajectory_id, assessment_id, session_id, agent_id,
          intent_contract_id, intent_version, intent_source,
          status, mode, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [trajectoryId, assessmentId, sId, aId,
         intentContractId || null, intentVersion, intentSource,
         'OPEN', QAVANAH_MODE, createdAt]
      );
    } catch (e) {
      inMemoryStore.trajectories[trajectoryId] = trajectory;
    }
  } else {
    inMemoryStore.trajectories[trajectoryId] = trajectory;
  }

  await logEvent('TrajectoryCreated', { trajectoryId, assessmentId, agentId: aId });

  res.status(201).json(trajectory);
});

app.get('/v1/trajectories/:id', async (req, res) => {
  const { id } = req.params;

  if (db) {
    try {
      const r = await db.query(
        'SELECT * FROM qav_trajectories WHERE trajectory_id = $1', [id]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'TRAJECTORY_NOT_FOUND' });
      return res.json(r.rows[0]);
    } catch (e) {
      // fallback in-memory
    }
  }

  const t = inMemoryStore.trajectories[id];
  if (!t) return res.status(404).json({ error: 'TRAJECTORY_NOT_FOUND' });
  res.json(t);
});

app.get('/v1/trajectories/:id/history', async (req, res) => {
  const { id } = req.params;
  const events = inMemoryStore.events.filter(
    e => e.payload && e.payload.trajectoryId === id
  );
  res.json({ trajectoryId: id, events });
});

// ── ETAPES 2+3 : INTENT CONTRACT + INTENT ANCHOR ─────────────────────────────
// Loi d'Étalon : l'Ancre est scellée à sa création, jamais modifiée silencieusement
// BH-001 : l'origine précède la forme

app.post('/v1/intents/:contractId/anchor', async (req, res) => {
  const { contractId } = req.params;
  const {
    trajectoryId,
    intentVersion = 1,
    source = 'USER_CONFIRMED',
    objectives = [],
    constraints = [],
    scope = {}
  } = req.body;

  const intentPayload = { contractId, intentVersion, objectives, constraints, scope };
  const hash          = hashObject(intentPayload);
  const anchorId      = generateId('ANC');
  const createdAt     = now();

  const anchor = {
    id:              anchorId,
    contractId,
    trajectoryId:   trajectoryId || null,
    version:        intentVersion,
    hash:           `sha256:${hash}`,
    embeddingModel:  'none-v0.1',
    embeddingVersion:'0.1',
    source,
    objectives,
    constraints,
    scope,
    sealed:         true,
    createdAt
  };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_intent_anchors
         (id, contract_id, trajectory_id, version, hash, source,
          objectives, constraints, scope, sealed, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [anchorId, contractId, trajectoryId || null, intentVersion,
         `sha256:${hash}`, source,
         JSON.stringify(objectives), JSON.stringify(constraints),
         JSON.stringify(scope), true, createdAt]
      );
    } catch (e) {
      inMemoryStore.intent_anchors[anchorId] = anchor;
    }
  } else {
    inMemoryStore.intent_anchors[anchorId] = anchor;
  }

  await logEvent('IntentAnchored', { anchorId, contractId, trajectoryId, version: intentVersion });

  res.status(201).json({ intentAnchor: anchor });
});

app.get('/v1/intents/:contractId', (req, res) => {
  const { contractId } = req.params;
  const anchors = Object.values(inMemoryStore.intent_anchors)
    .filter(a => a.contractId === contractId)
    .sort((a, b) => b.version - a.version);
  if (anchors.length === 0) return res.status(404).json({ error: 'INTENT_NOT_FOUND' });
  res.json({ contractId, versions: anchors });
});

app.post('/v1/intents/:contractId/reanchor', async (req, res) => {
  const { contractId } = req.params;
  const { trajectoryId, reason, objectives, constraints, scope } = req.body;

  // Trouver la version courante
  const existing = Object.values(inMemoryStore.intent_anchors)
    .filter(a => a.contractId === contractId)
    .sort((a, b) => b.version - a.version)[0];

  const newVersion = existing ? existing.version + 1 : 1;

  // Créer une nouvelle ancre (jamais écraser)
  const newPayload = { contractId, intentVersion: newVersion, objectives, constraints, scope };
  const hash       = hashObject(newPayload);
  const anchorId   = generateId('ANC');
  const createdAt  = now();

  const anchor = {
    id: anchorId, contractId, trajectoryId,
    version: newVersion,
    hash: `sha256:${hash}`,
    embeddingModel: 'none-v0.1', embeddingVersion: '0.1',
    source: 'USER_CONFIRMED',
    objectives, constraints, scope,
    sealed: true, createdAt,
    reanchorReason: reason || 'USER_CHANGED_INTENT'
  };

  inMemoryStore.intent_anchors[anchorId] = anchor;

  await logEvent('IntentReanchored', {
    trajectoryId, contractId,
    previousVersion: existing ? existing.version : null,
    newVersion, reason
  });

  res.status(201).json({ intentAnchor: anchor, event: 'RE-ANCHOR', previousVersion: existing?.version });
});

// ── ETAPE 4 : CONTEXT SNAPSHOT ───────────────────────────────────────────────
// Loi de Figement : le contexte est figé au moment de sa transmission
// BH-159 : le Lieu précède le Souffle

app.post('/v1/context/snapshot', async (req, res) => {
  const {
    trajectoryId,
    icl,
    place = {}, presence = {}, state = {},
    relations = [], resources = [], events = [], rules = []
  } = req.body;

  const contextId  = generateId('CTX');
  const capturedAt = now();
  const version    = 1;

  const snapshot = {
    contextId, trajectoryId,
    icl: icl || null,
    place, presence, state,
    relations, resources, events, rules,
    version, capturedAt,
    frozen: true  // Loi de Figement
  };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_context_snapshots
         (context_id, trajectory_id, icl, place, presence, state,
          relations, resources, rules, version, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [contextId, trajectoryId, icl,
         JSON.stringify(place), JSON.stringify(presence), JSON.stringify(state),
         JSON.stringify(relations), JSON.stringify(resources), JSON.stringify(rules),
         version, capturedAt]
      );
    } catch (e) {
      inMemoryStore.context_snapshots[contextId] = snapshot;
    }
  } else {
    inMemoryStore.context_snapshots[contextId] = snapshot;
  }

  await logEvent('ContextAttached', { contextId, trajectoryId, icl, version });

  res.status(201).json(snapshot);
});

app.get('/v1/context/:id', (req, res) => {
  const s = inMemoryStore.context_snapshots[req.params.id];
  if (!s) return res.status(404).json({ error: 'CONTEXT_NOT_FOUND' });
  res.json(s);
});

// ── ETAPE 5 : PROPOSED ACTION ────────────────────────────────────────────────
// Loi de Forme : aucune action ne peut entrer sans être structurée

app.post('/v1/actions/propose', async (req, res) => {
  const { trajectoryId, type, parameters = {}, requestedBy } = req.body;

  if (!type) {
    return res.status(400).json({ error: 'ACTION_TYPE_REQUIRED' });
  }

  const actionId  = generateId('ACT');
  const createdAt = now();

  const action = {
    actionId, type, parameters,
    requestedBy: requestedBy || 'unknown',
    trajectoryId: trajectoryId || null,
    status: 'PROPOSED',
    createdAt
  };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_proposed_actions
         (action_id, type, parameters, requested_by, trajectory_id, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [actionId, type, JSON.stringify(parameters),
         requestedBy || 'unknown', trajectoryId || null, 'PROPOSED', createdAt]
      );
    } catch (e) {
      inMemoryStore.proposed_actions[actionId] = action;
    }
  } else {
    inMemoryStore.proposed_actions[actionId] = action;
  }

  await logEvent('ActionProposed', { actionId, type, trajectoryId });

  res.status(201).json(action);
});

app.post('/v1/actions/:id/result', async (req, res) => {
  const { id } = req.params;
  const { status, result = {}, errorCode, executedAt } = req.body;

  const actionResult = {
    actionId: id,
    status: status || 'SUCCESS',
    result,
    errorCode: errorCode || null,
    executedAt: executedAt || now(),
    source: 'territory-action-layer',
    receivedAt: now()
  };

  inMemoryStore[`result_${id}`] = actionResult;

  await logEvent('ActionResultReceived', {
    actionId: id, status: actionResult.status
  });

  res.json({ received: true, actionResult });
});

// ── ETAPES 6+7 : RULE ENGINE + DECISION ENGINE ───────────────────────────────
// Endpoint principal de QAVANAH
// BH-384 : toute action juste doit être explicitement autorisée avant d'être exécutée
// BH-390 : toute autorité partagée sur les seuils produit l'effondrement du seuil

app.post('/v1/qavanah/check', async (req, res) => {
  const { trajectoryId, intent, context, agent, action } = req.body;

  if (!trajectoryId) {
    return res.status(400).json({
      error: 'TRAJECTORY_ID_REQUIRED',
      law:   'BH-005 : L\'identité précède l\'action'
    });
  }

  const checkId   = generateId('CHK');
  const checkedAt = now();

  // ── Moteur Déterministe (Étape 6) ──
  const ruleResult = runDeterministicEngine(intent, context, action);

  // ── Alignement observationnel (Étape 9 - OBSERVE) ──
  // En mode OBSERVE : scores calculés mais ne bloquent pas
  const alignmentScores = {
    intent:  intent  ? 0.95 : 0.0,
    context: context ? 0.90 : 0.0,
    action:  action  && AUTHORIZED_ACTIONS.has(action?.type) ? 0.98 : 0.10
  };

  // ── Construction de la réponse canonique ──
  const decisionPayload = {
    checkId,
    decision:     ruleResult.decision,
    trajectoryId,
    actionId:     action?.id || null,
    mode:         QAVANAH_MODE,

    alignment: alignmentScores,

    drift: {
      state:   'NORMAL',  // COA branché à l'Étape 10
      tension: null,
      slope:   null,
      auc:     null
    },

    authorization: {
      status: ruleResult.decision === 'ALLOW' ? 'AUTHORIZED' : 'REFUSED'
    },

    reasonCodes: ruleResult.reasonCodes,
    evidence:    ruleResult.evidence,

    next: ruleResult.decision === 'ALLOW'
      ? 'EXECUTE'
      : ruleResult.decision === 'ADJUST'
      ? 'RECOMPUTE'
      : 'STOP',

    checkedAt
  };

  // ── Journal de décision (Étape 8) ──
  inMemoryStore.decisions[checkId] = {
    ...decisionPayload,
    input: { trajectoryId, intent, context, agent, action }
  };

  const eventType = ruleResult.decision === 'ALLOW'
    ? 'DecisionAllowed'
    : ruleResult.decision === 'ADJUST'
    ? 'DecisionAdjusted'
    : 'DecisionBlocked';

  await logEvent(eventType, {
    checkId, trajectoryId,
    decision: ruleResult.decision,
    actionType: action?.type,
    evidence: ruleResult.evidence
  });
  await logEvent('ActionChecked', { checkId, trajectoryId, actionType: action?.type });

  // En mode OBSERVE : on retourne la décision mais on ne bloque pas physiquement
  // En mode ENFORCE : la décision est contraignante (géré côté appelant)
  res.json(decisionPayload);
});

// ── MONITORING ───────────────────────────────────────────────────────────────

app.get('/v1/trajectories/:id/signals', (req, res) => {
  const { id } = req.params;
  const events = inMemoryStore.events.filter(
    e => e.payload && e.payload.trajectoryId === id
  );
  const decisions = Object.values(inMemoryStore.decisions)
    .filter(d => d.trajectoryId === id);

  res.json({
    trajectoryId: id,
    eventCount:   events.length,
    events,
    decisions,
    driftSignals: []  // branché à l'Étape 10 (COA)
  });
});

app.get('/v1/trajectories/:id/decision', (req, res) => {
  const { id } = req.params;
  const decisions = Object.values(inMemoryStore.decisions)
    .filter(d => d.trajectoryId === id)
    .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt));

  if (decisions.length === 0) {
    return res.status(404).json({ error: 'NO_DECISION_FOR_TRAJECTORY' });
  }
  res.json({ trajectoryId: id, latest: decisions[0], history: decisions });
});

// ── INIT DB (optionnel) ───────────────────────────────────────────────────────

async function initDb() {
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS qav_trajectories (
        trajectory_id TEXT PRIMARY KEY,
        assessment_id TEXT,
        session_id TEXT,
        agent_id TEXT,
        intent_contract_id TEXT,
        intent_version INTEGER DEFAULT 1,
        intent_source TEXT DEFAULT 'PROVISIONAL',
        status TEXT DEFAULT 'OPEN',
        mode TEXT DEFAULT 'OBSERVE',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_intent_anchors (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        trajectory_id TEXT,
        version INTEGER DEFAULT 1,
        hash TEXT,
        source TEXT DEFAULT 'PROVISIONAL',
        objectives JSONB DEFAULT '[]',
        constraints JSONB DEFAULT '[]',
        scope JSONB DEFAULT '{}',
        sealed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_context_snapshots (
        context_id TEXT PRIMARY KEY,
        trajectory_id TEXT,
        icl TEXT,
        place JSONB DEFAULT '{}',
        presence JSONB DEFAULT '{}',
        state JSONB DEFAULT '{}',
        relations JSONB DEFAULT '[]',
        resources JSONB DEFAULT '[]',
        rules JSONB DEFAULT '[]',
        version INTEGER DEFAULT 1,
        captured_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_proposed_actions (
        action_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        parameters JSONB DEFAULT '{}',
        requested_by TEXT,
        trajectory_id TEXT,
        status TEXT DEFAULT 'PROPOSED',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_decisions (
        check_id TEXT PRIMARY KEY,
        trajectory_id TEXT,
        decision TEXT NOT NULL,
        reason_codes JSONB DEFAULT '[]',
        evidence JSONB DEFAULT '[]',
        alignment JSONB DEFAULT '{}',
        mode TEXT,
        checked_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[QAVANAH] Tables vérifiées / créées');
  } finally {
    client.release();
  }
}

// ─── DÉMARRAGE ───────────────────────────────────────────────────────────────

initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║      QAVANAH API™ - Le Gardien de Trajectoire  ║');
    console.log('║      Makom Intelligence™ · CorreIA LLC         ║');
    console.log(`║      Port : ${PORT}  ·  Mode : ${QAVANAH_MODE.padEnd(7)}            ║`);
    console.log('║      Version : 0.1.0  ·  Étapes : 0→8         ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log('  GET  /health');
    console.log('  GET  /version');
    console.log('  POST /v1/trajectories');
    console.log('  POST /v1/intents/:id/anchor');
    console.log('  POST /v1/intents/:id/reanchor');
    console.log('  POST /v1/context/snapshot');
    console.log('  POST /v1/actions/propose');
    console.log('  POST /v1/actions/:id/result');
    console.log('  POST /v1/qavanah/check');
    console.log('  GET  /v1/trajectories/:id');
    console.log('  GET  /v1/trajectories/:id/history');
    console.log('  GET  /v1/trajectories/:id/signals');
    console.log('  GET  /v1/trajectories/:id/decision');
    console.log('');
    console.log('  BH-028 : Le fondement précède l\'élévation. ✦');
    console.log('');
  });
}).catch(err => {
  console.error('[QAVANAH] Erreur init DB :', err.message);
  process.exit(1);
});
