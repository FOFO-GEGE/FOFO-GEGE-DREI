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
- Aujourd'hui : story plein écran façon Instagram (une carte à la
  fois, couleur pilotée par la vitalité), tri par urgence, tap
  gauche/droite ou glisser vers le bas pour naviguer/quitter, premier
  écran à l'ouverture de l'app. Pas fait/Fait seuls visibles ; Geler
  et Décaler regroupés derrière « Pas fait » (même ergonomie de
  bouton). « Décaler » (report same-day, une fois par jour) reste
  offert seul sur une carte déjà décidée mais réouvrable. Bande des 7
  derniers jours sous Taux/Jours sur la carte.
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

Description : refonte de la story Aujourd'hui façon Instagram
stories.
- Fond plein écran = couleur de vitalité (`--story-bg`), tout le CSS
  `.rs-story-*` écrit (n'existait pas du tout avant — le HTML était
  posé mais jamais stylé).
- Seuls Fait/Pas fait visibles sur la carte. Geler et Décaler ne sont
  plus des boutons permanents : « Pas fait » ouvre une étape
  (`mountFailChoice()`) avec Pas fait/Geler/Décaler en boutons de
  même ergonomie (`.ritual-btn`) — Geler et/ou Décaler omis s'ils ne
  sont pas disponibles (gel déjà pris ce mois, etc.). Précédent/
  Suivant retirés (redondants avec le tap gauche/droite).
- Tap gauche/droite pour changer de carte : rendu réellement
  fonctionnel (zones existaient en JS mais sans CSS, donc sans effet).
- Minuteur d'avance automatique (7s) supprimé entièrement.
- Story = écran par défaut à l'ouverture (`resolveScreen()` dans
  `app.js`), plus Mon miroir.
- Glisser vers le bas pour quitter : préservé, vérifié après la
  réorganisation des boutons.

Piège rencontré et documenté : `backdrop-filter`/`filter` sur un
élément à l'intérieur de la zone de tap créent leur propre contexte
d'empilement et passent au-dessus des zones de tap (z-index 0) quel
que soit l'ordre DOM, les rendant mortes par endroits — remplacés par
`text-shadow` et un fond translucide simple.

Fichiers concernés : `screens.js`, `app.js`, `style.css`.

## Problèmes connus

Voir « Limites connues » dans `docs/README.md` : pas de vrais boutons
Oui/Non sur notification web, Web Push nécessite l'installation sur
iOS, livraison push non vérifiée bout en bout, `vibrate()` inopérant
sur iOS.

- `tests/ritual-queue.spec.js`, `tests/answer-window.spec.js`,
  `tests/flow.spec.js` échouent déjà sur la branche de base (vérifié
  par comparaison avant/après les changements ci-dessus, aucun
  rapport avec eux) : `[data-nav="/today"]` n'existe plus dans la
  tabbar (Aujourd'hui n'est plus un onglet, cf. commentaire `app.js`).
  `tests/completed-promises.spec.js` échoue aussi déjà, sur
  `.finished-toggle` introuvable. Ces specs ciblent une architecture
  antérieure (`.ritual-card .pcard`, navigation par onglet) déjà
  remplacée — à mettre à jour, hors périmètre ici.

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
- Dans `.rs-story` : pas de `backdrop-filter`/`filter` sur un élément
  posé dans la zone de tap (`.ritual-body` et alentours) — ça crée un
  contexte d'empilement qui passe au-dessus de `.rs-story-tap-*`
  (z-index 0) et tue le tap à cet endroit précis. `text-shadow` et un
  fond translucide simple à la place.
