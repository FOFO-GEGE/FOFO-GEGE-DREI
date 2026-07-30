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

Tables : `profiles` (pseudo, timezone), `habits`, `habit_checks`,
`push_subscriptions`, `push_log`. RLS scopée à `auth.uid()` partout où un client
lit ; `push_log` a RLS activée **sans policy**, ce qui est le refus total voulu —
seul le service role l'écrit.

### La fenêtre de réponse d'une heure

Une promesse s'ouvre à son heure de vérification et reste répondable pendant une
heure, avec des rappels à T, +15, +30 et +45. Le silence passé cette heure n'est
pas une donnée manquante : le check devient `failed` avec le drapeau `expired` et
la série est brisée, exactement comme un « pas fait » déclaré.

`mirroir_daily_rollover()` applique cette règle côté serveur, planifiée **toutes
les 5 minutes** via `pg_cron` — une fenêtre d'une heure ne peut pas être arbitrée
par un cron horaire. Le client rejoue la même logique au chargement, en
garde-fou, pour que l'écran ne soit jamais périmé à l'arrivée.

Aucun check n'est ouvert pour une fenêtre déjà fermée : une promesse créée à 22h
avec un rappel à 08h commence à compter demain, plutôt que de marquer un échec
impossible à éviter. Cette règle est dupliquée client et SQL — les deux côtés
divergeraient sinon.

### Authentification

Pseudo + mot de passe, sans email. Un email technique
(`pseudo@mirroir.local`) est dérivé côté client uniquement comme identifiant
interne pour GoTrue ; il n'est jamais affiché ni demandé. Conséquence assumée :
**aucune récupération de mot de passe possible**, faute d'adresse réelle où
envoyer un lien.

### Web Push

Les rappels partent d'une Edge Function `send-reminders`, appelée toutes les 5
minutes par `pg_cron`. Le ciblage vit en SQL (`mirroir_due_pings`), là où le
calcul de fuseau horaire se trouve déjà ; la fonction n'est que le transport.
`mirroir_due_pings` réserve chaque ping au moment où il le rend, donc deux
exécutions qui se chevauchent ne peuvent pas doubler l'envoi.

**Deux réglages manuels sont nécessaires** (aucun outil ne permet de les faire à
distance) :

1. **Secret de la fonction** — dans le dashboard Supabase, Edge Functions →
   `send-reminders` → Secrets, ajouter `VAPID_PRIVATE_KEY` avec la clé privée
   VAPID. La clé publique correspondante est dans `config.js` ; la privée ne doit
   jamais être committée.
2. **Secret Vault** — SQL Editor :
   `select vault.create_secret('<service_role_key>', 'mirroir_service_role_key');`
   Le job cron lit cette valeur pour s'authentifier auprès de la fonction, plutôt
   que de la stocker en clair dans sa définition.

Tant que ces deux secrets manquent, le job tourne et échoue sans rien casser :
aucun ping n'est envoyé, aucune donnée n'est corrompue.

Également à basculer dans le dashboard : **Authentication → Providers → Email →
désactiver « Confirm email »**. L'email technique n'a pas de boîte réelle, donc
un lien de confirmation n'arriverait jamais et la connexion échouerait après
l'inscription.

## Limites connues

- **Pas de boutons Oui/Non sur la notification.** L'API web ne les propose pas de
  façon fiable (et Safari/iOS pas du tout). La notification ouvre l'app sur le
  check-in, où les boutons sont l'interaction réelle — le fallback prévu au spec.
  Les vrais boutons natifs (`registerActionTypes`) demanderaient Capacitor.
- **Le Web Push exige une installation sur iOS.** Safari refuse l'abonnement
  depuis un onglet ordinaire : il faut « Partager → Sur l'écran d'accueil ».
  L'app détecte ce cas et l'explique au lieu d'échouer en silence.
- **Livraison push non vérifiée de bout en bout.** Elle demande un appareil
  réel ; elle n'a pas pu être testée ici.
- **`navigator.vibrate()` est inopérant sur iOS.** De vrais retours haptiques
  demanderaient le plugin Capacitor.
- Supabase JS est vendorisé dans `vendor/supabase.js` (au lieu d'un CDN) pour un
  caching offline fiable par le service worker.

## Tests

Voir `../tests/` — Playwright contre une copie jetable de ce dossier, avec un
mock Supabase en mémoire. `tests/run.sh` lance tout ; le vrai projet n'est jamais
contacté.

## Prochaine étape

Empaqueter ce dossier avec Capacitor pour le build iOS natif, en remplaçant les rappels web par
`@capacitor/local-notifications` (`registerActionTypes`) comme prévu au spec.
