import * as React from 'react';
import { Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOTEUR_SUIVI_GEMINI, type EngineId } from '@beluga/shared';

/**
 * LE LOGO OFFICIEL de chaque moteur, en tracé vectoriel — jamais un dessin
 * maison : on reconnaît la marque, pas un symbole inventé. Les tracés sont
 * recopiés ici (jeux « logos », « simple-icons » et « vscode-icons » d'Iconify,
 * repris des chartes des marques) : rien n'est chargé du réseau à l'affichage.
 * `data-logo-moteur` dit quel logo est posé : c'est ce que lit le contrôle
 * (`node scripts/verif-logos-moteurs.mjs`).
 *
 * DEUX FAMILLES, et la différence compte dans les douze palettes :
 *  - les logos EN COULEURS (Claude, Gemini, MiMo) portent leur teinte de marque
 *    en `fill` FIXE — une classe `text-…` de l'appelant ne les reteinte pas ;
 *  - les logos NOIRS (OpenAI pour Codex, Cursor) suivent `currentColor`, posé
 *    sur `text-text` : noirs sur fond clair, clairs sur fond sombre. Figés en
 *    noir, ils disparaîtraient dans les six palettes sombres.
 */
type Logo = React.ComponentType<{ className?: string }>;

/** Claude : l'étincelle, orange de marque. */
function LogoClaude({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 257" className={className} aria-hidden="true" data-logo-moteur="claude">
      <path fill="#d97757" d="m50.228 170.321l50.357-28.257l.843-2.463l-.843-1.361h-2.462l-8.426-.518l-28.775-.778l-24.952-1.037l-24.175-1.296l-6.092-1.297L0 125.796l.583-3.759l5.12-3.434l7.324.648l16.202 1.101l24.304 1.685l17.629 1.037l26.118 2.722h4.148l.583-1.685l-1.426-1.037l-1.101-1.037l-25.147-17.045l-27.22-18.017l-14.258-10.37l-7.713-5.25l-3.888-4.925l-1.685-10.758l7-7.713l9.397.649l2.398.648l9.527 7.323l20.35 15.75L94.817 91.9l3.889 3.24l1.555-1.102l.195-.777l-1.75-2.917l-14.453-26.118l-15.425-26.572l-6.87-11.018l-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0l10.63 1.426l4.472 3.888l6.61 15.101l10.694 23.786l16.591 32.34l4.861 9.592l2.592 8.879l.973 2.722h1.685v-1.556l1.36-18.211l2.528-22.36l2.463-28.776l.843-8.1l4.018-9.722l7.971-5.25l6.222 2.981l5.12 7.324l-.713 4.73l-3.046 19.768l-5.962 30.98l-3.889 20.739h2.268l2.593-2.593l10.499-13.934l17.628-22.036l7.778-8.749l9.073-9.657l5.833-4.601h11.018l8.1 12.055l-3.628 12.443l-11.342 14.388l-9.398 12.184l-13.48 18.147l-8.426 14.518l.778 1.166l2.01-.194l30.46-6.481l16.462-2.982l19.637-3.37l8.88 4.148l.971 4.213l-3.5 8.62l-20.998 5.184l-24.628 4.926l-36.682 8.685l-.454.324l.519.648l16.526 1.555l7.065.389h17.304l32.21 2.398l8.426 5.574l5.055 6.805l-.843 5.184l-12.962 6.611l-17.498-4.148l-40.83-9.721l-14-3.5h-1.944v1.167l11.666 11.406l21.387 19.314l26.767 24.887l1.36 6.157l-3.434 4.86l-3.63-.518l-23.526-17.693l-9.073-7.972l-20.545-17.304h-1.36v1.814l4.73 6.935l25.017 37.59l1.296 11.536l-1.814 3.76l-6.481 2.268l-7.13-1.297l-14.647-20.544l-15.1-23.138l-12.185-20.739l-1.49.843l-7.194 77.448l-3.37 3.953l-7.778 2.981l-6.48-4.925l-3.436-7.972l3.435-15.749l4.148-20.544l3.37-16.333l3.046-20.285l1.815-6.74l-.13-.454l-1.49.194l-15.295 20.999l-23.267 31.433l-18.406 19.702l-4.407 1.75l-7.648-3.954l.713-7.064l4.277-6.286l25.47-32.405l15.36-20.092l9.917-11.6l-.065-1.686h-.583L44.07 198.125l-12.055 1.555l-5.185-4.86l.648-7.972l2.463-2.593l20.35-13.999z" />
    </svg>
  );
}

/** Codex : la fleur d'OpenAI, d'une seule teinte. */
function LogoOpenAI({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('text-text', className)} aria-hidden="true" data-logo-moteur="openai">
      <path fill="currentColor" d="M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z" />
    </svg>
  );
}

/** Cursor : le cube, d'une seule teinte. */
function LogoCursor({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('text-text', className)} aria-hidden="true" data-logo-moteur="cursor">
      <path fill="currentColor" d="M11.503.131L1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
    </svg>
  );
}

/**
 * MiMo : le logo de Xiaomi, orange de marque. MiMo n'a pas de symbole à lui —
 * son seul signe officiel est le mot « Xiaomi MiMo » écrit en toutes lettres,
 * illisible à la taille d'une lettre. Le tracé évide les lettres « mi » : le
 * rectangle blanc posé dessous les garde blanches, comme sur le logo, au lieu
 * de laisser voir le fond de la palette.
 */
function LogoXiaomi({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" data-logo-moteur="xiaomi">
      <rect x="4" y="6.5" width="16" height="11" fill="#fff" />
      <path fill="#ff6900" d="M12 0C8.016 0 4.756.255 2.493 2.516C.23 4.776 0 8.033 0 12.012s.23 7.235 2.494 9.497C4.757 23.77 8.017 24 12 24s7.243-.23 9.506-2.491S24 15.99 24 12.012c0-3.984-.233-7.243-2.502-9.504C19.234.252 15.978 0 12 0M4.906 7.405h5.624c1.47 0 3.007.068 3.764.827c.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051c-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.151.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149m12.131 0h1.949a.15.15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149M8.92 10.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .152-.147" />
    </svg>
  );
}

const ETOILE_GEMINI =
  'M57.067 28.61q-7.396-3.184-12.945-8.732q-5.547-5.546-8.732-12.944a38.4 38.4 0 0 1-1.97-5.824A1.464 1.464 0 0 0 32 .001c-.671 0-1.255.458-1.419 1.11a38.4 38.4 0 0 1-1.971 5.823q-3.186 7.397-8.732 12.944q-5.548 5.548-12.945 8.732a38.4 38.4 0 0 1-5.824 1.972A1.464 1.464 0 0 0 0 32c0 .67.458 1.255 1.11 1.418a38.4 38.4 0 0 1 5.823 1.972q7.396 3.184 12.945 8.732q5.55 5.546 8.732 12.944a38.4 38.4 0 0 1 1.971 5.824c.164.65.749 1.11 1.419 1.11s1.255-.458 1.419-1.11a38.4 38.4 0 0 1 1.971-5.823q3.185-7.395 8.732-12.944q5.548-5.548 12.945-8.732a38.4 38.4 0 0 1 5.824-1.972A1.464 1.464 0 0 0 64 32.001c0-.672-.458-1.255-1.11-1.42a38.4 38.4 0 0 1-5.823-1.97';

/** Les taches de couleur du logo Gemini : chacune est floutée, puis découpée par l'étoile. */
const FLOUS_GEMINI: Array<{ x: number; y: number; width: number; height: number; flou: number }> = [
  { x: -19.618, y: 12.903, width: 38.868, height: 42.756, flou: 2.46 },
  { x: -15.122, y: -40.03, width: 84.353, height: 85.162, flou: 11.891 },
  { x: -20.768, y: 11.483, width: 78.916, height: 90.22, flou: 10.109 },
  { x: 29.156, y: -11.658, width: 74.611, height: 73.27, flou: 9.606 },
  { x: -38.291, y: -16.269, width: 77.538, height: 78.151, flou: 8.706 },
  { x: 7.78, y: -6.098, width: 78.218, height: 76.898, flou: 7.775 },
  { x: 13.208, y: -18.425, width: 55.879, height: 51.479, flou: 6.957 },
  { x: -15.474, y: -31.027, width: 70.203, height: 68.674, flou: 5.876 },
  { x: -14.173, y: 20.474, width: 55.137, height: 51.261, flou: 7.273 },
];

/**
 * Gemini : l'étoile à quatre branches et son dégradé aux quatre couleurs de
 * Google. Le dégradé officiel est fait de taches floutées sous un masque :
 * filtres et masque portent un identifiant, qui doit être PROPRE À CHAQUE
 * LOGO affiché (`useId`). Partagé, il pointerait vers le premier logo de la
 * page — et s'éteindrait avec lui dès que celui-ci est caché.
 */
function LogoGemini({ className }: { className?: string }) {
  const brut = React.useId();
  // Les « : » de `useId` ne passent pas dans `url(#…)`.
  const id = `gemini-${brut.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const flou = (n: number) => `url(#${id}-f${n})`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" data-logo-moteur="gemini">
      <defs>
        {FLOUS_GEMINI.map((f, n) => (
          <filter
            key={n}
            id={`${id}-f${n}`}
            x={f.x}
            y={f.y}
            width={f.width}
            height={f.height}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation={f.flou} />
          </filter>
        ))}
        <mask id={`${id}-m`} x="0" y="0" width="64" height="64" maskUnits="userSpaceOnUse">
          <path fill="#fff" d={ETOILE_GEMINI} />
        </mask>
      </defs>
      <g mask={`url(#${id}-m)`}>
        <path fill="#fff" d={ETOILE_GEMINI} />
        <g filter={flou(0)}>
          <ellipse cx="14.208" cy="16.716" fill="#ffe432" rx="14.208" ry="16.716" transform="rotate(19.552 -43.96 -16.268)" />
        </g>
        <g filter={flou(1)}>
          <ellipse cx="27.054" cy="2.551" fill="#fc413d" rx="18.394" ry="18.799" />
        </g>
        <g filter={flou(2)}>
          <ellipse cx="19.224" cy="24.904" fill="#00b95c" rx="19.224" ry="24.904" transform="rotate(-2.799 667.58 51.694)" />
        </g>
        <g filter={flou(2)}>
          <ellipse cx="18.843" cy="20.744" fill="#00b95c" rx="18.843" ry="20.744" transform="rotate(-31.317 81.174 36.482)" />
        </g>
        <g filter={flou(3)}>
          <ellipse cx="66.462" cy="24.977" fill="#3186ff" rx="18.093" ry="17.423" />
        </g>
        <g filter={flou(4)}>
          <ellipse cx="20.929" cy="22.075" fill="#fbbc04" rx="20.929" ry="22.075" transform="rotate(37.251 9.618 -7.898)" />
        </g>
        <g filter={flou(5)}>
          <ellipse cx="24.131" cy="22.292" fill="#3186ff" rx="24.131" ry="22.292" transform="rotate(34.51 19.317 63.957)" />
        </g>
        <g filter={flou(6)}>
          <path fill="#749bff" d="M54.226-2.304c2.794 3.799-.797 11.184-8.02 16.497c-7.222 5.312-15.342 6.539-18.136 2.74S28.866 5.75 36.09.436c7.223-5.312 15.343-6.539 18.136-2.74" />
        </g>
        <g filter={flou(7)}>
          <ellipse cx="27.585" cy="17.148" fill="#fc413d" rx="27.585" ry="17.148" transform="rotate(-42.847 5.973 20.37)" />
        </g>
        <g filter={flou(8)}>
          <ellipse cx="14.782" cy="8.596" fill="#ffee48" rx="14.782" ry="8.596" transform="rotate(35.592 -44.338 25.191)" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Les logos connus. Un moteur du registre qui n'a pas le sien — tout moteur
 * ajouté depuis les réglages (`ext-…`) — garde une icône NEUTRE (`Cpu`) :
 * ajouter un moteur ne laisse jamais un trou dans la carte. C'est la SEULE
 * table où un moteur se reconnaît à son identifiant.
 */
const PAR_MOTEUR: Partial<Record<EngineId, Logo>> = {
  claude: LogoClaude,
  codex: LogoOpenAI,
  cursor: LogoCursor,
  mimo: LogoXiaomi,
  [MOTEUR_SUIVI_GEMINI]: LogoGemini,
};

/** Le repli neutre : discret, puisqu'il ne dit aucune marque. */
function LogoNeutre({ className }: { className?: string }) {
  return <Cpu className={cn('text-faint', className)} data-logo-moteur="neutre" />;
}

/**
 * Le logo du moteur, fait pour vivre DANS une ligne de texte — à gauche d'un
 * titre de carte ou d'un nom de compte, à la taille d'une lettre (`h-3 w-3`
 * par défaut). Il ne pose ni fond ni bordure.
 */
export function IconeMoteur({ engine, className }: { engine: EngineId; className?: string }) {
  const Logo = PAR_MOTEUR[engine] ?? LogoNeutre;
  return <Logo className={cn('h-3 w-3 shrink-0', className)} />;
}
