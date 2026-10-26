---
name: react-spring-ressorts-d-interface
description: À utiliser quand on veut des mouvements à ressort dans une interface React (react-spring, MIT) — tiroirs, cartes qui suivent le doigt, listes qui se réordonnent — ou quand on hésite à s'en servir pour une vidéo rendue : « effet ressort », « animation physique en React », « useSpring », « faut-il react-spring pour cette vidéo ? ».
etat: active
themes: animation, motion, interface
symptomes: effet ressort react, useSpring, animation physique d'interface, ressort dans une vidéo rendue
---

# react-spring-ressorts-d-interface

## Symptôme

On veut un mouvement naturel (rebond, inertie) dans une interface React, ou on essaie de rendre en vidéo une scène animée par react-spring et le résultat n'est jamais le même.

## Cause

react-spring simule un ressort sur sa propre horloge (requestAnimationFrame) : parfait pour une interface vivante, faux pour un rendu image par image qui impose le temps.

## Procédure

1. Interface : `useSpring({ x: ouvert ? 0 : -300, config: { tension: 280, friction: 30 } })` puis `<animated.div style={{ x }}>` ; listes : `useTransition` ; gestes : avec `@use-gesture/react`.
2. Respecter `prefers-reduced-motion` (`useReducedMotion` ou `config: { duration: 0 }`).
3. VIDÉO RENDUE (HyperFrames, capture) : ne PAS utiliser react-spring. Reproduire le ressort par une courbe : GSAP `elastic.out(1, 0.4)` ou `back.out(1.7)`, ou calculer le ressort amorti soi-même en fonction du temps t de la chronologie : `x(t) = cible + (depart - cible) * exp(-amort * t) * cos(pulsation * t)`.
4. Garder react-spring pour l'application, la courbe GSAP pour la vidéo : le même « ressenti » sans horloge propre.

## Vérification

Interface : le tiroir s'ouvre avec un léger dépassement puis se pose, et ne bouge plus avec l'option « réduire les animations » du système. Vidéo : deux rendus donnent la même image au même instant.

## Pièges

- Les valeurs animées ne déclenchent pas de rendu React : ne pas les lire dans le JSX hors `animated.*`.
- `immediate: true` coupe l'animation (utile en essai automatisé).

## Ce qui ne marche pas

Brancher react-spring dans une composition HyperFrames : le ressort vit sur sa propre horloge, les images rendues sont décalées.
