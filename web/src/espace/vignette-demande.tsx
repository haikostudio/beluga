/**
 * LA VIGNETTE D'UNE DEMANDE — LA TENUE DES CARTES DU TABLEAU BELUGA.
 *
 * Elle s'aligne sur les cartes du tableau Beluga, pour qu'on ne lise pas deux
 * kanbans différents dans la même application : même cadre plein
 * (`border-border bg-raised`), même titre en 14 px qui revient à la ligne
 * plutôt que de sortir du cadre, mêmes pastilles `Badge` pour les étiquettes.
 * L'importance reste un POINT de couleur, jamais un badge en capitales.
 *
 * CHAQUE INFORMATION A SON COIN, au lieu d'une seule ligne de pied qui les
 * alignait toutes :
 *  - en HAUT À DROITE, à gauche du « … », les compteurs de pièces jointes et
 *    de commentaires — ce qu'on guette en parcourant une colonne ;
 *  - en BAS, l'auteur à gauche et la DATE à droite (l'échéance, en rouge si
 *    elle est passée, sinon le jour du dépôt) ;
 *  - les TÂCHES quittent la carte pour un ONGLET SUSPENDU dessous, le même
 *    bandeau que celui des cartes Beluga (`bg-bandeau-etape`) : orange tant
 *    qu'il en reste, bleu quand tout est coché. Sans tâche, pas d'onglet.
 *
 * TOUTE LA VIGNETTE SE PREND, onglet compris : plus de poignée à viser. Un
 * appui maintenu arme le glisser — celui du tableau des cartes (`@/lib/dnd`),
 * pas un second geste écrit pour l'occasion —, et un clic ordinaire ouvre la
 * fiche.
 *
 * LES GESTES RARES SONT SOUS LE « … » : ranger, ouvrir la carte Beluga. Ils ne
 * prennent plus de place sur chaque vignette du tableau. Changer de colonne se
 * fait en glissant la vignette.
 */
import * as React from 'react';
import { ArrowRightLeft, CheckSquare, Inbox, MessageSquare, Paperclip } from 'lucide-react';
import { ActionTiroir, Badge, GroupeTiroir, MenuActions, Pastille } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import {
  TITRES_IMPORTANCE,
  demandeATraiter,
  echeanceDeDemandeDepassee,
  estArchivee,
  extraitDeDescription,
  jaugeDesTaches,
  type DemandeAffichee,
} from '@beluga/shared';
import { POINT_IMPORTANCE, jourCourt, jourDe } from './formats';

/*
 * PLUS DE « DÉPLACER » SOUS LE « ⋮ ». Une demande change de colonne en la
 * glissant (`usePointerDrag`), le seul geste pour cela.
 */
export interface GestesDeVignette {
  /** Ranger la demande, ou la ressortir des archives. */
  onArchiver: (id: string, archivee: boolean) => void;
  /** Réservé à Haiko : en faire une carte Beluga, ou l'ouvrir. */
  onCarte?: (id: string) => void;
}

export function VignetteDemande({
  demande,
  onOuvrir,
  prise,
  tenue,
  gestes,
}: {
  demande: DemandeAffichee;
  onOuvrir: () => void;
  /** Ce qui arme l'appui long : posé sur la vignette ENTIÈRE. */
  prise: React.HTMLAttributes<HTMLElement>;
  tenue: boolean;
  gestes: GestesDeVignette;
}) {
  const extrait = extraitDeDescription(demande.description);
  /* CE QUI M'ATTEND SE LIT, IL NE SE DÉCLARE PLUS : des messages non ouverts. */
  const nonLus = demande.resume.nonLus;
  const jauge = jaugeDesTaches(demande.taches);
  const enRetard = echeanceDeDemandeDepassee(demande.echeance, Date.now());
  const rangee = estArchivee(demande);
  const { pieces, commentaires } = demande.resume;
  /*
   * CE QUE LE CHIFFRE DE LA MESSAGERIE COMPTE SE RETROUVE SUR LA VIGNETTE.
   * « Nouvelle » : ce compte ne l'a jamais ouverte (même règle que le non-lu
   * bleu). « À traiter » : dans « À faire », sans carte — la pastille ORANGE de
   * la Messagerie, qu'on prenait pour un message. Vu par Haiko seul : `onCarte`
   * n'est donné qu'à sa vue.
   */
  const nouvelle = Boolean(demande.resume.jamaisOuverte);
  const aTraiter = Boolean(gestes.onCarte) && demandeATraiter(demande);

  /*
   * LES COMPTEURS, SUR LA LIGNE DU « ⋮ ». Ils tombaient une ligne plus bas que
   * les trois points dès que le titre prenait de la hauteur : ils sont
   * désormais dans le MÊME conteneur flex, centrés sur la hauteur du bouton.
   * `reperes` n'est vrai que pour la copie visible — le double qui réserve la
   * place ne porte aucun repère de contrôle.
   */
  const compteurs =
    pieces || commentaires
      ? (reperes: boolean) => (
          <span
            className="inline-flex h-6 items-center gap-2 text-[12px] leading-none text-faint"
            data-compteurs-vignette={reperes ? '' : undefined}
          >
            {pieces ? (
              <span className="inline-flex items-center gap-1" data-compteur-pieces={reperes ? pieces : undefined}>
                <Paperclip className="h-3 w-3" />
                {pieces}
              </span>
            ) : null}
            {commentaires ? (
              /* LE NOMBRE DE NON-LUS N'EST PLUS REDIT ICI : la pastille du coin le
                 porte. Le compteur se teinte seulement du bleu « à lire ». */
              <span
                className={cn('inline-flex items-center gap-1', nonLus && 'font-medium text-info')}
                data-compteur-commentaires={reperes ? commentaires : undefined}
              >
                <MessageSquare className="h-3 w-3" />
                {commentaires}
              </span>
            ) : null}
          </span>
        )
      : null;

  return (
    <div
      {...prise}
      className={cn(
        'group cursor-pointer',
        // `touch-action: manipulation` laisse le rail défiler tant que l'appui
        // n'est pas long ; une fois la vignette prise, c'est l'écouteur non
        // passif de `usePointerDrag` qui retient le doigt.
        'touch-manipulation',
        tenue && 'opacity-40',
      )}
      data-demande={demande.id}
      data-colonne={demande.colonne}
      data-non-lus={nonLus || undefined}
      data-jamais-ouverte={nouvelle ? '' : undefined}
      data-vignette-tenue={tenue ? '' : undefined}
    >
      <div
        className={cn(
          /* LE CADRE D'UNE CARTE BELUGA : fond `raised`, tour `border`, et le
             survol qui éclaircit le tour — le même geste que sur le tableau.
             Au-dessus de l'onglet (`z-10`), dont il mange le haut arrondi. */
          'relative z-10 rounded-md border border-border bg-raised transition-colors hover:border-faint',
          jauge.total ? 'rounded-b-none' : null,
          tenue && 'ring-1 ring-accent/50',
        )}
        data-cadre-vignette
      >
        {/* CE QUI M'ATTEND SE VOIT SANS OUVRIR LA FICHE : des messages que je
            n'ai pas lus. La pastille commune, bleue (à lire), à cheval sur le
            coin haut droit du cadre — la même dans la vue client et chez Haiko. */}
        <Pastille
          nombre={nonLus}
          ton="lire"
          position="coin-deborde"
          data-non-lus-vignette={nonLus || undefined}
          title={nonLus > 1 ? `${nonLus} ${t('messages non lus')}` : t('1 message non lu')}
        />
        <button
          type="button"
          onClick={onOuvrir}
          className="block w-full min-w-0 px-2.5 py-2 text-left"
          data-ouvrir-demande={demande.id}
        >
          {/* LA PLACE DU « ⋮ » N'EST RÉSERVÉE QUE SUR CETTE RANGÉE : elle
              écartait aussi la date du pied, loin du bord droit. */}
          <div className="flex min-w-0 items-start gap-2 pr-6" data-rangee-titre-vignette>
            {/* L'IMPORTANCE EST UN POINT : la couleur porte l'information, le
                titre entier reste lisible à côté. */}
            <span
              className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', POINT_IMPORTANCE[demande.importance])}
              title={t(TITRES_IMPORTANCE[demande.importance])}
              aria-hidden
            />
            {/* Le titre est le texte qu'on cherche à lire en entier : il revient
                à la ligne, y compris au milieu d'un mot interminable, plutôt que
                de sortir du cadre — comme sur le tableau Beluga. */}
            <h3 className="min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-text">
              {demande.titre}
            </h3>
            {/* LA PLACE DES COMPTEURS, RÉSERVÉE SANS LES DESSINER : les vrais
                vivent à côté du « ⋮ », sur SA ligne ; ce double invisible garde
                le titre de passer dessous. */}
            {compteurs ? (
              <span className="invisible shrink-0" aria-hidden>
                {compteurs(false)}
              </span>
            ) : null}
          </div>

          {nouvelle || aTraiter ? (
            <div className="mt-1.5 flex flex-wrap gap-1" data-reperes-vignette>
              {nouvelle ? (
                <span
                  className="rounded bg-info/15 px-1.5 text-[10.5px] font-medium leading-4 text-info"
                  data-vignette-nouvelle
                >
                  {t('Nouvelle')}
                </span>
              ) : null}
              {aTraiter ? (
                <span
                  className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 text-[10.5px] font-medium leading-4 text-warning"
                  data-vignette-a-traiter
                  title={t('À traiter : pas encore de carte Beluga')}
                >
                  <Inbox className="h-2.5 w-2.5" aria-hidden />
                  {t('À traiter')}
                </span>
              ) : null}
            </div>
          ) : null}

          {extrait ? <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{extrait}</p> : null}

          {/* LES ÉTIQUETTES SONT DES PASTILLES, comme les `labels` d'une carte :
              trois au plus, pour que la vignette reste lisible. */}
          {demande.etiquettes.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {demande.etiquettes.slice(0, 3).map((etiquette) => (
                <Badge key={etiquette} data-etiquette={etiquette}>
                  {etiquette}
                </Badge>
              ))}
            </div>
          ) : null}

          {/* LE PIED : qui à gauche, quand à droite — en gris pâle et en 12 px,
              comme le pied d'une carte Beluga. */}
          <div
            className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[12px] text-faint"
            data-pied-vignette
          >
            <span className="min-w-0 truncate">{demande.auteurNom}</span>
            {demande.echeance ? (
              <span
                className={cn('shrink-0 text-right', enRetard && 'text-danger')}
                data-echeance={enRetard ? 'depassee' : 'a-venir'}
                data-date-vignette
              >
                {jourCourt(demande.echeance)}
              </span>
            ) : (
              <span className="shrink-0 text-right" data-date-vignette>
                {jourDe(demande.creeeLe)}
              </span>
            )}
          </div>
        </button>

        {/*
         * LE « … » DE LA VIGNETTE. Il arrête l'appui avant qu'il n'arme le
         * glisser : sans ce garde, ouvrir le menu prendrait la vignette.
         */}
        <span
          className="absolute right-0.5 top-1 flex items-center gap-1.5"
          data-coin-vignette
        >
          {/* Les compteurs ne se prennent pas pour le « ⋮ » : un clic dessus ouvre la fiche. */}
          {compteurs ? (
            <span className="pointer-events-none" aria-hidden>
              {compteurs(true)}
            </span>
          ) : null}
          <span onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <MenuActions titre={demande.titre} repere="vignette" className="text-faint">
            {(fermer) => (
              <>
                <GroupeTiroir titre={t('Ranger')}>
                  <ActionTiroir
                    icone={<Inbox className="h-3.5 w-3.5" />}
                    onClick={() => {
                      gestes.onArchiver(demande.id, !rangee);
                      fermer();
                    }}
                    data-archiver-vignette={demande.id}
                  >
                    {rangee ? t('Ressortir') : t('Archiver')}
                  </ActionTiroir>
                  {gestes.onCarte ? (
                    <ActionTiroir
                      icone={<ArrowRightLeft className="h-3.5 w-3.5" />}
                      onClick={() => {
                        gestes.onCarte?.(demande.id);
                        fermer();
                      }}
                      data-carte-vignette={demande.id}
                    >
                      {demande.carteId ? t('Voir la carte Beluga') : t('En faire une carte Beluga')}
                    </ActionTiroir>
                  ) : null}
                </GroupeTiroir>
              </>
            )}
          </MenuActions>
          </span>
        </span>
      </div>

      {/*
       * L'ONGLET DES TÂCHES, SUSPENDU SOUS LA CARTE — la tenue exacte des
       * bandeaux du tableau Beluga : il remonte sous le cadre (`-mt-1`), porte
       * l'ombre intérieure qui le fait passer DESSOUS, et arrondit seul le bas.
       * Il reste DANS l'élément pris : tirer sur l'onglet tire la vignette.
       */}
      {jauge.total ? (
        <button
          type="button"
          onClick={onOuvrir}
          className={cn(
            'relative -mt-1 flex w-full cursor-pointer items-center gap-1 overflow-hidden rounded-b-md bg-bandeau-etape px-1.5 pb-1.5 pt-2 text-left text-[12.5px] leading-none',
            'shadow-[inset_0_7px_6px_-6px_rgba(0,0,0,0.75)]',
            jauge.faites === jauge.total ? 'text-termine' : 'text-en-cours',
          )}
          data-onglet-taches={`${jauge.faites}/${jauge.total}`}
          data-jauge-taches={`${jauge.faites}/${jauge.total}`}
          title={t('Todo')}
        >
          <CheckSquare className="h-3 w-3 shrink-0" />
          <span>
            {jauge.faites}/{jauge.total}
          </span>
        </button>
      ) : null}
    </div>
  );
}
