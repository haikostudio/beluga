/**
 * UNE COLONNE DU TABLEAU — SON NOM, SON COMPTE, SON FILTRE, SA RECHERCHE.
 *
 * LE FILTRE EST PAR COLONNE, À DROITE DU TITRE. Il vivait dans un menu unique de
 * l'entête : filtrer « À faire » vidait aussi « Terminé », et rien, dans la
 * colonne, ne disait qu'un filtre y retenait des demandes. Chaque colonne porte
 * donc son bouton, qui range son tri et ses filtres — et une PASTILLE qui
 * compte les demandes que le filtre ET la recherche cachent (`vueDeLaColonne`).
 * Rien de caché : pas de pastille.
 *
 * LA RECHERCHE EST SOUS LE TITRE, PLEINE LARGEUR. Elle filtre pendant la frappe,
 * sur le titre, la description et les étiquettes, et repart vide à chaque
 * visite.
 *
 * LE « + » VIT SUR « À FAIRE », là où la demande créée arrive. Les autres
 * colonnes n'en ont pas.
 *
 * UN CONTENEUR PLEINE HAUTEUR, SUR LES DEUX ÉCRANS. Tête fixe et liste qui
 * défile chez elle — le gabarit des colonnes du tableau Beluga. C'est ce qui
 * rend le dépôt fiable : la surface `[data-colonne-kanban]` couvre la colonne
 * entière, donc lâcher dans le vide sous la dernière vignette tombe bien dedans.
 *
 * PAS DE PERSONNAGE ICI. Le tableau Beluga en pose un dans le coin de chaque
 * colonne ; l'espace client n'en veut pas.
 */
import * as React from 'react';
import { Archive, Inbox, ListFilter, MessageSquare, Plus, Search, X } from 'lucide-react';
import {
  ActionTiroir,
  Button,
  GroupeTiroir,
  Input,
  MenuActions,
  SelecteurTiroir,
  ZoneDefilement,
  type OptionSelecteur,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import {
  COULEURS_COLONNES_DEMANDE,
  IMPORTANCES,
  TITRES_COLONNES_DEMANDE,
  TITRES_IMPORTANCE,
  TITRES_TRI_DEMANDE,
  TRIS_DEMANDE,
  filtresActifs,
  type ColonneDemande,
  type DemandeAffichee,
  type FiltreDeColonne,
  type ImportanceDemande,
  type TriDemande,
} from '@beluga/shared';
import { TON_COLONNE } from './formats';
import { VignetteDemande, type GestesDeVignette } from './vignette-demande';

export function ColonneDemandes({
  colonne,
  cartes,
  nonLues,
  masquees,
  visee,
  glissee,
  prise,
  onOuvrir,
  telephone,
  gestes,
  filtre,
  onFiltre,
  tri,
  onTri,
  recherche,
  onRecherche,
  etiquettes,
  onNouvelle,
}: {
  colonne: ColonneDemande;
  cartes: DemandeAffichee[];
  nonLues: number;
  /** Les demandes de la colonne que le filtre et la recherche cachent. */
  masquees: number;
  visee: boolean;
  glissee: string | null;
  prise: (demande: DemandeAffichee) => React.HTMLAttributes<HTMLElement>;
  onOuvrir: (id: string) => void;
  telephone: boolean;
  gestes: GestesDeVignette;
  filtre: FiltreDeColonne;
  onFiltre: (filtre: FiltreDeColonne) => void;
  tri: TriDemande;
  onTri: (tri: TriDemande) => void;
  recherche: string;
  onRecherche: (texte: string) => void;
  /** Les étiquettes connues du tableau, pour le filtre. */
  etiquettes: string[];
  /** Seule « À faire » le reçoit : le « + » qui ouvre la création. */
  onNouvelle?: () => void;
}) {
  const titre = t(TITRES_COLONNES_DEMANDE[colonne]);
  const actifs = filtresActifs(filtre);

  const optionsEtiquette: OptionSelecteur[] = [
    { valeur: '', libelle: t('Toutes les étiquettes') },
    ...etiquettes.map((etiquette) => ({ valeur: etiquette, libelle: etiquette })),
  ];
  const optionsImportance: OptionSelecteur[] = [
    { valeur: '', libelle: t('Toutes les importances') },
    ...IMPORTANCES.map((niveau) => ({ valeur: niveau, libelle: t(TITRES_IMPORTANCE[niveau]) })),
  ];

  return (
    <div
      className={cn(
        /*
         * LE CADRE DE LA COLONNE, comme au tableau Beluga : un fond un rien
         * plus clair que la page, un tour discret, des coins arrondis. La
         * hauteur est PLEINE dans les deux cas — c'est elle qui fait la
         * surface de dépôt.
         */
        'flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-border/60 bg-surface/70 transition-colors',
        // LE WAGON : presque toute la largeur, la suivante en amorce.
        telephone ? 'w-[86vw] max-w-[420px] shrink-0 snap-center' : 'min-w-[220px] flex-1 basis-0',
        // La colonne visée pendant un glissement se signale : sans cela, on
        // lâche à l'aveugle.
        visee && 'border-accent/60 bg-raised/60 ring-1 ring-inset ring-accent/40',
      )}
      data-colonne-kanban={colonne}
      data-compte={cartes.length}
      data-colonne-visee={visee ? '' : undefined}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 px-2.5 pb-1 pt-1.5" data-tete-colonne={colonne}>
        <span
          className={cn(
            'min-w-0 truncate text-[12px] font-medium uppercase tracking-wide',
            TON_COLONNE[COULEURS_COLONNES_DEMANDE[colonne]],
          )}
        >
          {titre}
        </span>
        <span className="text-[11px] text-faint">{cartes.length}</span>
        {/* CE QUE JE N'AI PAS LU DANS CETTE COLONNE, à côté de son compte. */}
        {nonLues ? (
          <span
            className="shrink-0 rounded-lg bg-warning/15 px-1.5 text-[10px] font-medium leading-4 text-warning"
            data-non-lues-colonne={nonLues}
            title={t('Messages non lus')}
          >
            {nonLues}
          </span>
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {onNouvelle ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onNouvelle}
              title={t('Nouvelle demande')}
              aria-label="Nouvelle demande"
              data-nouvelle-demande
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : null}
          <span className="inline-flex" data-filtre-colonne={colonne} data-masquees={masquees}>
            <MenuActions
              titre={`${t('Filtre')} · ${titre}`}
              repere={`filtre-${colonne}`}
              actifs={masquees}
              icone={<ListFilter className={cn('h-4 w-4', actifs ? 'text-accent' : null)} />}
            >
              {(fermer) => (
                <>
                  <GroupeTiroir titre={t('Filtrer')}>
                    {etiquettes.length ? (
                      <SelecteurTiroir
                        valeur={filtre.etiquette ?? ''}
                        options={optionsEtiquette}
                        onChoisir={(valeur) => onFiltre({ ...filtre, etiquette: valeur || undefined })}
                        titre={t('Étiquette')}
                        repere={`etiquette-${colonne}`}
                        empile
                        declencheur={(ouvrir, libelle) => (
                          <ActionTiroir onClick={ouvrir} valeur={libelle} data-filtre-etiquette={filtre.etiquette ?? ''}>
                            {t('Étiquette')}
                          </ActionTiroir>
                        )}
                      />
                    ) : null}
                    <SelecteurTiroir
                      valeur={filtre.importance ?? ''}
                      options={optionsImportance}
                      onChoisir={(valeur) =>
                        onFiltre({ ...filtre, importance: (valeur || undefined) as ImportanceDemande | undefined })
                      }
                      titre={t('Importance')}
                      repere={`importance-${colonne}`}
                      empile
                      declencheur={(ouvrir, libelle) => (
                        <ActionTiroir onClick={ouvrir} valeur={libelle} data-filtre-importance={filtre.importance ?? ''}>
                          {t('Importance')}
                        </ActionTiroir>
                      )}
                    />
                    {/*
                     * CE QUI M'ATTEND SE LIT : les demandes où des messages me
                     * sont arrivés sans que je les aie ouverts.
                     */}
                    <ActionTiroir
                      icone={<MessageSquare className="h-3.5 w-3.5" />}
                      actif={Boolean(filtre.nonLues)}
                      onClick={() => onFiltre({ ...filtre, nonLues: filtre.nonLues ? undefined : true })}
                      data-filtre-non-lues={filtre.nonLues ? 'oui' : ''}
                    >
                      {t('Messages non lus')}
                    </ActionTiroir>
                    {/*
                     * LES DEMANDES ARCHIVÉES SONT UN FILTRE DE CETTE COLONNE,
                     * plus une bascule du menu burger qui retournait le tableau
                     * entier. Chaque colonne garde le sien : on relit ce qu'on a
                     * rangé dans « Terminé » sans vider les trois autres.
                     */}
                    <ActionTiroir
                      icone={
                        filtre.archivees ? <Inbox className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />
                      }
                      actif={Boolean(filtre.archivees)}
                      onClick={() => onFiltre({ ...filtre, archivees: filtre.archivees ? undefined : true })}
                      data-filtre-archivees={filtre.archivees ? 'oui' : ''}
                    >
                      {t('Demandes archivées')}
                    </ActionTiroir>
                    {actifs ? (
                      <ActionTiroir
                        icone={<X className="h-3.5 w-3.5" />}
                        onClick={() => {
                          onFiltre({});
                          fermer();
                        }}
                        data-vider-filtres
                      >
                        {t('Tout afficher')}
                      </ActionTiroir>
                    ) : null}
                  </GroupeTiroir>

                  <GroupeTiroir titre={t('Trier')}>
                    {TRIS_DEMANDE.map((clef) => (
                      <ActionTiroir
                        key={clef}
                        actif={tri === clef}
                        onClick={() => {
                          onTri(clef);
                          fermer();
                        }}
                        data-tri-colonne={colonne}
                        data-tri={clef}
                      >
                        {t(TITRES_TRI_DEMANDE[clef])}
                      </ActionTiroir>
                    ))}
                  </GroupeTiroir>
                </>
              )}
            </MenuActions>
          </span>
        </span>
      </div>

      {/* LA RECHERCHE DE LA COLONNE, pleine largeur, sous sa tête. */}
      <div className="relative shrink-0 px-2.5">
        <Search className="pointer-events-none absolute left-[18px] top-[15px] h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={recherche}
          onChange={(event) => onRecherche(event.target.value)}
          placeholder={t('Rechercher…')}
          className="h-[30px] w-full pl-7 text-[13px]"
          aria-label={`${t('Rechercher…')} ${titre}`}
          data-recherche-colonne={colonne}
        />
      </div>

      {/*
       * LA LISTE DÉFILE CHEZ ELLE, tête de colonne comprise dans la boîte mais
       * hors du défilement : on garde le nom de la colonne sous les yeux, et le
       * bas de la colonne reste une surface de dépôt même quand la liste est
       * courte (`flex-1`, donc la zone occupe le vide restant).
       *
       * L'ESPACE SOUS LA RECHERCHE EST DANS LA ZONE QUI DÉFILE (`pt-2`), plus
       * sous le champ : la pastille des non-lus, à cheval sur le coin haut droit
       * de la première vignette, y trouve sa place au lieu d'être rognée.
       */}
      <ZoneDefilement className="flex min-h-0 flex-1 flex-col gap-2 px-2.5 pb-2.5 pt-2">
        {cartes.map((demande) => (
          <VignetteDemande
            key={demande.id}
            demande={demande}
            onOuvrir={() => onOuvrir(demande.id)}
            prise={prise(demande)}
            tenue={glissee === demande.id}
            gestes={gestes}
          />
        ))}
        {!cartes.length ? (
          <div className="rounded-md border border-dashed border-faint/40 px-3 py-6 text-center text-xs text-faint">
            {masquees ? t('Les demandes de cette colonne sont masquées par le filtre ou la recherche.') : t('Rien ici pour le moment.')}
          </div>
        ) : null}
      </ZoneDefilement>
    </div>
  );
}
