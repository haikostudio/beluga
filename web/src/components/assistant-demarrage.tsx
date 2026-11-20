import * as React from 'react';
import { Check, FolderPlus, Loader2 } from '@/components/ui/icones';
import {
  auMoinsUnMoteurEnLigne,
  etapePassable,
  etapesDeLaDiscussion,
  moteursDeLAssistant,
  nomDeLAssistant,
  paroleAvecPrenom,
  questionEnCours,
  type EngineId,
  type EtapeDeLAssistant,
  type EtatDeLAssistant,
  type ParolesDeLaMiseEnRoute,
} from '@beluga/shared';
import { Badge, Button, ZoneDefilement } from '@/components/ui';
import { BoutonRelireLesMoteurs, CarteMoteur } from '@/components/assistant-moteurs';
import { IconeMoteur } from '@/components/icone-moteur';
import {
  LigneDEtat,
  SectionCompetences,
  SectionCopie,
  SectionCourriels,
  SectionDomaine,
  SectionEspaceClient,
  SectionFacultatif,
  SectionGitHub,
  SectionMemoire,
  useEtatDeLInstallation,
  type EtatDeLInstallation,
} from '@/components/installation/sections';
import { SectionVotreAssistant, type EtatDeVotreAssistant } from '@/components/installation/votre-assistant';
import { ParcoursDInstallation } from '@/components/reglages/assistant-installation';
import { OrbeDeLAgent } from '@/components/installation/orbe-de-l-agent';
import { BarreDuTerminal, TerminalACote } from '@/components/installation/travail';
import { useVoileAffiche } from '@/lib/barre-de-l-heure';
import { useTravailDInstallation } from '@/lib/travail-installation';
import { client } from '@/lib/client';
import { SectionPartage, useEtatDuRelais } from '@/components/installation/relais';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t, useLangueGenerale } from '@/lib/langue';

/*
 * LA MISE EN ROUTE EN DISCUSSION (carte « Assistant d'installation et Jarvis », 20/11/2026, maquette #8f0b) —
 * remplace l'assistant en dix pages.
 *
 * Celui qui vient d'installer Beluga Build a créé son compte sur la page d'installation (servie par le démon). Il
 * arrive ici : un écran plein, une DISCUSSION avec l'agent « Beluga » (le nom réglé de l'assistant). Pas de champ
 * d'écriture en bas : seulement l'ORBE de l'agent (celui de l'appel en direct d'ProjetA, en gris) et « <nom> · à vous »
 * quand une réponse est attendue. On répond DANS les bulles : choix, boutons, petits champs.
 *
 * 1. LA PREMIÈRE QUESTION EST ÉCRITE D'AVANCE : quel moteur ? Rien ne peut parler avant qu'un moteur soit relié.
 *    Le moteur choisi s'installe et se connecte dans la bulle (`CarteMoteur`, la mécanique des réglages).
 * 2. DÈS QU'UN MOTEUR RÉPOND, il écrit les paroles de Beluga pour la suite, en un appel court
 *    (`installation.paroles`, `server/src/mise-en-route.ts`). Ses paroles remplacent les textes écrits d'avance ;
 *    s'il tarde ou tombe, ceux-ci restent : la discussion n'attend jamais un modèle plus de quelques secondes.
 * 3. L'ÉTAT DU SERVEUR FAIT FOI (`Settings.assistant`, ordre `etapesDeLaDiscussion`) : le modèle ne fait que dire
 *    les choses. Moteur, nom de l'assistant et GitHub restent indispensables — l'écran garde « Valider » éteint, et
 *    le démon refuse de les noter « faites » sans eux. Tout le reste se repousse (« Plus tard ») et se retrouve dans
 *    Réglages › Installation : ce sont les MÊMES sections (`installation/sections.tsx`).
 *
 * L'ORBE : il respire quand c'est à vous, s'accélère quand Beluga réfléchit (paroles en route, réponse en cours
 * d'enregistrement) et laisse monter la fumée quand il écrit (chaque lettre posée donne une impulsion).
 *
 * CE QUI SE PASSE SUR LE SERVEUR, EN BAS : la barre du terminal reste SOUS l'orbe, dans le flux — elle ne recouvre
 * jamais un bouton.
 */

/** Combien de temps une question attend les paroles du moteur avant de prendre son texte écrit d'avance. */
const ATTENTE_DES_PAROLES_MS = 20_000;
/** Lettres posées par seconde quand Beluga écrit. */
const LETTRES_PAR_SECONDE = 90;

/** Ce que Beluga dit à chaque étape quand le moteur n'a rien écrit (ou pas encore) : dans les cinq langues. */
function paroleEcriteDAvance(etape: EtapeDeLAssistant, nom: string): string {
  switch (etape) {
    case 'moteurs':
      return t('Pour commencer, quel moteur voulez-vous utiliser ? C’est lui qui fera le travail, et qui me donnera la parole.');
    case 'bienvenue':
      return t('Me voilà ! Beluga Build est un tableau de tâches que des agents réalisent sur votre serveur. Il apprend de chaque projet, et son code se modifie comme n’importe quel projet. On fait les réglages ensemble ?');
    case 'assistant':
      return t('Comment dois-je vous appeler ? Et gardez-vous le nom « {v0} » pour moi ? C’est aussi le mot qui m’appellera à voix haute.', { v0: nom });
    case 'ordinateur':
      return t('Équipons maintenant l’ordinateur où je travaillerai pour vous : son navigateur, et sur un Mac une petite application qui fait tout le reste. Vous pouvez aussi le faire plus tard.');
    case 'domaine':
      return t('À quelle adresse voulez-vous ouvrir Beluga Build ? Vos projets recevront la leur sous le même nom. L’adresse provisoire marche très bien en attendant.');
    case 'projet':
      return t('Reliez maintenant GitHub : c’est par lui que vos projets se récupèrent et se sauvegardent. Ensuite, ajoutez votre premier projet si vous le voulez.');
    case 'copie':
      return t('Voulez-vous faire de cette installation votre propre copie ? Un dépôt privé à votre nom garde vos changements et vous laisse récupérer les nouveautés.');
    case 'courriels':
      return t('Je peux écrire à vos clients et vous envoyer un point chaque matin. On règle l’envoi des courriels maintenant ou plus tard ?');
    case 'espace-client':
      return t('Vos clients peuvent avoir un espace à eux pour déposer leurs demandes et suivre leur avancement. On l’ouvre ?');
    case 'competences':
      return t('Une compétence est un mode d’emploi que vos agents suivent. Vous partez sans aucune : choisissez-en dans les bibliothèques publiques, les vôtres s’écriront au fil du travail.');
    case 'facultatif':
      return t('Dernière étape : quelques fonctions en plus, aucune n’est nécessaire. Tout se retrouve ensuite dans les réglages.');
  }
}

type EtatDesParoles = { statut: 'attente' | 'ecriture' | 'pretes' | 'echec'; paroles: ParolesDeLaMiseEnRoute };

/**
 * LES PAROLES DU MOTEUR : demandées une fois dès qu'un moteur répond, gardées pour la séance. Le démon les garde
 * aussi : un rechargement ne repaie rien.
 */
function useParoles(moteurPret: boolean): EtatDesParoles {
  const [langue] = useLangueGenerale();
  const [etat, setEtat] = React.useState<EtatDesParoles>({ statut: 'attente', paroles: {} });
  React.useEffect(() => {
    if (!moteurPret || etat.statut !== 'attente') return;
    setEtat({ statut: 'ecriture', paroles: {} });
    client
      .call<{ ok: boolean; paroles?: ParolesDeLaMiseEnRoute }>({ type: 'installation.paroles', langue }, 120_000)
      .then((r) => setEtat(r.ok && r.paroles ? { statut: 'pretes', paroles: r.paroles } : { statut: 'echec', paroles: {} }))
      .catch(() => setEtat({ statut: 'echec', paroles: {} }));
  }, [moteurPret, etat.statut, langue]);
  return etat;
}

/** Une impulsion par lettre posée, qui retombe d'elle-même : c'est le niveau que lit l'orbe à chaque image. */
function useImpulsions() {
  const pic = React.useRef(0);
  const dernier = React.useRef(0);
  const niveau = React.useCallback(() => {
    const ecoule = performance.now() - dernier.current;
    return pic.current * Math.exp(-ecoule / 260);
  }, []);
  const tic = React.useCallback(() => {
    const actuel = niveau();
    pic.current = Math.min(0.6, actuel * 0.9 + 0.14);
    dernier.current = performance.now();
  }, [niveau]);
  return { niveau, tic };
}

const mouvementReduit = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function AssistantDemarrage({ assistant }: { assistant: EtatDeLAssistant }) {
  useVoileAffiche();
  const state = useApp();
  const { etat, relire } = useEtatDeLInstallation();
  const relais = useEtatDuRelais();
  const hebergee = state.offreHebergee;
  const etapes = etapesDeLaDiscussion(hebergee);
  const enCours = questionEnCours(assistant, hebergee);
  const nom = nomDeLAssistant(state.settings);
  const prenom = state.monCompte?.prenom ?? '';
  const moteurPret = auMoinsUnMoteurEnLigne(state.engines, state.quotas);
  const githubRelie = Boolean(etat?.github?.connecte);
  const paroles = useParoles(moteurPret);
  const { niveau, tic } = useImpulsions();
  const travail = useTravailDInstallation();

  const [envoi, setEnvoi] = React.useState<'faite' | 'passee' | null>(null);
  const [assistantPret, setAssistantPret] = React.useState(false);
  const [ordinateurPret, setOrdinateurPret] = React.useState(false);
  const surEtatDeLAssistant = React.useCallback((e: EtatDeVotreAssistant) => setAssistantPret(e.pret), []);

  /* Les bulles déjà écrites pendant cette séance : elles ne se réécrivent pas à chaque rendu. Celles des étapes
     vues avant un rechargement s'affichent d'un coup. */
  const ecrites = React.useRef<Set<string>>(new Set(Object.keys(assistant.etapes).concat('ouverture')));
  const [, forcer] = React.useReducer((n: number) => n + 1, 0);
  const finiDEcrire = React.useCallback((cle: string) => {
    if (ecrites.current.has(cle)) return;
    ecrites.current.add(cle);
    forcer();
  }, []);

  /* Une question attend les paroles du moteur, quelques secondes au plus. */
  const [delaiEcoule, setDelaiEcoule] = React.useState(false);
  React.useEffect(() => {
    if (paroles.statut !== 'ecriture') return;
    const minuterie = window.setTimeout(() => setDelaiEcoule(true), ATTENTE_DES_PAROLES_MS);
    return () => window.clearTimeout(minuterie);
  }, [paroles.statut]);
  const attendLesParoles = enCours !== 'moteurs' && enCours !== 'fin' && paroles.statut === 'ecriture' && !delaiEcoule;

  const parole = (etape: EtapeDeLAssistant) => paroleAvecPrenom(paroles.paroles[etape] || paroleEcriteDAvance(etape, nom), prenom);

  const peutValider =
    enCours === 'moteurs'
      ? moteurPret
      : enCours === 'projet'
        ? githubRelie
        : enCours === 'assistant'
          ? assistantPret
          : enCours === 'ordinateur'
            ? ordinateurPret
            : true;

  const repondre = async (issue: 'faite' | 'passee') => {
    if (enCours === 'fin') return;
    setEnvoi(issue);
    try {
      await client.call({ type: 'installation.etape', etape: enCours, issue });
      const reste = etapes.slice(etapes.indexOf(enCours) + 1).some((e) => !assistant.etapes[e]);
      if (!reste) client.pushToast('success', t('Installation terminée. Tout se retrouve dans Réglages, page « Installation ».'));
    } catch (err) {
      client.pushToast('error', (err as Error)?.message || t('L’étape n’a pas pu être enregistrée.'));
    } finally {
      setEnvoi(null);
    }
  };

  /* Les étapes déjà passées, puis la question en cours. */
  const visibles = etapes.slice(0, enCours === 'fin' ? etapes.length : etapes.indexOf(enCours) + 1);
  const ouvertureEcrite = ecrites.current.has('ouverture');
  const enEcriture = !attendLesParoles && enCours !== 'fin' && !ecrites.current.has(enCours);
  /* Un outil s'installe sur le serveur : Beluga travaille, ce n'est pas à vous. */
  const humeur = envoi || attendLesParoles || travail?.etat === 'en-cours' ? 'thinking' : enEcriture ? 'speaking' : 'idle';
  const aVous = humeur === 'idle' && enCours !== 'fin';

  /* La mise en route occupe l'écran seule : le bouton du bord et le rond du terminal s'effacent (`styles.css`). */
  React.useEffect(() => {
    document.documentElement.setAttribute('data-mise-en-route', '');
    return () => document.documentElement.removeAttribute('data-mise-en-route');
  }, []);

  /* Le fil descend tout seul à chaque nouvelle bulle. */
  const finDuFil = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    // Après la mise en page : le terminal qui s'ouvre réduit le fil, le bas de la question (« Valider ») reste en vue.
    const minuterie = window.setTimeout(
      () => finDuFil.current?.scrollIntoView({ block: 'end', behavior: mouvementReduit() ? 'auto' : 'smooth' }),
      220,
    );
    return () => window.clearTimeout(minuterie);
  }, [enCours, attendLesParoles, enEcriture, ouvertureEcrite, travail?.etat]);

  return (
    <TerminalACote.Provider value>
    <div
      data-assistant-demarrage="1"
      data-etape={enCours}
      data-paroles={paroles.statut}
      /* SOUS les fenêtres (`z-50`) et les messages passagers : la fenêtre d'ajout de projet et les connexions de
         compte s'ouvrent par-dessus. */
      className="fixed inset-0 z-[45] flex flex-col bg-bg"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <ZoneDefilement className="min-h-0 flex-1" fond="hsl(var(--bg))">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-4 pb-6 pt-8 sm:pt-12" data-fil-de-mise-en-route>
          <BulleDeBeluga
            cle="ouverture"
            texte={t('Bonjour ! Je suis {v0}. Je vais mettre Beluga Build en route avec vous, une question à la fois.', { v0: nom })}
            ecrire={!ecrites.current.has('ouverture')}
            tic={tic}
            fini={finiDEcrire}
          />
          {ouvertureEcrite
            ? visibles.map((etape) => {
                const issue = assistant.etapes[etape];
                const courante = etape === enCours;
                if (courante && attendLesParoles) return <BulleQuiReflechit key={etape} />;
                const ecrite = ecrites.current.has(etape);
                return (
                  <React.Fragment key={etape}>
                    <BulleDeBeluga cle={etape} texte={parole(etape)} ecrire={courante && !ecrite} tic={tic} fini={finiDEcrire} />
                    {issue ? (
                      <BulleDeLaPersonne etape={etape} issue={issue} nom={nom} prenom={prenom} />
                    ) : courante && ecrite ? (
                      <CarteDeQuestion
                        etape={etape}
                        envoi={envoi}
                        peutValider={peutValider}
                        repondre={repondre}
                        raison={
                          enCours === 'moteurs' && !moteurPret
                            ? t('Il faut au moins un moteur prêt pour continuer.')
                            : enCours === 'projet' && !githubRelie
                              ? t('Reliez GitHub pour continuer : c’est par lui que vos projets se récupèrent et se sauvegardent.')
                              : enCours === 'assistant' && !assistantPret
                                ? t('Donnez votre prénom et un nom que l’assistant entendra pour continuer.')
                                : enCours === 'ordinateur' && !ordinateurPret
                                  ? t('Terminez l’installation, ou choisissez « Plus tard ».')
                                  : null
                        }
                      >
                        <ContenuDeLaQuestion
                          etape={etape}
                          etat={etat}
                          relire={relire}
                          githubRelie={githubRelie}
                          surEtatDeLAssistant={surEtatDeLAssistant}
                          surOrdinateurPret={setOrdinateurPret}
                          partage={Boolean(relais?.joint)}
                        />
                      </CarteDeQuestion>
                    ) : null}
                  </React.Fragment>
                );
              })
            : null}
          <div ref={finDuFil} />
        </div>
      </ZoneDefilement>

      {/* L'AGENT, EN BAS : l'orbe à la place du champ d'écriture, et ce qu'il fait en ce moment. */}
      <div className="flex shrink-0 flex-col items-center gap-1.5 pb-3 pt-2" data-pied-de-mise-en-route>
        <OrbeDeLAgent level={niveau} mood={humeur} className="w-20 sm:w-28" />
        <p className="flex items-center gap-1.5 text-[13px]" data-a-vous={aVous ? '1' : '0'}>
          <span className="font-medium text-text">{nom}</span>
          <span className="text-faint">·</span>
          {aVous ? (
            <span style={{ color: 'hsl(var(--cadre-question))' }}>{t('à vous')}</span>
          ) : humeur === 'thinking' ? (
            <span className="text-muted">{t('réfléchit…')}</span>
          ) : humeur === 'speaking' ? (
            <span className="text-muted">{t('écrit…')}</span>
          ) : (
            <span className="text-muted">{t('c’est prêt')}</span>
          )}
        </p>
      </div>

      {/* CE QUI SE PASSE SUR LE SERVEUR : collé sous l'orbe, dans le flux — en s'ouvrant il remonte l'écran, il ne
          recouvre jamais un bouton. */}
      <BarreDuTerminal />
      {travail ? null : <div className="shrink-0" style={{ height: 'var(--pied-natif, calc(env(safe-area-inset-bottom) + var(--marche-du-bas, 0px)))' }} />}
    </div>
    </TerminalACote.Provider>
  );
}

/**
 * UNE BULLE DE BELUGA. Écrite lettre à lettre la première fois (chaque lettre fait monter la fumée de l'orbe),
 * d'un coup ensuite ou si moins d'animations est demandé.
 */
function BulleDeBeluga({
  cle,
  texte,
  ecrire,
  tic,
  fini,
}: {
  cle: string;
  texte: string;
  ecrire: boolean;
  tic: () => void;
  fini: (cle: string) => void;
}) {
  const [montre, setMontre] = React.useState(ecrire && !mouvementReduit() ? 0 : texte.length);
  React.useEffect(() => {
    if (!ecrire) return;
    if (mouvementReduit()) {
      setMontre(texte.length);
      fini(cle);
      return;
    }
    let pose = 0;
    let derniere = performance.now();
    let raf = 0;
    const pas = (maintenant: number) => {
      const avance = Math.max(1, Math.round(((maintenant - derniere) / 1000) * LETTRES_PAR_SECONDE));
      derniere = maintenant;
      pose = Math.min(texte.length, pose + avance);
      setMontre(pose);
      tic();
      if (pose >= texte.length) {
        fini(cle);
        return;
      }
      raf = requestAnimationFrame(pas);
    };
    raf = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(raf);
    // Le texte d'une bulle ne change plus une fois son écriture partie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecrire]);
  const affiche = ecrire ? texte.slice(0, montre) : texte;
  return (
    <div className="flex justify-start" data-bulle-de-beluga={cle}>
      <p className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-surface px-3.5 py-2.5 text-[14.5px] leading-relaxed text-text">
        {affiche}
        {ecrire && montre < texte.length ? <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-faint align-middle" /> : null}
      </p>
    </div>
  );
}

/** Beluga réfléchit (les paroles du moteur sont en route) : une silhouette de bulle, jamais un vide. */
function BulleQuiReflechit() {
  return (
    <div className="flex justify-start" data-bulle-qui-reflechit>
      <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface px-3.5 py-3.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-faint" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </span>
    </div>
  );
}

/** Ce que la personne a répondu, en une bulle à droite. */
function BulleDeLaPersonne({
  etape,
  issue,
  nom,
  prenom,
}: {
  etape: EtapeDeLAssistant;
  issue: 'faite' | 'passee';
  nom: string;
  prenom: string;
}) {
  const state = useApp();
  let texte: string;
  if (issue === 'passee') texte = t('Plus tard.');
  else if (etape === 'moteurs') {
    const prets = moteursDeLAssistant(state.engines, state.quotas).filter((m) => m.etape === 'pret').map((m) => m.label);
    texte = prets.length ? t('{v0} est relié.', { v0: prets.join(', ') }) : t('C’est relié.');
  } else if (etape === 'bienvenue') texte = t('On y va !');
  else if (etape === 'assistant') texte = prenom ? t('Appelez-moi {v0}, et vous serez {v1}.', { v0: prenom, v1: nom }) : t('Vous serez {v0}.', { v0: nom });
  else texte = t('C’est réglé.');
  return (
    <div className="flex justify-end" data-bulle-de-la-personne={etape} data-issue={issue}>
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-raised px-3.5 py-2 text-[14.5px] leading-relaxed text-text">{texte}</p>
    </div>
  );
}

/**
 * LA QUESTION POSÉE : un cadre de question (le jaune des réponses attendues), son contenu, puis son pied —
 * « Plus tard » quand c'est permis, et « Valider ».
 */
function CarteDeQuestion({
  etape,
  envoi,
  peutValider,
  repondre,
  raison,
  children,
}: {
  etape: EtapeDeLAssistant;
  envoi: 'faite' | 'passee' | null;
  peutValider: boolean;
  repondre: (issue: 'faite' | 'passee') => void;
  raison: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="cadre-de-question rounded-2xl bg-surface" data-question={etape}>
      <div className="px-3.5 pb-1 pt-3.5 sm:px-4">{children}</div>
      <footer className="flex flex-wrap items-center gap-2 px-3.5 pb-3.5 pt-3 sm:px-4">
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-faint">{raison}</span>
        {etapePassable(etape) ? (
          <Button variant="ghost" size="md" data-assistant-plus-tard disabled={envoi !== null} onClick={() => repondre('passee')}>
            {envoi === 'passee' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {t('Plus tard')}
          </Button>
        ) : null}
        <Button variant="default" size="md" data-assistant-continuer disabled={!peutValider || envoi !== null} onClick={() => repondre('faite')}>
          {envoi === 'faite' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {etape === 'bienvenue' ? t('C’est parti') : etape === 'facultatif' ? t('Terminer') : t('Valider')}
        </Button>
      </footer>
    </section>
  );
}

function ContenuDeLaQuestion({
  etape,
  etat,
  relire,
  githubRelie,
  surEtatDeLAssistant,
  surOrdinateurPret,
  partage,
}: {
  etape: EtapeDeLAssistant;
  etat: EtatDeLInstallation | null;
  relire: () => Promise<void>;
  githubRelie: boolean;
  surEtatDeLAssistant: (e: EtatDeVotreAssistant) => void;
  surOrdinateurPret: (pret: boolean) => void;
  partage: boolean;
}) {
  switch (etape) {
    case 'moteurs':
      return <ChoixDuMoteur />;
    case 'bienvenue':
      return <SectionMemoire etat={etat} relire={relire} />;
    case 'assistant':
      return <SectionVotreAssistant surEtat={surEtatDeLAssistant} sansVoix />;
    case 'ordinateur':
      /* Le MÊME parcours que Réglages › Extension, sans fenêtre : « Plus tard » et « Valider » restent ceux de la carte. */
      return <ParcoursDInstallation integre surFini={surOrdinateurPret} onTerminer={() => {}} />;
    case 'domaine':
      return <SectionDomaine etat={etat} relire={relire} />;
    case 'projet':
      return (
        <div className="space-y-5">
          <SectionGitHub etat={etat} relire={relire} />
          {/* Le premier projet N'APPARAÎT qu'une fois GitHub relié : sans lui, rien à récupérer. */}
          {githubRelie ? <PremierProjet /> : null}
        </div>
      );
    case 'copie':
      return <SectionCopie etat={etat} relire={relire} />;
    case 'courriels':
      return <SectionCourriels etat={etat} relire={relire} />;
    case 'espace-client':
      return <SectionEspaceClient etat={etat} relire={relire} />;
    case 'competences':
      return <SectionCompetences etat={etat} relire={relire} />;
    case 'facultatif':
      return (
        <>
          <SectionFacultatif etat={etat} relire={relire} />
          {/* L'ACCORD DU PARTAGE DE L'ADRESSE se demande ici, à l'installation (décision du 20/10/2026). */}
          {partage ? (
            <div className="mt-6 space-y-2" data-assistant-partage>
              <p className="text-[14px] font-medium text-text">{t('Ce que l’équipe Beluga reçoit')}</p>
              <SectionPartage />
            </div>
          ) : null}
        </>
      );
  }
}

/**
 * LE CHOIX DU MOTEUR : les moteurs du registre en lignes à choisir ; le moteur choisi déplie ses deux gestes
 * (installer l'outil, connecter un compte) dans la bulle. Un moteur déjà prêt est choisi d'office.
 */
function ChoixDuMoteur() {
  const state = useApp();
  const moteurs = moteursDeLAssistant(state.engines, state.quotas);
  const pret = moteurs.find((m) => m.etape === 'pret');
  const [choisi, setChoisi] = React.useState<EngineId | null>(pret?.id ?? null);
  React.useEffect(() => {
    if (!choisi && pret) setChoisi(pret.id);
  }, [choisi, pret]);
  const moteur = moteurs.find((m) => m.id === choisi);
  return (
    <div className="space-y-3" data-choix-du-moteur>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {moteurs.map((m) => (
          <button
            key={m.id}
            type="button"
            data-choix-moteur={m.id}
            aria-pressed={m.id === choisi}
            onClick={() => setChoisi(m.id)}
            className={cn(
              'flex h-11 items-center gap-2 rounded-lg px-3 text-left text-[14px] transition-colors',
              m.id === choisi ? 'bg-raised font-medium text-text' : 'bg-bg text-muted hover:bg-raised hover:text-text',
            )}
          >
            <IconeMoteur engine={m.id} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{m.label}</span>
            {m.etape === 'pret' ? <Check className="h-3.5 w-3.5 shrink-0 text-success" /> : null}
          </button>
        ))}
      </div>
      {moteur ? (
        <div className="space-y-2" data-moteur-choisi={moteur.id}>
          <CarteMoteur moteur={moteur} />
          <BoutonRelireLesMoteurs />
        </div>
      ) : (
        <p className="text-[13px] text-muted">{t('Choisissez un moteur : vous pourrez en ajouter d’autres plus tard.')}</p>
      )}
      {moteur && moteur.etape !== 'pret' && moteurs.some((m) => m.etape === 'pret') ? (
        <Badge tone="success">{t('Un autre moteur est déjà prêt.')}</Badge>
      ) : null}
    </div>
  );
}

/**
 * LE PREMIER PROJET. La fenêtre d'ajout existe déjà dans la colonne des projets : on la fait ouvrir, par-dessus
 * la mise en route, plutôt que d'en écrire une seconde qui dériverait de la première.
 */
function PremierProjet() {
  const state = useApp();
  const nombre = state.projects.length;
  return (
    <div className="space-y-2" data-premier-projet>
      <p className="text-[14px] font-medium text-text">{t('Votre premier projet')}</p>
      {nombre ? (
        <LigneDEtat fait>{t('{n} projet(s) inscrit(s).', { n: String(nombre) })}</LigneDEtat>
      ) : (
        <LigneDEtat fait={false}>{t('Aucun projet inscrit.')}</LigneDEtat>
      )}
      <Button variant="subtle" size="md" data-ajouter-premier-projet onClick={() => window.dispatchEvent(new Event('beluga:ajouter-projet'))}>
        <FolderPlus className="h-3.5 w-3.5" />
        {nombre ? t('Ajouter un autre projet') : t('Ajouter mon premier projet')}
      </Button>
    </div>
  );
}
