import * as React from 'react';
import { rangerLeRapport, type CleDeSection, type SectionRangee } from '@beluga/shared';
import { Markdown } from '@/lib/markdown';
import { PointDuFil } from '@/components/point-du-fil';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LA RÉPONSE FINALE GARDE LE FLUX VERTICAL DU CADRAGE.
 *
 * Pendant le cadrage, tout se lit en timeline : un rond avec son icône, un
 * trait qui descend, et à droite ce que l'étape a produit
 * (`FluxDeCadrage`, `web/src/components/flux-cadrage.tsx`). Une fois la tâche
 * lancée, le compte rendu retombait dans le Markdown ordinaire : six titres
 * empilés dans un pavé dense. La forme changeait en cours de route, sur la
 * même carte.
 *
 * Ici, la STRUCTURE NE CHANGE PLUS : seules les DONNÉES à l'intérieur des
 * points changent. Chaque section du gabarit devient un point du fil, avec
 * son point gris et son intitulé, et son contenu se lit à droite, en Markdown
 * complet — listes, encadrés et « Évolutions possibles » cliquables compris.
 *
 * Le découpage vient de la règle partagée (`rangerLeRapport`,
 * `shared/src/rapport-gabarit.ts`). Un texte qui n'a pas assez de sections —
 * une réponse brève, un texte encore en train d'arriver — garde le rendu
 * ordinaire : mieux vaut un texte plat qu'un fil à trous.
 */

/** L'intitulé affiché, traduit — les noms canoniques viennent de la règle partagée. */
function nomAffiche(cle: CleDeSection, nom: string): string {
  if (cle === 'analyse') return t('Analyse');
  if (cle === 'ce-qui-est-fait') return t('Ce qui est fait');
  if (cle === 'consequences') return t('Conséquences');
  if (cle === 'impact') return t('Impact');
  if (cle === 'evolutions') return t('Évolutions possibles');
  if (cle === 'couts') return t('Coûts');
  return nom;
}

export interface RapportEnFluxProps {
  contenu: string;
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /** Le texte arrive encore : on ne range rien tant qu'il bouge. */
  streaming?: boolean;
  /**
   * L'ENTÊTE SE CALE AU BORD GAUCHE, sans le retrait qui l'aligne sur le texte
   * des points. Posé UNIQUEMENT par le fil d'une carte, qui décale déjà tout
   * son contenu : le chat ne le pose pas et garde son alignement.
   */
  enteteSansRetrait?: boolean;
}

export function RapportEnFlux({
  contenu,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  streaming,
  enteteSansRetrait,
}: RapportEnFluxProps) {
  const range = React.useMemo(() => rangerLeRapport(contenu), [contenu]);

  if (streaming || !range.conforme) {
    return (
      <Markdown
        className="texte-du-fil"
        content={contenu}
        pickedEvolutions={pickedEvolutions}
        onToggleEvolution={onToggleEvolution}
        onToggleAll={onToggleAll}
        streaming={streaming}
      />
    );
  }

  return (
    <div data-rapport-flux className="texte-du-fil min-w-0">
      {/* LA LIGNE D'EN-TÊTE RESTE EN TÊTE : modèle, niveau, temps estimé. Elle
          n'appartient à aucune section, elle les annonce toutes. */}
      {/* Dans le chat, elle se cale sur le TEXTE des points, jamais sur leurs
          ronds. Dans le fil d'une carte, le fil pose déjà son décalage : le
          retrait tombe (`enteteSansRetrait`) et l'entête suit le bord gauche. */}
      {range.entete ? (
        <div
          data-entete-rapport
          data-entete-retrait={enteteSansRetrait ? 'non' : 'oui'}
          className={cn('mb-3 text-muted', !enteteSansRetrait && 'pl-9')}
        >
          <Markdown content={range.entete} />
        </div>
      ) : null}

      <ol className="space-y-0">
        {range.sections.map((section, index) => (
          <SectionDuFlux
            key={section.cle}
            section={section}
            derniere={index === range.sections.length - 1}
            pickedEvolutions={pickedEvolutions}
            onToggleEvolution={onToggleEvolution}
            onToggleAll={onToggleAll}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * Un point du fil : son point gris dans la colonne de gauche, le trait conducteur
 * qui descend vers le suivant, son intitulé puis son contenu à droite. Le
 * trait suit `--faint` : sur les palettes plates, une bordure disparaîtrait.
 */
function SectionDuFlux({
  section,
  derniere,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
}: {
  section: SectionRangee;
  derniere: boolean;
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
}) {
  /* LES IDÉES DES « ÉVOLUTIONS POSSIBLES » RESTENT CLIQUABLES. Le titre est
     dessiné par le fil : le Markdown ne le voit plus, et sans ce drapeau les
     puces perdraient leurs cases pour la seule raison qu'elles n'ont plus de
     titre au-dessus (`listesCliquables`, `web/src/lib/markdown.tsx`). */
  const cliquable = section.cle === 'evolutions';
  return (
    <li data-section-rapport={section.cle} className="flex gap-3">
      <div className="flex w-6 shrink-0 flex-col items-center">
        <span className="flex h-6 w-6 items-center justify-center" data-rond-section>
          <PointDuFil />
        </span>
        {!derniere ? <span className="w-px flex-1 bg-faint/30" aria-hidden /> : null}
      </div>
      <div className={cn('min-w-0 flex-1', derniere ? 'pb-0' : 'pb-4')}>
        <p className="text-[14.5px] font-medium leading-relaxed text-text">{nomAffiche(section.cle, section.nom)}</p>
        {section.corps ? (
          <div data-corps-section={section.cle} className="mt-1">
            <Markdown
              content={section.corps}
              pickedEvolutions={pickedEvolutions}
              onToggleEvolution={cliquable ? onToggleEvolution : undefined}
              onToggleAll={cliquable ? onToggleAll : undefined}
              listesCliquables={cliquable}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}
