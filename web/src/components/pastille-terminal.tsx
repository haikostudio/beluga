import { ChevronDown, Loader2, TerminalSquare } from 'lucide-react';
import { DROITE_ROBOT_DEFAUT, ROND_ROBOT } from '@beluga/shared';
import type { EtatDuTerminal } from '@/lib/ouvrir-terminal';
import { RondDeLaRangee } from '@/components/rangee-des-ronds';
import { t } from '@/lib/langue';

/** La bulle du rond, selon l'état du terminal. */
export function bulleDuTerminal(etat: EtatDuTerminal, actif: boolean): string {
  if (etat === 'ouvert') return t('Réduire le terminal');
  if (etat === 'reduit') return actif ? t('Le terminal travaille — cliquer pour le rouvrir') : t('Rouvrir le terminal');
  return t('Terminal du serveur');
}

/**
 * LE ROND DU TERMINAL (demande du 20/10/2026), SUR ORDINATEUR : le même rond
 * que le robot de l'assistant — taille, couleurs, ombre, survol —, avec
 * l'icône du terminal, toujours affiché à sa gauche, sur toutes les pages. Il
 * remplace la pastille noire du terminal réduit et le bouton du haut des
 * tableaux de bord. Un clic ouvre le terminal (ou le réaffiche, réduit) ;
 * ouvert, il le réduit — comme le robot ouvre et ferme son chat. Il TOURNE, en
 * violet, la couleur du travail, tant que le terminal réduit reçoit de la
 * sortie. Sur téléphone, il n'existe pas : le bouton vit dans le pied du menu.
 *
 * IL VIT DANS LA RANGÉE DU ROBOT (`RangeeDesRonds`, 20/10/2026) : replié
 * derrière lui, il s'étale à sa gauche au survol — et reste visible tant
 * qu'il tourne. La rangée remonte avec le terminal ouvert.
 */
export function RondDuTerminal({
  etat,
  actif,
  onBasculer,
}: {
  etat: EtatDuTerminal;
  actif: boolean;
  onBasculer: () => void;
}) {
  const bulle = bulleDuTerminal(etat, actif);
  return (
    <RondDeLaRangee toujours={etat === 'reduit' && actif} coin={DROITE_ROBOT_DEFAUT}>
      <button
        type="button"
        data-terminal-rond
        data-terminal-etat={etat}
        data-terminal-actif={actif ? 'oui' : 'non'}
        title={bulle}
        aria-label={bulle}
        aria-expanded={etat === 'ouvert'}
        onClick={onBasculer}
        className="grid place-items-center rounded-full bg-text text-bg shadow-xl transition-transform hover:scale-105"
        style={{ width: ROND_ROBOT, height: ROND_ROBOT }}
      >
        {etat === 'ouvert' ? (
          <ChevronDown className="h-5 w-5" />
        ) : actif ? (
          <Loader2 data-terminal-rond-travail className="h-5 w-5 animate-spin text-teinte" />
        ) : (
          <TerminalSquare className="h-5 w-5" />
        )}
      </button>
    </RondDeLaRangee>
  );
}
