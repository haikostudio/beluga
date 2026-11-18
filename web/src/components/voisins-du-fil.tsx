import * as React from 'react';
import { ListeDeroulante, type OptionSelecteur } from '@/components/ui';
import { ChevronDown } from '@/components/ui/icones';
import { t } from '@/lib/langue';

/**
 * LE CHEVRON D'UNE LISTE NE PARAÎT QU'AU SURVOL (demande du 31/10/2026, capture #f29b) : au repos, le fil ne montre
 * que ses noms et ses séparateurs ; au survol (ou menu ouvert, ou focus clavier), le chevron s'ouvre une petite place
 * et le texte se décale à peine. Sans survol possible (écran tactile), il reste visible. Le groupe est `group/cran`.
 */
export const CLASSE_CHEVRON_AU_SURVOL =
  'h-3.5 w-0 shrink-0 opacity-0 transition-[width,margin,opacity] duration-150 ease-out motion-reduce:transition-none ' +
  'group-hover/cran:ml-1 group-hover/cran:w-3.5 group-hover/cran:opacity-100 ' +
  'group-focus-visible/cran:ml-1 group-focus-visible/cran:w-3.5 group-focus-visible/cran:opacity-100 ' +
  'group-data-[state=open]/cran:ml-1 group-data-[state=open]/cran:w-3.5 group-data-[state=open]/cran:opacity-100 ' +
  '[@media(hover:none)]:ml-1 [@media(hover:none)]:w-3.5 [@media(hover:none)]:opacity-100';

/**
 * LES VOISINS D'UN CRAN DU MILIEU DU FIL D'ARIANE (décision de l'utilisateur du 14/11/2026, carte « Icônes, menus et
 * aperçu plein écran ») : un cran d'avant ouvre, par un petit chevron, la liste des éléments du MÊME NIVEAU (les autres
 * projets, clients, classeurs, pages) pour passer de l'un à l'autre. En tête, « Ouvrir <nom> » garde le retour qu'on
 * avait en cliquant le nom. Sur téléphone, les crans d'avant sont cachés : rien ne change (la flèche remonte d'un cran).
 */
export interface VoisinsDuCran {
  /** Le nom du cran, repris par la ligne « Ouvrir <nom> ». */
  nom: string;
  /** L'élément du cran (coché dans la liste). */
  valeur: string;
  /** Les éléments du même niveau, lui compris. */
  options: OptionSelecteur[];
  onChoisir: (valeur: string) => void;
  /** Le titre de la liste (« Projets », « Clients »…), aussi l'intertitre des voisins. */
  titre: string;
  /** Le marqueur des contrôles : `data-voisins-du-cran=<repere>` sur le chevron. */
  repere: string;
}

/** La valeur de la ligne « Ouvrir <nom> ». */
export const OUVRIR_LE_CRAN = '__ouvrir-le-cran__';

/** Le chevron qui ouvre la liste des voisins, posé juste après le nom du cran (dans un `group/cran`). */
export function ChevronDesVoisins({ voisins, onOuvrir }: { voisins: VoisinsDuCran; onOuvrir?: () => void }) {
  const options = React.useMemo<OptionSelecteur[]>(
    () => [
      ...(onOuvrir ? [{ valeur: OUVRIR_LE_CRAN, libelle: t('Ouvrir {v0}', { v0: voisins.nom }), attributs: { 'data-ouvrir-le-cran': '' } }] : []),
      ...voisins.options.map((o) => ({ ...o, groupe: o.groupe ?? voisins.titre })),
    ],
    [voisins.options, voisins.nom, voisins.titre, onOuvrir],
  );
  return (
    <ListeDeroulante
      valeur={voisins.valeur}
      options={options}
      onChoisir={(v) => {
        if (v === OUVRIR_LE_CRAN || v === voisins.valeur) onOuvrir?.();
        else voisins.onChoisir(v);
      }}
      titre={voisins.titre}
      repere={`voisins-${voisins.repere}`}
      seuilRecherche={8}
      declencheur={(ouvrir, _libelle, fermer) => (
        <button
          type="button"
          /* LE DOUBLE CLIC MÈNE AU CRAN LUI-MÊME (16/11/2026) : la liste se referme, la page du cran s'ouvre. */
          onClick={(e) => (e.detail >= 2 ? undefined : ouvrir(e))}
          onDoubleClick={() => {
            fermer();
            onOuvrir?.();
          }}
          className="flex h-6 shrink-0 items-center rounded-md text-faint transition-colors hover:text-text"
          aria-haspopup="listbox"
          data-voisins-du-cran={voisins.repere}
        >
          <span className="sr-only">{t('Changer : {v0}', { v0: voisins.titre })}</span>
          <ChevronDown className={CLASSE_CHEVRON_AU_SURVOL} aria-hidden />
        </button>
      )}
    />
  );
}
