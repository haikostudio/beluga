/*
 * LA BIBLIOTHÈQUE D'ICÔNES DE BELUGA (décision de l'utilisateur du 14/11/2026 : « une librairie d'icônes linéaires,
 * basée sur Lucide, mais un peu plus minimaliste », dans l'esprit des icônes de Claude — captures #6517 et #508b).
 *
 * UNE SEULE PORTE : tout l'écran importe ses icônes d'ici (`@/components/ui/icones`), jamais de `lucide-react` en
 * direct (contrôlé par `scripts/icones-par-la-bibliotheque.test.mjs`). Deux étages :
 *  - les icônes les plus vues sont REDESSINÉES ci-dessous : trait fin (1,6), bouts et angles arrondis, formes réduites
 *    à l'essentiel — une loupe au manche court, un entonnoir sans tige, une liste en points et traits, une corbeille
 *    sans rayures, un document sans pli chargé ;
 *  - TOUTES les autres (« toutes les icônes de l'application, en un seul jeu cohérent », 14/11/2026) sont redessinées
 *    par `scripts/generer-icones.mjs` dans `icones-dessinees.tsx` : tracé Lucide d'origine resserré vers le centre,
 *    même trait, points pleins. Plus aucune icône Lucide brute ne passe (`export *` de Lucide retiré). Une icône neuve :
 *    l'importer d'ici, relancer le script, regarder `node scripts/planche-des-icones.mjs`.
 * Chaque export garde le nom et la forme d'appel de Lucide (`className`, `size`, `strokeWidth`) : la bascule n'a rien
 * demandé aux écrans. Chaque icône reste un import nommé : un écran qu'on n'ouvre pas n'embarque pas les siennes.
 */
import type { LucideIcon } from 'lucide-react';
import { dessiner, point } from './icones-dessin';
import {
  ArrowLeft as LucideArrowLeft,
  ArrowUp as LucideArrowUp,
  CalendarDays as LucideCalendarDays,
  Check as LucideCheck,
  ChevronDown as LucideChevronDown,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ChevronUp as LucideChevronUp,
  Code2 as LucideCode2,
  Copy as LucideCopy,
  Download as LucideDownload,
  EllipsisVertical as LucideEllipsisVertical,
  ExternalLink as LucideExternalLink,
  FileText as LucideFileText,
  Folder as LucideFolder,
  Globe as LucideGlobe,
  List as LucideList,
  ListFilter as LucideListFilter,
  MessageCircle as LucideMessageCircle,
  MessageSquare as LucideMessageSquare,
  Pencil as LucidePencil,
  Plus as LucidePlus,
  Search as LucideSearch,
  SquarePen as LucideSquarePen,
  Trash2 as LucideTrash2,
  X as LucideX,
} from 'lucide-react';

/* TOUTES LES AUTRES, redessinées par `scripts/generer-icones.mjs` (plus aucune icône Lucide brute, 14/11/2026). */
export * from './icones-dessinees';
export type { LucideIcon, LucideProps } from 'lucide-react';

export { TRAIT_DES_ICONES } from './icones-dessin';

/* ---------------------------- Les gestes ---------------------------- */
/* LE MICRO DE DICTÉE (revenu le 17/11/2026 : sans assistant vocal, il reprend sa place dans le champ d'écriture). */
export const Mic = dessiner('mic', <><path d="M12 2.32a2.64 2.64 0 0 0-2.64 2.64v6.16a2.64 2.64 0 0 0 5.28 0V4.96A2.64 2.64 0 0 0 12 2.32Z" /><path d="M18.16 10.24v1.76a6.16 6.16 0 0 1-12.32 0v-1.76" /><line x1="12" x2="12" y1="18.16" y2="20.8" /></>);
export const Search = dessiner('search', <><circle cx="10.5" cy="10.5" r="6.25" /><path d="m19.5 19.5-4.4-4.4" /></>);
const Entonnoir = <path d="M4.5 5.5h15l-5.75 6.75v5.25l-3.5 1.5v-6.75z" />;
export const ListFilter = dessiner('list-filter', Entonnoir);
export const Filter = dessiner('filter', Entonnoir);
export const List = dessiner('list', <>{point(5, 6.5)}{point(5, 12)}{point(5, 17.5)}<path d="M9.5 6.5H19.5M9.5 12H19.5M9.5 17.5H19.5" /></>);
export const Plus = dessiner('plus', <path d="M12 5.5v13M5.5 12h13" />);
export const X = dessiner('x', <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />);
export const Check = dessiner('check', <path d="m5.5 12.5 4.25 4.25L18.5 8" />);
export const ChevronDown = dessiner('chevron-down', <path d="m7 10 5 5 5-5" />);
export const ChevronUp = dessiner('chevron-up', <path d="m7 14 5-5 5 5" />);
export const ChevronLeft = dessiner('chevron-left', <path d="m14 7-5 5 5 5" />);
export const ChevronRight = dessiner('chevron-right', <path d="m10 7 5 5-5 5" />);
export const ArrowLeft = dessiner('arrow-left', <path d="M18.5 12h-13M10.5 7l-5 5 5 5" />);
export const ArrowUp = dessiner('arrow-up', <path d="M12 18.5v-13M7 10.5l5-5 5 5" />);
const TroisPoints = <>{point(12, 6)}{point(12, 12)}{point(12, 18)}</>;
export const EllipsisVertical = dessiner('ellipsis-vertical', TroisPoints);
export const MoreVertical = dessiner('more-vertical', TroisPoints);

/* ---------------------------- Les objets ---------------------------- */
export const MessageSquare = dessiner('message-square', <path d="M6 5h12a1.75 1.75 0 0 1 1.75 1.75v8.5A1.75 1.75 0 0 1 18 17H9.5l-4.25 3.25V6.75A1.75 1.75 0 0 1 6 5z" />);
export const MessageCircle = dessiner('message-circle', <path d="M12 4.75c4.3 0 7.5 2.9 7.5 6.6s-3.2 6.6-7.5 6.6c-.9 0-1.8-.1-2.6-.4L5 19.5l1-3.6c-1.5-1.2-2.5-2.8-2.5-4.6 0-3.7 3.2-6.55 7.5-6.55z" />);
const Chevrons = <path d="m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5M13.25 5.5l-2.5 13" />;
export const Code = dessiner('code', Chevrons);
export const Code2 = dessiner('code2', Chevrons);
export const Globe = dessiner('globe', <><circle cx="12" cy="12" r="8.75" /><path d="M12 3.25c2.3 2.4 3.5 5.3 3.5 8.75s-1.2 6.35-3.5 8.75c-2.3-2.4-3.5-5.3-3.5-8.75S9.7 5.65 12 3.25zM3.25 12h17.5" /></>);
const Corbeille = <path d="M5 7h14M9.75 7V5.25h4.5V7M6.75 7l.75 11.25c.05.8.7 1.5 1.5 1.5h6c.8 0 1.45-.7 1.5-1.5L17.25 7" />;
export const Trash2 = dessiner('trash2', Corbeille);
export const Trash = dessiner('trash', Corbeille);
export const Copy = dessiner('copy', <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>);
export const Download = dessiner('download', <path d="M12 4.5v10.5M7.5 10.5 12 15l4.5-4.5M5.5 19.5h13" />);
export const ExternalLink = dessiner('external-link', <path d="M13.5 4.5h6v6M19.5 4.5l-8.5 8.5M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10" />);
export const Pencil = dessiner('pencil', <path d="m15.25 5.25 3.5 3.5L8.5 19l-4 1 1-4z" />);
export const SquarePen = dessiner('square-pen', <path d="M11 4.75H6.75a2 2 0 0 0-2 2v10.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V13M16.75 4l3.25 3.25-8.25 8.25-3.75.75.75-3.75z" />);
export const FileText = dessiner('file-text', <path d="M13.75 3.75H7.25a2 2 0 0 0-2 2v12.5a2 2 0 0 0 2 2h9.5a2 2 0 0 0 2-2V8.75zM13.75 3.75v5h5M9 13.25h6M9 16.5h4" />);
export const Folder = dessiner('folder', <path d="M3.75 7.25a2 2 0 0 1 2-2h3.75l2 2.25h6.75a2 2 0 0 1 2 2v7.25a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z" />);
export const CalendarDays = dessiner('calendar-days', <><rect x="4.25" y="5.5" width="15.5" height="14.25" rx="2" /><path d="M8.5 3.5v4M15.5 3.5v4M4.25 10.25h15.5" /></>);

/**
 * LES ORIGINAUX DES ICÔNES REDESSINÉES, pour la planche « avant / après » (`scripts/planche-des-icones.mjs`). Rien dans
 * l'application ne les lit : l'objet est écarté du paquet publié.
 */
export const ICONES_REDESSINEES: Record<string, { avant: LucideIcon; apres: LucideIcon }> = {
  Search: { avant: LucideSearch, apres: Search },
  ListFilter: { avant: LucideListFilter, apres: ListFilter },
  List: { avant: LucideList, apres: List },
  Plus: { avant: LucidePlus, apres: Plus },
  X: { avant: LucideX, apres: X },
  Check: { avant: LucideCheck, apres: Check },
  ChevronDown: { avant: LucideChevronDown, apres: ChevronDown },
  ChevronUp: { avant: LucideChevronUp, apres: ChevronUp },
  ChevronLeft: { avant: LucideChevronLeft, apres: ChevronLeft },
  ChevronRight: { avant: LucideChevronRight, apres: ChevronRight },
  ArrowLeft: { avant: LucideArrowLeft, apres: ArrowLeft },
  ArrowUp: { avant: LucideArrowUp, apres: ArrowUp },
  EllipsisVertical: { avant: LucideEllipsisVertical, apres: EllipsisVertical },
  MessageSquare: { avant: LucideMessageSquare, apres: MessageSquare },
  MessageCircle: { avant: LucideMessageCircle, apres: MessageCircle },
  Code2: { avant: LucideCode2, apres: Code2 },
  Globe: { avant: LucideGlobe, apres: Globe },
  Trash2: { avant: LucideTrash2, apres: Trash2 },
  Copy: { avant: LucideCopy, apres: Copy },
  Download: { avant: LucideDownload, apres: Download },
  ExternalLink: { avant: LucideExternalLink, apres: ExternalLink },
  Pencil: { avant: LucidePencil, apres: Pencil },
  SquarePen: { avant: LucideSquarePen, apres: SquarePen },
  FileText: { avant: LucideFileText, apres: FileText },
  Folder: { avant: LucideFolder, apres: Folder },
  CalendarDays: { avant: LucideCalendarDays, apres: CalendarDays },
};
