import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { arrondi, REPONSE_GENERER_LE_LOT, REPONSE_REFUSER_LE_LOT, type DevisDeLaQuestion } from '@beluga/shared';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * LE BLOC « DEVIS » D'UN LOT (studio créatif, 24/10/2026) : posé dans la bulle
 * de la question que l'outil « realiser » rend pour un lot de générations
 * payantes. Une ligne par opération — le plan, le modèle et son service, le
 * prix en dollars ou « prix non publié » —, puis le total et l'état du budget.
 * Les choix « Valider le devis » / « Refuser » restent ceux de la question :
 * ce bloc ne décide rien, il montre ce que le clic autorisera, et rien d'autre.
 */
export function DevisDuLot({ devis, onRepondre }: { devis: DevisDeLaQuestion; onRepondre?: (reponse: string) => Promise<void> | void }) {
  const montant = (prix: number | null) => (prix === null ? t('prix non publié') : `${arrondi(prix)} $`);
  const [enVol, setEnVol] = React.useState<'generer' | 'refuser' | null>(null);
  /*
   * UNE GÉNÉRATION D'UNE CRÉATION DE MÉDIA (26/10/2026) : le bouton porte le
   * prix, et UN CLIC VAUT ACCORD — la génération part aussitôt. « Refuser »
   * ne dépense rien. Il dit qu'il travaille dès le clic.
   */
  const repondre = async (choix: 'generer' | 'refuser') => {
    if (!onRepondre || enVol) return;
    setEnVol(choix);
    try {
      await onRepondre(choix === 'generer' ? REPONSE_GENERER_LE_LOT : REPONSE_REFUSER_LE_LOT);
    } finally {
      setEnVol(null);
    }
  };
  const prixDuBouton = devis.sansPrix && !devis.total ? t('prix non publié') : `${arrondi(devis.total)} $${devis.sansPrix ? ` + ${t('prix non publié')}` : ''}`;
  return (
    <div className="mt-2 rounded-md bg-raised/40 px-2.5 py-2" data-devis-du-lot={devis.lotId}>
      <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">{t('Devis')}</p>
      <ul className="flex flex-col gap-1">
        {devis.lignes.map((ligne, rang) => (
          <li key={`${ligne.plan}-${rang}`} className="flex items-baseline gap-2 text-[13px]" data-ligne-de-devis="">
            <span className="min-w-0 flex-1">
              <span className="text-text">{ligne.plan}</span>
              <span className="text-faint"> · {ligne.modele} ({ligne.service})</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted" data-prix-de-ligne={ligne.prix === null ? 'non-publie' : String(ligne.prix)}>
              {montant(ligne.prix)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-baseline gap-2 text-[13px]">
        <span className="min-w-0 flex-1 font-medium text-text">{t('Total')}</span>
        <span className="shrink-0 font-medium tabular-nums text-text" data-total-du-devis={String(devis.total)}>
          {arrondi(devis.total)} $
          {devis.sansPrix ? <span className="font-normal text-faint"> {t('+ {n} au prix non publié', { n: devis.sansPrix })}</span> : null}
        </span>
      </div>
      {devis.bouton && onRepondre ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-boutons-du-lot="">
          <Button
            type="button"
            size="sm"
            data-generer-le-lot={devis.lotId}
            data-prix-du-bouton={String(devis.total)}
            aria-busy={enVol === 'generer'}
            disabled={!!enVol}
            onClick={() => void repondre('generer')}
            className="bg-accent text-accent-fg hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {enVol === 'generer' ? t('Génération lancée…') : t('Générer · {prix}', { prix: prixDuBouton })}
          </Button>
          <Button type="button" size="sm" variant="ghost" data-refuser-le-lot={devis.lotId} disabled={!!enVol} onClick={() => void repondre('refuser')}>
            {t('Refuser')}
          </Button>
        </div>
      ) : null}
      {devis.budget !== null ? (
        <p className="mt-1 text-[12px] text-faint" data-budget-du-devis="">
          {t('Budget : {engage} $ engagés sur {budget} $', { engage: arrondi(devis.depense), budget: devis.budget })}
        </p>
      ) : null}
    </div>
  );
}
