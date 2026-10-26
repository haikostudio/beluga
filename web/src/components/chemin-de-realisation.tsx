import * as React from 'react';
import { Clapperboard, Music, Play } from 'lucide-react';
import {
  type Attachment,
  type Card,
  type EtatDUnJalon,
  type TodoItem,
  LIBELLE_ETAPE_DE_SUIVI,
  LIBELLES_PHASES_DE_REALISATION,
  cheminDeLaRealisation,
  estUnApercu,
  realisationDeLaCarte,
} from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { CLASSE_BLOC_DU_PIED } from '@/components/ui';
import { CaseDeTache, classeDuLibelleDeTache } from '@/components/todos';
import { CLASSE_TRAIT_DE_BRANCHE } from '@/components/pastille-projet';
import { useMediasLivres } from '@/components/medias-livres';
import { ImageDePiece, adresseDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { ouvrirLeDocument } from '@/lib/document-de-carte';
import { useApp } from '@/lib/use-app';
import { useEtapesDuMedia } from '@/lib/production-de-carte';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** L'étape du tournage se valide comme une tâche : faite, en cours (ou prête), à venir. */
function etatDeTache(etat: EtatDUnJalon): TodoItem['state'] {
  return etat === 'fait' ? 'done' : etat === 'avenir' ? 'todo' : 'running';
}

/** Les pièces jointes du projet, demandées une fois si l'écran ne les a pas encore. */
function usePiecesDuProjet(projectId: string): Attachment[] | undefined {
  const connues = useApp().attachments[projectId];
  React.useEffect(() => {
    if (!connues) client.send({ type: 'attachments.list', projectId });
  }, [projectId, !connues]);
  return connues;
}

/**
 * LE CHEMIN DU TOURNAGE, DANS LE FIL (décision de l'utilisateur du 22/10/2026).
 *
 * Il remplace la sensation « un brief, un cahier, un bouton » : les sept
 * étapes (idée, style, scénario, budget, fabrication, montage, livré)
 * s'allument à mesure que le questionnaire avance, puis pendant le travail —
 * « Montage » dès que l'agent annonce l'assemblage (`montageA`). L'étape
 * où l'on est porte les tâches du tour.
 * Pendant la fabrication, les plans déjà faits se rangent dessous, puis le
 * tableau d'ambiance avec les images retenues.
 *
 * UNE LISTE DE TÂCHES, PLUS AUCUNE FRISE NI AUCUN FIL (décisions de
 * l'utilisateur du 23/10/2026, capture #cd9b) : les sept étapes s'écrivent
 * l'une sous l'autre et se VALIDENT EXACTEMENT COMME LA LISTE DE TÂCHES — même
 * case (`CaseDeTache`, `todos.tsx`), cochée et barrée une fois faite, en cours
 * qui respire, vide à venir. Aucun rond ni trait de rail. L'étape où l'on est ne
 * porte PLUS AUCUN TEXTE sous son nom (ni membre de l'équipe, ni mission, ni
 * « Ensuite », ni enveloppe, ni « Tout est prêt » — décision du 23/10/2026) :
 * seules les tâches du tour (`taches`) s'y rangent, en retrait et reliées à
 * l'étape par des branches pointillées, comme les membres d'un projet réuni
 * dans la colonne de gauche. Plus aucun violet ni pictogramme.
 *
 * COLLÉ AU-DESSUS DE LA RANGÉE D'ACTION, HORS DU FIL (`chat.tsx`, même règle
 * que le déroulé du cahier des charges, décision du 22/10/2026) : `reduit` (le
 * fil n'est pas en bas) ne fait plus que se signaler (`data-chemin-reduit`),
 * l'étape n'ayant plus de texte à replier ; replié par le pied compact du
 * téléphone (`onDeplier`), seule l'étape où l'on est reste.
 * Les six autres lignes ne disparaissent PAS au défilement : leur hauteur
 * dépasserait l'hystérésis de `auBas` (96 px) et ferait battre le bloc. Les plans fabriqués et le tableau d'ambiance, eux, DÉFILENT dans
 * le fil (`GaleriesDuTournage`) : trop hauts pour rester collés. Ni jauge ni
 * pause : ce n'est pas le bandeau retiré le 21/10/2026. Tout se lit
 * sur la carte (`cheminDeLaRealisation`), jamais dans les messages. Le
 * lancement reste le bouton de la rangée d'action : l'étape « Fabrication »
 * y renvoie quand le cahier est prêt.
 */
export function CheminDeRealisation({
  carte,
  reduit = false,
  onDeplier,
  integre = false,
  taches,
}: {
  carte: Card;
  reduit?: boolean;
  /** Replié pour faire de la place (pied compact du téléphone) : un appui le rouvre. */
  onDeplier?: () => void;
  /**
   * POSÉ EN TÊTE DU REPÈRE DES TÂCHES (demande du 23/10/2026) : ni bord ni fond
   * à lui, il prend ceux du décroché collé au champ (`TravailEnCours`,
   * `chat.tsx`) — un seul bloc pour les étapes et la liste de tâches.
   */
  integre?: boolean;
  /** La ligne de travail et la liste de tâches du tour, rangées SOUS l'étape où l'on est. */
  taches?: React.ReactNode;
}) {
  const chemin = cheminDeLaRealisation(carte);
  const auTravail = carte.column === 'running';
  /* LES QUATRE ÉTAPES DU MÉDIA (26/10/2026), les mêmes que la barre du haut et
     le volet : Brief, Esquisses, Montage, Téléchargement — plus les sept jalons
     d'avant, qui disaient deux fois le parcours autrement. */
  const media = useEtapesDuMedia(carte);
  const etapes: { jalon: string; libelle: string; etat: EtatDUnJalon }[] = media
    ? media.segments.map((s) => ({ jalon: s.etape, libelle: LIBELLE_ETAPE_DE_SUIVI[s.etape], etat: s.etat === 'fait' ? 'fait' : s.etat === 'avenir' ? 'avenir' : s.etat === 'question' ? 'pret' : 'encours' }))
    : [];
  const ouEstOn = media?.courante ?? chemin.jalon;
  return (
    <section
      className={integre ? 'min-w-0 flex-1' : CLASSE_BLOC_DU_PIED}
      data-chemin-realisation
      data-chemin-integre={integre ? '' : undefined}
      data-chemin-reduit={reduit ? '' : undefined}
      data-jalon={ouEstOn}
      data-role={chemin.role}
    >
      <div
        className={cn(integre ? 'py-0.5' : 'rounded-xl bg-raised/60 px-3 py-2', onDeplier && 'cursor-pointer')}
        /* Replié par le pied compact : tout le bloc se rouvre d'un appui. */
        {...(onDeplier
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': false,
              'data-deplier-bloc': '',
              onClick: onDeplier,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onDeplier();
                }
              },
            }
          : {})}
      >
        {/* LE BOUTON « SUIVI » EN HAUT À DROITE DE LA LISTE (capture #4e9c, décision
            du 25/10/2026), plus sur la ligne de l'étape en cours : sur téléphone il
            ouvre le suivi en page entière ; sur ordinateur le volet est toujours
            ouvert, et le bouton le ramène quand un autre document a pris sa place. */}
        <div className="flex min-w-0 items-start gap-2">
        <ol className="flex min-w-0 flex-1 flex-col gap-0.5" aria-label="Étapes du tournage">
          {etapes.map((etape) => {
            /* L'étape DÉPLIÉE est celle où se trouve la création. */
            const ici = etape.jalon === ouEstOn;
            /* Replié par le pied compact du téléphone : seule l'étape où l'on est reste. */
            if (onDeplier && !ici) return null;
            const etat = etatDeTache(etape.etat);
            return (
              <li
                key={etape.jalon}
                className="flex min-w-0 items-start gap-2 py-1"
                data-etape-chemin={etape.jalon}
                data-etat={etape.etat}
                data-etape-depliee={ici ? '' : undefined}
                aria-current={etape.etat === 'encours' || etape.etat === 'pret' ? 'step' : undefined}
              >
                {/* La même case que la liste de tâches : cochée une fois faite, en cours, vide à venir. */}
                <CaseDeTache etat={etat} streaming={etape.etat === 'encours' && auTravail} />
                <div className="min-w-0 flex-1">
                  <span className={cn('block truncate', classeDuLibelleDeTache(etat))} data-nom-etape>
                    {t(etape.libelle)}
                  </span>
                  {ici ? (
                    <>
                      {/* LES TÂCHES DU TOUR, sous l'étape où l'on est (`TravailEnCours`, `chat.tsx`). */}
                      {taches ? (
                        <div className="relative min-w-0 pt-1" data-taches-de-l-etape>
                          {/* LE TRONC : du dessous de la case de l'étape jusqu'au
                              haut de la première tâche (`pt-1` + `py-1.5` de la
                              liste, 10 px). Chaque tâche prend ensuite sa
                              branche (`BrancheDeTache`, `todos.tsx`). L'axe :
                              milieu de la case, 15,5 px à gauche du nom. */}
                          <span
                            aria-hidden
                            data-tronc-des-taches
                            className={`${CLASSE_TRAIT_DE_BRANCHE} top-0 h-[10px] border-l`}
                            style={{ left: -16 }}
                          />
                          {taches}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
          <button
            type="button"
            className="mt-0.5 flex h-[29px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted transition-colors hover:bg-raised hover:text-text sm:h-6"
            title={t('Ouvrir le suivi de la production')}
            data-ouvrir-le-suivi=""
            onClick={(event) => {
              event.stopPropagation();
              ouvrirLeDocument({ cardId: carte.id, genre: 'suivi', numero: 0 });
            }}
          >
            <Clapperboard className="h-3.5 w-3.5" />
            {t('Suivi')}
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * LES PLANS FABRIQUÉS ET LE TABLEAU D'AMBIANCE DU TOURNAGE, DANS LE FIL : ils
 * défilent, sous le plan, quand le chemin lui-même est collé en bas.
 */
export function GaleriesDuTournage({ carte }: { carte: Card }) {
  const chemin = cheminDeLaRealisation(carte);
  const auTravail = carte.column === 'running';
  const plans = auTravail && (chemin.jalon === 'fabrication' || chemin.jalon === 'montage');
  const ambiance = (realisationDeLaCarte(carte).ambiance ?? []).length > 0;
  if (!plans && !ambiance) return null;
  return (
    <div className="px-4 pb-3 pt-1 [&>*:first-child]:mt-0" data-galeries-du-tournage>
      {plans ? <PlansFabriques carte={carte} /> : null}
      {ambiance ? <TableauDAmbiance carte={carte} /> : null}
    </div>
  );
}

/**
 * LES PLANS DÉJÀ FABRIQUÉS (décision de l'utilisateur du 22/10/2026) : pendant
 * la fabrication et le montage, la rangée se remplit à mesure que les plans
 * sortent — une vignette par média fini, une silhouette par plan encore en
 * cours. C'est un RÉSUMÉ : les blocs du fil restent où ils sont.
 *
 * Les finis viennent de la base (`medias.livres.carte`, `useMediasLivres`) : la
 * rangée survit au rechargement et au redémarrage du démon. Les silhouettes
 * viennent de la liste en mémoire (`medias.fabrication`). Les aperçus du
 * questionnaire n'y entrent pas : ils ont leur tableau d'ambiance.
 */
function PlansFabriques({ carte }: { carte: Card }) {
  const livres = useMediasLivres({ cardId: carte.id });
  const etat = useApp();
  const enFabrication = etat.mediasEnFabrication ?? [];
  const connues = usePiecesDuProjet(carte.projectId);
  const [ouverte, setOuverte] = React.useState<Attachment | null>(null);
  const ambiance = new Set((realisationDeLaCarte(carte).ambiance ?? []).map((p) => p.piece));
  const finis = livres.filter((m) => !estUnApercu(m.sujet) && !ambiance.has(m.attachmentId));
  const enCours = enFabrication.filter((m) => m.cardId === carte.id && m.etat === 'en-cours' && !estUnApercu(m.sujet));
  if (!finis.length && !enCours.length) return null;
  const galerie = finis.map((m) => connues?.find((a) => a.id === m.attachmentId)).filter(Boolean) as Attachment[];
  return (
    <div className="mt-3" data-plans-fabriques={finis.length} data-plans-en-cours={enCours.length}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] uppercase tracking-wide text-faint">{t('Plans fabriqués')}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {finis.map((m) => {
          const jointe = galerie.find((a) => a.id === m.attachmentId);
          const legende = `${m.sujet || t('Média')}${m.version > 1 ? ` · v${m.version}` : ''}`;
          return (
            <button
              key={m.id}
              type="button"
              className="group flex min-w-0 flex-col gap-0.5 text-left"
              onClick={() => (jointe ? setOuverte(jointe) : window.open(adresseDePiece(m.attachmentId), '_blank'))}
              title={legende}
              data-plan-fabrique={m.attachmentId}
              data-plan-genre={m.genre}
            >
              <span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-surface">
                {m.genre === 'image' ? (
                  <ImageDePiece id={m.attachmentId} alt={legende} className="h-full w-full object-cover" />
                ) : m.genre === 'video' ? (
                  <>
                    {/* La première image fait la vignette ; la lecture se fait à l'ouverture. */}
                    <video src={adresseDePiece(m.attachmentId)} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                    <span aria-hidden className="absolute flex h-6 w-6 items-center justify-center rounded-full bg-bg/80 text-text">
                      <Play className="h-3 w-3 translate-x-px" fill="currentColor" />
                    </span>
                  </>
                ) : (
                  <Music aria-hidden className="h-4 w-4 text-faint" />
                )}
              </span>
              <span className="block truncate text-[11px] leading-tight text-faint group-hover:text-muted">{legende}</span>
            </button>
          );
        })}
        {enCours.map((m) => (
          <span key={m.id} className="flex min-w-0 flex-col gap-0.5" title={m.sujet} data-plan-en-cours={m.id}>
            <span aria-hidden className="block aspect-square w-full animate-silhouette rounded-md bg-faint/25" />
            <span className="block truncate text-[11px] leading-tight text-faint">{m.sujet}</span>
          </span>
        ))}
      </div>
      <AttachmentPreview item={ouverte} onClose={() => setOuverte(null)} galerie={galerie} onNaviguer={setOuverte} />
    </div>
  );
}

/**
 * LE TABLEAU D'AMBIANCE : les images retenues pendant le questionnaire (un
 * choix en images tranché, un aperçu gardé), chacune avec la rubrique qu'elle
 * illustre. Un clic l'ouvre en grand, avec la galerie des autres.
 */
function TableauDAmbiance({ carte }: { carte: Card }) {
  const [ouverte, setOuverte] = React.useState<Attachment | null>(null);
  const pieces = realisationDeLaCarte(carte).ambiance ?? [];
  const connues = usePiecesDuProjet(carte.projectId);
  const galerie = pieces.map((p) => connues?.find((a) => a.id === p.piece)).filter(Boolean) as Attachment[];
  return (
    <div className="mt-3" data-tableau-ambiance={pieces.length}>
      <p className="mb-1.5 text-[12px] uppercase tracking-wide text-faint">{t('Tableau d’ambiance')}</p>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {pieces.map((piece) => {
          const jointe = galerie.find((a) => a.id === piece.piece);
          return (
            <button
              key={piece.piece}
              type="button"
              className="group flex min-w-0 flex-col gap-0.5 text-left"
              onClick={() => (jointe ? setOuverte(jointe) : window.open(`/api/attachment?id=${encodeURIComponent(piece.piece)}`, '_blank'))}
              title={[piece.legende, t(LIBELLES_PHASES_DE_REALISATION[piece.phase])].filter(Boolean).join(' · ')}
              data-piece-ambiance={piece.piece}
            >
              <span className="relative block aspect-square w-full overflow-hidden rounded-md bg-surface">
                <ImageDePiece id={piece.piece} alt={piece.legende ?? ''} className="h-full w-full object-cover" />
              </span>
              <span className="block truncate text-[11px] leading-tight text-faint group-hover:text-muted">
                {piece.legende ?? t(LIBELLES_PHASES_DE_REALISATION[piece.phase])}
              </span>
            </button>
          );
        })}
      </div>
      <AttachmentPreview item={ouverte} onClose={() => setOuverte(null)} galerie={galerie} onNaviguer={setOuverte} />
    </div>
  );
}
