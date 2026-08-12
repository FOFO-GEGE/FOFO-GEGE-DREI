# MIRROIR — Current State

Dernière mise à jour : 2026-08-12

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
  écran à l'ouverture de l'app. Pas fait/Fait seuls visibles sur la
  carte ; « Pas fait » mène directement à « Pourquoi ? », avec Geler
  et Décaler ajoutés à la suite des raisons sur cette même page (même
  ergonomie de bouton) quand disponibles — rien n'est enregistré tant
  que ce n'est pas choisi. « Décaler » (report same-day, une fois par
  jour) reste offert seul sur une carte déjà décidée mais réouvrable.
  Bande des 7 derniers jours sous Taux/Jours sur la carte.
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

Description : redesign home + corrections écran story.

1. **Story** — `border-radius: 24px` + `overflow: hidden`, titre texte supprimé
   du header, countdown positif sans icône (« Il reste X min pour répondre »),
   bande semaine fixe L M M J V S D (`storyWeekHTML`), « il y a X min » dans
   le header.

2. **Cartes home** — fonds enrichis par vitalité (radial gradients), emoji
   palier en filigrane (`.pcard-lvl-icon`).

3. **Widget urgent** — quand une fenêtre de réponse est ouverte, un bloc
   « À répondre maintenant » (`.rs-urgent-card`) remplace le bandeau today
   sur l'écran d'accueil, avec badge, timer, bande semaine.

4. **Navigation** — Cimetière et Terminées déplacés sous Historique ;
   section « Ce que tu n'as pas tenu » supprimée de l'historique.

Fichiers concernés : `docs/style.css`, `docs/screens.js`, `docs/ui.js`.

---

Description précédente : deux dettes techniques comblées en parallèle.

1. **Tests cassés** — `ritual-queue.spec.js`, `answer-window.spec.js`
   et `flow.spec.js` ciblaient l'ancienne architecture par onglets
   (`[data-nav="/today"]`, `.ritual-card .pcard`, `#ritual-next/prev`).
   Réécrits pour la story actuelle : navigation via hash, `.rs-story`,
   zones de tap, flow Pas fait → Pourquoi via `mountReason()`.

2. **Accessibilité** — les zones de tap gauche/droite de la story
   étaient des `<div aria-hidden>` ; converties en `<button>` avec
   `aria-label` (« Carte précédente » / « Carte suivante »,
   « Voir mon miroir » sur le résumé). Navigables au clavier (Tab +
   Entrée/Espace) et lisibles par lecteur d'écran. CSS reset complet
   sur ces boutons pour éviter toute régression visuelle ; `outline`
   uniquement sur `:focus-visible`. Guard swipe-down mis à jour pour
   que `[data-tap]` ne soit pas exclu malgré la conversion en button.

Fichiers concernés : `screens.js`, `style.css`, `tests/ritual-queue.spec.js`,
`tests/answer-window.spec.js`, `tests/flow.spec.js`.

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
  remplacée — à mettre à jour, hors périmètre ici. C'est la dette la
  plus risquée du lot : toute la fenêtre de réponse, Décaler et le
  flow général tournent sans filet automatique depuis un moment.

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
