/**
 * QAVANAH API™ - Le Gardien de Trajectoire
 * Makom Intelligence™ · CorreIA LLC
 * Version : 0.2.0
 * Date : 2026-08-13
 * Correction : Ajout module Zera haMakom™ (ZM-DEV-001)
 *
 * Étapes couvertes : 0→8 (Kernel → Event Log)
 * Module ajouté   : Zera haMakom™ · couche antérieure de formation du Lieu
 *
 * Loi fondatrice : Qavanah ne contrôle jamais une action seule.
 * Q = f(I, C, T, A, R, Z)
 * Z = Place Seed · Zera haMakom™
 *
 * Loi de Zera : Ne jamais demander au système ce que le Lieu doit devenir.
 * Commencer par lire ce qu'il porte déjà. ZM-DEV-001 §34
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3100;

// ─── MODE OPÉRATOIRE ────────────────────────────────────────────────────────
const QAVANAH_MODE = process.env.QAVANAH_MODE || 'OBSERVE';

// ─── CATALOGUE DES ACTIONS AUTORISÉES (Phase 1) ─────────────────────────────
const AUTHORIZED_ACTIONS = new Set([
  'FLY_TO', 'ZOOM_TO', 'RESET_VIEW',
  'SEARCH_PLACE', 'HIGHLIGHT_ROAD', 'HIGHLIGHT_PLACE',
  'SHOW_LAYER', 'HIDE_LAYER', 'PLACE_MARKER',
  'START_GPS', 'SEARCH_NUMBER'
]);

// ─── BASE DE DONNÉES ─────────────────────────────────────────────────────────
let db = null;
let inMemoryStore = {
  trajectories:      {},
  intent_anchors:    {},
  context_snapshots: {},
  proposed_actions:  {},
  decisions:         {},
  place_seeds:       {},   // ← ZERA haMakom™
  events:            []
};

if (process.env.DATABASE_URL) {
  db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('[QAVANAH] Mode : PostgreSQL connecté');
} else {
  console.log('[QAVANAH] Mode : in-memory (sandbox)');
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
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
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function now() { return new Date().toISOString(); }

// ─── EVENT LOG ───────────────────────────────────────────────────────────────
// Loi de Proclamation : tout changement d'état est proclamé et persisté

async function logEvent(eventType, payload) {
  const event = { id: uuidv4(), eventType, payload, createdAt: now() };
  if (db) {
    try {
      await db.query(
        'INSERT INTO qav_events (id, event_type, payload, created_at) VALUES ($1,$2,$3,$4)',
        [event.id, eventType, JSON.stringify(payload), event.createdAt]
      );
    } catch { inMemoryStore.events.push(event); }
  } else {
    inMemoryStore.events.push(event);
  }
  console.log(`[EVENT] ${eventType}`, JSON.stringify(payload).substring(0, 100));
  return event;
}

// ─── MOTEUR DÉTERMINISTE ─────────────────────────────────────────────────────
// Étape 6 · BH-384 · opère AVANT tout calcul statistique

function runDeterministicEngine(intent, context, action) {
  const reasonCodes = [];
  const evidence    = [];

  if (!intent || !intent.contractId) {
    reasonCodes.push('INTENT_MISSING');
    return { decision: 'BLOCK', reasonCodes, evidence: ['INTENT_ABSENT'] };
  }
  if (!context || !context.contextId) {
    reasonCodes.push('CONTEXT_MISSING');
    return { decision: 'BLOCK', reasonCodes, evidence: ['CONTEXT_ABSENT'] };
  }
  if (!action || !action.type) {
    reasonCodes.push('ACTION_MALFORMED');
    return { decision: 'BLOCK', reasonCodes, evidence: ['ACTION_NO_TYPE'] };
  }
  if (!AUTHORIZED_ACTIONS.has(action.type)) {
    reasonCodes.push('ACTION_NOT_AUTHORIZED');
    return { decision: 'BLOCK', reasonCodes, evidence: [`ACTION_TYPE_${action.type}_NOT_IN_CATALOGUE`] };
  }
  if (intent.source === 'PROVISIONAL') {
    reasonCodes.push('INTENT_PROVISIONAL');
    evidence.push('INTENT_NOT_CONFIRMED');
    return { decision: 'ADJUST', reasonCodes, evidence };
  }
  if (action.type === 'SEARCH_NUMBER' && action.parameters && action.parameters.noData === true) {
    reasonCodes.push('NO_DATA_PADA');
    return { decision: 'BLOCK', reasonCodes, evidence: ['PADA_DATA_ABSENT', 'NON_INVENTION_LAW'] };
  }
  if (intent.scope && intent.scope.allowedActions && !intent.scope.allowedActions.includes(action.type)) {
    reasonCodes.push('ACTION_OUT_OF_SCOPE');
    return { decision: 'BLOCK', reasonCodes, evidence: ['ACTION_NOT_IN_INTENT_SCOPE'] };
  }

  // ── Contrôle Zera : compatibilité avec la structure constitutive du Lieu ──
  // ZM-DEV-001 §16 : Zera enrichit le référentiel, ne décide pas
  if (context.zera && context.zera.state === 'FORMED') {
    evidence.push('ZERA_CONTEXT_PRESENT');
    // En mode OBSERVE : Zera est tracé mais ne bloque pas encore
    // À calibrer expérimentalement (BH-068)
  }

  evidence.push('INTENT_MATCH', 'CONTEXT_VALID', 'ACTION_AUTHORIZED');
  return { decision: 'ALLOW', reasonCodes, evidence };
}

// ─── MODULE ZERA HAMAKOM™ ─────────────────────────────────────────────────────
// ZM-DEV-001 · Couche antérieure de formation du Lieu
// Loi : ZERA → FORMATION → LIEU → PCNT → ICL → AYIN → CONTEXT → BETOKH/QAVANAH/TAL
// Loi d'Immutabilité de la graine : jamais d'UPDATE, toujours une nouvelle version

function buildZeraId(icl) {
  // Format canonique : ZM-{icl sans pipe}
  return `ZM-${(icl || 'unknown').replace('|', '-')}`;
}

function computeSpatialSignature(lat, lon) {
  if (!lat || !lon) return null;
  return {
    latitude:   parseFloat(lat),
    longitude:  parseFloat(lon),
    quadrant:   lat >= 0 ? (lon >= 0 ? 'NE' : 'NW') : (lon >= 0 ? 'SE' : 'SW'),
    resolution: 'PCNT_v3_1'
  };
}

function buildZeraSeed({ icl, lat, lon, territory, place, voies, relations, observed }) {
  const zeraId      = buildZeraId(icl);
  const seedVersion = 1;
  const createdAt   = now();

  // Les quatre signatures constitutives (ZM-DEV-001 §7)
  const spatial_signature = computeSpatialSignature(lat, lon);

  const structural_signature = {
    road_access:       voies && voies.length > 0,
    boundary_detected: place ? true : false,
    thresholds:        voies ? voies.length : 0,
    place_type:        place ? (place.type || 'unknown') : null
  };

  const relational_signature = {
    connected_roads:  voies ? voies.length : 0,
    connected_places: relations ? relations.length : 0,
    territory:        territory || null
  };

  const territorial_signature = {
    zone:      territory || null,
    territory: 'abidjan',
    icl:       icl || null
  };

  // Distinction obligatoire observed / inferred (ZM-DEV-001 §7)
  const observed_features  = observed || {};
  const inferred_features  = {};  // jamais rempli sans données réelles

  return {
    id:            `${zeraId}-v${seedVersion}`,
    zera_id:       zeraId,
    icl:           icl || null,
    seed_version:  seedVersion,
    source_type:   'GPS_PCNT',
    source_ref:    icl,
    place_candidate_id: icl,

    spatial_signature,
    structural_signature,
    relational_signature,
    territorial_signature,

    observed_features,
    inferred_features,

    formation_state: 'FORMED',
    confidence:      spatial_signature ? 1.0 : 0.5,
    evidence_refs:   ['PCNT_v3_1', 'PADA_COCODY'],

    created_at:  createdAt,
    valid_from:  createdAt,
    valid_until: null,
    status:      'ACTIVE'
  };
}

// ─── ENDPOINTS KERNEL ─────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    service:   'qavanah-api',
    status:    'ok',
    version:   '0.2.0',
    mode:      QAVANAH_MODE,
    etape:     9,
    modules:   ['kernel', 'trajectory', 'intent', 'context', 'action', 'rule-engine',
                'decision-engine', 'event-log', 'zera-hamakom'],
    db:        db ? 'postgresql' : 'in-memory',
    timestamp: now()
  });
});

app.get('/version', (req, res) => {
  res.json({
    service:    'qavanah-api',
    version:    '0.2.0',
    codex:      'QAV-0001',
    devops:     'QAV-DEV-001',
    zera:       'ZM-DEV-001',
    raqia:      'QAV-RAQIA-001',
    hoqim:      'QAV-HOQ-001',
    mode:       QAVANAH_MODE,
    formula:    'Q = f(I, C, T, A, R, Z)',
    etapesCouvertes: [0,1,2,3,4,5,6,7,8,'ZM'],
    releasedAt: '2026-08-13'
  });
});

// ─── TRAJECTOIRES ────────────────────────────────────────────────────────────

app.post('/v1/trajectories', async (req, res) => {
  const { intentContractId, intentVersion = 1, sessionId, agentId, intentSource = 'PROVISIONAL' } = req.body;
  const trajectoryId = generateId('TRJ');
  const assessmentId = generateId('ASM');
  const sId = sessionId || generateId('SES');
  const aId = agentId   || 'unknown-agent';
  const createdAt = now();

  const trajectory = { trajectoryId, assessmentId, sessionId: sId, agentId: aId,
    intentContractId: intentContractId || null, intentVersion, intentSource,
    status: 'OPEN', mode: QAVANAH_MODE, createdAt };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_trajectories
         (trajectory_id, assessment_id, session_id, agent_id, intent_contract_id,
          intent_version, intent_source, status, mode, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [trajectoryId, assessmentId, sId, aId, intentContractId || null,
         intentVersion, intentSource, 'OPEN', QAVANAH_MODE, createdAt]
      );
    } catch { inMemoryStore.trajectories[trajectoryId] = trajectory; }
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
      const r = await db.query('SELECT * FROM qav_trajectories WHERE trajectory_id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'TRAJECTORY_NOT_FOUND' });
      return res.json(r.rows[0]);
    } catch {}
  }
  const t = inMemoryStore.trajectories[id];
  if (!t) return res.status(404).json({ error: 'TRAJECTORY_NOT_FOUND' });
  res.json(t);
});

app.get('/v1/trajectories/:id/history', (req, res) => {
  const { id } = req.params;
  const events = inMemoryStore.events.filter(e => e.payload && e.payload.trajectoryId === id);
  res.json({ trajectoryId: id, events });
});

// ─── INTENT ANCHOR ───────────────────────────────────────────────────────────

app.post('/v1/intents/:contractId/anchor', async (req, res) => {
  const { contractId } = req.params;
  const { trajectoryId, intentVersion = 1, source = 'USER_CONFIRMED', objectives = [], constraints = [], scope = {} } = req.body;

  const intentPayload = { contractId, intentVersion, objectives, constraints, scope };
  const hash    = hashObject(intentPayload);
  const anchorId = generateId('ANC');
  const createdAt = now();

  const anchor = { id: anchorId, contractId, trajectoryId: trajectoryId || null,
    version: intentVersion, hash: `sha256:${hash}`, embeddingModel: 'none-v0.1',
    embeddingVersion: '0.1', source, objectives, constraints, scope,
    sealed: true, createdAt };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_intent_anchors
         (id, contract_id, trajectory_id, version, hash, source, objectives, constraints, scope, sealed, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [anchorId, contractId, trajectoryId || null, intentVersion, `sha256:${hash}`,
         source, JSON.stringify(objectives), JSON.stringify(constraints), JSON.stringify(scope), true, createdAt]
      );
    } catch { inMemoryStore.intent_anchors[anchorId] = anchor; }
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
  const existing = Object.values(inMemoryStore.intent_anchors)
    .filter(a => a.contractId === contractId).sort((a, b) => b.version - a.version)[0];
  const newVersion = existing ? existing.version + 1 : 1;
  const hash    = hashObject({ contractId, intentVersion: newVersion, objectives, constraints, scope });
  const anchorId = generateId('ANC');
  const createdAt = now();
  const anchor = { id: anchorId, contractId, trajectoryId, version: newVersion,
    hash: `sha256:${hash}`, embeddingModel: 'none-v0.1', embeddingVersion: '0.1',
    source: 'USER_CONFIRMED', objectives, constraints, scope,
    sealed: true, createdAt, reanchorReason: reason || 'USER_CHANGED_INTENT' };
  inMemoryStore.intent_anchors[anchorId] = anchor;
  await logEvent('IntentReanchored', { trajectoryId, contractId, previousVersion: existing?.version, newVersion, reason });
  res.status(201).json({ intentAnchor: anchor, event: 'RE-ANCHOR', previousVersion: existing?.version });
});

// ─── CONTEXT SNAPSHOT ────────────────────────────────────────────────────────
// Enrichi du champ zera (ZM-DEV-001 §14)

app.post('/v1/context/snapshot', async (req, res) => {
  const { trajectoryId, icl, place = {}, presence = {}, state = {},
    relations = [], resources = [], events = [], rules = [],
    zera = null  // ← nouveau champ : structure constitutive du Lieu
  } = req.body;

  const contextId  = generateId('CTX');
  const capturedAt = now();

  // Si zera non fourni mais ICL présent → tenter de récupérer depuis le store
  let zeraData = zera;
  if (!zeraData && icl) {
    const zeraId = buildZeraId(icl);
    const storedZera = Object.values(inMemoryStore.place_seeds)
      .find(z => z.zera_id === zeraId && z.status === 'ACTIVE');
    if (storedZera) zeraData = storedZera;
  }

  const snapshot = { contextId, trajectoryId,
    icl: icl || null,
    place, presence, state, relations, resources, events, rules,
    zera: zeraData,        // ← Zera attaché au snapshot
    version: 1, capturedAt,
    frozen: true
  };

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_context_snapshots
         (context_id, trajectory_id, icl, place, presence, state,
          relations, resources, rules, zera, version, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [contextId, trajectoryId, icl,
         JSON.stringify(place), JSON.stringify(presence), JSON.stringify(state),
         JSON.stringify(relations), JSON.stringify(resources), JSON.stringify(rules),
         JSON.stringify(zeraData), 1, capturedAt]
      );
    } catch { inMemoryStore.context_snapshots[contextId] = snapshot; }
  } else {
    inMemoryStore.context_snapshots[contextId] = snapshot;
  }

  await logEvent('ContextAttached', { contextId, trajectoryId, icl, version: 1, zeraAttached: !!zeraData });
  res.status(201).json(snapshot);
});

app.get('/v1/context/:id', (req, res) => {
  const s = inMemoryStore.context_snapshots[req.params.id];
  if (!s) return res.status(404).json({ error: 'CONTEXT_NOT_FOUND' });
  res.json(s);
});

// ─── PROPOSED ACTION ─────────────────────────────────────────────────────────

app.post('/v1/actions/propose', async (req, res) => {
  const { trajectoryId, type, parameters = {}, requestedBy } = req.body;
  if (!type) return res.status(400).json({ error: 'ACTION_TYPE_REQUIRED' });
  const actionId  = generateId('ACT');
  const createdAt = now();
  const action = { actionId, type, parameters, requestedBy: requestedBy || 'unknown',
    trajectoryId: trajectoryId || null, status: 'PROPOSED', createdAt };
  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_proposed_actions (action_id, type, parameters, requested_by, trajectory_id, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [actionId, type, JSON.stringify(parameters), requestedBy || 'unknown', trajectoryId || null, 'PROPOSED', createdAt]
      );
    } catch { inMemoryStore.proposed_actions[actionId] = action; }
  } else {
    inMemoryStore.proposed_actions[actionId] = action;
  }
  await logEvent('ActionProposed', { actionId, type, trajectoryId });
  res.status(201).json(action);
});

app.post('/v1/actions/:id/result', async (req, res) => {
  const { id } = req.params;
  const { status, result = {}, errorCode, executedAt } = req.body;
  const actionResult = { actionId: id, status: status || 'SUCCESS', result,
    errorCode: errorCode || null, executedAt: executedAt || now(),
    source: 'territory-action-layer', receivedAt: now() };
  inMemoryStore[`result_${id}`] = actionResult;
  await logEvent('ActionResultReceived', { actionId: id, status: actionResult.status });
  res.json({ received: true, actionResult });
});

// ─── ZERA HAMAKOM™ ENDPOINTS ─────────────────────────────────────────────────
// ZM-DEV-001 §11 · §12 · §24
// Loi d'antériorité : ZERA → PLACE → ICL → AYIN → CONTEXT (jamais l'inverse)
// Loi d'immutabilité : la graine originelle n'est jamais écrasée

// POST /v1/zera/form · Former la graine d'un Lieu depuis ses données constitutives
app.post('/v1/zera/form', async (req, res) => {
  const { source, territory, icl, place, voies, relations, observed } = req.body;

  if (!source || (!source.latitude && !icl)) {
    return res.status(400).json({
      error: 'SOURCE_REQUIRED',
      law: 'ZM-DEV-001 §13 : la coordonnée ou l\'ICL est requis pour former la graine'
    });
  }

  const lat = source.latitude;
  const lon = source.longitude;
  const seed = buildZeraSeed({ icl, lat, lon, territory, place, voies, relations, observed });

  // Loi d'immutabilité : vérifier si une graine v1 existe déjà pour cet ICL
  const existing = icl
    ? Object.values(inMemoryStore.place_seeds).find(z => z.zera_id === buildZeraId(icl) && z.seed_version === 1)
    : null;

  if (existing) {
    // Ne jamais écraser · créer une nouvelle version (ZM-DEV-001 §21)
    const newVersion = Math.max(...Object.values(inMemoryStore.place_seeds)
      .filter(z => z.zera_id === buildZeraId(icl))
      .map(z => z.seed_version)) + 1;

    const updatedSeed = { ...seed,
      id: `${buildZeraId(icl)}-v${newVersion}`,
      seed_version: newVersion,
      created_at: now()
    };
    inMemoryStore.place_seeds[updatedSeed.id] = updatedSeed;
    await logEvent('PlaceSeedUpdated', { zeraId: updatedSeed.zera_id, icl, version: newVersion });
    return res.status(201).json({ zera: updatedSeed, event: 'UPDATED', previousVersion: 1 });
  }

  // Première formation
  inMemoryStore.place_seeds[seed.id] = seed;

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_place_seeds
         (id, zera_id, icl, seed_version, source_type, source_ref,
          place_candidate_id, spatial_signature, structural_signature,
          relational_signature, territorial_signature,
          observed_features, inferred_features,
          formation_state, confidence, evidence_refs,
          created_at, valid_from, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [seed.id, seed.zera_id, seed.icl, seed.seed_version,
         seed.source_type, seed.source_ref, seed.place_candidate_id,
         JSON.stringify(seed.spatial_signature), JSON.stringify(seed.structural_signature),
         JSON.stringify(seed.relational_signature), JSON.stringify(seed.territorial_signature),
         JSON.stringify(seed.observed_features), JSON.stringify(seed.inferred_features),
         seed.formation_state, seed.confidence, JSON.stringify(seed.evidence_refs),
         seed.created_at, seed.valid_from, seed.status]
      );
    } catch (e) {
      // déjà en mémoire
      console.log('[ZERA] DB insert fallback:', e.message);
    }
  }

  await logEvent('PlaceSeedDetected', { zeraId: seed.zera_id, icl, version: 1 });
  await logEvent('PlaceFormationCompleted', { zeraId: seed.zera_id, icl, state: 'FORMED' });

  res.status(201).json({ zera: seed, event: 'FORMED' });
});

// GET /v1/zera/:icl · Lire la graine d'un Lieu par son ICL
app.get('/v1/zera/:icl', async (req, res) => {
  const icl = req.params.icl;
  const zeraId = buildZeraId(icl);

  if (db) {
    try {
      const r = await db.query(
        'SELECT * FROM qav_place_seeds WHERE zera_id = $1 AND status = $2 ORDER BY seed_version DESC',
        [zeraId, 'ACTIVE']
      );
      if (r.rows.length > 0) {
        return res.json({ icl, zera: r.rows[0], versions: r.rows });
      }
    } catch {}
  }

  const seeds = Object.values(inMemoryStore.place_seeds)
    .filter(z => z.zera_id === zeraId)
    .sort((a, b) => b.seed_version - a.seed_version);

  if (seeds.length === 0) {
    return res.status(404).json({
      error: 'ZERA_NOT_FOUND',
      icl,
      hint: 'POST /v1/zera/form pour former la graine de ce Lieu'
    });
  }

  res.json({ icl, zera: seeds[0], versions: seeds });
});

// GET /v1/zera/:icl/compare · Comparer Zera(t0) avec le contexte actuel Ayin(t1)
// ZM-DEV-001 §24 · §15
app.get('/v1/zera/:icl/compare', async (req, res) => {
  const icl = req.params.icl;
  const { seed_version = 1, context_id } = req.query;
  const zeraId = buildZeraId(icl);

  // Récupérer la graine de référence
  const seed = Object.values(inMemoryStore.place_seeds)
    .find(z => z.zera_id === zeraId && z.seed_version === parseInt(seed_version));

  if (!seed) {
    return res.status(404).json({ error: 'SEED_NOT_FOUND', icl, seed_version });
  }

  // Récupérer le contexte actuel si fourni
  const currentCtx = context_id ? inMemoryStore.context_snapshots[context_id] : null;

  // Comparaison constitutive (ZM-DEV-001 §23 : ne pas confondre transformation et rupture)
  // Scores observationnels uniquement — pas d'invention (BH-068 : mesure expérimentale)
  const comparison = {
    continuity:     currentCtx ? 0.91 : null,  // calibrage empirique requis
    transformation: currentCtx ? 0.08 : null,
    rupture:        currentCtx ? 0.01 : null,
    note:           'MODE_OBSERVE · scores expérimentaux non calibrés'
  };

  const formation = {
    seed_state:   seed.formation_state,
    seed_version: seed.seed_version,
    seed_at:      seed.created_at
  };

  const current = currentCtx ? {
    context_snapshot: context_id,
    timestamp:        currentCtx.capturedAt,
    icl:              currentCtx.icl
  } : null;

  await logEvent('PlaceFormationCompared', { zeraId, icl, seed_version, context_id });

  res.json({
    icl,
    formation,
    current,
    comparison,
    evidence: seed.evidence_refs
  });
});

// ─── QAVANAH CHECK ───────────────────────────────────────────────────────────
// Q = f(I, C, T, A, R, Z) · ZM-DEV-001 §16

app.post('/v1/qavanah/check', async (req, res) => {
  const { trajectoryId, intent, context, agent, action } = req.body;

  if (!trajectoryId) {
    return res.status(400).json({ error: 'TRAJECTORY_ID_REQUIRED', law: 'BH-005' });
  }

  const checkId   = generateId('CHK');
  const checkedAt = now();

  // Moteur Déterministe (Étape 6) — enrichi de Zera
  const ruleResult = runDeterministicEngine(intent, context, action);

  // Alignement observationnel (OBSERVE)
  const alignmentScores = {
    intent:  intent  ? 0.95 : 0.0,
    context: context ? 0.90 : 0.0,
    action:  action && AUTHORIZED_ACTIONS.has(action?.type) ? 0.98 : 0.10,
    zera:    context && context.zera ? 0.92 : null  // ← score Zera (expérimental)
  };

  // Zera constitutif disponible dans le contexte ?
  const zeraRef = context && context.zera ? {
    zeraId:       context.zera.zera_id || null,
    seedVersion:  context.zera.seed_version || null,
    state:        context.zera.formation_state || null,
    present:      true
  } : { present: false };

  const decisionPayload = {
    checkId,
    decision:     ruleResult.decision,
    trajectoryId,
    actionId:     action?.id || null,
    mode:         QAVANAH_MODE,

    alignment: alignmentScores,

    zera: zeraRef,  // ← référence Zera dans la réponse Qavanah

    drift: { state: 'NORMAL', tension: null, slope: null, auc: null },

    authorization: {
      status: ruleResult.decision === 'ALLOW' ? 'AUTHORIZED' : 'REFUSED'
    },

    reasonCodes: ruleResult.reasonCodes,
    evidence:    ruleResult.evidence,

    next: ruleResult.decision === 'ALLOW' ? 'EXECUTE'
        : ruleResult.decision === 'ADJUST' ? 'RECOMPUTE'
        : 'STOP',

    checkedAt
  };

  inMemoryStore.decisions[checkId] = {
    ...decisionPayload,
    input: { trajectoryId, intent, context, agent, action }
  };

  const eventType = ruleResult.decision === 'ALLOW' ? 'DecisionAllowed'
    : ruleResult.decision === 'ADJUST' ? 'DecisionAdjusted' : 'DecisionBlocked';

  await logEvent(eventType, { checkId, trajectoryId, decision: ruleResult.decision, actionType: action?.type });
  await logEvent('ActionChecked', { checkId, trajectoryId, actionType: action?.type });

  res.json(decisionPayload);
});

// ─── MONITORING ──────────────────────────────────────────────────────────────

app.get('/v1/trajectories/:id/signals', (req, res) => {
  const { id } = req.params;
  const events    = inMemoryStore.events.filter(e => e.payload && e.payload.trajectoryId === id);
  const decisions = Object.values(inMemoryStore.decisions).filter(d => d.trajectoryId === id);
  res.json({ trajectoryId: id, eventCount: events.length, events, decisions, driftSignals: [] });
});

app.get('/v1/trajectories/:id/decision', (req, res) => {
  const { id } = req.params;
  const decisions = Object.values(inMemoryStore.decisions)
    .filter(d => d.trajectoryId === id)
    .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt));
  if (decisions.length === 0) return res.status(404).json({ error: 'NO_DECISION_FOR_TRAJECTORY' });
  res.json({ trajectoryId: id, latest: decisions[0], history: decisions });
});

// ─── INIT DB ─────────────────────────────────────────────────────────────────

async function initDb() {
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS qav_trajectories (
        trajectory_id TEXT PRIMARY KEY,
        assessment_id TEXT, session_id TEXT, agent_id TEXT,
        intent_contract_id TEXT, intent_version INTEGER DEFAULT 1,
        intent_source TEXT DEFAULT 'PROVISIONAL',
        status TEXT DEFAULT 'OPEN', mode TEXT DEFAULT 'OBSERVE',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_intent_anchors (
        id TEXT PRIMARY KEY, contract_id TEXT NOT NULL,
        trajectory_id TEXT, version INTEGER DEFAULT 1,
        hash TEXT, source TEXT DEFAULT 'PROVISIONAL',
        objectives JSONB DEFAULT '[]', constraints JSONB DEFAULT '[]',
        scope JSONB DEFAULT '{}', sealed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_context_snapshots (
        context_id TEXT PRIMARY KEY, trajectory_id TEXT,
        icl TEXT, place JSONB DEFAULT '{}', presence JSONB DEFAULT '{}',
        state JSONB DEFAULT '{}', relations JSONB DEFAULT '[]',
        resources JSONB DEFAULT '[]', rules JSONB DEFAULT '[]',
        zera JSONB DEFAULT NULL,
        version INTEGER DEFAULT 1, captured_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_proposed_actions (
        action_id TEXT PRIMARY KEY, type TEXT NOT NULL,
        parameters JSONB DEFAULT '{}', requested_by TEXT,
        trajectory_id TEXT, status TEXT DEFAULT 'PROPOSED',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_decisions (
        check_id TEXT PRIMARY KEY, trajectory_id TEXT,
        decision TEXT NOT NULL, reason_codes JSONB DEFAULT '[]',
        evidence JSONB DEFAULT '[]', alignment JSONB DEFAULT '{}',
        mode TEXT, checked_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_events (
        id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
        payload JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qav_place_seeds (
        id TEXT PRIMARY KEY,
        zera_id TEXT NOT NULL,
        icl TEXT,
        seed_version INTEGER DEFAULT 1,
        source_type TEXT,
        source_ref TEXT,
        place_candidate_id TEXT,
        spatial_signature JSONB DEFAULT '{}',
        structural_signature JSONB DEFAULT '{}',
        relational_signature JSONB DEFAULT '{}',
        territorial_signature JSONB DEFAULT '{}',
        observed_features JSONB DEFAULT '{}',
        inferred_features JSONB DEFAULT '{}',
        formation_state TEXT DEFAULT 'FORMED',
        confidence NUMERIC DEFAULT 1.0,
        evidence_refs JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        valid_from TIMESTAMPTZ DEFAULT NOW(),
        valid_until TIMESTAMPTZ DEFAULT NULL,
        status TEXT DEFAULT 'ACTIVE'
      );

      ALTER TABLE qav_context_snapshots
        ADD COLUMN IF NOT EXISTS zera JSONB DEFAULT NULL;
    `);
    console.log('[QAVANAH] Tables vérifiées / créées (incl. qav_place_seeds)');
  } finally {
    client.release();
  }
}

// ─── DÉMARRAGE ───────────────────────────────────────────────────────────────

initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║   QAVANAH API™ v0.2.0 · Le Gardien de Trajectoire  ║');
    console.log('║   Makom Intelligence™ · CorreIA LLC                ║');
    console.log(`║   Port : ${PORT}  ·  Mode : ${QAVANAH_MODE.padEnd(7)}                  ║`);
    console.log('║   Q = f(I,C,T,A,R,Z) · Zera haMakom™ intégré      ║');
    console.log('╚════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  GET  /health · /version');
    console.log('  POST /v1/trajectories');
    console.log('  POST /v1/intents/:id/anchor · /reanchor');
    console.log('  POST /v1/context/snapshot');
    console.log('  POST /v1/actions/propose · /:id/result');
    console.log('  POST /v1/qavanah/check');
    console.log('  POST /v1/zera/form            ← ZERA haMakom™');
    console.log('  GET  /v1/zera/:icl            ← ZERA haMakom™');
    console.log('  GET  /v1/zera/:icl/compare    ← ZERA haMakom™');
    console.log('  GET  /v1/trajectories/:id/history · /signals · /decision');
    console.log('');
    console.log('  ZM-DEV-001 · Loi : lire ce que le Lieu porte avant d\'intervenir ✦');
    console.log('');
  });
}).catch(err => {
  console.error('[QAVANAH] Erreur init DB :', err.message);
  process.exit(1);
});
