import * as React from 'react';
import { ordinateurEnLigne, type CommandeSlash, type Ordinateur } from '@beluga/shared';
import { ChevronDown, Monitor } from '@/components/ui/icones';
import { ListeDeroulante } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE CHOIX DE L'ORDINATEUR VISÉ, DEPUIS LA BARRE D'ÉCRITURE (carte « Choisir l'ordinateur visé depuis le téléphone »,
 * 15/11/2026). Un bouton à gauche du champ, juste après les réglages de l'agent, montre l'ordinateur où les agents de
 * cette carte travaillent ; il ouvre la liste des ordinateurs de la personne (`ListeDeroulante` : ancrée sur
 * ordinateur, feuille du bas sur téléphone), chacun avec son état. Le choix vaut pour toute la carte (ou la
 * conversation sans carte) ; sans choix, c'est le dernier ordinateur utilisé. Aucun ordinateur relié : pas de bouton.
 *
 * `useOrdinateurs` sert aussi le menu « / » : « /ordinateur: » y propose les ordinateurs en second niveau.
 */
export interface EtatDesOrdinateurs {
  ordinateurs: Ordinateur[];
  retenu: string | null;
  dernier: string | null;
}

export function useOrdinateurs(agentId: string | undefined, cardId?: string | null): [EtatDesOrdinateurs | null, () => void] {
  const [etat, setEtat] = React.useState<EtatDesOrdinateurs | null>(null);
  const lire = React.useCallback(() => {
    void client
      .call<EtatDesOrdinateurs>({ type: 'ordinateur.etat', ...(agentId ? { agentId } : {}), ...(cardId ? { cardId } : {}) })
      .then(setEtat)
      .catch(() => {
        /* le démon ne répond pas : on garde ce qu'on savait */
      });
  }, [agentId, cardId]);
  React.useEffect(() => {
    lire();
    return client.onExtension(lire);
  }, [lire]);
  return [etat, lire];
}

/** L'ordinateur montré par le bouton : celui retenu pour la carte, sinon le dernier utilisé, sinon le seul. */
export function ordinateurAffiche(etat: EtatDesOrdinateurs | null): Ordinateur | null {
  if (!etat?.ordinateurs.length) return null;
  const parId = (id: string | null) => (id ? etat.ordinateurs.find((o) => o.id === id) : undefined);
  return parId(etat.retenu) ?? parId(etat.dernier) ?? (etat.ordinateurs.length === 1 ? etat.ordinateurs[0]! : null);
}

/** Les entrées « /ordinateur:<repère> » du menu « / » : une par ordinateur, son nom en description. */
export function commandesDesOrdinateurs(etat: EtatDesOrdinateurs | null): CommandeSlash[] {
  return (etat?.ordinateurs ?? []).map((o) => ({ nom: `ordinateur:${o.repere}`, description: o.nom, origine: 'beluga' as const }));
}

export function BoutonOrdinateur({
  agentId,
  cardId,
  etat,
  relire,
  desactive,
}: {
  agentId: string | undefined;
  cardId?: string | null;
  etat: EtatDesOrdinateurs | null;
  relire: () => void;
  desactive?: boolean;
}) {
  /* Sans carte ni agent (nouvelle conversation pas encore créée), rien où retenir le choix. */
  if ((!agentId && !cardId) || !etat?.ordinateurs.length) return null;
  const affiche = ordinateurAffiche(etat);
  const choisir = (id: string) => {
    void client
      .call({ type: 'ordinateur.choisir', ...(agentId ? { agentId } : {}), ...(cardId ? { cardId } : {}), ordinateurId: id })
      .then(relire)
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.')));
  };
  return (
    <ListeDeroulante
      valeur={affiche?.id ?? ''}
      options={etat.ordinateurs.map((o) => {
        const allume = ordinateurEnLigne(o);
        return {
          valeur: o.id,
          libelle: o.nom,
          detail: allume ? t('Allumé') : t('Éteint ou hors ligne'),
          icone: <Monitor className="h-4 w-4" />,
          fin: <span className={cn('h-2 w-2 shrink-0 rounded-full', allume ? 'bg-success' : 'bg-faint')} data-etat-ordinateur={allume ? 'allume' : 'eteint'} />,
        };
      })}
      onChoisir={choisir}
      titre={t('Ordinateur visé')}
      repere="ordinateur"
      desactivee={desactive}
      declencheur={(ouvrir) => (
        <button
          type="button"
          onClick={(e) => ouvrir(e)}
          title={t('Ordinateur où les agents travaillent')}
          aria-haspopup="listbox"
          className="inline-flex h-[34px] min-w-0 max-w-[160px] shrink items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-raised hover:text-text sm:h-7"
          data-choix-ordinateur={affiche?.id ?? ''}
        >
          {/* L'ICÔNE À LA TAILLE DES AUTRES ICÔNES DE LA RANGÉE (`pastille-champ` : 22 px sur téléphone, 16 px sur
              ordinateur ; carte « Champ d'écriture allégé », 24/11/2026). Nichée dans ce span pour porter la pastille
              d'état, elle échappe à `[&>svg]` et au grossissement global `button > svg` : sa taille se pose ici. */}
          <span className="relative flex shrink-0 items-center">
            <Monitor className="h-[22px] w-[22px] sm:h-4 sm:w-4" />
            {affiche ? <span className={cn('absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full sm:h-1.5 sm:w-1.5', ordinateurEnLigne(affiche) ? 'bg-success' : 'bg-faint')} /> : null}
          </span>
          <span className="min-w-0 truncate">{affiche?.nom ?? t('Ordinateur')}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-faint" aria-hidden />
        </button>
      )}
    />
  );
}
