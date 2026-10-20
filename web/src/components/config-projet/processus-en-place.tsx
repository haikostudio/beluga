import * as React from 'react';
import {
  AlertTriangle,
  Box,
  Check,
  CircleCheck,
  GitMerge,
  Github,
  Hammer,
  Loader2,
  PackageCheck,
  RotateCw,
  Server,
  SquareTerminal,
  UploadCloud,
} from 'lucide-react';
import {
  LIBELLE_REPERE_D_AVANCEMENT,
  adresseVisee,
  brancheImposee,
  essaiReussiConnu,
  etapesDuDerouleCommun,
  etatDeLEtapeDePublication,
  genreDeLEtape,
  pourquoiCeProcessus,
  processusDeLEtape,
  processusJoueAuDeploiement,
  procedureEnPlace,
  reglagesChangesDepuisLeProcessus,
  reperesDAvancement,
  type CiblePublication,
  type EtatDeLEtapeDePublication,
  type GenreDEtapeDuProcessus,
  type Project,
  type ReglageChange,
  type RepereDAvancement,
} from '@beluga/shared';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { BoutonAgentDeConfiguration, useAgentDeConfiguration } from './agent-de-configuration';
import { Repli } from './communs';

/**
 * LES RUBRIQUES « DÉPLOIEMENT » ET « MISE EN PRODUCTION » ONT LA MÊME FORME, EN
 * TROIS TEMPS (11/10/2026 — « on ne comprend rien, trop d'informations ; je veux
 * comprendre où j'en suis et quel processus le système juge optimal ») :
 *
 *  1. OÙ J'EN SUIS (`OuJEnSuis`) : une phrase d'état, trois repères, un bouton ;
 *  2. CE QUI SE PASSERA AU CLIC (`ProcessusEnPlace`) : les étapes en titres
 *     simples, puis pourquoi ce processus, en deux phrases au plus ;
 *  3. LES RÉGLAGES : l'adresse du site, et le reste derrière « Réglages
 *     avancés » — ce troisième temps vit dans la page de chaque rubrique.
 *
 * Les deux premiers temps sont ici, communs aux deux rubriques.
 */

/** Le titre d'un des trois temps de la rubrique. */
export const CLASSE_TITRE_DE_TEMPS = 'text-[13.5px] font-medium text-text';

/** L'icône du rond, selon ce que fait l'étape (`genreDeLEtape`). */
const ICONE_DU_GENRE: Record<GenreDEtapeDuProcessus, React.ComponentType<{ className?: string }>> = {
  fusion: GitMerge,
  envoi: UploadCloud,
  github: Github,
  construction: Hammer,
  installation: PackageCheck,
  service: RotateCw,
  controle: CircleCheck,
  distant: Server,
  conteneur: Box,
  commande: SquareTerminal,
};

/** Une étape : ce qu'on en lit d'emblée (`titre`), et ce qui se range dans le détail. */
type PointDuProcessus = {
  genre: GenreDEtapeDuProcessus;
  titre: string;
  description?: string;
  commande?: string;
};

/* ------------------------------------------------------------------ */
/* 1. OÙ J'EN SUIS                                                      */
/* ------------------------------------------------------------------ */

/** Le nom affichable d'un réglage changé depuis l'écriture du processus. */
function nomDuReglage(reglage: ReglageChange): string {
  if (reglage === 'adresse') return t('adresse');
  if (reglage === 'port') return t('port');
  if (reglage === 'branche') return t('branche');
  if (reglage === 'commande') return t('commande de mise à jour');
  return t('services à relancer');
}

/**
 * LA PHRASE D'ÉTAT : une seule, et elle dit ce qu'il reste à faire. « Prêt »
 * ne promet un essai réussi que si l'écran en garde la preuve ; un déroulé
 * commun en service (Beluga, projet hérité) se dit tel quel, sans laisser
 * croire qu'un processus propre au projet sera joué.
 */
function phraseDEtat(
  etat: EtatDeLEtapeDePublication,
  suite: { joue: boolean; essaiReussi: boolean; changes: ReglageChange[] },
): string {
  if (etat === 'question') return t('L’agent attend votre réponse pour continuer son étude.');
  if (etat === 'etude') return t('Étude en cours : l’agent étudie le projet et prépare le processus.');
  if (etat === 'a-configurer') return t('À configurer : l’agent doit d’abord étudier le projet, puis établir son processus.');
  if (etat === 'a-reverifier') {
    return t('À revérifier : réglage modifié depuis l’écriture du processus ({reglages}). Demandez à l’agent de le relire.', {
      reglages: suite.changes.map(nomDuReglage).join(', '),
    });
  }
  if (!suite.joue) return t('Prêt : le déroulé commun s’applique à chaque déploiement.');
  return suite.essaiReussi
    ? t('Prêt : le processus est établi, et son dernier essai a réussi.')
    : t('Prêt : le processus est établi, il sera suivi au prochain clic.');
}

/**
 * LES TROIS REPÈRES, dessinés comme la barre d'étapes d'une carte
 * (`barre-etapes.tsx`), en noir et blanc : un rond plein et sa coche pour ce
 * qui est fait, un rond cerclé pour l'endroit où l'on est (une roue tant que
 * l'agent travaille, un point quand il attend une réponse, un « ! » quand il
 * faut revérifier), un rond pâle pour ce qui reste. Ce n'est pas une
 * navigation : rien ne se clique, on lit.
 */
function ReperesDAvancement({ reperes, attend }: { reperes: RepereDAvancement[]; attend: boolean }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
      aria-label="Avancement de la configuration"
      data-reperes-d-avancement
    >
      {reperes.map((repere, rang) => {
        const fait = repere.etat === 'fait';
        const ici = repere.etat === 'en-cours' || repere.etat === 'a-revoir';
        return (
          <li
            key={repere.cle}
            className="flex items-center gap-2"
            aria-current={ici ? 'step' : undefined}
            data-repere={repere.cle}
            data-repere-etat={repere.etat}
          >
            <span
              aria-hidden
              className={cn(
                'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
                fait
                  ? 'bg-text text-bg'
                  : ici
                    ? 'border-[1.5px] border-text text-text'
                    : 'border-[1.5px] border-faint/50 text-faint',
              )}
            >
              {fait ? (
                <Check className="h-3 w-3" strokeWidth={3} />
              ) : repere.etat === 'a-revoir' ? (
                <span className="text-[11px] font-bold leading-none">!</span>
              ) : repere.etat === 'en-cours' && attend ? (
                <span className="h-2 w-2 rounded-full bg-text" />
              ) : repere.etat === 'en-cours' ? (
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
              ) : null}
            </span>
            <span className={cn('text-[12.5px] leading-none', repere.etat === 'a-faire' ? 'text-faint' : 'font-medium text-text')}>
              {t(LIBELLE_REPERE_D_AVANCEMENT[repere.cle])}
            </span>
            {/* Un trait qui porte une information : plein jusqu'où l'on est
                arrivé, pâle au-delà. Il SUIT son repère : sur un téléphone, où
                les trois passent sur deux lignes, la seconde ne commence plus
                par un trait orphelin. */}
            {rang < reperes.length - 1 ? (
              <span aria-hidden className={cn('h-px w-4 sm:w-6', fait ? 'bg-text/60' : 'bg-faint/40')} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * LA DERNIÈRE RÉUSSITE DE CHAQUE ÉTAPE DE PUBLICATION, lue chez le serveur
 * (`deploy.reussites`). `relire` change quand il faut la relire. Un serveur
 * qui ne connaît pas encore cette lecture, ou un lien coupé, ne casse rien :
 * le repère retombe sur ce que l'écran sait par lui-même.
 */
function useReussitesDePublication(projectId: string, relire: string) {
  const [reussites, setReussites] = React.useState<Partial<Record<CiblePublication, number>> | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ reussites?: Partial<Record<CiblePublication, number>> }>({ type: 'deploy.reussites', projectId })
      .then((rendu) => {
        if (vivant) setReussites(rendu?.reussites ?? null);
      })
      .catch(() => {
        /* l'écran garde sa propre preuve */
      });
    return () => {
      vivant = false;
    };
  }, [projectId, relire]);
  return reussites;
}

/**
 * OÙ J'EN SUIS — le premier temps de la rubrique : UNE phrase d'état, trois
 * repères d'avancement (étude, processus établi, étape prête), et UN SEUL
 * bouton, celui de l'agent de configuration.
 *
 * L'état vient d'une règle pure (`etatDeLEtapeDePublication`, `shared`), nourrie
 * de ce que la rubrique sait déjà : l'étape peut-elle partir, l'agent
 * travaille-t-il ou attend-il une réponse, un réglage a-t-il changé depuis
 * l'écriture du processus. « À revérifier » se lit donc ICI, d'emblée, et plus
 * au milieu d'un bloc qu'il fallait dérouler.
 *
 * `entete` : ce que l'étape pose avant sa phrase (l'interrupteur de la mise en
 * production). `eteinte` : l'étape est désactivée — la phrase le dit, les
 * repères se taisent, et le bouton s'éteint en disant pourquoi au survol.
 */
export function OuJEnSuis({
  projet,
  cible,
  entete,
  eteinte,
}: {
  projet: Project;
  cible: CiblePublication;
  entete?: React.ReactNode;
  eteinte?: { phrase: string; voile: string } | null;
}) {
  const state = useApp();
  const { auTravail, question } = useAgentDeConfiguration(projet.id, cible);
  const processus = processusDeLEtape(projet, cible);
  const joue = cible === 'dev' ? processusJoueAuDeploiement(projet) : processus;
  const changes = processus ? reglagesChangesDepuisLeProcessus(processus, projet, cible) : [];
  const situation = {
    enPlace: procedureEnPlace(projet, cible),
    auTravail,
    question,
    reglagesChanges: changes.length > 0,
  };
  const etat = etatDeLEtapeDePublication(situation);
  /* LA PREUVE STABLE vient du serveur (`deploy.reussites`) : celle de l'écran
     seul retombait dès que l'autre étape publiait. Relue quand une publication
     du projet change d'état, et au retour du lien. */
  const derniere = state.deploys[projet.id];
  const reussites = useReussitesDePublication(projet.id, `${derniere?.id ?? ''}:${derniere?.state ?? ''}:${state.connected}`);
  const essaiReussi = essaiReussiConnu(derniere, cible, processus?.ecritLe, reussites?.[cible]);
  const reperes = reperesDAvancement({ ...situation, processus: !!processus, essaiReussi });
  const aRevoir = !eteinte && etat === 'a-reverifier';

  return (
    <section
      className="flex flex-col gap-3 rounded-lg bg-raised/35 px-3 py-3"
      data-ou-j-en-suis={cible}
      data-etat-de-l-etape={etat}
    >
      {entete}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <p
          className={cn(
            'flex min-w-[12rem] flex-1 items-start gap-1.5 text-[13.5px] leading-snug',
            eteinte ? 'text-muted' : aRevoir ? 'text-warning' : 'text-text',
          )}
          data-phrase-d-etat
          data-avertissement-processus={aRevoir ? '' : undefined}
        >
          {aRevoir ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          <span className="min-w-0">
            {eteinte ? eteinte.phrase : phraseDEtat(etat, { joue: !!joue, essaiReussi, changes })}
          </span>
        </p>
      </div>
      {eteinte ? null : <ReperesDAvancement reperes={reperes} attend={etat === 'question'} />}
      {/* LE BOUTON DE L'AGENT, EN DESSOUS ET SUR TOUTE LA LARGEUR, dans la couleur
          du travail de l'agent (demande du 19/10/2026 : il ne se perd plus en
          haut à droite, à côté de la phrase d'état). */}
      <BoutonAgentDeConfiguration projectId={projet.id} cible={cible} voile={eteinte?.voile ?? null} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. CE QUI SE PASSERA AU CLIC                                         */
/* ------------------------------------------------------------------ */

/**
 * LES ÉTAPES, EN TITRES SIMPLES : un petit rond à icône par étape, une ligne
 * verticale centrée sur les ronds, le titre à droite — et rien d'autre. La
 * commande exacte et le délai de chaque étape se lisent dans « Détail
 * technique ». Les ronds sont neutres : rien n'a encore tourné, c'est un
 * processus à lire, pas un déroulé.
 */
function FluxDuProcessus({ points }: { points: PointDuProcessus[] }) {
  /* Le rond fait 24 px, posé à 6 px du haut : son centre est à 18 px. */
  const centre = 18;
  return (
    <ol className="flex flex-col" data-flux-processus={points.length}>
      {points.map((point, rang) => {
        const Icone = ICONE_DU_GENRE[point.genre];
        const premier = rang === 0;
        const dernier = rang === points.length - 1;
        return (
          <li key={rang} className="relative min-h-9 py-1.5 pl-9" data-point-processus={point.genre}>
            {premier && dernier ? null : (
              <span
                className="absolute left-[11.5px] w-px bg-faint/40"
                style={premier ? { top: centre, bottom: 0 } : dernier ? { top: 0, height: centre } : { top: 0, bottom: 0 }}
                aria-hidden
                data-trait-processus
              />
            )}
            <span
              className="fond-de-zone absolute left-0 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-faint/60"
              aria-hidden
              data-rond-processus
            >
              <Icone className="h-3 w-3 text-muted" />
            </span>
            <p className="min-w-0 break-words text-[13.5px] leading-6 text-text" data-titre-point-processus>
              {point.titre}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * CE QUI SE PASSERA AU CLIC — le deuxième temps de la rubrique.
 *
 * Il montrait tout, déplié : l'adresse visée et la branche (déjà dites par les
 * réglages), le récit entier de l'agent (« Étude de l'agent »), puis chaque
 * étape avec sa commande. On n'y lit plus que :
 *
 *  - LES ÉTAPES QUI SERONT RÉELLEMENT JOUÉES, en titres simples : celles du
 *    processus écrit par l'agent, ou celles du déroulé commun quand c'est lui
 *    qui part (projet hérité, et Beluga Build dont le déroulé propre n'est
 *    jamais remplacé — `processusJoueAuDeploiement`) ;
 *  - POURQUOI CE PROCESSUS, en deux phrases au plus (`pourquoiCeProcessus`) ;
 *  - « DÉTAIL TECHNIQUE », fermé par défaut : la commande exacte et le délai de
 *    chaque étape, la date d'écriture, le lieu que l'agent a déclaré viser.
 *
 * Sans processus et sans déroulé commun (projet neuf, production jamais
 * configurée) : rien ne peut partir, et le bloc le dit.
 *
 * Les valeurs affichées sont celles du projet ENREGISTRÉ : un champ en cours
 * de saisie ne compte qu'une fois enregistré, comme pour le déploiement.
 */
export function ProcessusEnPlace({
  projet,
  cible,
  branche,
}: {
  projet: Project;
  cible: CiblePublication;
  /** La branche réglée (vide = la branche imposée de l'étape). */
  branche?: string;
}) {
  const [detail, setDetail] = React.useState(false);
  const ecrit = processusDeLEtape(projet, cible);
  const joue = cible === 'dev' ? processusJoueAuDeploiement(projet) : ecrit;
  const changes = ecrit ? reglagesChangesDepuisLeProcessus(ecrit, projet, cible) : [];

  if (!ecrit && !procedureEnPlace(projet, cible)) {
    return (
      <section className="space-y-2" data-processus-en-place={cible} data-processus-absent>
        <h3 className={CLASSE_TITRE_DE_TEMPS}>{t('Ce qui se passera au clic')}</h3>
        <p className="text-[13px] leading-snug text-muted" data-procedure-absente={cible}>
          {cible === 'production'
            ? t('Ce projet n’a pas encore de processus de mise en production : rien ne peut partir tant qu’il n’est pas configuré.')
            : t('Ce projet n’a pas encore de processus de déploiement : rien ne se déploie tant qu’il n’est pas initialisé.')}
        </p>
      </section>
    );
  }

  const enPoint = (etapes: NonNullable<typeof ecrit>['etapes']): PointDuProcessus[] =>
    etapes.map((etape) => ({
      genre: genreDeLEtape(etape),
      titre: etape.libelle,
      description: t('{n} s au plus', { n: String(etape.delaiS) }),
      commande: etape.commande,
    }));
  const communs: PointDuProcessus[] = joue
    ? []
    : etapesDuDerouleCommun(projet, branche?.trim() || brancheImposee(cible)).map((etape) => ({
        genre: etape.genre,
        titre: t(etape.libelle, etape.valeurs),
        description: t(etape.description, etape.valeurs),
        commande: etape.commande,
      }));
  /* Ce qui part au clic : le processus joué, sinon le déroulé commun. */
  const points = joue ? enPoint(joue.etapes) : communs;
  /* Ce que le détail déplie : le processus ÉCRIT (même non joué, pour Beluga),
     sinon le déroulé commun. */
  const details = ecrit ? enPoint(ecrit.etapes) : communs;

  const pourquoi = joue
    ? pourquoiCeProcessus(joue)
    : projet.isSelf
      ? t('Beluga Build garde son déroulé propre, avec ses gardes : jamais de redémarrage tant qu’une tâche ou une publication tourne.')
      : t('Aucun processus propre à ce projet n’est écrit : le déroulé commun s’applique, réglé par les champs de cette rubrique. L’agent de configuration peut en établir un sur mesure.');
  const ecritLe = ecrit?.ecritLe
    ? new Date(ecrit.ecritLe).toLocaleString(formatRegional(), { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const { adresse: lieu, declaree } = adresseVisee(ecrit, projet, cible);

  return (
    <section
      className="space-y-2.5"
      /* Le rond perce la ligne avec le fond de la ZONE : ici, la surface de la
         fenêtre de réglages. */
      style={{ ['--fond-zone' as string]: 'var(--surface)' }}
      data-processus-en-place={cible}
      data-processus-origine={joue ? 'agent' : 'commun'}
      data-processus-a-revoir={changes.length ? changes.join(' ') : undefined}
    >
      <h3 className={CLASSE_TITRE_DE_TEMPS}>{t('Ce qui se passera au clic')}</h3>

      <div data-etapes-processus={points.length}>
        <FluxDuProcessus points={points} />
      </div>

      {pourquoi ? (
        <p className="min-w-0 break-words text-[13px] leading-snug text-muted [overflow-wrap:anywhere]" data-pourquoi-processus>
          <span className="font-medium text-text">{t('Pourquoi ce processus :')}</span> {pourquoi}
        </p>
      ) : null}

      <Repli titre={t('Détail technique')} repere="detail-technique" ouvert={detail} onBascule={() => setDetail((avant) => !avant)}>
        <div className="space-y-2.5 px-1" data-detail-du-processus>
          {ecrit && !joue ? (
            <p className="text-[12.5px] leading-snug text-faint" data-processus-beluga>
              {t('Le processus écrit par l’agent se lit ici pour contrôle : il n’est pas joué à la place du déroulé propre de Beluga Build.')}
            </p>
          ) : null}
          <ol className="space-y-2">
            {details.map((point, rang) => (
              <li key={rang} className="min-w-0 text-[12.5px] leading-snug" data-etape-du-detail={point.genre}>
                <p className="text-text">
                  {rang + 1}. {point.titre}
                </p>
                {point.description ? <p className="text-muted">{point.description}</p> : null}
                {point.commande ? (
                  <code className="mt-0.5 block whitespace-pre-wrap break-all font-mono text-[11.5px] text-faint">
                    {point.commande}
                  </code>
                ) : null}
              </li>
            ))}
          </ol>
          {ecritLe || (lieu && declaree) ? (
            <p className="min-w-0 break-words text-[12px] leading-snug text-faint">
              {ecritLe ? <span data-processus-ecrit-le>{t('Processus écrit le {date}', { date: ecritLe })}</span> : null}
              {ecritLe && lieu && declaree ? ' · ' : null}
              {lieu && declaree ? (
                <span data-processus-adresse="agent">{t('Lieu déclaré par l’agent : {lieu}', { lieu })}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </Repli>
    </section>
  );
}
