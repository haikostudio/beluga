/**
 * CE QUI FLOTTE AU-DESSUS DE TOUT RESTE UTILISABLE PAR-DESSUS UNE FENÊTRE MODALE (carte « Jarvis : autonomie et
 * affichage », 18/11/2026, capture #5f80c : la conversation de Jarvis était masquée par la fiche d'une demande).
 *
 * Le volet de Jarvis (ordinateur), sa bulle vocale et le bouton du bord sont posés DEVANT toute page, feuille et
 * fenêtre de service (`z-[56]`, `data-au-dessus-de-tout`). Mais une fenêtre Radix MODALE (Réglages, une fenêtre de
 * service…) garde trois verrous posés sur `document`, en phase de bouillonnement :
 *   - son piège à focus (`FocusScope trapped`) ramène le focus chez elle dès qu'il part ailleurs → impossible
 *     d'écrire dans le champ du volet ;
 *   - son verrou de défilement (`react-remove-scroll`) annule la molette et le glissé du doigt hors d'elle → la
 *     conversation du volet ne défile plus.
 * On les court-circuite ICI pour les seuls événements nés dans un élément `[data-au-dessus-de-tout]` qui n'est pas
 * lui-même une fenêtre (`[role="dialog"]` : la feuille du volet sur téléphone est une vraie fenêtre Radix, la pile des
 * pièges de Radix la gère déjà). Les écouteurs sont posés au CHARGEMENT du module, donc avant ceux d'une fenêtre
 * ouverte plus tard : `stopImmediatePropagation` sur `document` les fait passer devant sans toucher aux écouteurs de
 * React (posés plus bas, sur la racine et sur `body` pour les portails), qui ont déjà reçu l'événement.
 */
const SELECTEUR = '[data-au-dessus-de-tout]';

function auDessus(noeud: EventTarget | null): boolean {
  const el = noeud instanceof Element ? noeud : null;
  if (!el?.closest(SELECTEUR)) return false;
  // Une fenêtre (la feuille du volet sur téléphone) a son propre piège : on ne s'en mêle pas.
  return !el.closest('[role="dialog"]');
}

let pose = false;

export function poserLaGardeAuDessusDesFenetres(): void {
  if (pose || typeof document === 'undefined') return;
  pose = true;
  const couper = (event: Event) => event.stopImmediatePropagation();
  document.addEventListener('focusin', (event) => {
    if (auDessus(event.target)) couper(event);
  });
  document.addEventListener('focusout', (event) => {
    // Le focus QUITTE la fenêtre pour aller au volet : c'est la cible d'arrivée qui compte.
    if (auDessus((event as FocusEvent).relatedTarget)) couper(event);
  });
  for (const type of ['wheel', 'touchmove', 'touchstart'] as const) {
    document.addEventListener(
      type,
      (event) => {
        if (auDessus(event.target)) couper(event);
      },
      { passive: true },
    );
  }
}

poserLaGardeAuDessusDesFenetres();
