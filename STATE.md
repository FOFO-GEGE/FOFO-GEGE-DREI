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
  navigation libre, « Décaler » (report same-day, une fois par jour),
  bande des 7 derniers jours sous Taux/Jours sur la carte.
- Vitalité (jauge de vie) + mort autonome + résurrection unique.
- Couleur de carte pilotée par la vitalité ; statut du jour en glyphe.
- Paliers (âge + vitalité) avec badges emoji.
- Cimetière (abandon/mort) et Terminées (fin de promesse naturelle).
- Historique : période (7j/30j/3 mois/Tout) + portée, timeline.
- Notifications Web Push (edge function + `pg_cron` toutes les 5 min).
- PWA installable (manifest, service worker).

## Fonctionnalités en cours

Refonte de la story Aujourd'hui (plein écran façon Instagram stories,
actions Pas fait/Geler/Décaler unifiées sous un seul bouton, sans
minuteur d'avance automatique, tap gauche/droite à rendre
fonctionnel, story comme premier écran à l'ouverture) : cadrée avec
l'utilisateur, en attente de feu vert avant implémentation.

## Dernière évolution

Description : bande des 7 derniers jours ajoutée sous Taux/Jours sur
la carte de la story Aujourd'hui, en réutilisant `lastWeekOf()` et le
composant `.pcard-week` déjà utilisé sur les cartes du deck.
`weekStripHTML()` factorisée dans `ui.js` (partagée par les deux) au
lieu d'être dupliquée. Seul changement CSS : `width:100%` sur
`.pcard-week` pour qu'il s'étire correctement hors du contexte
`.pcard` (qui le faisait par `align-items:stretch` implicite).

Fichiers concernés : `ui.js`, `screens.js`, `style.css`.

## Problèmes connus

Voir « Limites connues » dans `docs/README.md` : pas de vrais boutons
Oui/Non sur notification web, Web Push nécessite l'installation sur
iOS, livraison push non vérifiée bout en bout, `vibrate()` inopérant
sur iOS.

- `tests/ritual-queue.spec.js` et `tests/completed-promises.spec.js`
  échouent déjà sur la branche de base (vérifié par comparaison avant/
  après les changements ci-dessus, aucun rapport avec eux) :
  `[data-nav="/today"]` n'existe plus dans la tabbar (Aujourd'hui
  n'est plus un onglet, cf. commentaire `app.js`) et `.finished-toggle`
  est introuvable. Les deux specs ciblent une architecture antérieure
  (`.ritual-card .pcard`) déjà remplacée par la story plein écran
  actuelle (`rs-story`) — à mettre à jour, hors périmètre ici.

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
