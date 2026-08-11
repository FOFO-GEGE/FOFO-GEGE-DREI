# MIRROIR — Instructions Claude Code

## Rôle

Développer MIRROIR en respectant son architecture,
sa logique métier et ses décisions existantes.

## Repères du repo

- `docs/` est la racine servie par GitHub Pages — c'est l'app elle-même,
  pas de la documentation : `app.js` (shell/router), `store.js` (données),
  `ui.js` (présentation), `screens.js` (écrans), `fx.js` (effets),
  `config.js` (config Supabase publique), `sw.js` (service worker),
  `supabase/` (migrations SQL + edge function `send-reminders`).
- `docs/kazajob/` est une app indépendante préexistante, sans lien avec
  MIRROIR. Ne jamais y toucher sauf demande explicite.
- `tests/` contient la suite Playwright (voir `tests/README.md`).
- `PROJECT.md`, `STATE.md`, `CHANGELOG.md` (racine) = doc produit.

## Règles

- Réutiliser l'existant avant de créer.
- Modifier uniquement les fichiers nécessaires.
- Ne pas refactoriser hors périmètre.
- Ne pas créer de dépendance sans nécessité.
- Ne pas modifier la base de données (migrations Supabase) sans validation.
- Préserver les comportements existants, notamment ceux listés dans
  STATE.md sous « À ne pas casser ».
- `vitalityOf()` (JS) et `mirroir_vitality()` (SQL) doivent rester
  équivalents : toute modification de l'un se répercute sur l'autre.

## Exploration

- Ne pas parcourir tout le repository sans raison.
- Avant de coder : localiser les fichiers concernés (recherche ciblée
  ou agent Explore) — pas besoin que l'utilisateur les connaisse.
- Lire uniquement le contexte nécessaire.

## Tests

`tests/run.sh` (Playwright, mock Supabase en mémoire — voir `tests/README.md`).
Tester uniquement ce qui est pertinent.
Maximum 2 cycles de correction automatique.

## Documentation

- `PROJECT.md` = vision et fonctionnement du produit.
- `STATE.md` = état actuel du projet. À lire pour toute tâche non
  triviale (skip possible sur un fix d'une ligne). Mise à jour
  obligatoire en fin de tâche.
- `CHANGELOG.md` = historique des évolutions passées.
- `docs/README.md` = déploiement, backend Supabase, limites connues.

## Subagents

Si un subagent (ex: `reviewer`) est invoqué, lui fournir la liste
exacte des fichiers modifiés plutôt que le laisser explorer seul.

## Communication

Avant une grosse fonctionnalité :
- fichiers concernés ;
- solution proposée ;
- modèle recommandé ;
- effort estimé.

À la fin :
- fichiers modifiés ;
- changements ;
- tests ;
- problèmes éventuels ;
- mise à jour de STATE.md.

Réponses courtes.
