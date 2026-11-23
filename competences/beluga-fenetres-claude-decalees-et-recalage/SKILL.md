---
name: beluga-fenetres-claude-decalees-et-recalage
description: À utiliser dès que les fenêtres de 5 h des comptes Claude démarrent ou finissent en même temps, qu'un compte est réveillé au mauvais moment, ou avant de toucher à l'amorce, aux créneaux, au minuteur de réveil ou à la ligne « Prochain réveil » de la fiche des comptes : « les deux quotas repartent au même moment », « le décalage de 2 h 30 a disparu », « le compte en échec n'est jamais réveillé ».
etat: active
themes: beluga, quotas, comptes, amorce, créneaux
symptomes: deux fenêtres Claude alignées, décalage perdu entre les comptes, compte réveillé dès que sa fenêtre retombe, compte en échec renvoyé cinq heures plus loin
projets: Beluga
---

# beluga-fenetres-claude-decalees-et-recalage

## Cause

Trois causes constatées : le renouvellement de session (un vrai message) ouvrait la fenêtre hors créneau (DEC-410, carte « Fenêtres Claude de nouveau alignées ») ; un tour de carte parti juste avant la fin de fenêtre la rouvre aussitôt, alignée sur le repère (25/10/2026, 9 h 20) ; une amorce ratée à son créneau sortait de la tolérance de 10 min et attendait le créneau suivant (commit 9e0c49f9).

## Procédure

1. Règle pure : shared/src/amorce.ts — creneauxDesComptes (repère = plus petite priorité, rang k décalé de k × 5 h / N), decisionAmorce ('avant-son-creneau'), fenetreHorsCreneau (TOLERANCE_ALIGNEMENT_MS = 30 min), fenetreOuverte.
2. Démon : server/src/amorce.ts — creneauxActuels, amorcerFenetres, creneauxManques (créneau dû après un échec, 5 h max), signalerAlignements (une ligne de journal par fenêtre hors créneau), rearmerReveil (créneaux + fin du recul), apercuAmorce.
3. Le travail ne s'évite jamais : un compte hors créneau se recale APRÈS sa fenêtre. Pendant le repos, compteQuiRecoitLeTravail (shared/src/choix-de-compte.ts) ne l'utilise qu'en dernier recours.
4. Affichage : server/src/accounts.ts attacherCreneaux → quota.creneau.horsCreneau ; web/src/components/quota-badge.tsx ProchainReveil (data-prochain-reveil, data-hors-creneau) ; textes dans shared/src/traductions.ts.
5. Comptes jumeaux (shared/src/comptes-jumeaux.ts) : un jumeau sort du partage — vérifier qu'un alignement ne crée pas de faux jumeau (il faut aussi les mêmes chiffres hebdomadaires).

## Vérification

npm run build puis node --test server/dist/test/amorce.test.js server/dist/test/renouvellement-session.test.js (cas du 25/10 : alignement repéré, réveil du second à T + 7 h 30 et pas à T + 5 h ; repère plein ; faux jumelage). Après une mise en ligne décidée par l'utilisateur : au cycle suivant, la table amorce_log de data/beluga.db doit montrer le second compte amorcé 2 h 30 après le repère.

## Pièges

- Calculer l'écart quand le repère est au repos : son début glisse avec l'horloge, l'alignement « change » à chaque passage et le journal bavarde.
- Dire un alignement à chaque relevé : la clé du journal est la fin de fenêtre à la minute.
- Retenir le travail pour protéger un créneau : refusé par l'utilisateur.
- Un démon d'essai n'amorce jamais (BELUGA_SANS_AMORCE=1).

## Ce qui ne marche pas

Réveiller chaque compte dès que sa fenêtre retombe : l'écart dérivait au hasard (24/10/2026). Ne contrôler que l'amorce et le renouvellement : le travail réalignait quand même les fenêtres (25/10/2026).
