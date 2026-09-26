import * as React from 'react';
import { estTitreDesSuggestions, planEnTexteSimple } from '@beluga/shared';
import { Markdown } from '@/lib/markdown';

/**
 * UN PLAN SE LIT COMME UNE RÉPONSE ORDINAIRE — PLUS COMME UN TABLEAU DE BORD.
 *
 * Le plan était dessiné en RAPPORT : un entête encadré, un sommaire de quatre
 * lignes numérotées, chacune se dépliant sur place, des intitulés en petites
 * capitales et des chevrons. On croyait gagner en lisibilité ; on perdait la
 * lecture même : trois parties sur quatre étaient repliées d'office, et il
 * fallait quatre clics pour lire un texte qui tient sur un écran.
 *
 * Le plan garde son GABARIT — « # titre », le résumé en italique, les quatre
 * parties sous leurs titres — mais il s'affiche comme n'importe quelle réponse
 * du fil : du TEXTE, en clair, sans icône, sans couleur et sans repli.
 *
 * LE GABARIT EST QUAND MÊME REMIS D'APLOMB AVANT D'ÊTRE RENDU. Un moteur écrit
 * parfois ses quatre parties EN GRAS (« **Faisabilité** ») plutôt qu'en titres :
 * le texte s'afficherait alors en pavé, sans hiérarchie. La règle partagée
 * (`planEnTexteSimple`, `shared/src/plan-gabarit.ts`) reconnaît les trois écritures
 * qu'un moteur emploie ; on recompose donc un markdown propre — mêmes mots,
 * titres normalisés — et c'est LUI qu'on affiche. Un texte qui n'est pas au
 * gabarit passe tel quel : mieux vaut un texte brut qu'un plan reconstruit à
 * tort.
 *
 * CE QUI RESTE : les idées de la partie « Améliorations apportées » sont
 * toujours CLIQUABLES — un clic dépose l'idée dans la barre d'écriture, sans
 * rien envoyer (`estTitreDesSuggestions`, règle partagée).
 */
export interface PlanRapportProps {
  contenu: string;
  /** Le plan encore en jeu : lui seul propose des idées à cocher. */
  courant: boolean;
  pickedEvolutions: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /** Le texte arrive encore : on ne range rien tant qu'il bouge. */
  streaming?: boolean;
}

export function PlanRapport({
  contenu,
  courant,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  streaming,
}: PlanRapportProps) {
  /* TANT QUE LE TEXTE ARRIVE, ON NE LE RÉÉCRIT PAS : un plan à moitié tapé
     n'est pas au gabarit, et le remettre d'aplomb à chaque signe le ferait
     sauter sous les yeux. */
  const texte = React.useMemo(
    () => (streaming ? null : planEnTexteSimple(contenu)),
    [contenu, streaming],
  );

  return (
    <div data-rapport-plan data-plan-en-texte="oui" className="texte-du-fil min-w-0">
      <Markdown
        content={texte ?? contenu}
        pickedEvolutions={pickedEvolutions}
        onToggleEvolution={courant ? onToggleEvolution : undefined}
        onToggleAll={courant ? onToggleAll : undefined}
        autreTitreCliquable={estTitreDesSuggestions}
        streaming={streaming}
      />
    </div>
  );
}
