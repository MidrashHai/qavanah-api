/**
 * QAVANAH API™ - Le Gardien de Trajectoire
 * Makom Intelligence™ · CorreIA LLC
 * Version : 0.8.0
 * Date : 2026-08-14
 * Phase 2 · HSC Contract Binding · qav_sequence_states
 *           Qavanah maintient l'état séquentiel par trajectoire
 *           L'état n'avance qu'après ACTION_RESULT confirmé
 *
 * RÈGLE CANONIQUE v0.8.0 :
 * Qavanah ne fait pas confiance à l'état déclaré par l'agent.
 * Qavanah maintient un état séquentiel persistant par trajectoire.
 * L'état n'avance qu'après confirmation de la transition manifestée.
 *
 * Q = f(I, C, T, A, R, Z, S)
 *
 * DÉCISIONS v0.4.0 · LOI COA :
 *
 * Score composite = intent×0.4 + context×0.3 + action×0.2 + zera×0.1
 * Poids EXPÉRIMENTAUX · non constitutionnels · calibrage empirique requis (BH-068)
 * Score MIN conservé comme indicateur complémentaire · pas score COA principal
 *
 * Tension = (1.0 - composite_score) × 1000
 * Référence = 1.0 (alignement parfait)
 * Mode OBSERVATION : tension calculée · ne bloque pas · ne déclenche pas BLOCK automatique
 *
 * DÉCISION v0.3.0 · LOI DE SCORING ZERA (maintenue) :
 * convergence = donnée observée · signal diagnostique · pas de pénalité.
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3100;

const QAVANAH_MODE = process.env.QAVANAH_MODE || 'OBSERVE';

// ─── PADA ADAPTER (Étape 15) ─────────────────────────────────────────────────
// Architecture hybride : REAL si PADA_API_URL définie · SIMULATED sinon
// Loi : execution_mode jamais silencieux
// Loi : test REAL invalide si provider = SIMULATION

const PADA_API_URL = process.env.PADA_API_URL || null;

if (PADA_API_URL) {
  console.log(`[QAVANAH] PADA Adapter : REAL · ${PADA_API_URL}`);
} else {
  console.log('[QAVANAH] PADA Adapter : SIMULATED (PADA_API_URL absent)');
}

async function padaSearchPlace(query, contextIcl) {
  if (!PADA_API_URL) {
    return {
      execution_mode: 'SIMULATED', provider: 'SIMULATION',
      found: true,
      place: {
        name:    query, icl: contextIcl || '4331|2136',
        address: `${query} · Cocody · Abidjan`, source: 'SIMULATION'
      }
    };
  }

  try {
    const http = require('https');
    const url  = `${PADA_API_URL}/v1/territoire`;
    const data = await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('PARSE_ERROR')); } });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    });

    const normalizedQuery = query.toUpperCase().trim();
    const items = Array.isArray(data) ? data
      : (data.features ? data.features.map(f => f.properties) : []);

    // Trouver tous les enregistrements correspondant à la requête
    const matches = items.filter(item =>
      item && (
        (item.nom_voie && item.nom_voie.toUpperCase().includes(normalizedQuery)) ||
        (item.st_name  && item.st_name.toUpperCase().includes(normalizedQuery))  ||
        (item.nom      && item.nom.toUpperCase().includes(normalizedQuery))
      )
    );

    if (matches.length === 0) {
      return {
        execution_mode: 'REAL', provider: 'PADA',
        found: false, status: 'NOT_FOUND', query, source: 'PADA_COCODY_REAL'
      };
    }

    // Trier par proximité ICL si contextIcl fourni
    // ICL format "AAAA | BBBB" → distance = |A1-A2| + |B1-B2|
    let sorted = matches;
    if (contextIcl) {
      const [cA, cB] = contextIcl.replace(/\s/g, '').split('|').map(Number);
      sorted = [...matches].sort((x, y) => {
        const iclX = (x.icl || '0|0').replace(/\s/g, '').split('|').map(Number);
        const iclY = (y.icl || '0|0').replace(/\s/g, '').split('|').map(Number);
        const dX = Math.abs((iclX[0]||0) - cA) + Math.abs((iclX[1]||0) - cB);
        const dY = Math.abs((iclY[0]||0) - cA) + Math.abs((iclY[1]||0) - cB);
        return dX - dY;
      });
    }

    const best = sorted[0];

    // ── Métadonnées d'affichage cartographique · TAL frontend ─────────────
    // Toutes les adresses de la voie trouvée · pour illumination collective
    const voieName = best.nom_voie || best.st_name || best.nom || query;
    const allAddresses = sorted.map(a => ({
      icl:    a.icl    || null,
      numero: a.numero || null,
      name:   a.nom_voie || a.st_name || a.nom || voieName
    }));

    return {
      execution_mode:   'REAL',
      provider:         'PADA',
      found:            true,
      context_icl:      contextIcl || null,
      total_matches:    matches.length,
      proximity_sorted: !!contextIcl,
      place: {
        name:    voieName,
        icl:     best.icl || null,
        numero:  best.numero || null,
        address: `${voieName} · Cocody · Abidjan`,
        source:  'PADA_COCODY_REAL',
        raw:     best
      },
      alternatives: sorted.slice(1, 3).map(a => ({
        name:   a.nom_voie || a.st_name || a.nom,
        icl:    a.icl || null,
        numero: a.numero || null
      })),
      // ── TAL cartographique · OmeH.ai frontend ────────────────────────────
      // Ces métadonnées permettent au TAL d'illuminer toutes les adresses
      // de la voie sur la carte · conformément au Parcours Client OmeH.ai
      tal_map: {
        action:           'HIGHLIGHT_ADDRESSES_BY_VOIE',
        voie_name:        voieName,
        addresses:        allAddresses,
        addresses_count:  matches.length,
        highlight_color:  'orange',
        highlight_radius: 7,
        fly_to:           true,
        structure_f:      matches.length === 0  // hors périmètre si 0 résultats
      }
    };
  } catch (err) {
    console.error('[PADA] Erreur appel réel :', err.message);
    return {
      execution_mode: 'SIMULATED', provider: 'SIMULATION',
      fallback_reason: `PADA_ERROR: ${err.message}`,
      found: false, status: 'PADA_UNAVAILABLE'
    };
  }
}

async function padaSearchNumber(query, params) {
  if (params && params.noData) {
    return {
      execution_mode: PADA_API_URL ? 'REAL' : 'SIMULATED',
      provider:       PADA_API_URL ? 'PADA' : 'SIMULATION',
      found:          false,
      status:         'NO_DATA',
      law:            'NON_INVENTION'
    };
  }

  if (!PADA_API_URL) {
    return {
      execution_mode: 'SIMULATED',
      provider:       'SIMULATION',
      found:          true,
      number:         query,
      source:         'SIMULATION'
    };
  }

  // Appel réel PADA pour numéro
  try {
    const http = require('https');
    const url  = `${PADA_API_URL}/v1/territoire`;
    const data = await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { reject(new Error('PARSE_ERROR')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    });

    const items = Array.isArray(data) ? data : (data.features ? data.features.map(f => f.properties) : []);
    const found = items.find(item =>
      item && (item.numero === query || item.numero === parseInt(query))
    );

    if (!found) {
      return {
        execution_mode: 'REAL', provider: 'PADA', found: false,
        status: 'NOT_FOUND', law: 'NON_INVENTION',
        tal_map: { action: 'STRUCTURE_F', structure_f: true }
      };
    }

    // Trouver les voisins réels (numéros adjacents dans les données)
    const numero = parseInt(query);
    const neighbors = items
      .filter(item => item && item.numero && Math.abs(parseInt(item.numero) - numero) <= 10
                   && item.numero !== query && item.numero !== numero)
      .sort((a, b) => Math.abs(parseInt(a.numero) - numero) - Math.abs(parseInt(b.numero) - numero))
      .slice(0, 4)
      .map(n => ({ icl: n.icl || null, numero: n.numero }));

    return {
      execution_mode: 'REAL', provider: 'PADA', found: true,
      number: query, address: found, source: 'PADA_COCODY_REAL',
      neighbors,
      // ── TAL cartographique · OmeH.ai frontend ──────────────────────────
      // Point cible grand · voisins jaune pâle · zoom 18
      // Conformément au Parcours Client OmeH.ai Phase 5
      tal_map: {
        action:           'HIGHLIGHT_NUMBER',
        target: {
          icl:    found.icl    || null,
          numero: found.numero || query,
          highlight_color:  'orange',
          highlight_radius: 11
        },
        neighbors:        neighbors,
        neighbors_color:  'yellow',
        neighbors_radius: 7,
        fly_to:           true,
        zoom_level:       18
      }
    };
  } catch (err) {
    console.error('[PADA] Erreur numéro :', err.message);
    return {
      execution_mode: 'SIMULATED', provider: 'SIMULATION',
      fallback_reason: `PADA_ERROR: ${err.message}`,
      found: false, status: 'PADA_UNAVAILABLE'
    };
  }
}
// Familles d'actions pour le calcul d'alignement catégoriel (Étape 9)

const AUTHORIZED_ACTIONS = new Set([
  'FLY_TO', 'ZOOM_TO', 'RESET_VIEW',
  'SEARCH_PLACE', 'HIGHLIGHT_ROAD', 'HIGHLIGHT_PLACE',
  'SHOW_LAYER', 'HIDE_LAYER', 'PLACE_MARKER',
  'START_GPS', 'SEARCH_NUMBER'
]);

const ACTION_FAMILIES = {
  LECTURE:    new Set(['SEARCH_PLACE', 'SEARCH_ROAD', 'SEARCH_NUMBER', 'SEARCH_RESOURCE', 'SEARCH_EVENT']),
  NAVIGATION: new Set(['FLY_TO', 'ZOOM_TO', 'RESET_VIEW', 'START_GPS']),
  AFFICHAGE:  new Set(['HIGHLIGHT_ROAD', 'HIGHLIGHT_PLACE', 'SHOW_LAYER', 'HIDE_LAYER', 'FOCUS_ROAD', 'FOCUS_PLACE']),
  MARQUAGE:   new Set(['PLACE_MARKER']),
  ROUTE:      new Set(['CALCULATE_ROUTE', 'SHOW_ROUTE', 'CLEAR_ROUTE']),
  SYSTEME:    new Set(['REFRESH_TERRITORY', 'CAPTURE_VIEWPORT']),
};

function getActionFamily(actionType) {
  for (const [family, actions] of Object.entries(ACTION_FAMILIES)) {
    if (actions.has(actionType)) return family;
  }
  return 'UNKNOWN';
}

// ─── BASE DE DONNÉES ─────────────────────────────────────────────────────────
let db = null;
let inMemoryStore = {
  trajectories:       {},
  intent_anchors:     {},
  context_snapshots:  {},
  proposed_actions:   {},
  decisions:          {},
  place_seeds:        {},
  sequence_contracts: {},   // ← HSC Registry · Phase 1
  sequence_states:    {},   // ← HSC States · Phase 2 · état par trajectoire
  events:             []
};

if (process.env.DATABASE_URL) {
  db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log('[QAVANAH] Mode : PostgreSQL connecté');
} else {
  console.log('[QAVANAH] Mode : in-memory (sandbox)');
}

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

function generateId(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${ts}${rd}`;
}
function hashObject(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
function now() { return new Date().toISOString(); }

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

// ─── ÉTAPE 9 · MOTEUR D'ALIGNEMENT RÉEL ─────────────────────────────────────
// Scores calculés depuis les données · non des constantes
// Mode OBSERVE : scores observationnels · ne bloquent pas
// BH-068 : les scores mûrissent avant d'avoir autorité

function computeAlignmentScores(intent, context, action, zera) {
  const scores = {};
  const signals = {};

  // ── Score Intent (0.0 → 1.0) ──────────────────────────────────────────────
  // Mesure la fiabilité de la source d'intention
  if (!intent || !intent.contractId) {
    scores.intent = 0.0;
    signals.intent = 'INTENT_ABSENT';
  } else {
    switch (intent.source) {
      case 'USER_CONFIRMED':  scores.intent = 1.00; signals.intent = 'CONFIRMED'; break;
      case 'EXPLICIT_USER':   scores.intent = 0.95; signals.intent = 'EXPLICIT'; break;
      case 'PROVISIONAL':     scores.intent = 0.50; signals.intent = 'PROVISIONAL'; break;
      default:                scores.intent = 0.70; signals.intent = 'UNKNOWN_SOURCE';
    }
  }

  // ── Score Context (0.0 → 1.0) ─────────────────────────────────────────────
  // Mesure la complétude du contexte territorial
  if (!context || !context.contextId) {
    scores.context = 0.0;
    signals.context = 'CONTEXT_ABSENT';
  } else {
    let ctxScore = 0.5; // base : contextId présent
    if (context.icl)      ctxScore += 0.25; // ICL territorial présent
    if (context.place && Object.keys(context.place).length > 0) ctxScore += 0.15;
    if (context.state && Object.keys(context.state).length > 0) ctxScore += 0.10;
    scores.context = Math.min(ctxScore, 1.0);
    signals.context = context.icl ? 'ICL_PRESENT' : 'ICL_ABSENT';
  }

  // ── Score Action (0.0 → 1.0) ──────────────────────────────────────────────
  // Mesure l'alignement entre la famille d'action et le scope d'intention
  if (!action || !action.type) {
    scores.action = 0.0;
    signals.action = 'ACTION_ABSENT';
  } else if (!AUTHORIZED_ACTIONS.has(action.type)) {
    scores.action = 0.0;
    signals.action = 'ACTION_NOT_IN_CATALOGUE';
  } else {
    const family = getActionFamily(action.type);
    signals.action_family = family;

    // Vérification cohérence famille / scope d'intention
    if (intent && intent.scope && intent.scope.allowedActions) {
      if (intent.scope.allowedActions.includes(action.type)) {
        scores.action = 1.0;
        signals.action = 'IN_INTENT_SCOPE';
      } else {
        // Action autorisée mais hors scope déclaré
        scores.action = 0.30;
        signals.action = 'OUT_OF_INTENT_SCOPE';
      }
    } else {
      // Pas de scope déclaré → score par famille
      switch (family) {
        case 'LECTURE':    scores.action = 0.95; break;
        case 'NAVIGATION': scores.action = 0.90; break;
        case 'AFFICHAGE':  scores.action = 0.90; break;
        case 'MARQUAGE':   scores.action = 0.85; break;
        case 'ROUTE':      scores.action = 0.80; break;
        case 'SYSTEME':    scores.action = 0.75; break;
        default:           scores.action = 0.50;
      }
      signals.action = `FAMILY_${family}`;
    }
  }

  // ── Score Zera (0.0 → 1.0) ────────────────────────────────────────────────
  // Mesure la présence et la complétude de la graine constitutive du Lieu
  //
  // DÉCISION v0.3.0 : convergence (TENSION/FORTE/PARTIELLE)
  // = donnée observée UNIQUEMENT · ne modifie PAS le score
  // Raison : aucune calibration empirique disponible
  // La convergence est enregistrée comme signal pour corrélation future
  if (!zera && context && context.zera) {
    zera = context.zera;
  }

  if (!zera) {
    scores.zera = null; // null = pas de graine disponible (non pénalisant)
    signals.zera = 'ZERA_ABSENT';
    signals.zera_convergence = null;
  } else {
    let zeraScore = 0.5; // base : graine présente

    if (zera.formation_state === 'FORMED') zeraScore += 0.20;

    // Signature spatiale
    if (zera.spatial_signature && zera.spatial_signature.latitude) zeraScore += 0.10;

    // Signature structurale
    if (zera.structural_signature) {
      if (zera.structural_signature.road_access) zeraScore += 0.10;
      if (zera.structural_signature.boundary_detected) zeraScore += 0.05;
      if (zera.structural_signature.thresholds > 0) zeraScore += 0.05;
    }

    scores.zera = Math.min(zeraScore, 1.0);

    // CONVERGENCE → signal observé · PAS de pénalité (v0.3.0)
    const convergence = zera.observed_features && zera.observed_features.convergence
      ? zera.observed_features.convergence
      : null;

    signals.zera = `SEED_v${zera.seed_version || 1}`;
    signals.zera_convergence = convergence; // enregistré pour corrélation future
    signals.zera_convergence_note = convergence
      ? `OBSERVE_ONLY · ${convergence} · no_penalty_v0.3.0`
      : null;
  }

  return { scores, signals };
}

// ─── ÉTAPE 10 · MOTEUR COA™ · TRAJECTOIRE ───────────────────────────────────
// Calcul Tension / Slope / AUC sur série temporelle d'alignement
// Scénario référence QAV-DEV-001 §11 :
//   CP-1 tension=143.7 → NORMAL
//   CP-2 tension=246.2 · slope=+102.6 → WARNING
//   CP-3 tension=893.4 · AUC=1283 → DRIFT confirmé
//
// DÉCISION v0.4.0 :
//   Tension   = (1.0 - composite_score) × 1000
//   Composite = intent×0.4 + context×0.3 + action×0.2 + zera×0.1
//   Poids expérimentaux · calibrage empirique requis (BH-068)
//   Mode OBSERVE : COA calcule · ne bloque pas · ne déclenche pas BLOCK automatique

// Seuils initiaux (non calibrés · expérimentaux · BH-068)
const COA_THRESHOLDS = {
  WARNING_TENSION:  200,   // tension > 200 → WARNING
  DRIFT_TENSION:    500,   // tension > 500 → DRIFT
  WARNING_SLOPE:     80,   // pente > 80 par étape → alerte précoce
  DRIFT_AUC:       1000,   // AUC > 1000 → dérive confirmée
};

function computeCompositeScore(alignment) {
  // Poids expérimentaux v0.4.0
  const w = { intent: 0.4, context: 0.3, action: 0.2, zera: 0.1 };
  const i = alignment.intent  != null ? alignment.intent  : 0;
  const c = alignment.context != null ? alignment.context : 0;
  const a = alignment.action  != null ? alignment.action  : 0;
  const z = alignment.zera    != null ? alignment.zera    : i; // fallback sur intent si zera absent

  const composite = i * w.intent + c * w.context + a * w.action + z * w.zera;
  const min_score = Math.min(i, c, a, z);

  return {
    composite: parseFloat(composite.toFixed(4)),
    min_score: parseFloat(min_score.toFixed(4)),
    weights:   w,
    note:      'poids_experimentaux_v0.4.0'
  };
}

function computeTension(composite_score) {
  // Tension = (1.0 - composite) × 1000
  // Référence = 1.0 (alignement parfait)
  return parseFloat(((1.0 - composite_score) * 1000).toFixed(2));
}

function computeSlope(tensionSeries) {
  // Pente entre les deux derniers points
  if (!tensionSeries || tensionSeries.length < 2) return null;
  const last = tensionSeries[tensionSeries.length - 1];
  const prev = tensionSeries[tensionSeries.length - 2];
  return parseFloat((last - prev).toFixed(2));
}

function computeAUC(tensionSeries) {
  // Aire sous la courbe (somme trapézoïdale)
  if (!tensionSeries || tensionSeries.length < 2) return null;
  let auc = 0;
  for (let i = 1; i < tensionSeries.length; i++) {
    auc += (tensionSeries[i] + tensionSeries[i - 1]) / 2;
  }
  return parseFloat(auc.toFixed(2));
}

function computeDriftState(tension, slope, auc) {
  // Mode OBSERVE : calcule l'état · ne bloque pas
  // Séquence : NORMAL → WARNING → DRIFT
  if (auc != null && auc > COA_THRESHOLDS.DRIFT_AUC) return 'DRIFT';
  if (tension > COA_THRESHOLDS.DRIFT_TENSION)         return 'DRIFT';
  if (slope != null && slope > COA_THRESHOLDS.WARNING_SLOPE) return 'WARNING';
  if (tension > COA_THRESHOLDS.WARNING_TENSION)       return 'WARNING';
  return 'NORMAL';
}

// Récupérer ou initialiser la série de tensions d'une trajectoire
function getTensionSeries(trajectoryId) {
  const key = `coa_series_${trajectoryId}`;
  if (!inMemoryStore[key]) inMemoryStore[key] = [];
  return inMemoryStore[key];
}

function appendTension(trajectoryId, tension) {
  const series = getTensionSeries(trajectoryId);
  series.push(tension);
  return series;
}

// ─── RESET COA WINDOW ────────────────────────────────────────────────────────
// Décision v0.6.0 · Choix C
// Reset ≠ Delete · reset change la fenêtre active · pas l'historique
// Trigger : RE_ANCHOR (auto) | OPERATOR (explicite) | EXTERNAL_VALIDATION
// Événement d'audit COAWindowReset immuable à chaque reset

function getWindowNumber(trajectoryId) {
  const archives = Object.keys(inMemoryStore)
    .filter(k => k.startsWith(`coa_archive_${trajectoryId}_w`));
  return archives.length + 1; // window suivante
}

async function resetCOAWindow({ trajectoryId, reason, trigger, actor }) {
  const currentKey    = `coa_series_${trajectoryId}`;
  const currentSeries = inMemoryStore[currentKey] || [];
  const windowNumber  = getWindowNumber(trajectoryId);
  const archiveKey    = `coa_archive_${trajectoryId}_w${windowNumber}`;

  // Calculer l'état final de la fenêtre sortante
  const lastTension   = currentSeries.length > 0 ? currentSeries[currentSeries.length - 1] : null;
  const finalSlope    = computeSlope(currentSeries);
  const finalAUC      = computeAUC(currentSeries);
  const finalState    = currentSeries.length > 0
    ? computeDriftState(lastTension, finalSlope, finalAUC)
    : 'NORMAL';

  // Archiver la fenêtre précédente (immuable)
  inMemoryStore[archiveKey] = {
    windowId:        archiveKey,
    windowNumber,
    trajectoryId,
    series:          currentSeries,
    steps:           currentSeries.length,
    finalTension:    lastTension,
    finalSlope,
    finalAUC,
    finalState,
    archivedAt:      now(),
    reason,
    trigger,
    actor:           actor || 'system'
  };

  // Ouvrir nouvelle fenêtre active = [0]
  inMemoryStore[currentKey] = [0];

  // Événement d'audit immuable
  await logEvent('COAWindowReset', {
    trajectoryId,
    previousWindowId:   archiveKey,
    newWindowId:        `coa_series_${trajectoryId}`,
    windowNumber:       windowNumber + 1,
    reason,
    trigger,
    actor:              actor || 'system',
    previousState:      finalState,
    previousAUC:        finalAUC,
    newSeries:          [0],
    timestamp:          now()
  });

  return {
    reset:           true,
    previousWindowId: archiveKey,
    previousState:   finalState,
    previousAUC:     finalAUC,
    previousSteps:   currentSeries.length,
    newWindowNumber: windowNumber + 1,
    newSeries:       [0],
    trigger,
    reason
  };
}

// ─── MOTEUR DÉTERMINISTE ─────────────────────────────────────────────────────
// Étape 6 · opère AVANT les scores · BH-384

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
    return { decision: 'BLOCK', reasonCodes, evidence: [`ACTION_${action.type}_NOT_IN_CATALOGUE`] };
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

  evidence.push('INTENT_MATCH', 'CONTEXT_VALID', 'ACTION_AUTHORIZED');
  if (context.zera) evidence.push('ZERA_CONTEXT_PRESENT');
  return { decision: 'ALLOW', reasonCodes, evidence };
}

// ─── MODULE ZERA HAMAKOM™ ────────────────────────────────────────────────────

function buildZeraId(icl) { return `ZM-${(icl || 'unknown').replace('|', '-')}`; }

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

  const spatial_signature     = computeSpatialSignature(lat, lon);
  const structural_signature  = {
    road_access:       voies && voies.length > 0,
    boundary_detected: place ? true : false,
    thresholds:        voies ? voies.length : 0,
    place_type:        place ? (place.type || 'unknown') : null
  };
  const relational_signature  = {
    connected_roads:  voies ? voies.length : 0,
    connected_places: relations ? relations.length : 0,
    territory:        territory || null
  };
  const territorial_signature = {
    zone: territory || null, territory: 'abidjan', icl: icl || null
  };
  const observed_features  = observed || {};
  const inferred_features  = {};

  return {
    id: `${zeraId}-v${seedVersion}`, zera_id: zeraId, icl: icl || null,
    seed_version: seedVersion, source_type: 'GPS_PCNT', source_ref: icl,
    place_candidate_id: icl, spatial_signature, structural_signature,
    relational_signature, territorial_signature, observed_features, inferred_features,
    formation_state: 'FORMED', confidence: spatial_signature ? 1.0 : 0.5,
    evidence_refs: ['PCNT_v3_1', 'PADA_COCODY'],
    created_at: createdAt, valid_from: createdAt, valid_until: null, status: 'ACTIVE'
  };
}

// ─── ENDPOINTS ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    service:   'qavanah-api', status: 'ok', version: '0.8.0',
    mode:      QAVANAH_MODE, etape: 16,
    modules:   ['kernel','trajectory','intent','context','action',
                'rule-engine','decision-engine','event-log',
                'zera-hamakom','alignment-scoring','coa-trajectory',
                'reanchor-coa-reset','tal-hybrid','pada-adapter',
                'coa-window-manager','ayin-hamakom-loop',
                'hsc-registry','hsc-contract-binding'],
    hsc: {
      registry:    'qav_sequence_contracts',
      states:      'qav_sequence_states',
      seed:        'SEQ-SEARCH-PLACE-001 v1.0 · ACTIVE',
      rule:        'État avance uniquement après ACTION_RESULT confirmé',
      formula:     'Q = f(I, C, T, A, R, Z, S)'
    },
    pada: {
      mode:      PADA_API_URL ? 'REAL' : 'SIMULATED',
      url:       PADA_API_URL ? 'configured' : 'absent',
      actions:   ['SEARCH_PLACE','SEARCH_NUMBER'],
      fallback:  'SIMULATION',
      law:       'execution_mode jamais silencieux'
    },
    db: db ? 'postgresql' : 'in-memory', timestamp: now()
  });
});

app.get('/version', (req, res) => {
  res.json({
    service: 'qavanah-api', version: '0.6.0',
    codex: 'QAV-0001', devops: 'QAV-DEV-001',
    zera: 'ZM-DEV-001', raqia: 'QAV-RAQIA-001', hoqim: 'QAV-HOQ-001',
    mode: QAVANAH_MODE,
    formula: 'Q = f(I, C, T, A, R, Z)',
    decision_c_v0_6_0: {
      re_anchor:    'auto reset COA window · archive immutable',
      reset_coa:    'POST /v1/trajectories/:id/reset-coa · reason required',
      triggers:     ['RE_ANCHOR','OPERATOR','EXTERNAL_VALIDATION'],
      separation:   'RE-ANCHOR ≠ COA_WINDOW ≠ HISTORY'
    },
    etape14: {
      endpoint:  'POST /v1/ayin/integrate',
      input:     'ACTION_RESULT',
      output:    'ContextSnapshot N+1',
      loop:      'PERCEPTION → ACTION → RESULT → CONTEXT_N+1 → PERCEPTION'
    },
    etapesCouvertes: [0,1,2,3,4,5,6,7,8,'ZM',9,10,12,13,14],
    releasedAt: '2026-08-14'
  });
});

// ── TRAJECTOIRES ──────────────────────────────────────────────────────────────
app.post('/v1/trajectories', async (req, res) => {
  const { intentContractId, intentVersion = 1, sessionId, agentId, intentSource = 'PROVISIONAL' } = req.body;
  const trajectoryId = generateId('TRJ'), assessmentId = generateId('ASM');
  const sId = sessionId || generateId('SES'), aId = agentId || 'unknown-agent';
  const createdAt = now();
  const trajectory = { trajectoryId, assessmentId, sessionId: sId, agentId: aId,
    intentContractId: intentContractId || null, intentVersion, intentSource,
    status: 'OPEN', mode: QAVANAH_MODE, createdAt };
  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_trajectories
         (trajectory_id,assessment_id,session_id,agent_id,intent_contract_id,
          intent_version,intent_source,status,mode,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [trajectoryId,assessmentId,sId,aId,intentContractId||null,
         intentVersion,intentSource,'OPEN',QAVANAH_MODE,createdAt]
      );
    } catch { inMemoryStore.trajectories[trajectoryId] = trajectory; }
  } else { inMemoryStore.trajectories[trajectoryId] = trajectory; }
  await logEvent('TrajectoryCreated', { trajectoryId, assessmentId, agentId: aId });
  res.status(201).json(trajectory);
});

app.get('/v1/trajectories/:id', async (req, res) => {
  const { id } = req.params;
  if (db) {
    try {
      const r = await db.query('SELECT * FROM qav_trajectories WHERE trajectory_id=$1',[id]);
      if (r.rows.length > 0) return res.json(r.rows[0]);
    } catch {}
  }
  const t = inMemoryStore.trajectories[id];
  if (!t) return res.status(404).json({ error: 'TRAJECTORY_NOT_FOUND' });
  res.json(t);
});

app.get('/v1/trajectories/:id/history', (req, res) => {
  const events = inMemoryStore.events.filter(e => e.payload && e.payload.trajectoryId === req.params.id);
  res.json({ trajectoryId: req.params.id, events });
});

// ── INTENT ANCHOR ─────────────────────────────────────────────────────────────
app.post('/v1/intents/:contractId/anchor', async (req, res) => {
  const { contractId } = req.params;
  const { trajectoryId, intentVersion=1, source='USER_CONFIRMED', objectives=[], constraints=[], scope={} } = req.body;
  const hash = hashObject({ contractId, intentVersion, objectives, constraints, scope });
  const anchorId = generateId('ANC'), createdAt = now();
  const anchor = { id:anchorId, contractId, trajectoryId:trajectoryId||null,
    version:intentVersion, hash:`sha256:${hash}`, embeddingModel:'none-v0.1',
    embeddingVersion:'0.1', source, objectives, constraints, scope, sealed:true, createdAt };
  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_intent_anchors
         (id,contract_id,trajectory_id,version,hash,source,objectives,constraints,scope,sealed,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [anchorId,contractId,trajectoryId||null,intentVersion,`sha256:${hash}`,
         source,JSON.stringify(objectives),JSON.stringify(constraints),JSON.stringify(scope),true,createdAt]
      );
    } catch { inMemoryStore.intent_anchors[anchorId] = anchor; }
  } else { inMemoryStore.intent_anchors[anchorId] = anchor; }
  await logEvent('IntentAnchored', { anchorId, contractId, trajectoryId, version: intentVersion });
  res.status(201).json({ intentAnchor: anchor });
});

app.get('/v1/intents/:contractId', (req, res) => {
  const anchors = Object.values(inMemoryStore.intent_anchors)
    .filter(a => a.contractId === req.params.contractId)
    .sort((a,b) => b.version - a.version);
  if (anchors.length === 0) return res.status(404).json({ error: 'INTENT_NOT_FOUND' });
  res.json({ contractId: req.params.contractId, versions: anchors });
});

// reanchor défini plus bas avec reset COA (v0.5.0)

// ── CONTEXT SNAPSHOT ──────────────────────────────────────────────────────────
app.post('/v1/context/snapshot', async (req, res) => {
  const { trajectoryId, icl, place={}, presence={}, state={},
    relations=[], resources=[], events=[], rules=[], zera=null } = req.body;
  const contextId = generateId('CTX'), capturedAt = now();
  let zeraData = zera;
  if (!zeraData && icl) {
    const zeraId = buildZeraId(icl);
    const stored = Object.values(inMemoryStore.place_seeds)
      .find(z => z.zera_id === zeraId && z.status === 'ACTIVE');
    if (stored) zeraData = stored;
  }
  const snapshot = { contextId, trajectoryId, icl:icl||null,
    place, presence, state, relations, resources, events, rules,
    zera: zeraData, version:1, capturedAt, frozen:true };
  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_context_snapshots
         (context_id,trajectory_id,icl,place,presence,state,relations,resources,rules,zera,version,captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [contextId,trajectoryId,icl,
         JSON.stringify(place),JSON.stringify(presence),JSON.stringify(state),
         JSON.stringify(relations),JSON.stringify(resources),JSON.stringify(rules),
         JSON.stringify(zeraData),1,capturedAt]
      );
    } catch { inMemoryStore.context_snapshots[contextId] = snapshot; }
  } else { inMemoryStore.context_snapshots[contextId] = snapshot; }
  await logEvent('ContextAttached', { contextId, trajectoryId, icl, version:1, zeraAttached:!!zeraData });
  res.status(201).json(snapshot);
});

app.get('/v1/context/:id', (req, res) => {
  const s = inMemoryStore.context_snapshots[req.params.id];
  if (!s) return res.status(404).json({ error: 'CONTEXT_NOT_FOUND' });
  res.json(s);
});

// ── PROPOSED ACTION ───────────────────────────────────────────────────────────
app.post('/v1/actions/propose', async (req, res) => {
  const { trajectoryId, type, parameters={}, requestedBy } = req.body;
  if (!type) return res.status(400).json({ error: 'ACTION_TYPE_REQUIRED' });
  const actionId = generateId('ACT'), createdAt = now();
  const action = { actionId, type, parameters, requestedBy:requestedBy||'unknown',
    trajectoryId:trajectoryId||null, status:'PROPOSED', createdAt };
  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_proposed_actions
         (action_id,type,parameters,requested_by,trajectory_id,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [actionId,type,JSON.stringify(parameters),requestedBy||'unknown',trajectoryId||null,'PROPOSED',createdAt]
      );
    } catch { inMemoryStore.proposed_actions[actionId] = action; }
  } else { inMemoryStore.proposed_actions[actionId] = action; }
  await logEvent('ActionProposed', { actionId, type, trajectoryId });
  res.status(201).json(action);
});

app.post('/v1/actions/:id/result', async (req, res) => {
  const { id } = req.params;
  const { status, result={}, errorCode, executedAt } = req.body;
  const actionResult = { actionId:id, status:status||'SUCCESS', result,
    errorCode:errorCode||null, executedAt:executedAt||now(),
    source:'territory-action-layer', receivedAt:now() };
  inMemoryStore[`result_${id}`] = actionResult;
  await logEvent('ActionResultReceived', { actionId:id, status:actionResult.status });
  res.json({ received:true, actionResult });
});

// ── ZERA HAMAKOM™ ─────────────────────────────────────────────────────────────
app.post('/v1/zera/form', async (req, res) => {
  const { source, territory, icl, place, voies, relations, observed } = req.body;
  if (!source || (!source.latitude && !icl)) {
    return res.status(400).json({ error: 'SOURCE_REQUIRED', law: 'ZM-DEV-001 §13' });
  }
  const seed = buildZeraSeed({ icl, lat:source.latitude, lon:source.longitude,
    territory, place, voies, relations, observed });
  const existing = icl
    ? Object.values(inMemoryStore.place_seeds).find(z => z.zera_id === buildZeraId(icl) && z.seed_version === 1)
    : null;
  if (existing) {
    const maxV = Math.max(...Object.values(inMemoryStore.place_seeds)
      .filter(z => z.zera_id === buildZeraId(icl)).map(z => z.seed_version));
    const updated = { ...seed, id:`${buildZeraId(icl)}-v${maxV+1}`, seed_version:maxV+1, created_at:now() };
    inMemoryStore.place_seeds[updated.id] = updated;
    await logEvent('PlaceSeedUpdated', { zeraId:updated.zera_id, icl, version:maxV+1 });
    return res.status(201).json({ zera:updated, event:'UPDATED', previousVersion:maxV });
  }
  inMemoryStore.place_seeds[seed.id] = seed;
  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_place_seeds
         (id,zera_id,icl,seed_version,source_type,source_ref,place_candidate_id,
          spatial_signature,structural_signature,relational_signature,territorial_signature,
          observed_features,inferred_features,formation_state,confidence,evidence_refs,
          created_at,valid_from,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [seed.id,seed.zera_id,seed.icl,seed.seed_version,seed.source_type,seed.source_ref,
         seed.place_candidate_id,JSON.stringify(seed.spatial_signature),
         JSON.stringify(seed.structural_signature),JSON.stringify(seed.relational_signature),
         JSON.stringify(seed.territorial_signature),JSON.stringify(seed.observed_features),
         JSON.stringify(seed.inferred_features),seed.formation_state,seed.confidence,
         JSON.stringify(seed.evidence_refs),seed.created_at,seed.valid_from,seed.status]
      );
    } catch(e) { console.log('[ZERA] DB fallback:', e.message); }
  }
  await logEvent('PlaceSeedDetected', { zeraId:seed.zera_id, icl, version:1 });
  await logEvent('PlaceFormationCompleted', { zeraId:seed.zera_id, icl, state:'FORMED' });
  res.status(201).json({ zera:seed, event:'FORMED' });
});

app.get('/v1/zera/:icl', async (req, res) => {
  const icl = req.params.icl, zeraId = buildZeraId(icl);
  if (db) {
    try {
      const r = await db.query(
        'SELECT * FROM qav_place_seeds WHERE zera_id=$1 AND status=$2 ORDER BY seed_version DESC',
        [zeraId,'ACTIVE']
      );
      if (r.rows.length > 0) return res.json({ icl, zera:r.rows[0], versions:r.rows });
    } catch {}
  }
  const seeds = Object.values(inMemoryStore.place_seeds)
    .filter(z => z.zera_id === zeraId).sort((a,b) => b.seed_version - a.seed_version);
  if (seeds.length === 0) return res.status(404).json({ error:'ZERA_NOT_FOUND', icl,
    hint:'POST /v1/zera/form pour former la graine de ce Lieu' });
  res.json({ icl, zera:seeds[0], versions:seeds });
});

app.get('/v1/zera/:icl/compare', async (req, res) => {
  const icl = req.params.icl, zeraId = buildZeraId(icl);
  const { seed_version=1, context_id } = req.query;
  const seed = Object.values(inMemoryStore.place_seeds)
    .find(z => z.zera_id === zeraId && z.seed_version === parseInt(seed_version));
  if (!seed) return res.status(404).json({ error:'SEED_NOT_FOUND', icl, seed_version });
  const currentCtx = context_id ? inMemoryStore.context_snapshots[context_id] : null;
  const comparison = {
    continuity: currentCtx ? 0.91 : null,
    transformation: currentCtx ? 0.08 : null,
    rupture: currentCtx ? 0.01 : null,
    note: 'MODE_OBSERVE · scores expérimentaux non calibrés'
  };
  await logEvent('PlaceFormationCompared', { zeraId, icl, seed_version, context_id });
  res.json({ icl, formation:{ seed_state:seed.formation_state, seed_version:seed.seed_version, seed_at:seed.created_at },
    current: currentCtx ? { context_snapshot:context_id, timestamp:currentCtx.capturedAt, icl:currentCtx.icl } : null,
    comparison, evidence:seed.evidence_refs });
});

// ── QAVANAH CHECK · Étape 9 intégrée ─────────────────────────────────────────
// Q = f(I, C, T, A, R, Z)
// Scores calculés · non constants

app.post('/v1/qavanah/check', async (req, res) => {
  const { trajectoryId, intent, context, agent, action } = req.body;
  if (!trajectoryId) return res.status(400).json({ error:'TRAJECTORY_ID_REQUIRED', law:'BH-005' });

  const checkId = generateId('CHK'), checkedAt = now();

  // ── Moteur d'Alignement (Étape 9) · scores réels ───────────────────────────
  const { scores, signals } = computeAlignmentScores(intent, context, action,
    context && context.zera ? context.zera : null);

  // ── HSC Contract Binding (Phase 2) ─────────────────────────────────────────
  // Vérification séquentielle AVANT la décision finale
  // Qavanah ne fait pas confiance à l'état déclaré par l'agent
  let sequenceResult  = null;
  let sequenceDecision = null;

  const seqId   = action?.sequence_id || null;
  const stepId  = action?.step_id     || action?.type || null;

  if (seqId && stepId) {
    const contract = await loadSequenceContract(seqId);

    if (contract) {
      // Charger ou initialiser l'état séquentiel de cette trajectoire
      let seqState = await getSequenceState(trajectoryId, seqId);
      if (!seqState) {
        seqState = await initSequenceState(trajectoryId, seqId, contract);
      }

      const currentState = seqState.current_state;

      // Vérifier la transition
      const transitionCheck = checkTransition(contract, currentState, stepId);
      sequenceResult = {
        sequence_id:   seqId,
        current_state: currentState,
        proposed_step: stepId,
        ...transitionCheck
      };

      if (!transitionCheck.valid) {
        sequenceDecision = transitionCheck.decision; // BLOCK ou ADJUST
      }

      await logEvent('SequenceTransitionChecked', {
        trajectoryId, sequence_id: seqId,
        current_state: currentState,
        proposed_step: stepId,
        valid: transitionCheck.valid,
        reason: transitionCheck.reason
      });
    } else {
      sequenceResult = {
        sequence_id: seqId,
        error: 'CONTRACT_NOT_FOUND',
        note:  'Action évaluée sans contrat séquentiel'
      };
    }
  }

  // ── Décision finale · Moteur Déterministe + HSC Contract Binding ────────────
  // Priorité : HSC BLOCK > Déterministe > ALLOW
  const ruleResult = runDeterministicEngine(intent, context, action);

  // Si HSC dit BLOCK ou ADJUST · ça prime sur le moteur déterministe si celui-ci dit ALLOW
  let finalDecision = ruleResult.decision;
  let sequenceOverride = false;

  if (sequenceDecision && sequenceDecision !== 'ALLOW' && ruleResult.decision === 'ALLOW') {
    finalDecision    = sequenceDecision;
    sequenceOverride = true;
  }
  const compositeResult  = computeCompositeScore(scores);
  const tension          = computeTension(compositeResult.composite);
  const tensionSeries    = appendTension(trajectoryId, tension);
  const slope            = computeSlope(tensionSeries);
  const auc              = computeAUC(tensionSeries);
  const driftState       = computeDriftState(tension, slope, auc);

  // Signal précoce : slope seul peut déclencher WARNING avant tension élevée
  // QAV-DEV-001 §11 : "la pente détecte la dérive avant que le score final seul ne puisse la caractériser"
  const earlyDriftSignal = slope != null && slope > COA_THRESHOLDS.WARNING_SLOPE;

  // ── Référence Zera ──────────────────────────────────────────────────────────
  const contextZera = context && context.zera ? context.zera : null;
  const zeraRef = contextZera ? {
    zeraId:           contextZera.zera_id || null,
    seedVersion:      contextZera.seed_version || null,
    state:            contextZera.formation_state || null,
    present:          true,
    convergence:      signals.zera_convergence || null,
    convergenceNote:  signals.zera_convergence_note || null
  } : { present: false };

  const decisionPayload = {
    checkId, decision: finalDecision, trajectoryId,
    actionId: action?.id || null, mode: QAVANAH_MODE,

    // Scores d'alignement réels (Étape 9)
    alignment: {
      intent:    scores.intent,
      context:   scores.context,
      action:    scores.action,
      zera:      scores.zera,
      composite: compositeResult.composite,
      min_score: compositeResult.min_score
    },

    // Signals observationnels (pour calibration future)
    signals: {
      intent:           signals.intent,
      context:          signals.context,
      action:           signals.action,
      action_family:    signals.action_family || null,
      zera:             signals.zera || null,
      zera_convergence: signals.zera_convergence || null
    },

    zera: zeraRef,

    // HSC Contract Binding (Phase 2)
    sequence: sequenceResult ? {
      ...sequenceResult,
      override: sequenceOverride,
      note:     sequenceOverride
        ? `HSC override: ${sequenceResult.reason} → ${finalDecision}`
        : 'HSC check applied'
    } : null,

    // COA™ · Moteur de Trajectoire (Étape 10)
    // Mode OBSERVE : calculé · pas de blocage automatique (BH-068)
    drift: {
      state:            driftState,
      tension:          tension,
      slope:            slope,
      auc:              auc,
      step:             tensionSeries.length,
      series:           tensionSeries,
      early_signal:     earlyDriftSignal,
      thresholds:       COA_THRESHOLDS,
      composite_weights: compositeResult.weights,
      note:             'MODE_OBSERVE · pas_de_blocage_automatique · calibrage_requis'
    },

    authorization: { status: finalDecision === 'ALLOW' ? 'AUTHORIZED' : 'REFUSED' },

    reasonCodes: [
      ...ruleResult.reasonCodes,
      ...(sequenceResult && !sequenceResult.valid ? [`SEQ_${sequenceResult.reason}`] : [])
    ],
    evidence: [
      ...ruleResult.evidence,
      ...(sequenceResult?.valid ? [`SEQ_TRANSITION_VALID:${sequenceResult.current_state}→${sequenceResult.next_state}`] : [])
    ],

    next: finalDecision === 'ALLOW' ? 'EXECUTE'
        : finalDecision === 'ADJUST' ? 'RECOMPUTE' : 'STOP',

    checkedAt
  };

  inMemoryStore.decisions[checkId] = { ...decisionPayload, input:{ trajectoryId, intent, context, agent, action } };

  const eventType = finalDecision === 'ALLOW' ? 'DecisionAllowed'
    : finalDecision === 'ADJUST' ? 'DecisionAdjusted' : 'DecisionBlocked';

  // Log drift si signal détecté
  if (driftState !== 'NORMAL') {
    await logEvent('DriftDetected', {
      checkId, trajectoryId, driftState,
      tension, slope, auc, step: tensionSeries.length,
      earlySignal: earlyDriftSignal
    });
  }

  await logEvent(eventType, { checkId, trajectoryId, decision: finalDecision,
    actionType: action?.type, alignment: scores,
    coa: { tension, slope, auc, driftState },
    sequence: sequenceResult ? { id: seqId, step: stepId, valid: sequenceResult.valid } : null
  });
  await logEvent('ActionChecked', { checkId, trajectoryId, actionType: action?.type });

  res.json(decisionPayload);
});

// ── MONITORING ────────────────────────────────────────────────────────────────
app.get('/v1/trajectories/:id/signals', (req, res) => {
  const { id } = req.params;
  const events    = inMemoryStore.events.filter(e => e.payload && e.payload.trajectoryId === id);
  const decisions = Object.values(inMemoryStore.decisions).filter(d => d.trajectoryId === id);
  const series    = getTensionSeries(id);
  const driftEvents = events.filter(e => e.eventType === 'DriftDetected');

  // Recalcul des métriques COA depuis la série complète
  const slope = computeSlope(series);
  const auc   = computeAUC(series);
  const driftState = series.length > 0
    ? computeDriftState(series[series.length-1], slope, auc)
    : 'NORMAL';

  res.json({
    trajectoryId: id,
    eventCount:   events.length,
    events,
    decisions,
    coa: {
      tensionSeries:  series,
      steps:          series.length,
      currentTension: series.length > 0 ? series[series.length-1] : null,
      slope,
      auc,
      driftState,
      driftEvents,
      thresholds: COA_THRESHOLDS,
      note: 'MODE_OBSERVE · pas_de_blocage_automatique'
    }
  });
});

app.get('/v1/trajectories/:id/decision', (req, res) => {
  const { id } = req.params;
  const decisions = Object.values(inMemoryStore.decisions)
    .filter(d => d.trajectoryId === id)
    .sort((a,b) => new Date(b.checkedAt) - new Date(a.checkedAt));
  if (decisions.length === 0) return res.status(404).json({ error:'NO_DECISION_FOR_TRAJECTORY' });
  res.json({ trajectoryId:id, latest:decisions[0], history:decisions });
});

// ── REANCHOR avec reset COA ───────────────────────────────────────────────────
// Décision v0.5.0 : RE-ANCHOR archive la série passée et ouvre série_v2 = [0]
// La mémoire historique reste accessible · la nouvelle ancre ouvre une nouvelle fenêtre

app.post('/v1/intents/:contractId/reanchor', async (req, res) => {
  const { contractId } = req.params;
  const { trajectoryId, reason, objectives, constraints, scope } = req.body;

  // Trouver la version courante
  const existing = Object.values(inMemoryStore.intent_anchors)
    .filter(a => a.contractId === contractId)
    .sort((a, b) => b.version - a.version)[0];

  if (!existing) {
    return res.status(404).json({
      error: 'ANCHOR_NOT_FOUND',
      hint: 'POST /v1/intents/:id/anchor requis avant reanchor · loi BH-001'
    });
  }

  const newVersion = existing.version + 1;
  const hash       = hashObject({ contractId, intentVersion: newVersion, objectives, constraints, scope });
  const anchorId   = generateId('ANC');
  const createdAt  = now();

  const anchor = {
    id: anchorId, contractId, trajectoryId,
    version: newVersion, hash: `sha256:${hash}`,
    embeddingModel: 'none-v0.1', embeddingVersion: '0.1',
    source: 'USER_CONFIRMED', objectives, constraints, scope,
    sealed: true, createdAt,
    reanchorReason: reason || 'USER_CHANGED_INTENT'
  };

  inMemoryStore.intent_anchors[anchorId] = anchor;

  // Reset COA : archiver la série passée · ouvrir nouvelle fenêtre (Décision C)
  let coaResetResult = null;
  if (trajectoryId) {
    coaResetResult = await resetCOAWindow({
      trajectoryId,
      reason: reason || 'USER_CHANGED_INTENT',
      trigger: 'RE_ANCHOR',
      actor: 'system'
    });
  }

  await logEvent('IntentReanchored', {
    trajectoryId, contractId,
    previousVersion: existing.version,
    newVersion, reason
  });

  res.status(201).json({
    intentAnchor:    anchor,
    event:           'RE-ANCHOR',
    previousVersion: existing.version,
    coa: coaResetResult || { reset: false, note: 'trajectoryId absent' }
  });
});

// ── TERRITORY ACTION LAYER™ · SIMULÉ (Étape 13) ───────────────────────────────
// TAL simulé dans qavanah-api · pas encore connecté à McOmH.ai
// Loi : le TAL ne reçoit que depuis un ALLOW explicite de Qavanah (BH-384)
// Catalogue actions simulées avec résultats réalistes pour Cocody

const TAL_SIMULATED_RESULTS = {
  FLY_TO: (params) => ({
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: true,
    destination: params.icl || params.coordinates || 'inconnu',
    mapState: { zoom: 16, centered: true }
  }),
  HIGHLIGHT_ROAD: (params) => ({
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: true, road: params.roadName || 'voie inconnue', highlighted: true
  }),
  HIGHLIGHT_PLACE: (params) => ({
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: true, place: params.placeName || 'lieu inconnu', highlighted: true
  }),
  ZOOM_TO: (params) => ({
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: true, zoom: params.level || 15
  }),
  RESET_VIEW: () => ({
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: true, mapState: { zoom: 12, centered: false }
  }),
  PLACE_MARKER: (params) => ({
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: true, marker: { icl: params.icl || null, label: params.label || 'Marqueur' }
  }),
  START_GPS: () => ({
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: true, gps: { status: 'ACTIVE', accuracy: 10 }
  }),
};

// Exécution TAL hybride : PADA Adapter pour SEARCH_* · simulation pour les autres
async function executeTAL(action, contextIcl) {
  const type   = action.type;
  const params = action.parameters || {};

  // SEARCH_PLACE → PADA Adapter (REAL si possible) · tri par proximité ICL
  if (type === 'SEARCH_PLACE') {
    return await padaSearchPlace(params.query || '', contextIcl || null);
  }

  // SEARCH_NUMBER → PADA Adapter (REAL si possible · Loi Non-invention)
  if (type === 'SEARCH_NUMBER') {
    return await padaSearchNumber(params.query || '', params);
  }

  // CALCULATE_ROUTE → simulation (pas encore connecté)
  if (type === 'CALCULATE_ROUTE') {
    return {
      execution_mode: 'SIMULATED', provider: 'SIMULATION',
      executed: true,
      route: {
        from: params.from || null,
        to:   params.to   || null,
        steps: [],
        note: 'ROUTE_ENGINE_NOT_YET_CONNECTED'
      }
    };
  }

  // Actions cartographiques → simulation
  const simulator = TAL_SIMULATED_RESULTS[type];
  if (simulator) return simulator(params);

  return {
    execution_mode: 'SIMULATED', provider: 'SIMULATION',
    executed: false, reason: 'ACTION_NOT_IMPLEMENTED'
  };
}

app.post('/v1/tal/execute', async (req, res) => {
  const { decisionId, actionId, action, trajectoryId, contextIcl } = req.body;

  // Vérification : l'action ne peut entrer dans le TAL que depuis un ALLOW
  // Récupérer la décision depuis le store
  const decision = decisionId ? inMemoryStore.decisions[decisionId] : null;

  if (decisionId) {
    // Cas 1 · decisionId fourni mais décision introuvable → PREMATURE_EXECUTION
    if (!decision) {
      await logEvent('TALBlocked', {
        trajectoryId, decisionId, actionId,
        reason: 'AUTHORIZATION_NOT_FOUND'
      });
      return res.status(403).json({
        error:      'TAL_BLOCKED',
        reason:     'AUTHORIZATION_NOT_FOUND · token introuvable ou expiré',
        law:        'BH-384 · Autorisation préalable obligatoire',
        decisionId,
        expected:   'ALLOW',
        received:   'NOT_FOUND'
      });
    }
    // Cas 2 · décision trouvée mais pas ALLOW
    if (decision.decision !== 'ALLOW') {
      await logEvent('TALBlocked', {
        trajectoryId, decisionId, actionId,
        reason: `DECISION_WAS_${decision.decision}_NOT_ALLOW`
      });
      return res.status(403).json({
        error:      'TAL_BLOCKED',
        reason:     `La décision ${decisionId} est ${decision.decision} · pas ALLOW`,
        law:        'BH-384 · BH-390 · Autorisation préalable obligatoire',
        decisionId,
        expected:   'ALLOW',
        received:   decision.decision
      });
    }
  }

  if (!action || !action.type) {
    return res.status(400).json({ error: 'ACTION_TYPE_REQUIRED' });
  }

  // Exécution hybride PADA Adapter (Étape 15) · contextIcl pour tri proximité
  const result    = await executeTAL(action, contextIcl || null);
  const executedAt = now();

  // Validation : test REAL invalide si provider = SIMULATION et PADA_API_URL définie
  const validationWarning = PADA_API_URL && result.provider === 'SIMULATION'
    ? 'WARNING · PADA_API_URL définie mais résultat SIMULATED · vérifier connectivité'
    : null;
  const actionResult = {
    actionId:        actionId || generateId('ACT'),
    type:            action.type,
    execution_mode:  result.execution_mode || 'SIMULATED',
    provider:        result.provider       || 'SIMULATION',
    status:          result.found === false && result.status === 'NO_DATA' ? 'NO_DATA'
                     : result.execution_mode === 'SIMULATED' ? 'SUCCESS_SIMULATED'
                     : 'SUCCESS',
    result,
    executedAt,
    source:          result.execution_mode === 'REAL'
                     ? 'territory-action-layer-real'
                     : 'territory-action-layer-simulated',
    decisionId:      decisionId || null,
    trajectoryId:    trajectoryId || null,
    validation_warning: validationWarning
  };

  // Stocker le résultat pour la boucle Ayin haMakom™
  if (actionResult.actionId) {
    inMemoryStore[`result_${actionResult.actionId}`] = actionResult;
  }

  await logEvent('ActionExecuted', {
    trajectoryId, actionId: actionResult.actionId,
    type: action.type, status: actionResult.status
  });

  await logEvent('ActionResultReceived', {
    trajectoryId, actionId: actionResult.actionId,
    status: actionResult.status
  });

  res.json({
    actionResult,
    next: 'RETURN_TO_AYIN_HAMAKOM',
    execution_mode: actionResult.execution_mode,
    provider:       actionResult.provider,
    pada_api_url:   PADA_API_URL ? 'configured' : 'absent',
    note: actionResult.execution_mode === 'REAL'
      ? 'TAL_REAL · données PADA territoriales'
      : 'TAL_SIMULATED · connecter PADA_API_URL pour données réelles'
  });
});

// GET historique des résultats d'une trajectoire
app.get('/v1/trajectories/:id/results', (req, res) => {
  const { id } = req.params;
  const results = Object.entries(inMemoryStore)
    .filter(([k]) => k.startsWith('result_'))
    .map(([, v]) => v)
    .filter(r => r.trajectoryId === id);
  res.json({ trajectoryId: id, results });
});

// GET archives COA d'une trajectoire (mémoire historique)
app.get('/v1/trajectories/:id/coa-archives', (req, res) => {
  const { id } = req.params;
  const archives = Object.entries(inMemoryStore)
    .filter(([k]) => k.startsWith(`coa_archive_${id}`))
    .map(([k, v]) => ({ key: k, ...v }));
  const currentSeries = getTensionSeries(id);
  res.json({ trajectoryId: id, currentSeries, archives });
});

// ── POST /v1/trajectories/:id/reset-coa · Reset explicite (Décision C) ───────
// Trigger : OPERATOR | EXTERNAL_VALIDATION
// reason obligatoire · événement d'audit immuable

app.post('/v1/trajectories/:id/reset-coa', async (req, res) => {
  const { id } = req.params;
  const { reason, actor } = req.body;

  if (!reason) {
    return res.status(400).json({
      error:  'REASON_REQUIRED',
      law:    'Décision C v0.6.0 · reason obligatoire pour tout reset explicite',
      hint:   '{ "reason": "new_observation_window" }'
    });
  }

  const coaResult = await resetCOAWindow({
    trajectoryId: id,
    reason,
    trigger: 'OPERATOR',
    actor:   actor || 'operator'
  });

  res.json({
    trajectoryId: id,
    event:        'COA_WINDOW_RESET',
    trigger:      'OPERATOR',
    ...coaResult
  });
});

// GET archives COA complètes (toutes fenêtres)
app.get('/v1/trajectories/:id/coa-archives', (req, res) => {
  const { id } = req.params;
  const archives = Object.entries(inMemoryStore)
    .filter(([k]) => k.startsWith(`coa_archive_${id}_w`))
    .map(([, v]) => v)
    .sort((a, b) => a.windowNumber - b.windowNumber);
  const currentSeries = getTensionSeries(id);
  const currentSlope  = computeSlope(currentSeries);
  const currentAUC    = computeAUC(currentSeries);
  const currentState  = currentSeries.length > 0
    ? computeDriftState(currentSeries[currentSeries.length-1], currentSlope, currentAUC)
    : 'NORMAL';

  res.json({
    trajectoryId:  id,
    totalWindows:  archives.length + 1,
    activeWindow: {
      windowId:    `coa_series_${id}`,
      series:      currentSeries,
      steps:       currentSeries.length,
      tension:     currentSeries.length > 0 ? currentSeries[currentSeries.length-1] : null,
      slope:       currentSlope,
      auc:         currentAUC,
      state:       currentState
    },
    archivedWindows: archives
  });
});

// ── ÉTAPE 14 · ACTION_RESULT enrichi · Boucle Ayin haMakom™ ──────────────────
// Fermeture complète : ACTION_RESULT → contexte enrichi → prochain contrôle
// BH-154 : Tout est spirale · rien ne se perd

app.post('/v1/ayin/integrate', async (req, res) => {
  const { trajectoryId, actionId, actionResult, icl } = req.body;

  if (!actionResult) {
    return res.status(400).json({ error: 'ACTION_RESULT_REQUIRED' });
  }

  const integrationId = generateId('AYN');
  const integratedAt  = now();

  // Construire le nouveau ContextSnapshot N+1
  const newContextId = generateId('CTX');
  const contextN1 = {
    contextId:   newContextId,
    trajectoryId,
    icl:         icl || null,
    source:      'AYIN_HAMAKOM_INTEGRATION',
    actionId:    actionId || null,
    actionResult,
    integratedAt,
    version:     'N+1',
    frozen:      true,
    place:   actionResult.result?.place || {},
    state:   {
      lastAction:   actionResult.type || null,
      lastStatus:   actionResult.status,
      lastFocus:    actionResult.result?.place?.icl || icl || null,
      updatedAt:    integratedAt
    }
  };

  // Persister le nouveau contexte
  inMemoryStore.context_snapshots[newContextId] = contextN1;

  await logEvent('ActionResultIntegrated', {
    trajectoryId, actionId, integrationId,
    newContextId,
    icl: contextN1.state.lastFocus,
    status: actionResult.status
  });

  await logEvent('AyinHaMakomUpdated', {
    trajectoryId,
    previousContext: null,
    newContext: newContextId,
    trigger: 'ACTION_RESULT'
  });

  res.json({
    integrationId,
    event:          'AYIN_HAMAKOM_UPDATED',
    trajectoryId,
    newContext:     contextN1,
    next:           'QAVANAH_CHECK_WITH_NEW_CONTEXT',
    loop:           'PERCEPTION → ACTION → RESULT → CONTEXT_N+1 → PERCEPTION',
    note:           'Boucle fermée · prochain contrôle depuis le nouveau contexte'
  });
});

// ── HSC REGISTRY · Phase 1 ───────────────────────────────────────────────────
// HSC-INT-DEV-001 · Sequence Contract™ · mémoire constitutive commune
// HSC construit le droit séquentiel · Qavanah garde ce droit
//
// Loi : une séquence ambiguë ou incomplète ne devient jamais ACTIVE
// Loi : HSC ne doit jamais inventer l'antérieur
// Loi : mode compilation uniquement · pas appelé à chaque requête

function computeChecksum(contract) {
  const crypto = require('crypto');
  const data = JSON.stringify({
    sequence_id:   contract.sequence_id,
    version:       contract.version,
    states:        contract.states,
    transitions:   contract.transitions,
    preconditions: contract.preconditions,
    manifestation: contract.manifestation
  });
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

function validateContract(contract) {
  const errors = [];

  if (!contract.sequence_id) errors.push('SEQUENCE_ID_REQUIRED');
  if (!contract.version)     errors.push('VERSION_REQUIRED');
  if (!Array.isArray(contract.states) || contract.states.length < 2)
    errors.push('STATES_MINIMUM_2');

  // Vérifier que START existe
  if (contract.states && !contract.states.includes('START'))
    errors.push('STATES_MISSING_START');

  // Vérifier la non-inversion : chaque transition doit pointer vers un état connu
  if (contract.transitions && Array.isArray(contract.transitions)) {
    for (const t of contract.transitions) {
      if (!contract.states.includes(t.from)) errors.push(`TRANSITION_UNKNOWN_FROM:${t.from}`);
      if (!contract.states.includes(t.to))   errors.push(`TRANSITION_UNKNOWN_TO:${t.to}`);
    }
  }

  return errors;
}

// POST /v1/sequences · Enregistrer un Sequence Contract™
app.post('/v1/sequences', async (req, res) => {
  const {
    sequence_id, version = '1.0',
    problem_id = null, law_id = null, hoq_id = null,
    states = [], preconditions = {}, transitions = [],
    manifestation = {}, status = 'DRAFT'
  } = req.body;

  if (!sequence_id) {
    return res.status(400).json({ error: 'SEQUENCE_ID_REQUIRED' });
  }

  // Validation structurelle (HSC ne doit jamais laisser passer une séquence incomplète)
  const errors = validateContract({ sequence_id, version, states, transitions, preconditions, manifestation });
  if (errors.length > 0 && status === 'ACTIVE') {
    return res.status(400).json({
      error:  'INVALID_SEQUENCE',
      status: 'REJECTED',
      errors,
      law:    'HSC-INT-DEV-001 §14 : une séquence incomplète ne devient jamais ACTIVE'
    });
  }

  const createdAt = now();
  const contract = {
    sequence_id, version,
    problem_id, law_id, hoq_id,
    states, preconditions, transitions, manifestation,
    status: errors.length > 0 ? 'DRAFT' : status,
    created_at: createdAt,
    checksum:   computeChecksum({ sequence_id, version, states, transitions, preconditions, manifestation })
  };

  // Persister en mémoire
  inMemoryStore.sequence_contracts[sequence_id] = contract;

  // Persister en PostgreSQL
  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_sequence_contracts
         (sequence_id, version, problem_id, law_id, hoq_id,
          states, preconditions, transitions, manifestation,
          status, created_at, checksum)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (sequence_id) DO UPDATE SET
           version=EXCLUDED.version, status=EXCLUDED.status,
           states=EXCLUDED.states, transitions=EXCLUDED.transitions,
           preconditions=EXCLUDED.preconditions,
           manifestation=EXCLUDED.manifestation,
           checksum=EXCLUDED.checksum`,
        [sequence_id, version, problem_id, law_id, hoq_id,
         JSON.stringify(states), JSON.stringify(preconditions),
         JSON.stringify(transitions), JSON.stringify(manifestation),
         contract.status, createdAt, contract.checksum]
      );
    } catch (e) {
      console.error('[HSC-REGISTRY] DB error :', e.message);
    }
  }

  await logEvent('SequenceContractRegistered', {
    sequence_id, version, status: contract.status, checksum: contract.checksum
  });

  res.status(201).json({
    contract,
    registered: true,
    validation: errors.length > 0 ? { warnings: errors } : { valid: true }
  });
});

// GET /v1/sequences/:id · Lire un Sequence Contract™
app.get('/v1/sequences/:id', async (req, res) => {
  const { id } = req.params;

  if (db) {
    try {
      const r = await db.query(
        'SELECT * FROM qav_sequence_contracts WHERE sequence_id = $1', [id]
      );
      if (r.rows.length > 0) {
        const row = r.rows[0];
        return res.json({
          contract: {
            ...row,
            states:        row.states,
            preconditions: row.preconditions,
            transitions:   row.transitions,
            manifestation: row.manifestation
          }
        });
      }
    } catch (e) {
      console.error('[HSC-REGISTRY] DB read error :', e.message);
    }
  }

  const contract = inMemoryStore.sequence_contracts[id];
  if (!contract) {
    return res.status(404).json({
      error: 'SEQUENCE_NOT_FOUND',
      id,
      hint: 'POST /v1/sequences pour enregistrer un Sequence Contract™'
    });
  }

  res.json({ contract });
});

// GET /v1/sequences · Lister tous les contrats
app.get('/v1/sequences', async (req, res) => {
  const { status } = req.query;

  if (db) {
    try {
      const query = status
        ? 'SELECT sequence_id, version, status, problem_id, law_id, hoq_id, created_at, checksum FROM qav_sequence_contracts WHERE status = $1 ORDER BY created_at DESC'
        : 'SELECT sequence_id, version, status, problem_id, law_id, hoq_id, created_at, checksum FROM qav_sequence_contracts ORDER BY created_at DESC';
      const params = status ? [status] : [];
      const r = await db.query(query, params);
      return res.json({ contracts: r.rows, total: r.rows.length });
    } catch (e) {
      console.error('[HSC-REGISTRY] DB list error :', e.message);
    }
  }

  const contracts = Object.values(inMemoryStore.sequence_contracts)
    .filter(c => !status || c.status === status)
    .map(c => ({
      sequence_id: c.sequence_id, version: c.version, status: c.status,
      problem_id: c.problem_id, law_id: c.law_id, hoq_id: c.hoq_id,
      created_at: c.created_at, checksum: c.checksum
    }));

  res.json({ contracts, total: contracts.length });
});

// PATCH /v1/sequences/:id/status · Changer le statut d'un contrat
app.patch('/v1/sequences/:id/status', async (req, res) => {
  const { id }    = req.params;
  const { status } = req.body;

  const VALID_STATUSES = ['DRAFT', 'VALIDATED', 'ACTIVE', 'DEPRECATED', 'REJECTED'];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error:  'INVALID_STATUS',
      valid:  VALID_STATUSES
    });
  }

  const contract = inMemoryStore.sequence_contracts[id];
  if (!contract) {
    return res.status(404).json({ error: 'SEQUENCE_NOT_FOUND' });
  }

  // Règle : ne peut devenir ACTIVE que si validation structurelle passe
  if (status === 'ACTIVE') {
    const errors = validateContract(contract);
    if (errors.length > 0) {
      return res.status(400).json({
        error:  'CANNOT_ACTIVATE',
        errors,
        law:    'HSC-INT-DEV-001 §14'
      });
    }
  }

  const previousStatus = contract.status;
  contract.status = status;

  if (db) {
    try {
      await db.query(
        'UPDATE qav_sequence_contracts SET status = $1 WHERE sequence_id = $2',
        [status, id]
      );
    } catch (e) {
      console.error('[HSC-REGISTRY] DB update error :', e.message);
    }
  }

  await logEvent('SequenceContractStatusChanged', {
    sequence_id: id, previousStatus, newStatus: status
  });

  res.json({ sequence_id: id, previousStatus, status, updated: true });
});

// ── HSC CONTRACT BINDING · Phase 2 ──────────────────────────────────────────
// Qavanah maintient l'état séquentiel persistant par trajectoire
// L'état n'avance QU'APRÈS ACTION_RESULT confirmé · jamais sur ALLOW seul
// Règle canonique : Qavanah ne fait pas confiance à l'état déclaré par l'agent

// Charger un Sequence Contract depuis le Registry
async function loadSequenceContract(sequence_id) {
  if (!sequence_id) return null;

  // Mémoire d'abord
  if (inMemoryStore.sequence_contracts[sequence_id]) {
    return inMemoryStore.sequence_contracts[sequence_id];
  }

  // PostgreSQL si absent en mémoire
  if (db) {
    try {
      const r = await db.query(
        'SELECT * FROM qav_sequence_contracts WHERE sequence_id = $1 AND status = $2',
        [sequence_id, 'ACTIVE']
      );
      if (r.rows.length > 0) {
        inMemoryStore.sequence_contracts[sequence_id] = r.rows[0];
        return r.rows[0];
      }
    } catch (e) {
      console.error('[HSC-BINDING] loadSequenceContract error:', e.message);
    }
  }

  return null;
}

// Lire l'état séquentiel courant d'une trajectoire
async function getSequenceState(trajectoryId, sequence_id) {
  const key = `seq_state_${trajectoryId}_${sequence_id}`;

  if (inMemoryStore.sequence_states[key]) {
    return inMemoryStore.sequence_states[key];
  }

  if (db) {
    try {
      const r = await db.query(
        'SELECT * FROM qav_sequence_states WHERE trajectory_id = $1 AND sequence_id = $2',
        [trajectoryId, sequence_id]
      );
      if (r.rows.length > 0) {
        inMemoryStore.sequence_states[key] = r.rows[0];
        return r.rows[0];
      }
    } catch (e) {
      console.error('[HSC-BINDING] getSequenceState error:', e.message);
    }
  }

  return null;
}

// Initialiser l'état séquentiel d'une trajectoire (premier appel)
async function initSequenceState(trajectoryId, sequence_id, contract) {
  const key       = `seq_state_${trajectoryId}_${sequence_id}`;
  const createdAt = now();
  const state = {
    trajectory_id:  trajectoryId,
    sequence_id,
    current_state:  'START',
    previous_state: null,
    last_action:    null,
    steps_completed: 0,
    created_at:     createdAt,
    updated_at:     createdAt,
    status:         'IN_PROGRESS'
  };

  inMemoryStore.sequence_states[key] = state;

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_sequence_states
         (trajectory_id, sequence_id, current_state, previous_state,
          last_action, steps_completed, created_at, updated_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (trajectory_id, sequence_id) DO NOTHING`,
        [trajectoryId, sequence_id, 'START', null, null, 0, createdAt, createdAt, 'IN_PROGRESS']
      );
    } catch (e) {
      console.error('[HSC-BINDING] initSequenceState error:', e.message);
    }
  }

  return state;
}

// Vérifier si une transition est légitime selon le contrat
function checkTransition(contract, currentState, proposedStep) {
  if (!contract || !contract.transitions) {
    return { valid: false, reason: 'NO_CONTRACT' };
  }

  const transitions = Array.isArray(contract.transitions)
    ? contract.transitions
    : Object.values(contract.transitions);

  // Chercher la transition demandée
  const transition = transitions.find(
    t => t.from === currentState && (t.to === proposedStep || t.action === proposedStep)
  );

  if (!transition) {
    // Chercher si l'étape existe dans le contrat (mais depuis un autre état)
    const stepExists = transitions.some(
      t => t.to === proposedStep || t.action === proposedStep
    );

    if (stepExists) {
      // L'étape existe mais n'est pas accessible depuis l'état courant
      const validFrom = transitions
        .filter(t => t.to === proposedStep || t.action === proposedStep)
        .map(t => t.from);
      return {
        valid:          false,
        reason:         'PREMATURE_STEP',
        current_state:  currentState,
        proposed_step:  proposedStep,
        valid_from:     validFrom,
        decision:       'BLOCK',
        hint:           `SHOW_PLACE requires completing: ${validFrom.join(', ')}`
      };
    }

    return {
      valid:         false,
      reason:        'UNKNOWN_STEP',
      current_state: currentState,
      proposed_step: proposedStep,
      decision:      'BLOCK'
    };
  }

  // Vérifier les préconditions
  const preconditions = contract.preconditions?.[proposedStep] || [];

  return {
    valid:         true,
    reason:        'TRANSITION_VALID',
    current_state: currentState,
    next_state:    transition.to,
    action:        transition.action,
    requires:      transition.requires || [],
    preconditions,
    decision:      'ALLOW'
  };
}

// Avancer l'état séquentiel APRÈS confirmation ACTION_RESULT
async function advanceSequenceState(trajectoryId, sequence_id, next_state, action) {
  const key       = `seq_state_${trajectoryId}_${sequence_id}`;
  const existing  = inMemoryStore.sequence_states[key];
  const updatedAt = now();

  const updated = {
    ...(existing || {}),
    trajectory_id:   trajectoryId,
    sequence_id,
    previous_state:  existing?.current_state || 'START',
    current_state:   next_state,
    last_action:     action,
    steps_completed: (existing?.steps_completed || 0) + 1,
    updated_at:      updatedAt,
    status:          'IN_PROGRESS'
  };

  inMemoryStore.sequence_states[key] = updated;

  if (db) {
    try {
      await db.query(
        `INSERT INTO qav_sequence_states
         (trajectory_id, sequence_id, current_state, previous_state,
          last_action, steps_completed, created_at, updated_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (trajectory_id, sequence_id)
         DO UPDATE SET
           current_state = EXCLUDED.current_state,
           previous_state = EXCLUDED.previous_state,
           last_action = EXCLUDED.last_action,
           steps_completed = EXCLUDED.steps_completed,
           updated_at = EXCLUDED.updated_at`,
        [trajectoryId, sequence_id, next_state,
         updated.previous_state, action,
         updated.steps_completed,
         updated.created_at || updatedAt, updatedAt, 'IN_PROGRESS']
      );
    } catch (e) {
      console.error('[HSC-BINDING] advanceSequenceState error:', e.message);
    }
  }

  await logEvent('SequenceStateAdvanced', {
    trajectoryId, sequence_id,
    previousState: updated.previous_state,
    newState:      next_state,
    action,
    stepsCompleted: updated.steps_completed
  });

  return updated;
}

// GET /v1/sequences/state/:trajectoryId/:sequenceId · État courant d'une trajectoire
app.get('/v1/sequences/state/:trajectoryId/:sequenceId', async (req, res) => {
  const { trajectoryId, sequenceId } = req.params;

  const state = await getSequenceState(trajectoryId, sequenceId);
  if (!state) {
    return res.status(404).json({
      error: 'SEQUENCE_STATE_NOT_FOUND',
      trajectoryId,
      sequenceId,
      hint: 'L\'état est initialisé au premier appel /v1/qavanah/check avec sequence_id'
    });
  }
  res.json({ state });
});

// POST /v1/sequences/state/advance · Avancer l'état après ACTION_RESULT confirmé
// Appelé uniquement après que TAL a confirmé l'exécution
app.post('/v1/sequences/state/advance', async (req, res) => {
  const { trajectoryId, sequence_id, next_state, action, actionResultId } = req.body;

  if (!trajectoryId || !sequence_id || !next_state) {
    return res.status(400).json({ error: 'TRAJECTORY_ID + SEQUENCE_ID + NEXT_STATE REQUIRED' });
  }

  // Vérifier que le contrat existe
  const contract = await loadSequenceContract(sequence_id);
  if (!contract) {
    return res.status(404).json({ error: 'SEQUENCE_CONTRACT_NOT_FOUND', sequence_id });
  }

  // Vérifier que next_state existe dans les états du contrat
  const states = Array.isArray(contract.states) ? contract.states : [];
  if (!states.includes(next_state)) {
    return res.status(400).json({
      error:       'INVALID_NEXT_STATE',
      next_state,
      valid_states: states
    });
  }

  const updated = await advanceSequenceState(trajectoryId, sequence_id, next_state, action);

  res.json({
    advanced:       true,
    trajectoryId,
    sequence_id,
    previousState:  updated.previous_state,
    currentState:   updated.current_state,
    stepsCompleted: updated.steps_completed,
    trigger:        'ACTION_RESULT_CONFIRMED',
    actionResultId: actionResultId || null
  });
});

// ── INIT DB ───────────────────────────────────────────────────────────────────
async function initDb() {
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS qav_trajectories (
        trajectory_id TEXT PRIMARY KEY, assessment_id TEXT, session_id TEXT, agent_id TEXT,
        intent_contract_id TEXT, intent_version INTEGER DEFAULT 1,
        intent_source TEXT DEFAULT 'PROVISIONAL', status TEXT DEFAULT 'OPEN',
        mode TEXT DEFAULT 'OBSERVE', created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS qav_intent_anchors (
        id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, trajectory_id TEXT,
        version INTEGER DEFAULT 1, hash TEXT, source TEXT DEFAULT 'PROVISIONAL',
        objectives JSONB DEFAULT '[]', constraints JSONB DEFAULT '[]',
        scope JSONB DEFAULT '{}', sealed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS qav_context_snapshots (
        context_id TEXT PRIMARY KEY, trajectory_id TEXT, icl TEXT,
        place JSONB DEFAULT '{}', presence JSONB DEFAULT '{}', state JSONB DEFAULT '{}',
        relations JSONB DEFAULT '[]', resources JSONB DEFAULT '[]', rules JSONB DEFAULT '[]',
        zera JSONB DEFAULT NULL, version INTEGER DEFAULT 1,
        captured_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS qav_proposed_actions (
        action_id TEXT PRIMARY KEY, type TEXT NOT NULL, parameters JSONB DEFAULT '{}',
        requested_by TEXT, trajectory_id TEXT, status TEXT DEFAULT 'PROPOSED',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS qav_decisions (
        check_id TEXT PRIMARY KEY, trajectory_id TEXT, decision TEXT NOT NULL,
        reason_codes JSONB DEFAULT '[]', evidence JSONB DEFAULT '[]',
        alignment JSONB DEFAULT '{}', signals JSONB DEFAULT '{}',
        mode TEXT, checked_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS qav_events (
        id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
        payload JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS qav_place_seeds (
        id TEXT PRIMARY KEY, zera_id TEXT NOT NULL, icl TEXT,
        seed_version INTEGER DEFAULT 1, source_type TEXT, source_ref TEXT,
        place_candidate_id TEXT,
        spatial_signature JSONB DEFAULT '{}', structural_signature JSONB DEFAULT '{}',
        relational_signature JSONB DEFAULT '{}', territorial_signature JSONB DEFAULT '{}',
        observed_features JSONB DEFAULT '{}', inferred_features JSONB DEFAULT '{}',
        formation_state TEXT DEFAULT 'FORMED', confidence NUMERIC DEFAULT 1.0,
        evidence_refs JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW(),
        valid_from TIMESTAMPTZ DEFAULT NOW(), valid_until TIMESTAMPTZ DEFAULT NULL,
        status TEXT DEFAULT 'ACTIVE'
      );
      ALTER TABLE qav_context_snapshots ADD COLUMN IF NOT EXISTS zera JSONB DEFAULT NULL;
      ALTER TABLE qav_decisions ADD COLUMN IF NOT EXISTS signals JSONB DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS qav_sequence_contracts (
        sequence_id   TEXT PRIMARY KEY,
        version       TEXT NOT NULL DEFAULT '1.0',
        problem_id    TEXT,
        law_id        TEXT,
        hoq_id        TEXT,
        states        JSONB DEFAULT '[]',
        preconditions JSONB DEFAULT '{}',
        transitions   JSONB DEFAULT '[]',
        manifestation JSONB DEFAULT '{}',
        status        TEXT DEFAULT 'DRAFT',
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        checksum      TEXT
      );
      CREATE TABLE IF NOT EXISTS qav_sequence_states (
        trajectory_id    TEXT NOT NULL,
        sequence_id      TEXT NOT NULL,
        current_state    TEXT NOT NULL DEFAULT 'START',
        previous_state   TEXT,
        last_action      TEXT,
        steps_completed  INTEGER DEFAULT 0,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW(),
        status           TEXT DEFAULT 'IN_PROGRESS',
        PRIMARY KEY (trajectory_id, sequence_id)
      );
    `);
    console.log('[QAVANAH] Tables vérifiées / créées v0.7.0 · incl. qav_sequence_contracts');

    // ── SEED · Premier Sequence Contract™ · SEQ-SEARCH-PLACE-001 ─────────────
    // HSC-INT-DEV-001 §10 · Premier cas Or-Waffan™ · RUE TANO ATCHIMON
    // Compilé depuis la généalogie : PROBLÈME → LOI → HOQ → SÉQUENCE
    const seqCheck = await client.query(
      "SELECT sequence_id FROM qav_sequence_contracts WHERE sequence_id = 'SEQ-SEARCH-PLACE-001'"
    );

    if (seqCheck.rows.length === 0) {
      const seq = {
        sequence_id: 'SEQ-SEARCH-PLACE-001',
        version:     '1.0',
        problem_id:  'PROB-OR-HABAYIT-001',  // Or haBayit ne connaît pas la voie proche
        law_id:      'BH-159',               // Le Lieu précède le Souffle
        hoq_id:      'BH-163',               // Lieu → Contexte → Parole → Forme : séquence irréversible
        states:      ['START','RESOLVE_ICL','CAPTURE_CONTEXT','SEARCH_PLACE','RESOLVE_RESULT','SHOW_PLACE'],
        preconditions: {
          RESOLVE_ICL:     ['GPS_AVAILABLE'],
          CAPTURE_CONTEXT: ['ICL_RESOLVED'],
          SEARCH_PLACE:    ['CONTEXT_CAPTURED'],
          RESOLVE_RESULT:  ['SEARCH_EXECUTED'],
          SHOW_PLACE:      ['RESULT_RESOLVED']
        },
        transitions: [
          { from: 'START',          to: 'RESOLVE_ICL',     action: 'GPS_TO_ICL',      requires: ['GPS_AVAILABLE'] },
          { from: 'RESOLVE_ICL',    to: 'CAPTURE_CONTEXT', action: 'BUILD_CONTEXT',   requires: ['ICL_RESOLVED'] },
          { from: 'CAPTURE_CONTEXT',to: 'SEARCH_PLACE',    action: 'SEARCH_PLACE',    requires: ['CONTEXT_CAPTURED'] },
          { from: 'SEARCH_PLACE',   to: 'RESOLVE_RESULT',  action: 'RESOLVE_RESULT',  requires: ['SEARCH_EXECUTED'] },
          { from: 'RESOLVE_RESULT', to: 'SHOW_PLACE',      action: 'SHOW_PLACE',      requires: ['RESULT_RESOLVED'] }
        ],
        manifestation: { type: 'SHOW_PLACE', tal_action: 'HIGHLIGHT_PLACE' },
        status:    'ACTIVE',
        created_at: now(),
        checksum:  'seed-v1.0'
      };

      await client.query(
        `INSERT INTO qav_sequence_contracts
         (sequence_id, version, problem_id, law_id, hoq_id,
          states, preconditions, transitions, manifestation,
          status, created_at, checksum)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [seq.sequence_id, seq.version, seq.problem_id, seq.law_id, seq.hoq_id,
         JSON.stringify(seq.states), JSON.stringify(seq.preconditions),
         JSON.stringify(seq.transitions), JSON.stringify(seq.manifestation),
         seq.status, seq.created_at, seq.checksum]
      );

      // Charger en mémoire
      inMemoryStore.sequence_contracts[seq.sequence_id] = seq;
      console.log('[HSC-REGISTRY] SEQ-SEARCH-PLACE-001 v1.0 · ACTIVE · seedé');
    } else {
      console.log('[HSC-REGISTRY] SEQ-SEARCH-PLACE-001 déjà présent');
      // Charger depuis DB en mémoire
      const row = seqCheck.rows[0];
      const fullRow = await client.query(
        'SELECT * FROM qav_sequence_contracts WHERE sequence_id = $1',
        ['SEQ-SEARCH-PLACE-001']
      );
      if (fullRow.rows.length > 0) {
        inMemoryStore.sequence_contracts['SEQ-SEARCH-PLACE-001'] = fullRow.rows[0];
      }
    }
  } finally { client.release(); }
}

// ── DÉMARRAGE ─────────────────────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   QAVANAH API™ v0.8.0 · Le Gardien de Trajectoire   ║');
    console.log('║   Makom Intelligence™ · CorreIA LLC                  ║');
    console.log(`║   Port : ${PORT}  ·  Mode : ${QAVANAH_MODE.padEnd(7)}                    ║`);
    console.log('║   HSC Contract Binding · qav_sequence_states         ║');
    console.log('║   État avance après ACTION_RESULT uniquement         ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
  });
}).catch(err => {
  console.error('[QAVANAH] Erreur init DB :', err.message);
  process.exit(1);
});
