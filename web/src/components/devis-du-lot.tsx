import { arrondi, type DevisDeLaQuestion } from '@beluga/shared';
import { t } from '@/lib/langue';

/**
 * LE BLOC « DEVIS » D'UN LOT (studio créatif, 24/10/2026) : posé dans la bulle
 * de la question que l'outil « realiser » rend pour un lot de générations
 * payantes. Une ligne par opération — le plan, le modèle et son service, le
 * prix en dollars ou « prix non publié » —, puis le total et l'état du budget.
 * Les choix « Valider le devis » / « Refuser » restent ceux de la question :
 * ce bloc ne décide rien, il montre ce que le clic autorisera, et rien d'autre.
 */
export function DevisDuLot({ devis }: { devis: DevisDeLaQuestion }) {
  const montant = (prix: number | null) => (prix === null ? t('prix non publié') : `${arrondi(prix)} $`);
  /* UNE GÉNÉRATION D'UNE CRÉATION DE MÉDIA (bouton à prix) ne passe plus ici :
     elle se lit dans l'encart commun `ValidationAvecCout` (27/10/2026). */
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
      {devis.budget !== null ? (
        <p className="mt-1 text-[12px] text-faint" data-budget-du-devis="">
          {t('Budget : {engage} $ engagés sur {budget} $', { engage: arrondi(devis.depense), budget: devis.budget })}
        </p>
      ) : null}
    </div>
  );
}
