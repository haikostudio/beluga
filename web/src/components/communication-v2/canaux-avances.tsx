import * as React from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Info,
  Loader2,
  Plus,
  Sparkles,
  X,
} from '@/components/ui/icones';
import {
  type ActionMarketing,
  type Agent,
  type Card,
  type ContenuMarketing,
  type EspaceMarketing,
  type GuideMarketing,
  type ResultatsMarketing,
  type DiagnosticSuivi,
  FAMILLES_CANAL,
  LIBELLE_FAMILLE_CANAL,
  agentTientSonTour,
  RESEAUX_SOCIAUX,
  canauxDansLOrdre,
  parcoursDuCanal,
  estReseauSocial,
} from '@beluga/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  ZoneDefilement,
  } from '@/components/ui';
import { } from '@/components/chat';
import { } from 'react-dom';
import { } from '@/components/rubriques-de-colonne';
import { } from '@/components/repere-attention';
import { } from '@/components/interrupteur-suivi';
import { } from '@/components/pastille-projet';
import { } from '@/components/selecteur-de-projet';
import { client } from '@/lib/client';
import { } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { } from '@/lib/assistant-global';
import { cn } from '@/lib/utils';
import { OngletComptes, type VueDesReseaux } from './reseaux-avances';
import { LogoReseau } from '@/components/logos-reseaux';

/**
 * L'ATELIER MARKETING — la liste des projets, puis l'espace d'UN projet.
 *
 * Tout ce qui se montre vient du serveur à l'ouverture (`marketing.lister`,
 * `marketing.espace`), et se relit quand l'événement `marketing` de ce projet
 * passe : l'agent qui écrit un contenu le fait apparaître sans rien recharger.
 *
 * REFONTE DU 26/09/2026 — un écran d'application professionnelle, pensé
 * d'abord pour le téléphone :
 *  - UN SEUL ROBOT (20/10/2026) : plus de chat flottant propre au
 *    Marketing. On parle à l'assistant de l'application, qui a l'outil
 *    `marketing` pour tout projet ; l'agent attitré du projet travaille en
 *    coulisse (`AgentEnCoulisse`) et son BOUTON UNIQUE (état de
 *    `etatDuBoutonMarketing`) se pose dans la barre : « Initialiser »,
 *    l'avancement n/N, la question, puis « Rapport » ;
 *  - Canaux montre TOUT le catalogue avec l'avis de l'agent, le Calendrier
 *    porte son plan d'action daté à côté des contenus, et le service Statistiques (écran à part) trace
 *    les courbes et les répartitions ;
 *  - AUCUNE EXPLICATION AFFICHÉE EN PERMANENCE : chacune vit derrière un point
 *    « i » (`PointInfo`) qui ouvre un volet — jamais une bulle au survol, qui ne
 *    marche pas au doigt ;
 *  - UNE ACTION PRINCIPALE PAR ONGLET, dans un pied pleine largeur
 *    (`CorpsOnglet`) ; le reste en icônes nommées ;
 *  - listes et fiches s'ouvrent en tiroirs empilés ; le calendrier se lit en
 *    semaine sur téléphone, en quatre semaines sur ordinateur.
 *
 * RETOUCHES DU 11/10/2026 — SUR ORDINATEUR, LA NAVIGATION EST DANS LA COLONNE
 * DE GAUCHE (`ColonneDeService`), sur deux niveaux : la liste des projets
 * suivis (`ColonneDesProjets`), puis, un projet ouvert, ses quatre rubriques
 * et « À faire ensuite ». La page, elle, ne garde que du contenu : le tableau
 * de bord et « En attente par projet » à l'ouverture, la rubrique ouverte dans
 * un projet — Calendrier et Contenus sur toute la largeur. Sur téléphone, où
 * la colonne n'existe pas, rien ne change : tableaux des projets et barre
 * d'onglets restent dans la page.
 */

export interface EspaceComplet {
  projectId: string;
  nom: string;
  espace: EspaceMarketing | null;
  contenus: ContenuMarketing[];
  actions: ActionMarketing[];
  guide: GuideMarketing;
  resultats: (ResultatsMarketing & { tronque: boolean }) | null;
  extrait: string | null;
  confidentialite: string;
  adresseLiens: string;
  /** Les cartes de l'agent marketing du projet : elles ne paraissent plus au tableau. */
  cartes?: Card[];
  /** Ce que porte la page servie (`DiagnosticSuivi`), `null` sans adresse connue. */
  diagnosticSuivi?: DiagnosticSuivi | null;
  /** LA carte d'installation du suivi, si elle existe : posée, elle ne vaut pas code posé. */
  carteSuivi?: Card | null;
  /** Les visuels prêts de chaque contenu : le média validé du directeur artistique, ou un visuel de l'ancien Studio (le plus récent d'abord). */
  visuels?: Record<string, VisuelDuContenu[]>;
  /** La carte du directeur artistique liée à chaque contenu (« Créer le visuel » la rouvre). */
  cartesDesVisuels?: Record<string, string>;
  /** Les comptes reliés du projet, les applications des réseaux et les messages non lus. */
  reseaux?: VueDesReseaux;
}

interface VisuelDuContenu {
  id: string;
  attachmentId: string;
  afficheId?: string;
  format: string;
  genre: 'video' | 'image';
  titre: string;
  cardId?: string;
}



/* ------------------------------------------------------------------ */
/* Les briques communes                                                 */
/* ------------------------------------------------------------------ */

/**
 * LE VOLET D'EXPLICATION. Toutes les explications de l'écran s'y lisent : un
 * tiroir empilé, au doigt comme à la souris, qu'on referme en le tirant.
 */
function VoletInfo({
  ouvert,
  titre,
  onClose,
  children,
  adresse,
  feuille,
}: {
  ouvert: boolean;
  titre: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Le nom du volet dans l'adresse ; absent quand l'appelant la tient déjà. */
  adresse?: string;
  /** En FEUILLE DU BAS, posée par-dessus l'écran, au lieu d'une page (un événement du calendrier). */
  feuille?: boolean;
}) {
  if (!ouvert) return null;
  return (
    <Drawer open onClose={onClose} empile adresse={adresse} feuille={feuille}>
      <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
        <Info className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{titre}</DialogTitle>
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-5">
        <div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-text" data-marketing-volet-info>
          {children}
        </div>
      </ZoneDefilement>
    </Drawer>
  );
}

/** LE POINT « i » : une petite icône qui ouvre le volet d'explication. */
export function PointInfo({ titre, children }: { titre: string; children: React.ReactNode }) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Explications"
        title={t('Explications')}
        data-marketing-info
        onClick={() => setOuvert(true)}
        className="flex h-[34px] sm:h-7 w-[34px] sm:w-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-bloc hover:text-text"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <VoletInfo ouvert={ouvert} titre={titre} onClose={() => setOuvert(false)} adresse="info-marketing">
        {children}
      </VoletInfo>
    </>
  );
}



/**
 * LE CORPS D'UN ONGLET : ce qui défile, puis le PIED qui garde l'action
 * principale sous le pouce, en pleine largeur sur téléphone.
 */
function CorpsOnglet({
  children,
  pied,
  refDefilement,
  plein,
}: {
  children: React.ReactNode;
  pied?: React.ReactNode;
  /** Le contenu remplit au moins la hauteur visible (il peut s'y étirer en `flex-1`). */
  plein?: boolean;
  /** Ce qui défile, pour qu'un onglet à deux vues retrouve sa position au retour. */
  refDefilement?: React.Ref<HTMLDivElement>;
}) {
  return (
    <>
      <ZoneDefilement ref={refDefilement} fond="hsl(var(--surface))" className={cn('px-3 pb-4', plein && 'flex flex-col')}>
        {children}
      </ZoneDefilement>
      {pied ? (
        <div className="flex shrink-0 items-center gap-1.5 px-3 pb-[var(--pied-natif,calc(max(env(safe-area-inset-bottom),10px)+var(--marche-du-bas,0px)))] pt-2 sm:justify-end" data-marketing-pied>
          {pied}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* L'écran                                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* L'espace d'un projet                                                 */
/* ------------------------------------------------------------------ */

/* L'onglet « Statistiques » est devenu un service à part (27/09/2026) : un
   onglet mémorisé ou demandé qui porterait encore ce nom retombe sur le défaut. */

/* ------------------------------------------------------------------ */
/* Identité de marque                                                   */
/* ------------------------------------------------------------------ */





/* ------------------------------------------------------------------ */
/* Contenus                                                             */
/* ------------------------------------------------------------------ */

/** Où en est une carte de l'agent marketing : le même témoin que sur le tableau. */
export function etatDeCarte(card: Card, agent: Agent | undefined): { libelle: string; classe: string; tourne: boolean } {
  if (agent?.attendReponse) return { libelle: t('Question en attente'), classe: 'text-warning', tourne: false };
  if (agent && agentTientSonTour(agent)) return { libelle: t('L’agent travaille'), classe: 'text-en-cours', tourne: true };
  if (card.column === 'running') return { libelle: t('En cours'), classe: 'text-en-cours', tourne: false };
  if (card.column === 'planned') return { libelle: t('Planifié'), classe: 'text-faint', tourne: false };
  return { libelle: t('Terminé'), classe: 'text-termine', tourne: false };
}

/* (La création d'une publication passe par le directeur de Communication depuis le 03/11/2026 : plus de tiroir.) */

/* ------------------------------------------------------------------ */
/* Calendrier                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Canaux                                                               */
/* ------------------------------------------------------------------ */

function libellePertinence(p: string): string {
  return p === 'haute' ? t('Recommandé') : p === 'moyenne' ? t('À envisager') : t('Peu utile ici');
}

/**
 * LES CANAUX, EN DEUX VUES. La LISTE n'est qu'une colonne de boutons courts —
 * le nom, l'avis de l'agent en un mot, une coche si le canal est retenu — :
 * vos canaux en tête, puis les autres rangés par famille. Un toucher ouvre la
 * FICHE du canal : à quoi il sert, l'avis de l'agent pour CE produit, puis le
 * PARCOURS pas à pas (la base du catalogue, complétée par les conseils de
 * l'agent). Choisir ou retirer le canal se fait sur la fiche.
 */
export function OngletCanaux({
  projectId,
  donnees,
  ouvert,
  onOuvrir,
  onAgent,
  onOuvrirCarte,
}: {
  projectId: string;
  donnees: EspaceComplet;
  /** Le canal dont la fiche est ouverte : tenu par l'espace, qui en fait un cran du fil d'Ariane. */
  ouvert: string | null;
  onOuvrir: (cle: string | null) => void;
  onAgent: () => void;
  onOuvrirCarte?: (card: Card) => void;
}) {
  const config = donnees.espace?.configuration;
  const lignes = canauxDansLOrdre({ canaux: config?.canaux ?? [], recommandations: config?.recommandations ?? [] });
  /* Les réseaux reliables vivent dans le bloc des comptes, en tête : la liste du dessous ne les redit pas. */
  const reseaux = donnees.reseaux;
  const sousLesComptes = (cle: string) => !!reseaux && (RESEAUX_SOCIAUX as readonly string[]).includes(cle);
  const choisis = lignes.filter((l) => l.choisi && !sousLesComptes(l.canal.cle));
  const autres = lignes.filter((l) => !l.choisi && !sousLesComptes(l.canal.cle));
  const relies = new Set((reseaux?.comptes ?? []).filter((c) => c.etat === 'relie').map((c) => c.reseau as string));
  const etatDesReseaux = Object.fromEntries(
    lignes.filter((l) => sousLesComptes(l.canal.cle)).map((l) => [l.canal.cle, { choisi: l.choisi, pertinence: l.recommandation?.pertinence }]),
  );
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const defilement = React.useRef<HTMLDivElement | null>(null);
  // La position de la liste, retrouvée au retour d'une fiche.
  const positionListe = React.useRef(0);
  const aDesAvis = (config?.recommandations ?? []).length > 0;

  React.useLayoutEffect(() => {
    if (defilement.current) defilement.current.scrollTop = ouvert ? 0 : positionListe.current;
  }, [ouvert]);

  const ouvrir = (cle: string | null) => {
    if (cle && defilement.current) positionListe.current = defilement.current.scrollTop;
    onOuvrir(cle);
  };

  const basculer = async (cle: string) => {
    const actuels = config?.canaux ?? [];
    const suivants = actuels.includes(cle) ? actuels.filter((c) => c !== cle) : [...actuels, cle];
    setEnvoi(cle);
    try {
      await client.call({ type: 'marketing.configurer', projectId, configuration: { canaux: suivants } });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Canal non modifié'));
    } finally {
      setEnvoi(null);
    }
  };

  const ligneOuverte = ouvert ? lignes.find((l) => l.canal.cle === ouvert) : undefined;
  if (ligneOuverte) {
    return (
      <CorpsOnglet refDefilement={defilement}>
        <FicheCanal ligne={ligneOuverte} relie={relies.has(ligneOuverte.canal.cle)} envoi={envoi === ligneOuverte.canal.cle} onBasculer={() => void basculer(ligneOuverte.canal.cle)} onAgent={onAgent} />
      </CorpsOnglet>
    );
  }

  const bouton = (l: (typeof lignes)[number]) => (
    <li key={l.canal.cle}>
      <button
        type="button"
        onClick={() => ouvrir(l.canal.cle)}
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-md bg-bloc px-3 py-2 text-left hover:bg-raised"
        data-marketing-canal={l.canal.cle}
        data-choisi={l.choisi ? 'oui' : 'non'}
        data-pertinence={l.recommandation?.pertinence ?? ''}
      >
        {estReseauSocial(l.canal.cle) ? <LogoReseau reseau={l.canal.cle} /> : l.choisi ? <CheckCircle2 className="h-4 w-4 shrink-0 text-termine" /> : <Circle className="h-4 w-4 shrink-0 text-faint" />}
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{t(l.canal.libelle)}</span>
        {l.recommandation ? <PastillePertinence pertinence={l.recommandation.pertinence} /> : null}
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
      </button>
    </li>
  );

  const groupe = (titre: string, liste: typeof lignes, famille?: string) =>
    liste.length ? (
      <div key={titre} className="flex flex-col gap-1" data-marketing-groupe={famille ?? 'choisis'}>
        <span className="px-0.5 text-[12px] font-medium text-muted">{titre}</span>
        <ul className="flex flex-col gap-1">{liste.map(bouton)}</ul>
      </div>
    ) : null;

  return (
    <CorpsOnglet refDefilement={defilement}>
      <div className="flex flex-col gap-4" data-marketing-canaux={lignes.filter((l) => l.choisi).length} data-marketing-catalogue={lignes.length}>
        {reseaux ? (
          <OngletComptes
            projectId={projectId}
            reseaux={reseaux}
            cartes={donnees.cartes ?? []}
            onOuvrirCarte={onOuvrirCarte}
            canaux={etatDesReseaux}
            onOuvrirCanal={(reseau) => ouvrir(reseau)}
          />
        ) : null}
        <div className="flex items-center gap-2 pt-2">
          <span className="flex-1 text-[13px] text-muted">
            {aDesAvis ? t('Touchez un canal pour voir l’avis de l’agent et le parcours à suivre.') : t('Tous les canaux qui peuvent amener des clients.')}
          </span>
          <PointInfo titre={t('Les canaux')}>
            <p>{t('Un canal, c’est un endroit où vos futurs clients peuvent vous découvrir : un réseau social, Google, une lettre d’information, un salon…')}</p>
            <p>{t('Mieux vaut peu de canaux bien tenus que tous à la fois. L’agent dit lesquels conviennent à votre produit et par quoi commencer ; vous choisissez.')}</p>
            <p>
              {t(
                'Reliez vos comptes en haut de cette page : l’atelier publie alors lui-même sur Instagram, Facebook, LinkedIn, Threads, YouTube, TikTok, X, Pinterest et la fiche Google, et un compte relié compte d’office parmi vos canaux. Le lien de suivi de chaque contenu compte ses visites.',
              )}
            </p>
          </PointInfo>
        </div>
        {!aDesAvis ? (
          <button type="button" onClick={onAgent} className="rounded-md bg-bloc px-3 py-2.5 text-left text-[12.5px] text-muted hover:bg-raised" data-marketing-canaux-sans-avis>
            {t('L’agent n’a pas encore donné son avis. Lancez son analyse depuis le bouton du haut : il vous dira lesquels choisir.')}
          </button>
        ) : null}
        {groupe(t('Vos canaux'), choisis)}
        {FAMILLES_CANAL.map((famille) =>
          groupe(
            t(LIBELLE_FAMILLE_CANAL[famille]),
            autres.filter((l) => l.canal.famille === famille),
            famille,
          ),
        )}
      </div>
    </CorpsOnglet>
  );
}

export function PastillePertinence({ pertinence }: { pertinence: string }) {
  return (
    <Badge tone={pertinence === 'haute' ? 'success' : pertinence === 'moyenne' ? 'neutral' : 'warning'} className="shrink-0">
      {libellePertinence(pertinence)}
    </Badge>
  );
}

/** Un bloc de la fiche : un intitulé discret, puis son contenu sur le fond de bloc. */
function BlocDeFiche({ titre, children, ...props }: { titre: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className="flex flex-col gap-1.5" {...props}>
      <h3 className="px-0.5 text-[12px] font-medium text-muted">{titre}</h3>
      <div className="rounded-md bg-bloc px-3 py-2.5">{children}</div>
    </section>
  );
}

/**
 * LA FICHE D'UN CANAL : ce qu'on y fait, et dans quel ordre. Le parcours se
 * lit comme un flux à points numérotés ; le premier pas conseillé par l'agent,
 * quand il existe, est mis en avant au-dessus, et ses conseils propres au
 * produit ferment la marche.
 */
function FicheCanal({
  ligne,
  relie,
  envoi,
  onBasculer,
  onAgent,
}: {
  ligne: ReturnType<typeof canauxDansLOrdre>[number];
  /** Un compte relié porte ce canal : il est choisi d'office, et ne s'abandonne qu'en retirant le compte. */
  relie: boolean;
  envoi: boolean;
  onBasculer: () => void;
  onAgent: () => void;
}) {
  const { canal, choisi, recommandation } = ligne;
  const parcours = parcoursDuCanal(canal.cle);
  const conseils = recommandation?.etapes ?? [];
  /* QUITTER UN CANAL SE CONFIRME : le choisir est un clic, l'abandonner en
     demande deux. « Annuler » ne touche à rien. */
  const [confirmerAbandon, setConfirmerAbandon] = React.useState(false);
  return (
    <div className="flex flex-col gap-4 pt-1" data-marketing-fiche-canal={canal.cle}>
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-[17px] font-semibold text-text">
          <span className="min-w-0 truncate">{t(canal.libelle)}</span>
          {/* LE CANAL EST CHOISI : la mention reste près du titre, puisque le
              bouton dit désormais le geste inverse. */}
          {choisi ? (
            <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-termine" data-marketing-canal-choisi={canal.cle}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {relie ? t('Compte relié') : t('Choisi')}
            </span>
          ) : null}
        </h2>
        {relie ? null : choisi ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-danger hover:text-danger"
            disabled={envoi}
            onClick={() => setConfirmerAbandon(true)}
            data-marketing-canal-choix={canal.cle}
            data-marketing-canal-abandon={canal.cle}
          >
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            {t('Abandonner')}
          </Button>
        ) : (
          <Button size="sm" variant="default" className="shrink-0" disabled={envoi} onClick={onBasculer} data-marketing-canal-choix={canal.cle}>
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('Choisir')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmerAbandon}
        title={t('Abandonner ce canal ?')}
        description={t('« {canal} » quitte vos canaux. Les conseils de l’agent et les contenus déjà prévus restent, et vous pourrez le choisir de nouveau.', { canal: t(canal.libelle) })}
        confirmLabel={t('Abandonner')}
        danger
        onConfirm={onBasculer}
        onClose={() => setConfirmerAbandon(false)}
      />

      <BlocDeFiche titre={t('À quoi ça sert')}>
        <p className="text-[13px] text-text">{t(canal.description)}</p>
      </BlocDeFiche>

      <BlocDeFiche titre={t('L’avis de l’agent')} data-marketing-fiche-avis={recommandation ? 'oui' : 'non'}>
        {recommandation ? (
          <div className="flex flex-col items-start gap-1.5">
            <PastillePertinence pertinence={recommandation.pertinence} />
            <p className="text-[13px] text-text">{recommandation.raison}</p>
          </div>
        ) : (
          <button type="button" onClick={onAgent} className="text-left text-[12.5px] text-muted hover:text-text">
            {t('L’agent n’a pas encore donné son avis sur ce canal. Lancez son analyse depuis le bouton du haut.')}
          </button>
        )}
      </BlocDeFiche>

      <section className="flex flex-col gap-1.5" data-marketing-parcours={parcours.length}>
        <h3 className="px-0.5 text-[12px] font-medium text-muted">{t('Le parcours')}</h3>
        {recommandation?.premierPas ? (
          <div className="rounded-md bg-bloc px-3 py-2.5" data-marketing-premier-pas>
            <span className="text-[12px] font-medium text-accent">{t('Pour commencer')}</span>
            <p className="text-[13px] text-text">{recommandation.premierPas}</p>
          </div>
        ) : null}
        <ol className="flex flex-col rounded-md bg-bloc px-3 py-3">
          {parcours.map((etape, i) => (
            <li key={etape.titre + i} className="flex gap-3" data-marketing-etape={i + 1}>
              <span className="flex flex-col items-center">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold text-text">{i + 1}</span>
                {i < parcours.length - 1 ? <span className="w-px flex-1 bg-faint" /> : null}
              </span>
              <span className={cn('flex min-w-0 flex-1 flex-col gap-0.5', i < parcours.length - 1 && 'pb-3')}>
                <span className="pt-0.5 text-[13.5px] font-medium text-text">{t(etape.titre)}</span>
                <span className="text-[12.5px] text-muted">{t(etape.detail)}</span>
              </span>
            </li>
          ))}
        </ol>
        {conseils.length ? (
          <div className="flex flex-col gap-1 rounded-md bg-bloc px-3 py-2.5" data-marketing-conseils={conseils.length}>
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-accent">
              <Sparkles className="h-3.5 w-3.5" />
              {t('Les conseils de l’agent pour votre produit')}
            </span>
            <ul className="flex flex-col gap-1">
              {conseils.map((conseil, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-text">
                  <span className="text-faint">•</span>
                  <span className="min-w-0 flex-1">{conseil}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Le tiroir d'un contenu                                               */
/* ------------------------------------------------------------------ */


