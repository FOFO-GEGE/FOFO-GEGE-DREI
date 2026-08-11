# MIRROIR — Project

## Concept

MIRROIR confronte l'utilisateur à ses propres engagements.

L'utilisateur définit une promesse (habitude) et une heure de rappel.
À l'échéance, une fenêtre de réponse s'ouvre (durée configurable par
promesse) : MIRROIR lui demande s'il a tenu.

Boucle principale :

Promesse
→ Fenêtre de réponse
→ Réponse (Fait / Pas fait + raison) ou silence (= échec, flag `expired`)
→ Vitalité mise à jour
→ Historique
→ Prise de conscience

## Philosophie

MIRROIR doit rester :

- simple ;
- rapide ;
- direct ;
- peu intrusif ;
- orienté action.

## UX

L'action principale (répondre à une promesse) doit nécessiter le
minimum d'interactions possible : Aujourd'hui présente une promesse à
la fois (pas de liste), navigation libre entre cartes, et « Décaler »
pour reporter sans jamais repeindre la carte en plus overdue qu'elle
ne l'est réellement.

Les notifications (Web Push) permettent d'être notifié sans ouvrir
l'app. Les vrais boutons Oui/Non sur la notification ne sont pas
fiables côté web (limite de l'API, absente sur Safari/iOS) : l'app
s'ouvre donc sur le check-in, prévu comme fallback. Prochaine étape :
empaquetage Capacitor pour de vrais boutons natifs.

## Règles produit

- Ne pas ajouter une fonctionnalité uniquement parce qu'elle est
  techniquement intéressante.
- Toute fonctionnalité doit renforcer la boucle comportementale
  (promesse → réponse → vitalité).
- Éviter les écrans inutiles.
- Éviter de transformer MIRROIR en journal intime.
- Ne pas ajouter de l'IA simplement pour ajouter de l'IA.

## Vitalité

Une jauge de vie (0-100) par promesse, en double implémentation
strictement synchronisée : `vitalityOf()` côté client (JS) et
`mirroir_vitality()` côté serveur (SQL) — un changement non répercuté
des deux côtés fait diverger ce que le client affiche de ce que le
cron a déjà tranché. Une promesse peut mourir seule (mort autonome)
si elle n'est plus nourrie, et ne peut être ressuscitée qu'une seule
fois. La couleur de la carte reflète la vitalité, pas la réponse du
jour (qui n'a droit qu'à un glyphe de statut).

## Architecture (`docs/` = app déployée sur GitHub Pages)

- `app.js` — shell, router, boot.
- `store.js` — couche données : store en mémoire, mutations
  optimistes, file d'écriture avec retry.
- `ui.js` — présentation (icônes, thèmes, carte) ; aucun accès réseau.
- `screens.js` — écrans, rendu synchrone depuis le store.
- `fx.js` — effets décoratifs (particules, secousses) ; jamais
  bloquants, dégradés sous `prefers-reduced-motion`.
- `config.js` — config Supabase publique (clé publishable, VAPID
  public).
- `sw.js` — service worker (ignore explicitement `/kazajob/`).
- `supabase/migrations/` — schéma + logique métier serveur (rollover,
  vitalité, fenêtre de réponse...).
- `supabase/functions/send-reminders/` — edge function des rappels
  Web Push (déclenchée par `pg_cron` toutes les 5 min).
- `docs/kazajob/` — app indépendante préexistante, sans lien avec
  MIRROIR ; ne pas modifier sans demande explicite.

Réutiliser les mécanismes existants. Détails de déploiement et
limites connues : voir `docs/README.md`.
