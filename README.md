# QAVANAH API™
## Le Gardien de Trajectoire
### Makom Intelligence™ · CorreIA LLC

> Ne construisez pas Qavanah comme un nouveau cerveau.  
> Construisez-le comme une porte de contrôle observable entre l'intention d'un agent et la manifestation de son action.

---

## Étapes couvertes : 0 → 8

| Étape | Module | Loi |
|---|---|---|
| 0 | Kernel | Indépendance |
| 1 | Trajectory Identity | BH-005 |
| 2 | Intent Contract | Source unique |
| 3 | Intent Anchor | Immutabilité |
| 4 | Context Snapshot | Contexte préalable |
| 5 | Proposed Action | Manifestation explicite |
| 6 | Rule Engine | BH-384 Autorisation |
| 7 | Decision Engine | ALLOW / ADJUST / BLOCK |
| 8 | Event Log | Traçabilité |

---

## Démarrage local

```bash
npm install
node src/server.js
```

## Tests d'acceptation

```bash
node tests/test-etape0.js
```

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3100` | Port du service |
| `QAVANAH_MODE` | `OBSERVE` | Mode opératoire : OBSERVE / SHADOW / ENFORCE |
| `DATABASE_URL` | — | PostgreSQL (optionnel, sinon in-memory) |

---

## Endpoints

```
GET  /health
GET  /version

POST /v1/trajectories
GET  /v1/trajectories/:id
GET  /v1/trajectories/:id/history
GET  /v1/trajectories/:id/signals
GET  /v1/trajectories/:id/decision

POST /v1/intents/:contractId/anchor
POST /v1/intents/:contractId/reanchor
GET  /v1/intents/:contractId

POST /v1/context/snapshot
GET  /v1/context/:id

POST /v1/actions/propose
POST /v1/actions/:id/result

POST /v1/qavanah/check
```

---

## Loi finale

```
IAG™         → établit l'intention
Ayin haMakom → établit le contexte
Agent / LLM  → propose
Qavanah      → contrôle
TAL          → exécute (si ALLOW)
Action Result → retourne l'état
Ayin haMakom → actualise le contexte
Qavanah      → contrôle la suite
```

---

*QAV-DEV-001 · v0.1.0 · 2026-08-13*  
*Makom Intelligence™ · CorreIA LLC · Scribe du Souffle · Midrash Haï Ben Nun ha✦Ayin*
