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
- Bande des 7 derniers jours repositionnée en bas de carte, après
  Taux/Jours, sur le deck et sur la story ; `weekStripHTML()`
  factorisée dans `ui.js` au lieu d'être dupliquée. Fichiers : `ui.js`,
  `screens.js`, `style.css`.
- Refonte de la story Aujourd'hui façon Instagram stories : fond
  plein écran couleur de vitalité (CSS `.rs-story-*` écrit, n'existait
  pas), seuls Fait/Pas fait visibles (Geler/Décaler regroupés derrière
  « Pas fait », même ergonomie de bouton), tap gauche/droite rendu
  fonctionnel, minuteur d'avance automatique supprimé, story = écran
  par défaut à l'ouverture. Piège CSS : `backdrop-filter`/`filter`
  dans la zone de tap crée un contexte d'empilement qui passe au-
  dessus des zones de tap quel que soit l'ordre DOM. Fichiers :
  `screens.js`, `app.js`, `style.css`.
- 3 retouches sur cette story : émoji de palier affiché une seule
  fois (n'était plus répété en petit dans le libellé), bande des 7
  jours plus visible sur fond coloré (anneau clair + lettres
  éclaircies), texte « glisse vers le bas pour revenir » retiré
  (geste conservé). Fichiers : `screens.js`, `style.css`.
- Espace ajouté entre Taux/Jours et la bande des 7 jours sur la story
  (collés — `.ritual-body` n'a pas le `gap` que `.pcard` a). Fichier :
  `style.css`.
- Écran de fin de story (« Voilà les faits ») habillé comme les
  cartes qui le précèdent au lieu du chrome plat générique : fond
  coloré selon l'issue du jour (réutilise `vitalityStory()`), tap à
  droite ajouté pour sortir vers Mon miroir (bouton conservé aussi).
  Fichiers : `screens.js`, `style.css`.
- `.ritual-status` (« Non tenu » etc. sur une carte déjà décidée)
  alignée sur `.countdown` : `margin-top` ajouté, ne collait plus la
  bande des 7 jours. Fichier : `style.css`.
- Cartes du deck de hauteur inégale entre lignes : une promesse avec
  moins de 2 jours échus n'affichait pas la bande des 7 jours du
  tout, la rendant plus courte que ses voisines. `weekStripHTML()`
  affiche maintenant toujours la bande dès qu'un `week` existe
  (mêmes marques transparentes pour une habitude neuve, même
  hauteur). `tests/completed-promises.spec.js` mis à jour. Fichiers :
  `ui.js`, `tests/completed-promises.spec.js`.
- Étape intermédiaire « Comment ça ? » supprimée : « Pas fait » mène
  directement à « Pourquoi ? », Geler et Décaler ajoutés à la suite
  des puces de raison sur cette même page au lieu d'un écran séparé
  — corrige l'ambiguïté « ça a changé d'écran, c'est déjà enregistré
  ? ». `settleVerdict()` devient une fonction sœur de `mount()`
  (Geler peut être déclenché depuis `mountReason()`). Fichiers :
  `screens.js`, `style.css`.
- Tabbar orphelin corrigé : les deux états vides d'Aujourd'hui
  (« Aucune promesse » et « Repos aujourd'hui ») renvoyaient
  `tab: '/today'` mais `/today` est absent de `TABS` — aucun onglet
  ne s'allumait. Corrigé en `tab: '/home'` (onglet Miroir actif,
  cohérent avec le bouton « Voir mon miroir » présent sur ces deux
  écrans). Fichier : `screens.js`.
