import * as React from 'react';
import { createPortal } from 'react-dom';
import { BAS_ROBOT } from '@beluga/shared';

/**
 * LES RONDS FLOTTANTS DU COIN BAS DROIT, SUR ORDINATEUR. Le robot de l'assistant, qui les tenait en rangée et les
 * dépliait à son survol (20/10/2026), a disparu (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : le bouton du
 * bord est l'entrée de l'assistant. Un rond (le terminal du serveur) se pose donc SEUL dans le coin, toujours visible.
 *
 * LE ROND REMONTE AVEC LE TERMINAL. Ouvert, le terminal soulève toute l'application de sa hauteur
 * (`--hauteur-terminal`, `html[data-terminal-ouvert]`) ; le rond, porté par <body>, ajoute cette hauteur à sa
 * distance au bas, au même rythme (190 ms).
 */

/** La distance au bas d'un rond : celle de l'ancien robot, plus la hauteur du terminal ouvert. */
export const BAS_DES_RONDS = `calc(max(calc(${BAS_ROBOT}px + var(--hauteur-terminal, 0px)), env(safe-area-inset-bottom)) + var(--marche-du-bas, 0px))`;

/** L'air entre le haut de Jarvis (bulle ou volet, et sa pile de bulles) et le rond qui remonte au-dessus. */
const AIR_AU_DESSUS_DE_JARVIS = 12;

/**
 * LE ROND REMONTE AU-DESSUS DE JARVIS (17/11/2026) : la bulle vocale et le volet se posent désormais à 16 px du bord
 * droit, dans le coin du rond. Tant que l'un d'eux est ouvert, le rond se pose au-dessus de lui ET de sa pile de bulles,
 * jamais dessous. Relevé quatre fois par seconde seulement pendant qu'une surface de Jarvis existe.
 */
/**
 * …ET AU-DESSUS DU PIED D'UN VOLET (carte « Extension, rapport SEO-GEO et menus », 21/11/2026) : le bouton pleine
 * largeur d'un pied de volet (`[data-pied-du-volet]`) passait sous le rond au coin bas droit. Un pied visible qui
 * occupe la colonne du rond, près du bas de l'écran, le fait remonter au-dessus de lui : rien ne recouvre jamais un
 * bouton de pied. Le pied « Nouvel artefact » de la page d'un projet (`page-du-projet.tsx`, 26/11/2026) aussi.
 */
function useBasAuDessusDeJarvis(coin = 16, largeur = 48): number | null {
  const [bas, setBas] = React.useState<number | null>(null);
  React.useEffect(() => {
    const relever = () => {
      const surfaces = document.querySelectorAll<HTMLElement>('[data-bulle-vocale], [data-volet-de-jarvis]');
      let haut = Infinity;
      for (const surface of surfaces) {
        const boite = surface.getBoundingClientRect();
        if (boite.width <= 0 || boite.height <= 0) continue;
        haut = Math.min(haut, boite.top);
        const pile = surface.querySelector<HTMLElement>('[data-bulles-du-direct]')?.getBoundingClientRect();
        if (pile && pile.height > 0) haut = Math.min(haut, pile.top);
      }
      const gaucheDuRond = window.innerWidth - coin - largeur;
      for (const pied of document.querySelectorAll<HTMLElement>('[data-pied-du-volet], [data-nouvel-artefact-pied-projet]')) {
        const boite = pied.getBoundingClientRect();
        if (boite.width <= 0 || boite.height <= 0) continue;
        if (boite.right <= gaucheDuRond || boite.bottom < window.innerHeight - 160) continue;
        haut = Math.min(haut, boite.top);
      }
      const suivant = Number.isFinite(haut) ? Math.max(0, Math.round(window.innerHeight - haut + AIR_AU_DESSUS_DE_JARVIS)) : null;
      setBas((b) => (b === suivant ? b : suivant));
    };
    relever();
    const minuterie = window.setInterval(relever, 250);
    return () => window.clearInterval(minuterie);
  }, []);
  return bas;
}

/** UN ROND DU COIN, posé seul à `coin` px du bord droit. `toujours` reste lu par ses appelants (il tourne). */
export function RondDeLaRangee({ coin, children }: { toujours?: boolean; coin: number; children: React.ReactNode }) {
  const auDessus = useBasAuDessusDeJarvis(coin);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-rond-seul
      data-au-dessus-de-jarvis={auDessus !== null ? '' : undefined}
      /* AU MÊME ÉTAGE QUE JARVIS (`z-[56]`, 18/11/2026) : devant les pages et fenêtres de service, comme lui ; un appui
         dessus ne referme pas la page dessous. */
      data-au-dessus-de-tout
      className="pointer-events-auto fixed z-[56] transition-[bottom] duration-[190ms] ease-out"
      style={{ right: coin, bottom: auDessus !== null ? auDessus : BAS_DES_RONDS }}
    >
      {children}
    </div>,
    document.body,
  );
}
