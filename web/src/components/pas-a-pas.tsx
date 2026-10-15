import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';

/*
 * LE PAS-À-PAS D'UN ÉCRAN VIDE — on ne laisse plus personne « largué ».
 *
 * Un écran vide disait « Aucun projet », « Aucun client », et s'arrêtait là :
 * qui découvre Beluga Build ne savait ni à quoi servait l'écran, ni par quoi
 * commencer. Chaque service vide montre désormais ce même gabarit : son icône,
 * une phrase qui dit à quoi il sert, deux ou trois étapes numérotées, puis LE
 * bouton qui lance la première. Il ne remplace JAMAIS une silhouette : un écran
 * qui attend encore ses données n'est pas vide.
 */
export function PasAPas({
  icone,
  titre,
  explication,
  etapes,
  action,
  repere,
}: {
  icone?: React.ReactNode;
  titre: string;
  /** À quoi sert l'écran, en une phrase. */
  explication?: string;
  /** Deux ou trois étapes courtes, dans l'ordre où on les fait. */
  etapes: string[];
  action?: React.ReactNode;
  /** Le repère du service, pour les contrôles (`data-pas-a-pas`). */
  repere: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center" data-pas-a-pas={repere}>
      {icone ? <div className="text-faint">{icone}</div> : null}
      <p className="mt-2 text-[15px] font-medium text-text">{titre}</p>
      {explication ? <p className="mt-1 max-w-[340px] text-[13.5px] leading-relaxed text-muted">{explication}</p> : null}
      <ol className="mt-4 w-full max-w-[340px] space-y-2 text-left">
        {etapes.map((etape, index) => (
          <li key={etape} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-muted">
            <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-raised text-[11.5px] font-medium text-text">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{etape}</span>
          </li>
        ))}
      </ol>
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Ouvre la fenêtre d'ajout de projet, celle de la colonne de gauche. */
export function ouvrirLAjoutDeProjet(): void {
  window.dispatchEvent(new CustomEvent('beluga:ajouter-projet'));
}

/** « Créer votre premier projet » — le même bouton partout où il n'y a encore aucun projet. */
export function BoutonPremierProjet({ avant }: { avant?: () => void }) {
  return (
    <Button
      size="md"
      data-creer-premier-projet
      onClick={() => {
        avant?.();
        // Après la fermeture d'une fenêtre qui recouvrait la colonne : un tour d'affichage d'écart.
        window.setTimeout(ouvrirLAjoutDeProjet, avant ? 120 : 0);
      }}
    >
      <Plus className="h-3.5 w-3.5" />
      {t('Créer votre premier projet')}
    </Button>
  );
}
