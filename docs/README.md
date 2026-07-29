# MIRROIR — PWA (phase de test)

Implémentation V1 du spec MIRROIR, en PWA vanilla JS (pas de build step) avant l'empaquetage Capacitor/iOS.

## Structure du site déployé

Ce dossier `docs/` est la racine servie par GitHub Pages. Il héberge deux apps
indépendantes :

- `/` → **MIRROIR** (cette app)
- `/kazajob/` → KazaJob, l'app préexistante du repo, inchangée fonctionnellement

Chacune a son propre `manifest.json` et son propre service worker. Celui de
MIRROIR est à la racine, donc son scope couvre aussi `/kazajob/` : il ignore
explicitement ces requêtes pour laisser KazaJob à son propre service worker.

## Lancer en local

```
cd docs
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000`.

## Backend

Projet Supabase dédié : `mirroir` (région eu-west-3). URL et clé publique dans `config.js`.
Schéma : `profiles` (timezone), `habits`, `habit_checks`, RLS scopée à `auth.uid()`, plus une fonction
`mirroir_daily_rollover()` planifiée toutes les heures via `pg_cron` qui :
- clôture en `no_data` les `habit_checks` encore à `created` des jours précédents,
- crée les lignes du jour pour les habitudes actives.

Le client fait aussi une génération paresseuse (garde-fou) au chargement de l'app pour éviter un écran
vide si le cron a du retard.

## Limites connues de cette phase PWA

- **Pas de boutons Oui/Non sur la notification** : c'est une limite de l'API Notification web (et en
  particulier de Safari/iOS PWA), pas de ce code. Les rappels sont de simples notifications qui ouvrent
  l'app sur "Objectifs du jour", où les boutons Fait/Pas fait sont l'interaction réelle — c'est exactement
  le fallback prévu par le spec pour ce cas. Les vrais boutons d'action natifs (`registerActionTypes`)
  arriveront avec l'empaquetage Capacitor/iOS.
- **Rappels uniquement en premier plan** : le rappel est vérifié toutes les 30s tant que l'app est ouverte
  dans l'onglet. Il n'y a pas de push server (Web Push + VAPID) branché — à ajouter si on veut des rappels
  fiables app fermée, avant ou en parallèle du passage à Capacitor.
- Supabase JS est vendorisé dans `vendor/supabase.js` (au lieu d'un CDN) pour un caching offline fiable par
  le service worker.

## Prochaine étape

Empaqueter ce dossier avec Capacitor pour le build iOS natif, en remplaçant les rappels web par
`@capacitor/local-notifications` (`registerActionTypes`) comme prévu au spec.
