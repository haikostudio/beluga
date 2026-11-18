import * as React from 'react';
import { Check, ChevronDown, Loader2 } from '@/components/ui/icones';
import { REPONSE_GENERER_LE_LOT, REPONSE_REFUSER_LE_LOT, arrondi, type DevisDeLaQuestion, type ModeleDuMenu } from '@beluga/shared';
import { ValidationAvecCout } from '@/components/validation-avec-cout';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** Le prix d'une ligne, comme sur le bouton : « 1.50 $ » ou « prix non publié ». */
function prixLisible(prix: number | null): string {
  return prix === null ? t('prix non publié') : `${arrondi(prix)} $`;
}

/**
 * L'ENCART « GÉNÉRER » D'UNE GÉNÉRATION, AVEC LE CHOIX DU MODÈLE (demande du 01/11/2026, maquette A #81ce).
 *
 * À l'ouverture, une lecture SANS FRAIS (`realisation.lot.modeles`) donne les modèles qui savent faire cette
 * génération, avec le prix total de chacun. S'il y en a plus d'un, la ligne « modèle · n brouillons » devient un
 * menu : le modèle prévu coché, le prix à droite de chaque ligne. Choisir un autre modèle ne lance RIEN : le devis
 * change de modèle (`realisation.lot.modele`, prix vu revérifié côté démon) et le bouton suit son prix. Pendant ce
 * changement, « Générer » est retenu ; le clic reste la seule porte vers une dépense.
 */
export function ValidationDuLot({
  devis,
  titre,
  description,
  messageId,
  questionId,
  entete,
  variante,
  repere,
  onRepondre,
}: {
  devis: DevisDeLaQuestion;
  titre: string;
  description?: string;
  /** Le message et la question qui portent ce devis : sans eux, l'encart reste sans menu. */
  messageId?: string;
  questionId?: string;
  entete?: React.ReactNode;
  variante?: 'neutre' | 'attention' | 'contraste';
  repere?: Record<string, string | undefined>;
  onRepondre: (reponse: string, images: string[]) => Promise<void>;
}) {
  const [modeles, setModeles] = React.useState<ModeleDuMenu[] | null>(null);
  /** Le modèle sélectionné ICI, en attendant que la question relue le dise aussi. */
  const [choisi, setChoisi] = React.useState<ModeleDuMenu | null>(null);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const peutChoisir = !!messageId && !!questionId;

  const charger = React.useCallback(async () => {
    if (!peutChoisir) return;
    try {
      const r = (await client.call({ type: 'realisation.lot.modeles', lotId: devis.lotId })) as { modeles?: ModeleDuMenu[] };
      setModeles(r?.modeles ?? []);
    } catch {
      setModeles([]);
    }
  }, [devis.lotId, peutChoisir]);
  React.useEffect(() => {
    void charger();
  }, [charger]);

  const actuel = choisi ?? modeles?.find((m) => m.actuel) ?? null;
  /* Le prix du bouton : celui de la question, ou celui du modèle choisi ici tant que la question relue ne l'a pas repris. */
  const cout = choisi
    ? prixLisible(choisi.prix)
    : devis.sansPrix && !devis.total
      ? t('prix non publié')
      : `${arrondi(devis.total)} $${devis.sansPrix ? ` + ${t('prix non publié')}` : ''}`;
  const nombre = devis.lignes.length;
  const libelle = actuel ? `${actuel.nom} · ${t('{n} brouillons', { n: nombre })}` : (description ?? '');

  const choisir = async (m: ModeleDuMenu) => {
    if (enCours || (actuel && m.service === actuel.service && m.modele === actuel.modele)) return;
    setEnCours(m.modele);
    try {
      const r = (await client.call({
        type: 'realisation.lot.modele',
        messageId: messageId!,
        questionId: questionId!,
        service: m.service,
        modele: m.modele,
        prixVu: m.prix,
      })) as { ok: boolean; raison?: string; prix?: number | null };
      if (r?.ok) {
        setChoisi({ ...m, prix: r.prix ?? m.prix });
      } else {
        client.pushToast('error', t('Le modèle n’a pas changé : {raison}', { raison: r?.raison ?? '' }));
        await charger();
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le modèle n’a pas changé : {raison}', { raison: '' }));
    } finally {
      setEnCours(null);
    }
  };

  const menu =
    peutChoisir && modeles && modeles.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex max-w-full items-center gap-1 rounded-sm text-left text-[12.5px] text-faint transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint"
            aria-busy={!!enCours}
            title={t('Choisir le modèle')}
            data-menu-des-modeles={devis.lotId}
          >
            {enCours ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden /> : null}
            <span className="min-w-0 truncate">{enCours ? t('Changement du modèle…') : libelle}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[min(24rem,calc(100vw-1.5rem))]" data-liste-des-modeles={devis.lotId}>
          {modeles.map((m) => {
            const coche = !!actuel && m.service === actuel.service && m.modele === actuel.modele;
            return (
              <DropdownMenuItem
                key={`${m.service}:${m.modele}`}
                onSelect={() => void choisir(m)}
                className="items-start"
                data-modele-du-menu={m.modele}
                data-modele-coche={coche ? '' : undefined}
              >
                <Check className={cn('mt-0.5 h-4 w-4 shrink-0', coche ? 'text-accent' : 'invisible')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate', coche && 'font-medium')}>{m.nom}</span>
                  {m.usage ? <span className="block truncate text-[12.5px] text-faint">{m.usage}</span> : null}
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted" data-prix-du-modele={m.prix ?? ''}>
                  {prixLisible(m.prix)}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <ValidationAvecCout
      titre={titre}
      description={choisi ? libelle : description}
      ligne={menu}
      note={choisi ? null : devis.conseil}
      cout={cout}
      entete={entete}
      variante={variante}
      bloque={!!enCours}
      repere={repere}
      onValider={() => onRepondre(REPONSE_GENERER_LE_LOT, [])}
      onRefuser={() => onRepondre(REPONSE_REFUSER_LE_LOT, [])}
    />
  );
}
