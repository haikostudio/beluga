/*
 * LE VOLET D'UNE MISE EN LIGNE : UN FLUX À POINTS, LE DÉTAIL SOUS SON ÉTAPE.
 *
 * Il y avait DEUX écrans de suivi, et ils ne se ressemblaient pas. Le
 * déploiement s'ouvrait sur une longue timeline où chaque étape se dépliait
 * sur place ; la mise en production réutilisait la même timeline mais y
 * traînait des morceaux qui n'avaient rien à y faire. UN SEUL COMPOSANT LES
 * SERT DÉSORMAIS, monté deux fois avec une table d'étapes différente
 * (`shared/src/parcours-de-publication.ts`).
 *
 * LA LISTE EST UN ACCORDÉON, PLUS DEUX COLONNES. Le volet a d'abord posé le
 * parcours à gauche et le détail à droite : il fallait faire l'aller-retour
 * entre une liste et un panneau pour savoir ce qu'une étape avait fait, et sur
 * écran étroit les deux colonnes s'empilaient — une seconde mise en page à
 * maintenir pour la même information. Désormais :
 *
 *   UN POINT PAR ÉTAPE, dessiné comme le fil d'un agent : un grand rond à
 *   icône, un trait vertical continu qui relie les ronds, le nom de l'étape
 *   puis, dessous, la phrase qui dit ce qu'elle fait. Cliquer l'étape DÉPLIE
 *   son détail JUSTE DESSOUS : l'explication longue, puis son fil horodaté —
 *   chaque commande, chaque branche, chaque passage d'un agent de dépannage.
 *
 *   UNE SEULE ÉTAPE OUVERTE À LA FOIS. Ouvrir la voisine referme la
 *   précédente ; recliquer l'étape ouverte la referme. L'étape qui travaille
 *   est dépliée d'office — c'est celle qu'on vient regarder.
 *
 *   LA MÊME PRÉSENTATION PARTOUT, téléphone compris : une liste qui se déplie
 *   tient dans n'importe quelle largeur.
 *
 * LA CONVERSATION N'EST PLUS UN POINT DU PARCOURS. Parler à celui qui publie
 * n'est pas une étape de la publication : c'est un GESTE, et les gestes vivent
 * au pied du volet. Le bouton « En parler avec celui qui publie » se pose donc
 * SOUS « Arrêter », et ouvre le fil dans un tiroir EMPILÉ au-dessus du volet —
 * le parcours reste derrière, on le retrouve en refermant.
 *
 * TROIS CHOSES QUE CE VOLET GARANTIT.
 *
 *  1. LES ÉTAPES PRÉPARÉES D'AVANCE RESTENT VISIBLES. Depuis que le clic
 *     DÉSIGNE une version construite à l'écart, « Vérification » et
 *     « Construction » sont sautées. Les retirer de la liste ferait croire
 *     qu'on a rogné sur les contrôles : elles gardent leur ligne, marquées
 *     « déjà faite en coulisses », avec le motif lisible dans leur détail.
 *     Elles ne comptent pas dans l'avancement — c'est déjà la règle
 *     (`avancement-publication.ts` écarte les étapes sautées).
 *  2. RIEN N'Y PUBLIE. Lire ce volet ne déclenche jamais rien ; seuls
 *     « Arrêter » et « Relancer » agissent, et seulement sur la publication
 *     vivante du projet ouvert. Une publication rouverte depuis un groupe de
 *     cartes se RELIT.
 *  3. LES DEUX VOLETS SONT LE MÊME. Leur structure est rendue par ce fichier,
 *     une seule fois : ce qui change entre déploiement et mise en production,
 *     ce sont les ÉTAPES, jamais la présentation.
 */

import * as React from 'react';
import {
  Check,
  ChevronRight,
  GitCommitHorizontal,
  GitMerge,
  Hammer,
  Loader2,
  MessagesSquare,
  Rocket,
  RotateCw,
  ShieldCheck,
  Terminal,
  UploadCloud,
  Wrench,
  X,
} from 'lucide-react';
import {
  CiblePublication,
  DeployRun,
  DeployStepKey,
  EtapeDuVolet,
  avancementDuFlux,
  depanneurVivant,
  ecartDepuisLeDebut,
  etapeAOuvrir,
  etapeDePublication,
  filDeLEtape,
  leVoletSeRaconte,
  libelleDuChampDuFil,
  parcoursDesEtapes,
  publicationADepanner,
  questionsOuvertesDuFil,
  reponsesToutesFaites,
  resumeDuFil,
  titreDeLaPublication,
  type GenreDEvenement,
  type EtatDuMoment,
  type EtatDuPoint,
} from '@beluga/shared';
import { Chat } from '@/components/chat';
import { EncadreEtape } from '@/components/encadre-etape';
import { ReglageEnLecture } from '@/components/run-selectors';
import {
  AvancementDuFluxEnTete,
  DateSousLeMessage,
  IconeMoment,
  TachesDuLot,
  bordureRondMoment,
  heureEtDureeEtape,
  motifLisible,
} from '@/components/tiroir-deploiement';
import { BulleInfo, Button, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { MESURES_DU_FLUX, TON_DE_L_ETAT, type MesuresDuFlux } from '@/components/mesures-du-flux';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * CE QUI EST DÉPLIÉ DANS LE PARCOURS : une étape, ou rien.
 *
 * `aucune` n'est pas `null` : il dit « l'étape ouverte a été REFERMÉE à la
 * main », quand `null` dit « personne n'a encore choisi » — et c'est ce
 * second cas, lui seul, qui laisse l'étape en cours s'ouvrir d'office.
 */
type ChoixDuParcours = { sorte: 'etape'; cle: DeployStepKey } | { sorte: 'aucune' };

/**
 * L'état d'une étape, dit en français simple — le même vocabulaire partout.
 *
 * Une FONCTION, pas une table de constantes : les cinq mots doivent être
 * traduits AU MOMENT où ils s'affichent. Rangés dans un objet monté au
 * chargement du module, ils garderaient la langue du premier affichage.
 */
function libelleDeLEtat(etat: EtapeDuVolet['etat']): string {
  if (etat === 'running') return t('en cours');
  if (etat === 'done') return t('fait');
  if (etat === 'failed') return t('échoué');
  if (etat === 'skipped') return t('sauté');
  return t('à venir');
}

/* ------------------------------------------------------------------ */
/* LA LISTE DU PARCOURS                                                */
/* ------------------------------------------------------------------ */

/** L'icône de chaque étape d'une mise en ligne, sur son grand rond. */
const ICONE_DE_L_ETAPE_DE_PUBLICATION: Record<DeployStepKey, React.ComponentType<{ className?: string }>> = {
  merge: GitMerge,
  commit: GitCommitHorizontal,
  push: UploadCloud,
  verify: ShieldCheck,
  build: Hammer,
  publish: Rocket,
  restart: RotateCw,
};

/**
 * L'état d'une étape traduit dans les teintes du fil des agents : orange pour
 * ce qui tourne, bleu pour ce qui est fait, jaune pour une étape passée après
 * reprise, rouge pour l'échec, gris pour ce qui n'a pas (encore) eu lieu.
 */
function tonDeLEtape(etape: EtapeDuVolet): EtatDuPoint {
  if (etape.etat === 'running') return 'encours';
  if (etape.etat === 'done') return etape.rattrape ? 'question' : 'fait';
  if (etape.etat === 'failed') return 'erreur';
  return 'avenir';
}

/**
 * UNE ÉTAPE DU PARCOURS, DESSINÉE COMME UN POINT DU FIL D'UN AGENT.
 *
 * Un GRAND ROND à icône, posé sur la ligne verticale qui relie toutes les
 * étapes ; à sa droite le NOM de l'étape et son état, DESSOUS la phrase qui
 * dit ce qu'elle fait, et TOUT À DROITE de la ligne l'heure à laquelle
 * l'étape a démarré suivie de sa durée — « 17:41 (2 s) ». Les mesures et les
 * teintes sont celles du fil d'une carte (`mesures-du-flux.ts`) : les deux
 * écrans se lisent pareil.
 *
 * L'ENTÊTE se touche pour déplier le détail ; déplié, son chevron pivote. LE
 * DÉTAIL est rendu DANS le `<li>`, mais HORS du `<button>` : un long texte
 * posé dans un bouton ne se sélectionnerait plus à la souris.
 *
 * LA LIGNE EST FAITE DE SEGMENTS, un par étape : le premier part de son rond,
 * le dernier s'arrête dans le sien. Posée d'un seul trait sur la liste, elle
 * débordait sous le dernier rond dès que son détail était ouvert, et
 * traversait le bloc des tâches du lot rangé dessous.
 *
 * Une étape FAITE D'AVANCE porte sa mention en clair sous sa phrase : « déjà
 * faite en coulisses ». Sans elle, une étape grise « sautée » se lirait comme
 * un contrôle qu'on aurait laissé tomber.
 */
function LigneDuParcours({
  etape,
  ouverte,
  onBasculer,
  temps,
  run,
  onOuvrirAgent,
  premiere,
  derniere,
  mesures,
  hauteurDuRond,
}: {
  etape: EtapeDuVolet;
  ouverte: boolean;
  onBasculer: () => void;
  /** Quand l'étape a commencé, et combien de temps elle a duré : « 17:41 (2 s) ». */
  temps: { libelle: string; infobulle: string } | null;
  run?: DeployRun | null;
  onOuvrirAgent?: (agentId: string) => void;
  premiere: boolean;
  derniere: boolean;
  mesures: MesuresDuFlux;
  /** Le diamètre du grand rond, en pixels : c'est lui qui borne les segments. */
  hauteurDuRond: number;
}) {
  /*
   * L'ENTÊTE REVIENT EN VUE QUAND ON DÉPLIE. Un détail peut être très long
   * (trace de commandes, fil d'un dépannage) : il repousse les étapes
   * suivantes loin en bas, et sans ce rappel on ouvre une étape pour se
   * retrouver à lire son milieu. `block: 'nearest'` ne bouge RIEN quand
   * l'entête est déjà visible — refermer ne fait donc jamais sauter la liste.
   */
  const entete = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!ouverte) return;
    const minuteur = window.setTimeout(() => {
      entete.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }, 80);
    return () => window.clearTimeout(minuteur);
  }, [ouverte]);

  const ton = TON_DE_L_ETAT[tonDeLEtape(etape)];
  const Icone = ICONE_DE_L_ETAPE_DE_PUBLICATION[etape.cle] ?? Rocket;
  /* Le haut du rond : le `py-3` du point, soit 12 px. Le segment du premier
     point part du CENTRE de son rond ; celui du dernier s'y arrête. */
  const hautDuRond = 12;
  const centre = hautDuRond + hauteurDuRond / 2;

  return (
    <li
      data-ligne-parcours={etape.cle}
      data-point-publication={tonDeLEtape(etape)}
      className={cn('relative py-3', mesures.decalage)}
    >
      {premiere && derniere ? null : (
        <span
          className={cn('absolute w-px bg-faint/40', mesures.ligne)}
          style={premiere ? { top: centre, bottom: 0 } : derniere ? { top: 0, height: centre } : { top: 0, bottom: 0 }}
          aria-hidden
          data-trait-parcours={etape.cle}
        />
      )}
      {/* LE GRAND ROND : l'icône lisible, le fond de la zone pour percer la ligne. */}
      <span
        className={cn(
          'fond-de-zone absolute left-0 top-3 flex items-center justify-center rounded-full border-2 transition-colors',
          mesures.rond,
          ton.rond,
        )}
        aria-hidden
        data-rond-parcours={etape.cle}
      >
        {etape.etat === 'running' ? (
          <Loader2 className={cn('animate-spin', mesures.icone, ton.icone)} />
        ) : etape.etat === 'failed' ? (
          <X className={cn(mesures.icone, ton.icone)} />
        ) : (
          <Icone className={cn(mesures.icone, ton.icone)} />
        )}
        {etape.etat === 'done' && !etape.rattrape ? (
          <span className="fond-de-zone absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full">
            <Check className="h-3 w-3 text-termine" />
          </span>
        ) : null}
      </span>

      <button
        ref={entete}
        type="button"
        onClick={onBasculer}
        aria-current={ouverte ? 'step' : undefined}
        aria-expanded={ouverte}
        data-etape-parcours={etape.cle}
        data-etape-depliee={ouverte ? 'oui' : undefined}
        data-etat-process={etape.etat}
        data-etape-preparee={etape.preparee ? 'oui' : undefined}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={cn('text-[15px] font-semibold', etape.etat === 'failed' ? 'text-danger' : ton.titre)}
              data-etape-nom={etape.cle}
            >
              {t(etape.libelle)}
            </span>
            <span className="flex shrink-0 items-center gap-x-1.5 text-[12px] text-faint">
              {etape.etat === 'todo' || etape.etat === 'skipped' ? (
                <span className="rounded-lg bg-raised px-1.5 text-[11.5px]" data-etat-etape={etape.etat}>
                  {libelleDeLEtat(etape.etat)}
                </span>
              ) : (
                <span data-etat-etape={etape.etat}>{libelleDeLEtat(etape.etat)}</span>
              )}
            </span>
          </span>
          {/* SOUS LE TITRE, CE QUE L'ÉTAPE FAIT — la phrase vient de la table
              des étapes, jamais de ce composant. */}
          <span className="block text-[13.5px] leading-snug text-muted" data-etape-phrase={etape.cle}>
            {t(etape.phrase)}
          </span>
          {/* LA MENTION QUI CHANGE TOUT : cette étape n'a pas été laissée de
              côté, elle a déjà eu lieu — avant le clic, sur la table de
              montage. Le motif entier se lit dans le détail. */}
          {etape.preparee ? (
            <span className="mt-0.5 block text-[12px] text-en-cours" data-etape-en-coulisses={etape.cle}>
              {t('déjà faite en coulisses')}
            </span>
          ) : null}
        </span>
        {/* QUAND, ET COMBIEN DE TEMPS — à DROITE de la ligne, hors du bloc du
            titre. Collée au nom de l'étape, la mention se perdait au milieu
            du texte et ne s'alignait sur rien ; posée ici, toutes les étapes
            tombent dans la même colonne et la liste se parcourt comme un
            relevé de temps. `mt-[3px]` la cale sur la PREMIÈRE ligne du nom,
            pas sur le haut du bouton, et `tabular-nums` empêche la colonne de
            danser d'une ligne à l'autre. */}
        {temps ? (
          <span
            className="mt-[3px] shrink-0 whitespace-nowrap text-[12px] tabular-nums text-faint"
            data-duree-etape={etape.cle}
            title={temps.infobulle}
          >
            {temps.libelle}
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            'mt-1.5 h-3.5 w-3.5 shrink-0 transition-transform',
            ouverte ? 'rotate-90 text-muted' : 'text-faint',
          )}
          aria-hidden
        />
      </button>

      {/* LE DÉTAIL DE L'ÉTAPE, JUSTE SOUS ELLE, aligné sur son texte. */}
      {ouverte ? (
        <div className="pb-1 pt-2.5">
          <DetailDeLEtape etape={etape} run={run} onOuvrirAgent={onOuvrirAgent} />
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* LE DÉTAIL D'UNE ÉTAPE                                               */
/* ------------------------------------------------------------------ */

/**
 * UN MOMENT DU FIL DE L'ÉTAPE : son heure, son rond, et ce qu'il porte.
 *
 * Une COMMANDE réellement lancée n'est pas un texte de plus : elle a son
 * encadré, comme dans la conversation d'un agent. Le reste — une branche
 * fusionnée, un contrôle lancé — se lit en clair, à sa ligne.
 */
function MomentDeLEtape({
  moment,
  depuis,
  onOuvrirAgent,
}: {
  moment: {
    evenement: { at: number } | null;
    texte: string;
    genre: GenreDEvenement;
    etat?: EtatDuMoment;
    agentId?: string;
  };
  depuis?: number;
  onOuvrirAgent?: (agentId: string) => void;
}) {
  const ecart = moment.evenement ? ecartDepuisLeDebut(moment.evenement.at, depuis) : null;
  const agentId = moment.genre === 'depannage' ? moment.agentId : undefined;

  if (moment.genre === 'commande') {
    return (
      <li data-moment-fil="commande">
        <EncadreEtape sorte="commande" titre={t('Commande')} icone={Terminal}>
          <p className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-snug text-muted texte-copiable">
            {moment.texte}
          </p>
        </EncadreEtape>
        <DateSousLeMessage at={moment.evenement?.at} ecart={ecart} />
      </li>
    );
  }

  if (moment.genre === 'depannage') {
    return (
      <li data-moment-fil="depannage" data-moment-etat={moment.etat}>
        <EncadreEtape sorte="depannage" titre={t('Dépannage')} icone={Wrench}>
          {agentId ? (
            <button
              type="button"
              onClick={() => onOuvrirAgent?.(agentId)}
              data-moment-agent={agentId}
              className="block text-left text-[12.5px] leading-snug text-warning underline underline-offset-2 hover:opacity-80"
            >
              {moment.texte}
            </button>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug text-warning texte-copiable">
              {moment.texte}
            </p>
          )}
        </EncadreEtape>
        <DateSousLeMessage at={moment.evenement?.at} ecart={ecart} />
      </li>
    );
  }

  return (
    <li className="flex gap-2" data-moment-fil={moment.genre} data-moment-etat={moment.etat}>
      <span
        className={cn(
          'mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-surface',
          bordureRondMoment(moment.genre, moment.etat),
        )}
      >
        <IconeMoment genre={moment.genre} etat={moment.etat} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block whitespace-pre-wrap break-words text-[12.5px] leading-snug text-muted texte-copiable">
          {moment.texte}
        </span>
        <DateSousLeMessage at={moment.evenement?.at} ecart={ecart} />
      </span>
    </li>
  );
}

/**
 * L'ÉTAPE DÉPLIÉE, EN ENTIER : ce qu'elle fait et pourquoi, puis ce qu'elle a
 * réellement fait.
 *
 * L'explication est LONGUE, et c'est voulu : c'est la seule chose qui permette
 * à quelqu'un qui ne publie pas tous les jours de comprendre ce qui est en
 * train de se passer sur sa machine. Rendue sous l'étape, elle dispose de la
 * pleine largeur du volet — les traces de commandes et les avertissements
 * longs restent donc dans leur cadre (`break-words`, `texte-copiable`).
 */
function DetailDeLEtape({
  etape,
  run,
  onOuvrirAgent,
}: {
  etape: EtapeDuVolet;
  run?: DeployRun | null;
  onOuvrirAgent?: (agentId: string) => void;
}) {
  const brute = run?.steps.find((step) => step.key === etape.cle);
  /*
   * PENDANT QUE ÇA TOURNE : DES POINTS, PAS UN RÉCIT (`leVoletSeRaconte`).
   * Le fil horodaté, la longue explication et la mention de rôle ne paraissent
   * qu'une fois la mise en ligne terminée — là, on relit ; pendant, on suit.
   */
  const raconte = leVoletSeRaconte(run);
  const fil = raconte && brute ? filDeLEtape(brute) : [];
  const resume = raconte ? resumeDuFil(brute?.journal) : null;

  return (
    <div className="space-y-3" data-detail-etape={etape.cle} data-detail-etat={etape.etat}>
      {/* L'ÉTAT ET LA DURÉE SE LISENT DÉJÀ SUR LE TITRE DU POINT : le détail
          ne garde que ce que le titre ne dit pas — le compte
          de ce que l'étape a raconté. */}
      {resume ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-faint">
          {resume ? <span data-fil-compte={etape.cle}>{resume}</span> : null}
        </p>
      ) : null}

      {/* CE QUE L'ÉTAPE FAIT, EN TOUTES LETTRES — une fois qu'elle est passée. */}
      {raconte ? (
        <p className="text-[13px] leading-relaxed text-muted texte-copiable" data-description-etape={etape.cle}>
          {t(etape.explication)}
          {/* MENÉE PAR UN AGENT : le fil est alors celui d'une vraie
              conversation — outils, questions —, et pas un journal de
              commandes. La précision vit dans le « i », au bout du texte. */}
          {etape.nature === 'agent' ? (
            <span className="ml-1 inline-flex align-middle" data-nature-etape="agent">
              <BulleInfo cote="start">
                {t('Selon la procédure réglée pour ce projet, cette étape peut être menée par un agent : son travail se lit alors dans la conversation.')}
              </BulleInfo>
            </span>
          ) : null}
        </p>
      ) : null}

      {/* DÉJÀ FAITE EN COULISSES : le motif entier, celui que le serveur a
          écrit — jamais un « ignoré » sec. */}
      {etape.preparee ? (
        <div
          className="rounded-md bg-raised/40 px-2.5 py-2 text-[12.5px] leading-snug text-muted"
          data-detail-en-coulisses={etape.cle}
        >
          <p className="font-medium text-en-cours">{t('Déjà faite en coulisses')}</p>
          <p className="mt-0.5 whitespace-pre-line texte-copiable">{etape.motif}</p>
        </div>
      ) : null}

      {/* SAUTÉE POUR UNE AUTRE RAISON : elle n'a pas eu lieu, et on dit
          pourquoi. */}
      {etape.etat === 'skipped' && !etape.preparee && etape.motif ? (
        <div className="rounded-md bg-raised/40 px-2.5 py-2 text-[12.5px] leading-snug text-faint" data-detail-sautee={etape.cle}>
          <p className="whitespace-pre-line texte-copiable">{etape.motif}</p>
        </div>
      ) : null}

      {/* PENDANT QU'ELLE TOURNE : ce qu'elle fait à l'instant. En orange si
          elle a dépassé sa durée attendue. */}
      {etape.etat === 'running' && brute?.progress ? (
        <p
          className={cn('text-[12.5px] leading-snug', brute.enRetard ? 'text-warning' : 'text-muted')}
          data-progress-etape={etape.cle}
          data-etape-en-retard={brute.enRetard ? 'oui' : undefined}
        >
          {brute.progress}
        </p>
      ) : null}

      {/* LE FIL HORODATÉ : chaque moment, dans l'ordre où il est arrivé. */}
      {fil.length ? (
        <ul className="space-y-2" data-fil-etape={etape.cle}>
          {fil.map((moment, i) => (
            <MomentDeLEtape key={i} moment={moment} depuis={brute?.startedAt} onOuvrirAgent={onOuvrirAgent} />
          ))}
        </ul>
      ) : raconte ? (
        <p className="text-[12.5px] text-faint" data-fil-vide={etape.cle}>
          {etape.etat === 'todo'
            ? t('Cette étape n’a pas encore commencé.')
            : t('Cette étape n’a rien eu à raconter.')}
        </p>
      ) : null}

      {/* CE QUI A BLOQUÉ : le motif de l'échec, dans son encadré rouge. */}
      {etape.etat === 'failed' && brute?.log ? (
        <EncadreEtape sorte="echec" titre={t('Ce qui a bloqué')} ton="echec">
          <p className="whitespace-pre-wrap break-words text-[11.5px] leading-snug text-faint texte-copiable">
            {motifLisible(brute.log)}
          </p>
        </EncadreEtape>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LE VOLET LUI-MÊME                                                   */
/* ------------------------------------------------------------------ */

/**
 * LE CORPS DU VOLET, sans son enveloppe : l'entête, la liste dépliable, et le
 * pied où vivent les gestes.
 *
 * `sansTitre` laisse le titre à l'enveloppe qui l'accueille — le bandeau de
 * mise en production porte déjà le sien.
 *
 * UNE SEULE MISE EN PAGE, quelle que soit la largeur : une liste dont l'étape
 * ouverte porte son détail. Rien ne se réarrange sur téléphone.
 */
export function CorpsDuVolet({
  cible,
  run,
  sousTitre,
  controls,
  sansTitre = false,
  ouvrirSur = 'parcours',
  agentAOuvrir,
}: {
  /** L'étape dont ce volet déroule les propres étapes. */
  cible: CiblePublication;
  /** La publication à raconter. Absente : le parcours entier, « à venir ». */
  run?: DeployRun | null;
  sousTitre?: string;
  controls?: React.ReactNode;
  sansTitre?: boolean;
  /**
   * SUR QUOI LE VOLET S'OUVRE quand c'est une porte NOMMÉE qui l'ouvre.
   *
   * « Voir la conversation de la dernière mise en ligne » doit tomber sur la
   * conversation, pas sur le parcours : ouvrir ailleurs que là où le bouton
   * promet d'emmener est un pas de plus à faire, à chaque fois. Le fil étant
   * désormais un tiroir EMPILÉ, il s'ouvre par-dessus le parcours — qui reste
   * derrière, et se retrouve en le refermant.
   */
  ouvrirSur?: 'parcours' | 'conversation';
  /**
   * L'AGENT À EMPILER D'EMBLÉE, quand le volet est ouvert depuis ailleurs
   * (vignette « Dépannage » du tableau de bord, menu Agents, cloche) : le
   * conducteur ouvre son fil, tout autre agent — le dépanneur — son propre
   * tiroir. `nonce` rejoue une seconde demande du même agent.
   */
  agentAOuvrir?: { id: string; nonce: number } | null;
}) {
  const state = useApp();
  const telephone = useTelephone();
  const mesures = telephone ? MESURES_DU_FLUX.telephone : MESURES_DU_FLUX.ordinateur;
  const etapes = React.useMemo(() => parcoursDesEtapes(cible, run), [cible, run]);
  const [choix, setChoix] = React.useState<ChoixDuParcours | null>(null);
  /* L'agent de dépannage OUVERT depuis un moment du fil : un second volet,
     empilé au-dessus de celui-ci, avec sa conversation en direct. Il reste
     DISTINCT du fil de celui qui publie — ce sont deux agents différents. */
  const [agentOuvert, setAgentOuvert] = React.useState<string | null>(null);
  /* LE FIL DE CELUI QUI PUBLIE, dans son propre tiroir empilé : ouvert par le
     bouton du pied, ou d'emblée par la porte nommée `ouvrirSur`. */
  const [filOuvert, setFilOuvert] = React.useState(false);

  const conducteur = run?.agentId ? (state.agents[run.agentId] ?? null) : null;

  /* « RÉSOUDRE LE PROBLÈME » : l'agent qui dépanne cette publication tombée,
     puis la relance lui-même (`shared/src/depannage-publication.ts`). Son lien
     est écrit sur la publication : le même bouton le rouvre, volet refermé ou
     projet quitté. Seule la DERNIÈRE publication du projet se dépanne. */
  const depanneurId = run?.depannage?.agentId;
  const depanneur = depanneurId ? (state.agents[depanneurId] ?? null) : null;
  const depannageVivant = depanneurVivant(depanneur);
  const aDepanner = publicationADepanner(run, run ? state.deploys[run.projectId] : null);
  const relanceDemandee = !!run?.depannage?.relanceDemandee;
  const [depannageEnvoye, setDepannageEnvoye] = React.useState(false);
  React.useEffect(() => {
    if (depanneurId) void client.chargerAgent(depanneurId);
  }, [depanneurId]);
  const resoudre = async () => {
    if (!run) return;
    if (depannageVivant && depanneurId) {
      setAgentOuvert(depanneurId);
      return;
    }
    setDepannageEnvoye(true);
    const rendu = await client.geste<{ agentId: string }>({ type: 'deploy.depanner', runId: run.id }, t('Résoudre le problème'));
    setDepannageEnvoye(false);
    if (rendu?.agentId) setAgentOuvert(rendu.agentId);
  };
  const boutonDepannage = aDepanner || depannageVivant;
  /* LES QUESTIONS ENCORE OUVERTES du conducteur : c'est ce qui allume le signal
     orange du bouton du pied. Les messages vivent dans le magasin général, pas
     sur l'agent — le lire ailleurs rendrait toujours 0. */
  const messagesDuConducteur = conducteur ? (state.messages[conducteur.id] ?? []) : [];
  const questions = React.useMemo(
    () => questionsOuvertesDuFil(messagesDuConducteur),
    [messagesDuConducteur],
  );

  /* L'agent d'une publication PASSÉE n'est plus dans l'état envoyé au tableau :
     on le réclame au montage du CORPS, jamais à l'ouverture du tiroir du fil —
     sinon le compte des questions du bouton du pied resterait à zéro, et la
     conversation s'ouvrirait vide. */
  React.useEffect(() => {
    if (run?.agentId) void client.chargerAgent(run.agentId);
  }, [run?.agentId]);
  React.useEffect(() => {
    if (agentOuvert) void client.chargerAgent(agentOuvert);
  }, [agentOuvert]);
  React.useEffect(() => {
    if (!agentAOuvrir) return;
    if (agentAOuvrir.id === run?.agentId) setFilOuvert(true);
    else setAgentOuvert(agentAOuvrir.id);
    // Seule une NOUVELLE demande rouvre : le changement de publication racontée ne le fait pas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAOuvrir?.id, agentAOuvrir?.nonce]);

  /* L'ÉTAPE QUI TRAVAILLE EST DÉPLIÉE D'OFFICE : c'est celle qu'on vient
     regarder. Un repli fait à la main ne se défait jamais tout seul — d'où le
     suivi de la dernière étape ouverte d'office. */
  const dOffice = etapeAOuvrir(etapes);
  const auto = React.useRef<DeployStepKey | null>(null);
  React.useEffect(() => {
    if (!dOffice || auto.current === dOffice) return;
    auto.current = dOffice;
    setChoix({ sorte: 'etape', cle: dOffice });
  }, [dOffice]);

  /* LA PORTE NOMMÉE OUVRE LE FIL D'EMBLÉE. Le drapeau ne se rearme qu'au
     retour sur le parcours : sans lui, refermer le tiroir à la main le
     rouvrirait au rendu suivant. */
  const filDemande = React.useRef(false);
  React.useEffect(() => {
    if (ouvrirSur !== 'conversation') {
      filDemande.current = false;
      return;
    }
    if (filDemande.current || !conducteur) return;
    filDemande.current = true;
    setFilOuvert(true);
  }, [ouvrirSur, conducteur]);

  const parDefaut: ChoixDuParcours = dOffice ? { sorte: 'etape', cle: dOffice } : { sorte: 'aucune' };
  const retenu: ChoixDuParcours = choix ?? parDefaut;

  const etape = etapeDePublication(cible);
  /* Ce parcours travaille-t-il sur un LOT de cartes ? Seul le déploiement en
     a un ; la mise en production pousse une VERSION. */
  const porteUnLot = etapes.some((e) => e.nature === 'lot');
  const avancement = run ? avancementDuFlux(run) : null;
  /* DEUX RÉPONSES TOUTES FAITES, SEULEMENT SUR UNE ÉTAPE TOMBÉE : ailleurs, la
     barre reste nue — on n'encombre pas une publication qui se passe bien. */
  const tombee = etapes.find((e) => e.etat === 'failed');
  const reponses = tombee ? reponsesToutesFaites(t(tombee.libelle)) : undefined;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col" data-volet-publication={etape.cible} data-fil-publication={run?.id}>
        <div className={cn('shrink-0 pb-2', sansTitre ? 'px-3' : 'px-4')}>
          {/* Le compte des tâches embarquées reste lisible ; la phrase qui
              explique le volet passe derrière le « i » du titre. */}
          <div className={cn('flex items-center gap-1', sansTitre ? 'pt-1' : null)}>
            {sansTitre ? null : (
              <DialogTitle className="text-[15.5px] font-semibold text-text">
                {run ? titreDeLaPublication(etape.titreCourt, run.startedAt) : t(etape.libelle)}
              </DialogTitle>
            )}
            {sousTitre || !(run && !etape.sansLot) ? (
              <BulleInfo cote="start">{sousTitre ?? t('Le parcours complet, étape par étape.')}</BulleInfo>
            ) : null}
          </div>
          {run && !etape.sansLot ? (
            <p className="mt-0.5 text-[12.5px] text-faint">
              {t('{v0} tâche(s) embarquée(s)', { v0: run.cardIds.length })}
            </p>
          ) : null}
          {avancement ? <AvancementDuFluxEnTete avancement={avancement} /> : null}
        </div>

        {/* LE PARCOURS, EN FLUX À POINTS, PLEINE LARGEUR — comme le fil d'un
            agent. Le détail de l'étape dépliée est rendu par son point, sous
            elle. Le trait vertical qui relie les ronds suit `--faint` : sur
            les apparences plates, `--border` ne dessine rien, et ce trait
            porte une information (l'ordre des étapes). */}
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-2 pb-4">
          <ul data-parcours-etapes={etape.cible} className="px-1 pt-1">
            {etapes.map((e, rang) => (
              <LigneDuParcours
                key={e.cle}
                etape={e}
                premiere={rang === 0}
                derniere={rang === etapes.length - 1}
                mesures={mesures}
                hauteurDuRond={telephone ? 32 : 40}
                ouverte={retenu.sorte === 'etape' && retenu.cle === e.cle}
                /* UN SEUL DÉTAIL À LA FOIS, et l'étape ouverte se referme
                   d'un second clic : c'est le comportement attendu d'un
                   accordéon, et il rend la liste entière à qui la cherche. */
                onBasculer={() =>
                  setChoix(
                    retenu.sorte === 'etape' && retenu.cle === e.cle
                      ? { sorte: 'aucune' }
                      : { sorte: 'etape', cle: e.cle },
                  )
                }
                temps={heureEtDureeEtape(run?.steps.find((step) => step.key === e.cle))}
                run={run}
                onOuvrirAgent={setAgentOuvert}
              />
            ))}
          </ul>

          {/* OÙ EN EST CHAQUE TÂCHE DU LOT, sous le parcours : c'est ce
              qu'on vient voir en premier, et ça appartient à la publication
              ENTIÈRE, pas à l'une de ses étapes — donc visible quelle que
              soit l'étape dépliée. Une étape SANS LOT (la mise en production)
              n'embarque aucune carte : elle n'affiche rien du tout. */}
          {porteUnLot && run?.taches?.length ? (
            <div className="mt-2">
              <TachesDuLot taches={run.taches} etapes={run.steps} runId={run.id} />
            </div>
          ) : null}
        </ZoneDefilement>

        {/* LES GESTES, EN PIED FIXE : au bout d'un long parcours, ils ne
            défilent plus hors de vue. « Arrêter » ou « Relancer » d'abord,
            puis PARLER À CELUI QUI PUBLIE — un geste, pas une étape, et c'est
            pour cela qu'il a quitté la liste du parcours. */}
        {controls || conducteur || boutonDepannage ? (
          <div
            className="flex shrink-0 flex-col gap-1.5 border-t border-faint/20 px-2 pt-2"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            data-fenetre-pied
          >
            {controls}
            {/* RÉSOUDRE LE PROBLÈME : un agent répare, puis relance lui-même
                la publication. Tant qu'il travaille, le même bouton le ROUVRE,
                en orange ; le clic se voit tout de suite (roue qui tourne). */}
            {boutonDepannage ? (
              <Button
                size="pied"
                variant="outline"
                disabled={depannageEnvoye}
                onClick={() => void resoudre()}
                data-bouton-depannage={depannageVivant ? 'en-cours' : 'libre'}
                className={cn(depannageVivant ? 'border-en-cours text-en-cours' : undefined)}
              >
                {depannageEnvoye ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                {depannageVivant ? t('Dépannage en cours') : t('Résoudre le problème')}
                {depannageVivant && relanceDemandee ? (
                  <span className="text-en-cours">· {t('relance demandée')}</span>
                ) : null}
              </Button>
            ) : null}
            {/* Le dépannage FINI se relit : sa conversation dit ce qui a été réparé. */}
            {depanneurId && !depannageVivant ? (
              <button
                type="button"
                onClick={() => setAgentOuvert(depanneurId)}
                data-voir-depannage={depanneurId}
                className="self-center py-0.5 text-[12px] text-muted underline underline-offset-2 hover:text-text"
              >
                {t('Voir le dernier dépannage')}
              </button>
            ) : null}
            {conducteur ? (
              <Button
                size="pied"
                variant="outline"
                onClick={() => setFilOuvert(true)}
                data-point-conversation={questions ? 'question' : 'libre'}
                className={cn(questions ? 'border-en-cours text-en-cours' : undefined)}
              >
                <MessagesSquare className="h-3.5 w-3.5" />
                {t('En parler avec celui qui publie')}
                {/* ORANGE POUR CE QUI ATTEND : le compte des questions restées
                    sans réponse, exactement comme sur la ligne qu'il remplace. */}
                {questions ? (
                  <span className="text-en-cours" data-questions-ouvertes={questions}>
                    · {t('{v0} question(s) attend(ent) votre réponse', { v0: questions })}
                  </span>
                ) : null}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* LE FIL DE CELUI QUI PUBLIE, empilé au-dessus du parcours : on lui
          parle sans perdre l'étape qu'on était en train de lire, et on la
          retrouve en refermant. `plein` lui donne la HAUTEUR entière — sans
          lui, un tiroir de conversation s'arrête sur son contenu. */}
      <Drawer open={filOuvert && !!conducteur} onClose={() => setFilOuvert(false)} empile plein>
        {conducteur ? (
          <div className="flex min-h-0 flex-1 flex-col" data-volet-conversation>
            <div className="shrink-0 px-4 pb-2">
              <div className="flex items-center gap-1">
                <DialogTitle className="text-[15.5px] font-semibold text-text">
                  {t('En parler avec celui qui publie')}
                </DialogTitle>
                <BulleInfo cote="start">{t('questions et gestes proposés en route')}</BulleInfo>
              </div>
            </div>
            <Chat
              agent={conducteur}
              projectId={run?.projectId ?? ''}
              reponsesProposees={reponses}
              libelleDuChamp={t(libelleDuChampDuFil(run))}
            />
          </div>
        ) : null}
      </Drawer>

      {/* LE VOLET DE L'AGENT DE DÉPANNAGE, empilé au-dessus : sa conversation
          et son avancement, en direct, sans quitter celui de la publication. */}
      <Drawer open={!!agentOuvert} onClose={() => setAgentOuvert(null)} empile>
        {agentOuvert ? (
          <div className="flex min-h-0 flex-1 flex-col" data-tiroir-depannage>
            <div className="shrink-0 px-4 pb-2">
              <div className="flex items-center gap-1">
                <DialogTitle className="text-[15.5px] font-semibold text-text">
                  {agentOuvert === depanneurId ? t('Résoudre le problème') : t('Agent de dépannage')}
                </DialogTitle>
                <BulleInfo cote="start">
                  {agentOuvert === depanneurId
                    ? t('L’agent cherche la cause, répare, puis relance lui-même la publication.')
                    : t('Le conflit de fusion se résout ici, en direct.')}
                </BulleInfo>
              </div>
              {state.agents[agentOuvert] ? (
                <ReglageEnLecture
                  engines={state.engines}
                  run={state.agents[agentOuvert].run}
                  compte={state.agents[agentOuvert].account}
                  comptes={state.quotas}
                />
              ) : null}
            </div>
            <Chat agent={state.agents[agentOuvert] ?? null} projectId={run?.projectId ?? ''} />
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

/**
 * LE VOLET DANS SON TIROIR — la porte ouverte par le bouton de déploiement, et
 * par la relecture d'une publication passée.
 *
 * `plein` : le volet prend la HAUTEUR entière, il ne s'arrête pas sur son
 * contenu. Une liste dont une seule étape est dépliée s'ajusterait sinon à
 * quelques lignes, et le pied remonterait au milieu de l'écran.
 */
export function VoletDePublication({
  open,
  onClose,
  cible,
  run,
  sousTitre,
  controls,
  empile,
  agentAOuvrir,
}: {
  open: boolean;
  onClose: () => void;
  cible: CiblePublication;
  run?: DeployRun | null;
  sousTitre?: string;
  controls?: React.ReactNode;
  empile?: boolean;
  /** L'agent à empiler d'emblée, demandé d'ailleurs (voir `CorpsDuVolet`). */
  agentAOuvrir?: { id: string; nonce: number } | null;
}) {
  return (
    <Drawer open={open} onClose={onClose} empile={empile} plein>
      <CorpsDuVolet cible={cible} run={run} sousTitre={sousTitre} controls={controls} agentAOuvrir={agentAOuvrir} />
    </Drawer>
  );
}
