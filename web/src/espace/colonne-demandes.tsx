import { ChampDeRecherche } from '@/components/ui/champ-de-recherche';
/**
 * UNE COLONNE DU TABLEAU — SON NOM, SON COMPTE, SON FILTRE, SA RECHERCHE.
 *
 * LE FILTRE EST PAR COLONNE, À DROITE DU TITRE. Il vivait dans un menu unique de
 * l'entête : filtrer « À faire » vidait aussi « Terminé », et rien, dans la
 * colonne, ne disait qu'un filtre y retenait des demandes. Chaque colonne porte
 * donc son bouton, qui ouvre SOUS LUI un petit menu (son tri, ses filtres ; les
 * filtres à choix déplient leur liste en sous-menu) — et une PASTILLE qui
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
import { Archive, BadgeCheck, CircleCheck, CircleDashed, Inbox, ListFilter, ListTodo, MessageSquare, Plus, Search, X, type LucideIcon } from '@/components/ui/icones';
import {
  ActionTiroir,
  Button,
  GroupeTiroir,
  Input,
  MenuActions,
  SousMenuTiroir,
  ZoneDefilement,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import {
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
import { VignetteDemande, type GestesDeVignette } from './vignette-demande';

/**
 * LA TÊTE D'UNE COLONNE SE LIT COMME UNE PASTILLE TEINTÉE (demande du 08/11/2026, capture #12cb) : une icône à
 * gauche, le nom, le compte dans sa propre pastille, sur un fond léger de la teinte de la colonne. Les teintes —
 * gris, bleu, vert, vert — sont une exception VOULUE à la charte monochrome, limitée à ces têtes (jetons
 * `--colonne-*` de styles.css, déclarés en clair et en sombre).
 */
const TETE_DE_COLONNE: Record<ColonneDemande, { icone: LucideIcon; fond: string; texte: string; compte: string }> = {
  'a-faire': { icone: ListTodo, fond: 'bg-colonne-gris-fond', texte: 'text-muted', compte: 'bg-colonne-gris-fond text-muted' },
  'en-cours': { icone: CircleDashed, fond: 'bg-colonne-bleu-fond', texte: 'text-colonne-bleu', compte: 'bg-colonne-bleu-fond text-colonne-bleu' },
  termine: { icone: CircleCheck, fond: 'bg-colonne-vert-fond', texte: 'text-colonne-vert', compte: 'bg-colonne-vert-fond text-colonne-vert' },
  valide: { icone: BadgeCheck, fond: 'bg-colonne-vert-fond', texte: 'text-colonne-vert', compte: 'bg-colonne-vert-fond text-colonne-vert' },
};

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
  /* SUR ORDINATEUR, LA RECHERCHE EST UNE LOUPE DANS LA TÊTE (carte « Refonte de l'espace Médias », 05/11/2026 :
     « recherche et filtres en icônes en haut à droite, partout ») ; le champ ne s'ouvre que sur demande, ou tant
     qu'il porte un texte. Sur téléphone, il reste toujours là. */
  const [rechercheOuverte, setRechercheOuverte] = React.useState(false);
  const champVisible = telephone || rechercheOuverte || !!recherche;

  const optionsEtiquette: { valeur: string; libelle: string }[] = [
    { valeur: '', libelle: t('Toutes les étiquettes') },
    ...etiquettes.map((etiquette) => ({ valeur: etiquette, libelle: etiquette })),
  ];
  const optionsImportance: { valeur: string; libelle: string }[] = [
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
        'flex h-full min-h-0 min-w-0 flex-col rounded-xl transition-colors',
        // LE WAGON : presque toute la largeur, la suivante en amorce.
        telephone ? 'w-[86vw] max-w-[420px] shrink-0 snap-center' : 'min-w-[220px] flex-1 basis-0',
        // La colonne visée pendant un glissement se signale : sans cela, on
        // lâche à l'aveugle.
        visee && 'bg-surface ring-1 ring-inset ring-faint/50',
      )}
      data-colonne-kanban={colonne}
      data-compte={cartes.length}
      data-colonne-visee={visee ? '' : undefined}
    >
      <div
        /* LA TÊTE TOUCHE LES BORDS DE SA COLONNE (cadrage du 24/11/2026 : « titres et colonnes alignés ») : le bord gauche
           de la première tête tombe sur celui du titre de la page, le bord droit de la dernière sur ses gestes. */
        className={cn('mb-1.5 mt-1 flex min-w-0 shrink-0 items-center gap-2 rounded-lg py-1 pl-2.5 pr-1', TETE_DE_COLONNE[colonne].fond)}
        data-tete-colonne={colonne}
      >
        {React.createElement(TETE_DE_COLONNE[colonne].icone, {
          className: cn('h-4 w-4 shrink-0', TETE_DE_COLONNE[colonne].texte),
          'aria-hidden': true,
        })}
        <span className={cn('min-w-0 truncate text-[13.5px] font-medium', TETE_DE_COLONNE[colonne].texte)}>{titre}</span>
        <span
          className={cn('shrink-0 rounded-md px-1.5 text-[11px] font-medium leading-[18px] tabular-nums', TETE_DE_COLONNE[colonne].compte)}
          data-compte-colonne={cartes.length}
        >
          {cartes.length}
        </span>
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
          {!telephone ? (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setRechercheOuverte((o) => !o || !!recherche)}
              title={t('Rechercher…')}
              aria-label="Rechercher"
              aria-pressed={champVisible}
              className={cn(recherche ? 'text-accent' : null)}
              data-recherche-colonne-bouton={colonne}
            >
              <Search className="h-4 w-4" />
            </Button>
          ) : null}
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
                    {/*
                     * LES DEUX FILTRES À CHOIX DÉPLIENT LEUR LISTE EN SOUS-MENU,
                     * à côté de leur entrée : choisir replie le sous-menu et
                     * laisse le menu ouvert, la valeur retenue à droite.
                     */}
                    {etiquettes.length ? (
                      <SousMenuTiroir
                        titre={t('Étiquette')}
                        valeur={optionsEtiquette.find((option) => option.valeur === (filtre.etiquette ?? ''))?.libelle}
                        data-filtre-etiquette={filtre.etiquette ?? ''}
                      >
                        {(replier) =>
                          optionsEtiquette.map((option) => (
                            <ActionTiroir
                              key={option.valeur}
                              actif={option.valeur === (filtre.etiquette ?? '')}
                              onClick={() => {
                                onFiltre({ ...filtre, etiquette: option.valeur || undefined });
                                replier();
                              }}
                              data-choix-etiquette={option.valeur}
                            >
                              {option.libelle}
                            </ActionTiroir>
                          ))
                        }
                      </SousMenuTiroir>
                    ) : null}
                    <SousMenuTiroir
                      titre={t('Importance')}
                      valeur={optionsImportance.find((option) => option.valeur === (filtre.importance ?? ''))?.libelle}
                      data-filtre-importance={filtre.importance ?? ''}
                    >
                      {(replier) =>
                        optionsImportance.map((option) => (
                          <ActionTiroir
                            key={option.valeur}
                            actif={option.valeur === (filtre.importance ?? '')}
                            onClick={() => {
                              onFiltre({
                                ...filtre,
                                importance: (option.valeur || undefined) as ImportanceDemande | undefined,
                              });
                              replier();
                            }}
                            data-choix-importance={option.valeur}
                          >
                            {option.libelle}
                          </ActionTiroir>
                        ))
                      }
                    </SousMenuTiroir>
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
      {champVisible ? (
        <div className="shrink-0">
          <ChampDeRecherche
            valeur={recherche}
            onChange={onRecherche}
            placeholder={t('Rechercher…')}
            aria-label={`${t('Rechercher…')} ${titre}`}
            autoFocus={rechercheOuverte && !telephone}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !recherche) setRechercheOuverte(false);
            }}
            data-recherche-colonne={colonne}
          />
        </div>
      ) : null}

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
      {/* LES VIGNETTES SUR LES BORDS DE LA TÊTE : la zone déborde de 4 px de chaque côté et les rend en marge intérieure,
          pour que la pastille des non-lus, à cheval sur le coin d'une vignette, ne soit pas rognée. */}
      <ZoneDefilement classeEnveloppe="-mx-1" className="flex min-h-0 flex-1 flex-col gap-2 px-1 pb-2.5 pt-2">
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
          <div className="rounded-xl bg-surface/70 px-3 py-6 text-center text-[12.5px] text-faint">
            {masquees ? t('Les demandes de cette colonne sont masquées par le filtre ou la recherche.') : t('Rien ici pour le moment.')}
          </div>
        ) : null}
      </ZoneDefilement>
    </div>
  );
}
