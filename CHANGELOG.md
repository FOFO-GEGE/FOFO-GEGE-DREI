# MIRROIR — Changelog

Historique des évolutions produit. STATE.md ne garde que la dernière ;
le détail des précédentes vit ici pour que STATE.md reste court.
Pour l'historique antérieur à ce fichier, voir `git log`.

## 2026-08-11

- Mise en place de `CLAUDE.md`, `PROJECT.md`, `STATE.md`,
  `CHANGELOG.md` et du subagent `reviewer` pour structurer le
  développement avec Claude Code.
- Couleur de la carte pilotée par la vitalité plutôt que la réponse du
  jour ; stats Taux/Jours recentrées sous la carte ; retrait de
  l'émoji d'état du rituel (ombre portée seule) ; ambiance visuelle +
  emoji des paliers pour Cimetière/Terminées. Fichiers : `ui.js`,
  `screens.js`, `tests/card-colour.spec.js`,
  `tests/completed-promises.spec.js`.
