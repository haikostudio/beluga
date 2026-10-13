import {
  BookOpen,
  Brain,
  Eye,
  FileText,
  Flag,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  MessageSquare,
  Pencil,
  Search,
  Sparkles,
  StickyNote,
  Terminal,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { GenreDeBloc } from '@beluga/shared';
import { PointDuFil, type TonDuPoint } from '@/components/point-du-fil';
import { cn } from '@/lib/utils';

/**
 * L'ICÔNE DE CHAQUE LIGNE DU FIL — un seul endroit pour dire quelle sorte de
 * ligne porte quelle icône (demande du 13/10/2026 : « des icônes pour
 * distinguer les différents points : mémoire, skills, bash… »).
 *
 * Le second niveau du fil n'était qu'une colonne de points gris identiques. Il
 * porte maintenant, sur le même axe et dans la même gouttière, une icône
 * lucide au trait fin, grise : la sorte se lit d'un coup d'œil. Les icônes
 * reprennent celles des encadrés dépliés (`contenu-journal.tsx`,
 * `encadre-competence.tsx`) pour que la ligne et son contenu disent la même
 * chose.
 *
 * LA TABLE DES GENRES EST EXHAUSTIVE (`Record<GenreDeBloc, …>`) : un genre
 * ajouté au récit sans icône ne compile plus. Une ligne dont la sorte n'est
 * pas connue ne passe aucune icône et GARDE LE POINT GRIS de 5 px.
 */

/** Une icône par genre de bloc raconté. */
export const ICONE_DU_GENRE: Record<GenreDeBloc, LucideIcon> = {
  capture: ImageIcon,
  lecture: FileText,
  ecriture: Pencil,
  commande: Terminal,
  recherche: Search,
  memoire: Brain,
  question: MessageCircleQuestion,
  web: Globe,
  tache: ListChecks,
  note: StickyNote,
  outil: Wrench,
};

/** Les sortes de ligne propres au fil, qui ne sont pas un genre raconté. */
export type SorteDeLigneDuFil =
  | 'competence'
  | 'memoire-ouverte'
  | 'depot'
  | 'reflexion'
  | 'reponse'
  | 'comprehension'
  | 'plan'
  | 'rapport'
  | 'erreur';

export const ICONE_DE_LA_LIGNE: Record<SorteDeLigneDuFil, LucideIcon> = {
  competence: Sparkles,
  'memoire-ouverte': BookOpen,
  depot: GitBranch,
  reflexion: Lightbulb,
  reponse: MessageSquare,
  comprehension: Eye,
  plan: FileText,
  rapport: Flag,
  erreur: TriangleAlert,
};

/**
 * Le ROND d'une ligne : l'icône de sa sorte, ou le point gris quand elle n'en
 * a pas. La couleur ne revient que là où elle porte une information — rouge
 * pour un échec, violet pulsé tant que l'agent y travaille (le même violet que
 * le point de tête de la carte) ; tout le reste est gris, en `--muted`.
 */
export function RondDeLaLigne({ icone: Icone, ton = 'neutre' }: { icone?: LucideIcon; ton?: TonDuPoint }) {
  if (!Icone) return <PointDuFil ton={ton} />;
  return (
    <Icone
      aria-hidden
      strokeWidth={1.5}
      data-sous-point-icone={Icone.displayName ?? 'icone'}
      data-point-du-fil={ton}
      className={cn(
        'block h-3.5 w-3.5 shrink-0',
        ton === 'erreur' ? 'text-danger' : ton === 'en-cours' ? 'animate-pulse-soft text-teinte motion-reduce:animate-none' : 'text-muted',
      )}
    />
  );
}
