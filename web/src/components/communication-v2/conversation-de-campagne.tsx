import * as React from 'react';
import { Check, CheckCheck, ChevronLeft, ChevronRight, EllipsisVertical, Inbox, Loader2, PanelRight, PanelRightClose, Trash2 } from '@/components/ui/icones';
import { FICHES_RESEAUX, LIBELLES_DE_STRATEGIE, RUBRIQUES_DE_STRATEGIE, parcoursDeLaCampagne, type EtapeDuParcoursDeCampagne, type ReseauSocial } from '@beluga/shared';
import { LigneDeParcours, type EtapeDeLaLigne } from '@/components/ligne-de-parcours';
import { Chat } from '@/components/chat';
import { Composer } from '@/components/composer';
import { LogoReseau } from '@/components/logos-reseaux';
import { ResizeHandle, useResizable } from '@/components/resizer';
import { OptionDePage, OptionsDePage } from '@/components/entete-de-zone';
import { CLASSE_FENETRE_DU_VOLET, CLASSE_VOLET_DU_PLAN, CLE_DE_LARGEUR_DU_PLAN, PanneauDuVolet, bornesDuVoletDuPlan, usePlaceDeLaRangee } from '@/components/volet-comme-un-plan';
import { SilhouetteConversation, SilhouetteMarketing } from '@/components/silhouettes';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EnteteDeFeuille,
  ZoneDefilement,
} from '@/components/ui';
import { Apercu, Bloc, dateCourteLocale, estUnReseau, jouerUnGeste, libelleDuCanal, nombreLisible, useLecture } from '@/components/communication-v2/socle/pieces';
import { CaseACocher } from '@/components/ui/elements-maison';
import type { Canaux, LigneDeCanal } from './page-canaux';
import { client } from '@/lib/client';
import { Markdown } from '@/lib/markdown';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { PageV2 as PageEnPlace } from './page-v2';
import { useDeclarerLaCampagne, useV2 } from './contexte';
import { cleDuMedia, postsDeLaCampagne, useCampagne, useCampagnes, useMediasDeLaMarque, type CampagneV2, type DetailDeCampagneV2, type PublicationV2 } from './donnees';
import { ApercuV2, dateDePublication } from './apercu-v2';
import { BulleDuBoutonEteint, EtatDePublication, VIOLET } from './pieces';

/**
 * LA CAMPAGNE EST UNE CONVERSATION (carte « Suppression de campagne et menu nettoyé », 10/11/2026, capture #3cd0 :
 * « j'ai posé un prompt et ça m'a créé n'importe quoi. Ça aurait dû me poser des questions »).
 *
 *  - « Nouvelle campagne » ouvre le MÊME champ d'écriture que les agents (`Composer`, sans agent encore) : le premier
 *    envoi fait naître la campagne (« en préparation », titre provisoire) et SON agent, à qui le message part
 *    aussitôt (geste `campagne.creer`). Plus d'assistant en trois écrans, plus de barre d'étapes en haut : les trois
 *    étapes sont la liste de tâches de l'agent.
 *  - La page d'une campagne EST sa conversation (`Chat`, le fil des agents : questions, liste de tâches, réglages),
 *    une par campagne, et le restera après la validation. À droite, LE VOLET DU PLAN, EN LECTURE SEULE (décision de
 *    l'utilisateur) : stratégie, programme avec « Valider le programme », visuels et résultats — tout changement se
 *    demande à l'agent. Sur téléphone, le volet monte du bas (`Drawer feuille`).
 *  - CE VOLET EST CELUI DU PLAN D'UNE CARTE (carte « Volet des campagnes comme un plan », 10/11/2026) : collé au bord
 *    droit, même largeur gardée, même poignée et mêmes bornes, même cadre gris et fenêtre arrondie, entête titre +
 *    croix (`volet-comme-un-plan.tsx`) ; la conversation se centre dans la place restante.
 *  - Le bouton qui replie le plan et les trois points (« Supprimer », corbeille 30 jours, éteint avec sa raison quand
 *    l'agent travaille) vivent dans la barre du fil d'Ariane (`GestesDePage`, `OptionsDePage`).
 */

const mesureLisible = (m: string): string => ({ visites: t('visites'), clics: t('clics'), vues: t('vues'), abonnes: t('abonnés gagnés') } as Record<string, string>)[m] ?? m;
const statutDeCampagne = (s: string): string => ({ preparation: t('En préparation'), en_cours: t('En cours'), terminee: t('Terminée') } as Record<string, string>)[s] ?? s;

/** Le libellé affiché de chaque rubrique de la stratégie (les mêmes que l'agent écrit, retraduits). */
const libelleDeRubrique = (r: (typeof RUBRIQUES_DE_STRATEGIE)[number]): string =>
  ({
    idee: t('Idée et objectif business'),
    parcours: t('Parcours du client'),
    angles: t('Angles à tester'),
    concurrence: t('Concurrence'),
    preuves: t('Preuves à montrer'),
    budget: t('Budget de publicité recommandé'),
    indicateurs: t('Indicateurs semaine par semaine'),
  })[r] ?? LIBELLES_DE_STRATEGIE[r];

/** La largeur de la conversation, comme celle des agents du tableau et de Marketing. */
const CLASSE_DU_FIL = 'mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col [--fond-du-pied:transparent] [--retrait-du-fil:1rem]';

/** Le programme a-t-il déjà été validé ? Une publication a quitté le brouillon, ou a déjà son visuel. */
export function programmeValide(publications: readonly PublicationV2[]): boolean {
  return publications.some((p) => p.etape !== 'brouillon' && p.etape !== 'abandonne') || publications.some((p) => p.etape === 'brouillon' && !!p.apercu);
}

/** Combien de visuels le Studio fabriquera : un par post (ses déclinaisons partagent le leur), sauf un réseau sans visuel. */
export function visuelsAFabriquer(publications: readonly PublicationV2[]): number {
  return postsDeLaCampagne(publications).filter(({ membres }) =>
    membres.some((m) => {
      const r = m.canaux.find(estUnReseau);
      return !m.apercu && (!r || FICHES_RESEAUX[r as ReseauSocial].media !== 'aucun');
    }),
  ).length;
}

/* ------------------------------------------------------------------ */
/* Nouvelle campagne : le champ des agents, avant que l'agent existe     */
/* ------------------------------------------------------------------ */

export function NouvelleCampagneEnConversation() {
  const { marque, aller } = useV2();
  const state = useApp();
  const projetId = marque.projets[0]?.id ?? '';
  /* LES RÉSEAUX DE LA CAMPAGNE, CHOISIS AVANT LE PREMIER MESSAGE (12/11/2026 : l'étape « Réseaux » a disparu). */
  const { donnees: canaux } = useLecture<Canaux>({ type: 'communication.canaux', marqueId: marque.id }, [marque.id]);
  const lignes = React.useMemo(() => (canaux?.reseaux ?? []).filter((r) => r.publier), [canaux]);
  const [coches, setCoches] = React.useState<Record<string, boolean>>({});
  const estCoche = (r: LigneDeCanal) => coches[r.reseau] ?? (r.choisi || r.comptes.some((c) => c.etat === 'relie'));
  const reseaux = lignes.filter(estCoche).map((r) => r.reseau);
  const envoyer = async (texte: string, pieces: string[]) => {
    /* Le champ rend le texte et dit la raison (`Composer`, envoi refusé). */
    if (!reseaux.length) throw new Error(t('Choisissez au moins un réseau pour cette campagne.'));
    const r = await client.call<{ campagneId: string; agentId: string }>({ type: 'communication.geste', geste: 'campagne.creer', id: marque.id, donnees: { texte, reseaux, ...(pieces.length ? { pieces } : {}) } } as never);
    if (r?.agentId) void client.chargerAgent(r.agentId);
    if (r?.campagneId) aller('campagnes', r.campagneId);
  };
  return (
    <PageEnPlace barre={false} invite={null} plein aligne={false} data-v2-nouvelle-conversation>
      <div className={CLASSE_DU_FIL}>
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="flex flex-col justify-end gap-2 px-4 pb-4 pt-6">
          <div className="flex flex-col gap-1.5" data-v2-accueil-nouvelle>
            <h2 className="text-[16px] font-semibold tracking-tight text-text">{t('Quelle campagne voulez-vous mener ?')}</h2>
            <p className="text-[13.5px] leading-relaxed text-muted">
              {t('Choisissez d’abord les réseaux visés, puis décrivez votre idée en quelques mots. L’agent de la campagne vous pose ensuite ses questions, une à une, avec son conseil — but, public, dates, angles à tester, budget — et le plan se remplit à droite au fil de vos réponses.')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5" data-v2-reseaux-de-campagne={reseaux.join(',')}>
            <span className="text-[12.5px] font-medium text-muted">{t('Réseaux de la campagne')}</span>
            {!canaux ? (
              <div className="h-10 animate-pulse rounded-xl bg-surface" />
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {lignes.map((r) => (
                  <li key={r.reseau}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-surface px-3 py-2 hover:bg-raised" data-v2-reseau-campagne={r.reseau}>
                      <CaseACocher checked={estCoche(r)} onCheckedChange={(oui) => setCoches((c) => ({ ...c, [r.reseau]: oui === true }))} aria-label={r.libelle} />
                      <LogoReseau reseau={r.reseau} className="h-4 w-4 shrink-0" />
                      <span className="text-[13px] text-text">{r.libelle}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ZoneDefilement>
        <Composer
          agent={null}
          engines={state.engines}
          queue={[]}
          busy={false}
          projectId={projetId}
          dansTiroir
          libelleDuChamp={t('Décrivez la campagne que vous voulez mener…')}
          envoyerSansAgent={envoyer}
          cleSansAgent={`communication2-nouvelle-campagne-${marque.id}`}
        />
      </div>
    </PageEnPlace>
  );
}

/* ------------------------------------------------------------------ */
/* La page d'une campagne : sa conversation, et le volet du plan        */
/* ------------------------------------------------------------------ */

const CLE_DU_PLI = 'beluga.v2-volet-campagne';

function usePliDuVolet(): [boolean | null, (ouvert: boolean) => void] {
  const [pli, setPli] = React.useState<boolean | null>(() => {
    try {
      const lu = window.localStorage.getItem(CLE_DU_PLI);
      return lu === 'ouvert' ? true : lu === 'ferme' ? false : null;
    } catch {
      return null;
    }
  });
  const poser = React.useCallback((ouvert: boolean) => {
    setPli(ouvert);
    try {
      window.localStorage.setItem(CLE_DU_PLI, ouvert ? 'ouvert' : 'ferme');
    } catch {
      /* Un onglet privé garde le pli en mémoire seulement. */
    }
  }, []);
  return [pli, poser];
}

/** Le plan a-t-il déjà quelque chose à montrer ? Un point tranché, une rubrique, une publication. */
function planCommence(d: DetailDeCampagneV2): boolean {
  return d.fiche.manquants.length < 8 || Object.keys(d.campagne.strategie ?? {}).length > 0 || d.publications.length > 0;
}

/** Le nom de chaque étape du parcours d'une campagne. */
const NOMS_DU_PARCOURS = (): Record<EtapeDuParcoursDeCampagne, string> => ({
  brief: t('Brief'),
  plan: t('Plan'),
  visuels: t('Visuels'),
  connexion: t('Connexion'),
  programmation: t('Programmation'),
  en_ligne: t('En ligne'),
});

export function PageDeCampagneV2({ id, selection, versLeProgramme = false }: { id: string; selection: string | null; versLeProgramme?: boolean }) {
  const { aller, marque } = useV2();
  const state = useApp();
  const telephone = useTelephone();
  const { donnees: d, erreur } = useCampagne(id);
  const { donnees: liste } = useCampagnes();
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [panne, setPanne] = React.useState<string | null>(null);
  const [pli, setPli] = usePliDuVolet();
  const [feuille, setFeuille] = React.useState(versLeProgramme);
  const [suppression, setSuppression] = React.useState(false);
  /* LA LARGEUR DU VOLET EST CELLE DU PLAN D'UNE CARTE : même mémoire, mêmes bornes, mesurées sur la rangée. */
  const [placeDeLaRangee, setRangee] = usePlaceDeLaRangee();
  const { width, start, reset } = useResizable(CLE_DE_LARGEUR_DU_PLAN, bornesDuVoletDuPlan(placeDeLaRangee));
  useDeclarerLaCampagne(d?.campagne.titre);
  /* UNE ANCIENNE ADRESSE « …/programme » : la page de la campagne, volet ouvert ; l'adresse se corrige. */
  React.useEffect(() => {
    if (versLeProgramme) aller('campagnes', id);
  }, [versLeProgramme, aller, id]);
  /* SON AGENT : déjà né, ou né à la première ouverture d'une campagne plus ancienne (mot d'accueil sans moteur). */
  const agentConnu = d?.agentId ?? null;
  React.useEffect(() => {
    if (!d) return;
    if (agentConnu) {
      setAgentId(agentConnu);
      return;
    }
    let vivant = true;
    client
      .call<{ agentId: string }>({ type: 'communication.geste', geste: 'campagne.agent', id } as never)
      .then((r) => vivant && setAgentId(r.agentId))
      .catch((err: any) => vivant && setPanne(err?.message ?? String(err)));
    return () => {
      vivant = false;
    };
  }, [!!d, agentConnu, id]);
  React.useEffect(() => {
    if (agentId) void client.chargerAgent(agentId);
  }, [agentId]);
  const agent = agentId ? state.agents[agentId] : undefined;
  const auTravail = !!agent && (agent.status === 'running' || agent.status === 'starting');

  if (erreur && !d) {
    return (
      <PageEnPlace barre={false} invite={null}>
        <p className="text-[13px] text-danger" data-v2-campagne-introuvable>
          {erreur}
        </p>
      </PageEnPlace>
    );
  }
  if (!d) {
    return (
      <PageEnPlace barre={false} invite={null}>
        <SilhouetteMarketing />
      </PageEnPlace>
    );
  }
  const c = d.campagne;
  const ligne = liste?.campagnes.find((x) => x.id === id);
  const voletOuvert = versLeProgramme || (pli ?? planCommence(d));
  const enUneLigne = [
    c.debut || c.fin ? `${dateCourteLocale(c.debut)} → ${dateCourteLocale(c.fin)}` : null,
    c.reseaux.length ? c.reseaux.map(libelleDuCanal).join(', ') : null,
    c.objectifChiffre ? `${nombreLisible(d.atteint)} / ${nombreLisible(c.objectifChiffre)} ${mesureLisible(c.mesure)}` : null,
    statutDeCampagne(c.statut),
  ]
    .filter(Boolean)
    .join(' · ');
  const volet = <VoletDeCampagne d={d} agentId={agentId} auTravail={auTravail} selection={selection} />;
  /* LE PARCOURS DE LA CAMPAGNE, EN BAS COMME CELUI D'UN AGENT (14/11/2026) : il remplace « Procédures précédentes ».
     La connexion des réseaux et les réponses s'y ouvrent : ce ne sont plus des onglets en haut. */
  const datees = d.publications.filter((p) => !!p.datePrevue);
  const parcours = parcoursDeLaCampagne({
    briefComplet: d.fiche.manquants.length === 0,
    visuels: ligne?.visuels ?? { prevus: datees.length, faits: datees.filter((p) => !!p.apercu).length },
    comptesRelies: marque.v2.comptesRelies,
    programmees: datees.filter((p) => p.etape === 'programme' || p.etape === 'publie').length,
    publiees: datees.filter((p) => p.etape === 'publie').length,
    statut: c.statut,
  });
  const noms = NOMS_DU_PARCOURS();
  const etapesDeLaLigne: EtapeDeLaLigne[] = parcours.map((e) => ({
    cle: e.id,
    libelle: noms[e.id],
    etat: e.etat,
    ...(e.compte
      ? { detail: e.id === 'visuels' ? t('{v0} visuels sur {v1}', { v0: e.compte.faits, v1: e.compte.total }) : t('{v0} sur {v1}', { v0: e.compte.faits, v1: e.compte.total }) }
      : {}),
    ...(e.id === 'connexion' ? { onAller: () => aller('connexion') } : {}),
  }));
  const ligneDeParcours = (
    <LigneDeParcours
      repere="campagne"
      etapes={etapesDeLaLigne}
      extra={
        <li>
          <button type="button" onClick={() => aller('reponses')} className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1 py-1 text-left text-[13px] text-muted transition-colors hover:bg-raised" data-etape-de-parcours="reponses">
            <Inbox className="h-[14px] w-[14px] shrink-0" />
            <span className="min-w-0 truncate">{t('Réponses')}</span>
            {marque.messages ? <span className="ml-auto shrink-0 pr-1 text-[12px] text-faint">{marque.messages}</span> : null}
          </button>
        </li>
      }
    />
  );
  const raisonDeSuppression = auTravail || ligne?.agentAuTravail ? t('L’agent de cette campagne travaille : attendez qu’il ait fini pour la supprimer.') : null;
  /* « SUPPRIMER », DERRIÈRE LES TROIS POINTS DE LA BARRE DU HAUT (carte « Volet des campagnes comme un plan ») :
     éteint, avec sa raison écrite dessous, tant que l'agent travaille. */
  const supprimer = (
    <OptionDePage
      icone={<Trash2 />}
      disabled={!!raisonDeSuppression}
      detail={raisonDeSuppression}
      onClick={() => setSuppression(true)}
      className="text-danger data-[highlighted]:text-danger [&_svg]:text-danger"
      data-v2-supprimer-campagne={raisonDeSuppression ? 'eteint' : 'pret'}
    >
      {t('Supprimer la campagne')}
    </OptionDePage>
  );
  return (
    <PageEnPlace barre={false} invite={null} plein aligne={false} data-v2-campagne={c.id} data-v2-volet={telephone ? 'feuille' : voletOuvert ? 'ouvert' : 'ferme'}>
      {/* LES GESTES DE LA CAMPAGNE MONTENT DANS LA BARRE DU FIL D'ARIANE (demande du 10/11/2026) : sur ordinateur, le
          bouton qui replie ou rouvre le plan, puis les trois points (« Supprimer ») ; sur téléphone, les deux dans les
          trois points du haut — « Le plan de la campagne » y ouvre la feuille du bas. */}
      {telephone ? (
        <OptionsDePage>
          <OptionDePage icone={<PanelRight />} onClick={() => setFeuille(true)} data-v2-ouvrir-volet="">
            {t('Le plan de la campagne')}
          </OptionDePage>
          {supprimer}
        </OptionsDePage>
      ) : null}
      {/* LA RANGÉE : la conversation, centrée dans la place que le volet lui laisse, puis le volet collé au bord droit. */}
      <div ref={setRangee} className="flex min-h-0 min-w-0 flex-1" data-v2-rangee-campagne>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-v2-conversation-campagne={agent?.id ?? 'chargement'}>
          <div className={CLASSE_DU_FIL}>
            {/* LA LIGNE DU HAUT DU FIL (décision du 14/11/2026) : plus de barre vide au-dessus de la campagne — ses dates
                et réseaux, puis, en haut à droite du fil, le bouton du volet et les options (« Supprimer la campagne »). */}
            {enUneLigne || !telephone ? (
              <div className="flex shrink-0 items-center gap-1 pl-4 pr-2 pt-2" data-v2-sous-titre-campagne>
                <p className="min-w-0 flex-1 truncate text-[12px] text-muted">{enUneLigne}</p>
                {!telephone ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className={cn('h-8 w-8 shrink-0 text-muted', voletOuvert && 'text-text')}
                      aria-label={voletOuvert ? 'Replier le plan' : 'Afficher le plan'}
                      title={voletOuvert ? t('Replier le plan') : t('Afficher le plan')}
                      aria-pressed={voletOuvert}
                      onClick={() => setPli(!voletOuvert)}
                      data-v2-plier-volet={voletOuvert ? 'ouvert' : 'ferme'}
                    >
                      {voletOuvert ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted data-[state=open]:bg-raised" aria-label="Options de la campagne" title={t('Options de la campagne')} data-v2-options-campagne>
                          <EllipsisVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="sm:w-[260px]">
                        <DropdownMenuItem
                          disabled={!!raisonDeSuppression}
                          title={raisonDeSuppression ?? undefined}
                          onSelect={() => setSuppression(true)}
                          className="gap-2.5 text-danger data-[highlighted]:text-danger"
                          data-v2-supprimer-campagne={raisonDeSuppression ? 'eteint' : 'pret'}
                        >
                          <Trash2 className="h-4 w-4 shrink-0" />
                          {t('Supprimer la campagne')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : null}
              </div>
            ) : null}
            {agent ? (
              <Chat agent={agent} projectId={agent.projectId} libelleDuChamp={t('Écrire à l’agent de la campagne…')} parcours={ligneDeParcours} />
            ) : (
              <div className="px-4 pt-3">{panne ? <p className="text-[13px] text-danger">{panne}</p> : <SilhouetteConversation bulles={2} />}</div>
            )}
          </div>
        </div>
        {!telephone && voletOuvert ? (
          <>
            {/* Au-dessus de la piste du pouce de défilement de la conversation (z-20), comme celle du plan d'une carte. */}
            <ResizeHandle onPointerDown={(e) => start(e, 'right')} onDoubleClick={reset} className="z-30" data-document-poignee="v2-volet-campagne" />
            <aside className={cn('min-h-0', CLASSE_VOLET_DU_PLAN)} style={{ width }} aria-label="Le plan de la campagne" data-v2-volet-campagne>
              <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', CLASSE_FENETRE_DU_VOLET)} data-v2-fenetre-du-volet>
                <PanneauDuVolet titre={t('Plan de la campagne')} libelleFermer={t('Replier le plan')} onFermer={() => setPli(false)} reperesCroix={{ 'data-croix-du-volet': 'campagne' }}>
                  {volet}
                </PanneauDuVolet>
              </div>
            </aside>
          </>
        ) : null}
      </div>
      {telephone ? (
        <Drawer feuille open={feuille} onClose={() => setFeuille(false)}>
          <EnteteDeFeuille titre={t('Le plan de la campagne')} data-v2-feuille-volet />
          <ZoneDefilement className="px-4 pb-6">{volet}</ZoneDefilement>
        </Drawer>
      ) : null}
      {suppression ? (
        <ConfirmationDeSuppression
          campagne={{ id: c.id, titre: c.titre, aAnnuler: ligne?.aAnnuler ?? d.publications.filter((p) => p.etape !== 'publie' && p.etape !== 'abandonne').length, medias: ligne?.medias ?? 0 }}
          onFermer={() => setSuppression(false)}
          onSupprimee={() => aller('campagnes')}
        />
      ) : null}
    </PageEnPlace>
  );
}

/* ------------------------------------------------------------------ */
/* Le volet : le plan, en lecture seule                                 */
/* ------------------------------------------------------------------ */

function VoletDeCampagne({ d, agentId, auTravail, selection }: { d: DetailDeCampagneV2; agentId: string | null; auTravail: boolean; selection: string | null }) {
  const { aller } = useV2();
  const telephone = useTelephone();
  const c = d.campagne;
  const posts = postsDeLaCampagne(d.publications);
  const rang = selection ? posts.findIndex((p) => p.membres.some((m) => m.id === selection)) : -1;
  const famille = rang >= 0 ? posts[rang]! : null;
  const ouvrir = React.useCallback((p: { tete: PublicationV2 } | undefined) => p && aller('campagnes', c.id, 'pub', p.tete.id), [aller, c.id]);
  const fermer = React.useCallback(() => aller('campagnes', c.id), [aller, c.id]);
  /* LES FLÈCHES DU CLAVIER parcourent les publications tant que la feuille est ouverte — jamais pendant une frappe. */
  React.useEffect(() => {
    if (rang < 0) return;
    const touche = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;
      const voisin = posts[rang + (e.key === 'ArrowRight' ? 1 : -1)];
      if (!voisin) return;
      e.preventDefault();
      ouvrir(voisin);
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [rang, posts, ouvrir]);
  const strategie = c.strategie ?? {};
  const manquantes = d.strategieManquante ?? RUBRIQUES_DE_STRATEGIE.filter((r) => !strategie[r]);
  const deja = programmeValide(d.publications);
  const avecVisuel = posts.filter((p) => p.tete.apercu);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-v2-volet-plan>
      <FicheEnHuitPoints c={c} manquants={d.fiche.manquants} />
      <Bloc titre={t('La stratégie')} detail={manquantes.length ? t('{n} rubrique(s) encore à trancher', { n: manquantes.length }) : t('Complète')} data-v2-volet-strategie={manquantes.length}>
        <dl className="flex min-w-0 flex-col gap-2.5 text-[13px]">
          {RUBRIQUES_DE_STRATEGIE.map((r) => (
            <div key={r} className="flex min-w-0 flex-col gap-0.5" data-v2-rubrique={r} data-etat={strategie[r] ? 'tranchee' : 'a-trancher'}>
              <dt className="text-[12px] text-muted">{libelleDeRubrique(r)}</dt>
              <dd className="min-w-0">
                {/* MÊME RENDU QUE LE CHAT (gras, italique, listes, tableaux), en lecture seule : aucune liste cliquable. */}
                {strategie[r] ? <Markdown content={strategie[r]} enTexte className="texte-du-volet" /> : <span className="text-[13px] text-faint">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Bloc>
      <section className="flex min-w-0 flex-col gap-2" data-v2-volet-programme={posts.length}>
        <h2 className="text-[14px] font-semibold text-text">{t('Le programme')}</h2>
        {posts.length ? (
          <ul className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-raised" data-v2-liste-publications={posts.length}>
            {posts.map((p) => {
              const { tete, membres } = p;
              const actif = famille?.tete.id === tete.id;
              return (
                <li key={tete.id}>
                  <button
                    type="button"
                    onClick={() => ouvrir(p)}
                    aria-current={actif ? 'true' : undefined}
                    className={cn('flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left hover:bg-fond-survol', actif && cn(VIOLET.fondPale, VIOLET.anneau))}
                    data-v2-publication={tete.id}
                    data-etape={tete.etape}
                  >
                    <Apercu piece={tete.apercu?.attachmentId ?? null} genre={tete.apercu?.genre ?? 'image'} taille={36} />
                    <span className="min-w-0 flex-1">
                      <b className={cn('block truncate text-[13px] font-semibold', actif ? VIOLET.texte : 'text-text')}>{tete.titre}</b>
                      <span className="block truncate text-[12px] text-muted first-letter:uppercase">{dateDePublication(tete)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1" aria-hidden>
                      {membres.map((m) => {
                        const r = m.canaux.find(estUnReseau);
                        return r ? <LogoReseau key={m.id} reseau={r} className="h-3.5 w-3.5" /> : null;
                      })}
                    </span>
                    <EtatDePublication etape={membres.some((m) => m.etape === 'a_valider') ? 'a_valider' : tete.etape} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-muted" data-v2-programme-vide>
            {t('Le programme des publications arrive ici quand la stratégie est complète.')}
          </p>
        )}
        {posts.length && !deja ? <ValiderLeProgramme d={d} agentId={agentId} auTravail={auTravail} /> : null}
        <ToutValider publications={d.publications} />
      </section>
      {avecVisuel.length ? (
        <Bloc titre={t('Les visuels')} detail={t('{n} visuel(s)', { n: avecVisuel.length })} data-v2-volet-visuels={avecVisuel.length}>
          <ul className="grid grid-cols-3 gap-1.5">
            {avecVisuel.map((p) => (
              <li key={p.tete.id}>
                <button type="button" onClick={() => ouvrir(p)} className="block w-full overflow-hidden rounded-lg" aria-label={p.tete.titre} title={p.tete.titre} data-v2-visuel={p.tete.id}>
                  <Apercu piece={p.tete.apercu!.attachmentId} genre={p.tete.apercu!.genre} taille={96} />
                </button>
              </li>
            ))}
          </ul>
        </Bloc>
      ) : null}
      <Resultats d={d} />
      {/* LE TIROIR SE RESSERRE SUR L'APERÇU (15/11/2026) : 480 px au plus sur ordinateur — le post le plus large en fait
          400, marges comprises. */}
      <Drawer feuille open={!!famille} onClose={fermer} className="sm:max-w-[480px]">
        {famille ? (
          <>
            <EnteteDeFeuille titre={famille.tete.titre} data-v2-feuille-apercu={famille.tete.id} />
            <ZoneDefilement className="px-4 pb-5">
              <ApercuV2
                key={famille.tete.id}
                membres={famille.membres}
                campagneId={c.id}
                sansRetouche
                navigation={
                <div className="flex min-w-0 items-center gap-2" data-v2-navigation-apercu>
                  <Button size="sm" variant="subtle" disabled={rang <= 0} onClick={() => ouvrir(posts[rang - 1])} aria-label="Publication précédente" data-v2-apercu-precedent>
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {telephone ? null : t('Précédente')}
                  </Button>
                  <span className="min-w-0 flex-1 text-center text-[12.5px] tabular-nums text-muted" data-v2-apercu-rang={rang + 1}>
                    {t('{a} sur {b}', { a: rang + 1, b: posts.length })}
                  </span>
                  <Button size="sm" variant="subtle" disabled={rang >= posts.length - 1} onClick={() => ouvrir(posts[rang + 1])} aria-label="Publication suivante" data-v2-apercu-suivant>
                    {telephone ? null : t('Suivante')}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                }
              />
            </ZoneDefilement>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

/**
 * « VALIDER LE PROGRAMME » : un message de la personne à l'agent, dans la conversation — il fabrique alors les visuels
 * dans le Studio, en version gratuite d'abord. Le coût de ce clic est dit avant (0 $).
 */
function ValiderLeProgramme({ d, agentId, auTravail }: { d: DetailDeCampagneV2; agentId: string | null; auTravail: boolean }) {
  const [part, setPart] = React.useState(false);
  const visuels = visuelsAFabriquer(d.publications);
  const incomplet = d.fiche.manquants.length > 0 || (d.strategieManquante?.length ?? 0) > 0;
  const raison = !agentId ? t('L’agent de la campagne arrive…') : auTravail ? t('L’agent travaille encore : attendez la fin de son tour.') : incomplet ? t('La stratégie n’est pas encore complète.') : null;
  const valider = async () => {
    if (!agentId) return;
    setPart(true);
    try {
      await client.call({ type: 'agent.prompt', agentId, text: t('Je valide le programme : fabrique les visuels, en version gratuite d’abord.') } as never);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Demande non envoyée'));
    } finally {
      setPart(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-v2-cout-visuels={visuels}>
      <BulleDuBoutonEteint raison={part ? null : raison} className="w-full">
        <Button className="w-full" disabled={!!raison || part} onClick={() => void valider()} data-v2-valider-programme={postsDeLaCampagne(d.publications).length} data-en-route={part ? '' : undefined}>
          {part ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {t('Valider le programme')}
        </Button>
      </BulleDuBoutonEteint>
      <p className="text-[12px] leading-relaxed text-muted">{t('{n} visuel(s) à fabriquer par le Studio, en version gratuite d’abord : ce clic coûte 0 $.', { n: visuels })}</p>
    </div>
  );
}

/**
 * « TOUT VALIDER » : les publications dont le visuel attend l'accord de la personne passent prêtes, avec leur média, d'un
 * seul geste — une validation, pas une modification du plan : elle reste dans le volet.
 */
function ToutValider({ publications }: { publications: readonly PublicationV2[] }) {
  const { donnees: medias } = useMediasDeLaMarque();
  const [lot, setLot] = React.useState<{ fait: number; total: number } | null>(null);
  const aValider = publications.filter((p) => p.etape === 'a_valider');
  if (!aValider.length) return null;
  const toutValider = async () => {
    setLot({ fait: 0, total: aValider.length });
    for (const [i, p] of aValider.entries()) {
      const cle = cleDuMedia(p.id, medias?.medias);
      await jouerUnGeste('publication.valider', p.id, cle ? { media: cle } : undefined);
      setLot({ fait: i + 1, total: aValider.length });
    }
    setLot(null);
  };
  return (
    <Button className="w-full" disabled={!!lot} onClick={() => void toutValider()} data-v2-tout-valider={aValider.length}>
      {lot ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
      {lot ? t('Validation… {a} sur {b}', { a: lot.fait, b: lot.total }) : t('Tout valider ({n})', { n: aValider.length })}
    </Button>
  );
}

/** LA FICHE EN HUIT POINTS, compacte : ce que l'agent a tranché ; un point encore manquant se dit « — ». */
export function FicheEnHuitPoints({ c, manquants }: { c: CampagneV2; manquants: readonly string[] }) {
  const points: [string, string | null][] = [
    [t('Types de médias'), c.typesMedias.length ? c.typesMedias.join(', ') : null],
    [t('Quantité et rythme'), [c.quantiteMedias ? t('{n} publications', { n: c.quantiteMedias }) : null, c.rythme].filter(Boolean).join(' · ') || null],
    [t('Cible'), c.cible],
    [t('Réseaux'), c.reseaux.length ? c.reseaux.map(libelleDuCanal).join(', ') : null],
    [t('Dates'), c.debut || c.fin ? `${dateCourteLocale(c.debut)} → ${dateCourteLocale(c.fin)}` : null],
    [t('Objectif chiffré'), c.objectifChiffre ? `${nombreLisible(c.objectifChiffre)} ${mesureLisible(c.mesure)}` : null],
    [t('Message et ton'), [c.message, c.ton].filter(Boolean).join(' · ') || null],
    [t('Appel à l’action'), c.appelAction],
  ];
  return (
    <Bloc titre={t('La campagne en huit points')} detail={manquants.length ? t('{n} point(s) encore à trancher', { n: manquants.length }) : t('Complète')} data-v2-fiche={manquants.length}>
      <dl className="flex min-w-0 flex-col gap-1.5 text-[13px]">
        {points.map(([l, v]) => (
          <div key={l} className="flex min-w-0 gap-2">
            <dt className="w-[118px] shrink-0 text-muted">{l}</dt>
            <dd className="min-w-0 flex-1 break-words text-text">{v ?? <span className="text-faint">—</span>}</dd>
          </div>
        ))}
      </dl>
    </Bloc>
  );
}

/** LES RÉSULTATS : où en est l'objectif, et ce que chaque réseau a rapporté. */
function Resultats({ d }: { d: DetailDeCampagneV2 }) {
  const c = d.campagne;
  const publiees = d.publications.filter((p) => p.etape === 'publie').length;
  const total = d.publications.filter((p) => p.etape !== 'abandonne').length;
  const part = c.objectifChiffre ? Math.min(100, Math.round((d.atteint / c.objectifChiffre) * 100)) : null;
  return (
    <Bloc titre={t('Résultats')} detail={t('{a} publiée(s) sur {b}', { a: publiees, b: total })} data-v2-resultats>
      {part !== null ? (
        <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised">
            <span className="block h-full rounded-full bg-text/60" style={{ width: `${part}%` }} />
          </span>
          <span className="shrink-0 tabular-nums">
            {nombreLisible(d.atteint)} / {nombreLisible(c.objectifChiffre)} {mesureLisible(c.mesure)}
          </span>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">{t('Les chiffres arrivent avec les premières publications.')}</p>
      )}
      {d.parReseau.some((r) => r.valeur > 0) ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
          {d.parReseau
            .filter((r) => r.valeur > 0)
            .map((r) => (
              <li key={r.reseau} className="flex items-center gap-1.5">
                {estUnReseau(r.reseau) ? <LogoReseau reseau={r.reseau} className="h-3.5 w-3.5" /> : null}
                {libelleDuCanal(r.reseau)} · <b className="font-semibold text-text">{nombreLisible(r.valeur)}</b>
              </li>
            ))}
        </ul>
      ) : null}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* Supprimer et restaurer                                               */
/* ------------------------------------------------------------------ */

/** LE MENU « … » DE LA CAMPAGNE : « Supprimer », éteint avec sa raison quand l'agent de la campagne travaille. */
/**
 * LA CONFIRMATION, commune au clic droit de la liste et au « … » de la page : ce qui part à la corbeille avec la
 * campagne, et qu'elle se récupère 30 jours. Le bouton dit qu'il part dès le clic.
 */
export function ConfirmationDeSuppression({
  campagne,
  onFermer,
  onSupprimee,
}: {
  campagne: { id: string; titre: string; aAnnuler: number; medias: number };
  onFermer: () => void;
  onSupprimee?: () => void;
}) {
  const [envoi, setEnvoi] = React.useState(false);
  const supprimer = async () => {
    setEnvoi(true);
    const r = await jouerUnGeste('campagne.supprimer', campagne.id);
    setEnvoi(false);
    if (!r) return;
    client.pushToast('success', t('Campagne mise à la corbeille : elle se restaure pendant 30 jours.'));
    onFermer();
    onSupprimee?.();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !envoi && onFermer()}>
      <DialogContent className="sm:w-[min(460px,100%)]" data-v2-confirmer-suppression={campagne.id}>
        <DialogHeader>
          <DialogTitle>{t('Supprimer « {titre} » ?', { titre: campagne.titre })}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="mt-0">{t('La campagne part à la corbeille, avec sa conversation. Vous pouvez la restaurer pendant 30 jours, depuis le bas de la liste des campagnes.')}</DialogDescription>
        <ul className="mx-5 mb-1 mt-2 flex flex-col gap-0.5 rounded-xl bg-surface p-1.5 text-[13px]">
          <li className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2" data-v2-suppression-publications={campagne.aAnnuler}>
            <span className="min-w-0 flex-1 text-text">{t('Publications programmées annulées')}</span>
            <span className="shrink-0 tabular-nums text-muted">{campagne.aAnnuler}</span>
          </li>
          <li className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2" data-v2-suppression-medias={campagne.medias}>
            <span className="min-w-0 flex-1 text-text">{t('Visuels mis à la corbeille')}</span>
            <span className="shrink-0 tabular-nums text-muted">{campagne.medias}</span>
          </li>
        </ul>
        <DialogFooter pleineLargeur>
          <Button variant="danger" disabled={envoi} onClick={() => void supprimer()} data-v2-confirmer-supprimer data-en-route={envoi ? '' : undefined}>
            {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {envoi ? t('Suppression…') : t('Supprimer la campagne')}
          </Button>
          <Button variant="ghost" disabled={envoi} onClick={onFermer}>
            {t('Annuler')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Restaurer une campagne de la corbeille : elle revient dans la liste avec ses visuels et sa conversation. */
export async function restaurerCampagne(id: string): Promise<boolean> {
  const r = await jouerUnGeste('campagne.restaurer', id);
  if (!r) return false;
  client.pushToast('success', t('Campagne restaurée, avec ses visuels et sa conversation.'));
  return true;
}

