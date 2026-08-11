# MIRROIR — Current State

Dernière mise à jour : 2026-08-11

## État général

En développement actif. PWA vanilla JS (V1, sans build step), avant
empaquetage Capacitor pour iOS natif.

## Fonctionnalités existantes

- Auth pseudo + mot de passe (sans email).
- Création guidée d'une promesse (habitude + heure de rappel).
- Fenêtre de réponse configurable par promesse (remplace l'ancienne
  fenêtre fixe d'1h), avec rappels échelonnés.
- Réponse Fait / Pas fait (+ raison), ou silence = échec (`expired`).
- Aujourd'hui : file rituelle une carte à la fois, tri par urgence,
  navigation libre, « Décaler » (report same-day, une fois par jour).
- Vitalité (jauge de vie) + mort autonome + résurrection unique.
- Couleur de carte pilotée par la vitalité ; statut du jour en glyphe.
- Paliers (âge + vitalité) avec badges emoji.
- Cimetière (abandon/mort) et Terminées (fin de promesse naturelle).
- Historique : période (7j/30j/3 mois/Tout) + portée, timeline.
- Notifications Web Push (edge function + `pg_cron` toutes les 5 min).
- PWA installable (manifest, service worker).

## Fonctionnalités en cours

Aucune à cette date.

## Dernière évolution

Description : couleur de la carte pilotée par la vitalité plutôt que
la réponse du jour ; stats Taux/Jours recentrées sous la carte ;
retrait de l'émoji d'état du rituel (ombre portée seule) ; ambiance
visuelle + emoji des paliers pour Cimetière/Terminées.

Fichiers concernés : `ui.js`, `screens.js`,
`tests/card-colour.spec.js`, `tests/completed-promises.spec.js`.

## Problèmes connus

Voir « Limites connues » dans `docs/README.md` : pas de vrais boutons
Oui/Non sur notification web, Web Push nécessite l'installation sur
iOS, livraison push non vérifiée bout en bout, `vibrate()` inopérant
sur iOS.

## Décisions techniques récentes

- Backend Supabase dédié `mirroir` (eu-west-3), RLS partout.
- `mirroir_daily_rollover()` toutes les 5 min via `pg_cron`, logique
  dupliquée côté client en garde-fou.
- Auth pseudo + mot de passe sans email → aucune récupération de
  mot de passe possible (assumé).
- Supabase JS vendorisé (`vendor/supabase.js`) pour un caching
  offline fiable par le service worker.

## Prochaine évolution

Empaquetage Capacitor pour le build iOS natif ; remplacer les
rappels web par `@capacitor/local-notifications` (`registerActionTypes`).

## À ne pas casser

- Contrat JS/SQL entre `vitalityOf()` et `mirroir_vitality()`.
- Règle silence → échec `expired`, dupliquée client + SQL.
- `dayState()` comme source unique de vérité (bande 7 jours +
  timeline Historique).
- Le service worker MIRROIR ignore explicitement `/kazajob/`.
- Une seule résurrection possible par promesse.
- « Décaler » ne réouvre un jour qu'une seule fois.
- Création rapide d'une promesse, réponse Fait/Pas fait simple.
