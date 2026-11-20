import * as React from 'react';
import { EtatVideDuProjet, useChoixDeLaPortee, useFiltreCentral, useProjetDeLObjetOuvert, useProjetDuService as useProjetDuServiceBrut } from '@/components/projet-du-service';
import { AccueilDeCommunication } from './accueil-de-communication';
import { CalendarDays, Flag, Inbox, Link2, Loader2, Megaphone, Plus, Radio } from '@/components/ui/icones';
import { PAGE_D_OUVERTURE_V2, cheminCommunicationV2, lireCheminCommunicationV2, pageAccessibleV2, type GenreDeCoulisses, type PageCommunicationV2 } from '@beluga/shared';
import { BoutonPrincipal, CranDuFil, GestePrincipal, OptionDePage, OptionsDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { useDeclarerLeProjetDuHaut } from '@/components/haut-du-telephone';
import { useDeclarerLeNiveauDuBas, useDeclarerLesGestesDuBas, type GestesDuBas } from '@/components/menu-du-bas';
import { TOUS_LES_PROJETS } from '@/components/menus-de-la-colonne';
import { SilhouetteMarketing, SilhouetteTableauDeService } from '@/components/silhouettes';
import { Dialog } from '@/components/ui';
import { useLecture } from '@/components/communication-v2/socle/pieces';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { adresseV2, ContexteV2, type Cibles, type EtatDesCoulisses, type MarqueV2, type OutilsV2 } from './contexte';
import { PageCanaux } from './page-canaux';
import { PageReglagesDesCanaux } from './page-reglages-canaux';
import { PageConnexion } from './page-connexion';
import { PageCampagnes } from './page-campagnes';
import { PageReponses } from './page-reponses';

/**
 * COMMUNICATION 2 — SIMPLE ET LIMPIDE (carte du 08/11/2026, décisions de l'utilisateur au cadrage).
 *
 * Un NOUVEL espace à côté de l'actuel, sur les MÊMES données (marques, campagnes, publications, messages) : l'actuel
 * n'est ni modifié ni retiré. À gauche, la marque (son menu pour en changer), puis QUATRE ÉTAPES NUMÉROTÉES (Réseaux, Campagnes, Connexion, Calendrier, 09/11/2026), cochées
 * une fois faites — Canaux, Campagnes, Calendrier —, un trait, et « Réponses » (l'étape « Plan marketing » et l'outil
 * Marketing sont sortis du parcours le 08/11/2026). Au centre, la page de
 * l'étape. AUCUN chef flottant, aucune conversation générale : chaque page a son champ, et la demande part au chef de
 * la marque EN COULISSES (`communication.coulisses`) ; ce qu'il prépare se dit en violet, à l'endroit même.
 *
 * Adresse : `#communication2/<marque>/<page>/<élément…>` (`shared/src/communication-v2.ts`). Sans page, la marque
 * s'ouvre sur ses campagnes (`PAGE_D_OUVERTURE_V2`).
 */
const nomsDesPages = (): Record<PageCommunicationV2, string> => ({
  canaux: t('Réseaux'),
  campagnes: t('Campagnes'),
  connexion: t('Connexion'),
  calendrier: t('Calendrier'),
  reponses: t('Réponses'),
});

const ICONES: Record<PageCommunicationV2, typeof Radio> = { canaux: Radio, campagnes: Flag, connexion: Link2, calendrier: CalendarDays, reponses: Inbox };

/** L'ÉTAT DES COULISSES DE LA MARQUE : relu à chaque diffusion, et toutes les trois secondes tant que le chef travaille. */
function useCoulisses(marqueId: string | null): EtatDesCoulisses | null {
  const version = useApp().communicationVersion;
  const [etat, setEtat] = React.useState<EtatDesCoulisses | null>(null);
  const [tic, setTic] = React.useState(0);
  React.useEffect(() => setEtat(null), [marqueId]);
  React.useEffect(() => {
    if (!marqueId) return;
    let vivant = true;
    client
      .call<EtatDesCoulisses>({ type: 'communication.coulisses.etat', marqueId } as never)
      .then((r) => vivant && setEtat(r))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [marqueId, version, tic]);
  const enCours = !!etat?.enCours;
  React.useEffect(() => {
    if (!enCours) return;
    const id = window.setInterval(() => setTic((n) => n + 1), 3000);
    return () => window.clearInterval(id);
  }, [enCours]);
  return etat;
}

export function Communication2({
  vise,
  onVise,
  onOuvrirCarte,
}: {
  vise: string | null;
  onVise: (chemin: string | null) => void;
  onOuvrirCarte?: (cardId: string, projectId: string) => void;
}) {
  const telephone = useTelephone();
  const { donnees, erreur } = useLecture<{ marques: MarqueV2[] }>({ type: 'communication.marques' }, []);
  const marques = donnees?.marques ?? null;
  const emplacement = React.useMemo(() => lireCheminCommunicationV2(vise), [vise]);
  const marque = emplacement.marqueId ? (marques?.find((m) => m.id === emplacement.marqueId) ?? null) : null;
  /* SANS PAGE, LA MARQUE S'OUVRE TOUJOURS SUR SES CAMPAGNES (décision du 12/11/2026, `PAGE_D_OUVERTURE_V2`). */
  const demandee: PageCommunicationV2 | null = marque ? (emplacement.page ?? PAGE_D_OUVERTURE_V2) : null;
  /* LES ÉTAPES S'OUVRENT DANS L'ORDRE (08/11/2026, `pageAccessibleV2`) : une adresse vers une étape encore fermée
     ouvre l'étape à terminer d'abord — et l'adresse se corrige (plus bas), pour qu'un retour arrière n'y ramène pas.
     LE CALENDRIER N'EST PLUS UNE PAGE (20/11/2026) : c'est un volet de chaque campagne ; « …/calendrier » mène aux
     campagnes du projet. */
  const lue: PageCommunicationV2 | null = demandee === 'calendrier' ? 'campagnes' : demandee;
  const page: PageCommunicationV2 | null = marque && lue ? pageAccessibleV2(lue, marque.v2) : lue;
  /* Une ANCIENNE adresse (la page « plan », l'étape « Réseaux » nue, le calendrier) se lit sur les campagnes : elle se
     corrige aussi. */
  const pageEcrite = String(vise ?? '').split('/').filter(Boolean)[1];
  const redirigee = !!marque && !!emplacement.page && (page !== emplacement.page || pageEcrite !== emplacement.page);
  const element = redirigee ? [] : (emplacement.element ?? []);
  const coulisses = useCoulisses(marque?.id ?? null);
  /* Une CAMPAGNE ouverte (objet réel, en onglet) se range sous un projet de SA marque. */
  useProjetDeLObjetOuvert(marque && element.length ? marque.projets.map((p) => p.id) : null);
  /* LE NOM DE LA CAMPAGNE OUVERTE, pour le fil d'Ariane : déclaré par sa page (qui l'a déjà lu), effacé en la quittant. */
  const [titreDeLaCampagne, setTitreDeLaCampagne] = React.useState<string | null>(null);

  /*
   * LE PROJET DE LA PAGE (décision du 20/11/2026, « le service, ensuite le projet, puis la fiche ») :
   *  - DANS UNE PAGE DE SERVICE, c'est la PORTÉE (« Tous les projets », ou un projet, écrite dans l'adresse) : le fil
   *    de l'application en fait son second cran. Ouvrir la marque d'un projet règle la portée sur ce projet ; choisir un
   *    autre projet au chevron ouvre SA marque ; revenir à « Tous les projets » ramène à la liste des projets.
   *  - DANS L'ONGLET D'UN PROJET, c'est ce projet : sa marque s'ouvre d'elle-même.
   */
  const choisirLaPortee = useChoixDeLaPortee();
  const filtreCentral = useFiltreCentral();
  const projetDuServiceBrut = useProjetDuServiceBrut();
  const enPageDeService = !!choisirLaPortee && filtreCentral;
  const portee = enPageDeService ? (projetDuServiceBrut?.id ?? TOUS_LES_PROJETS) : null;
  const projetCible = enPageDeService ? projetDuServiceBrut : filtreCentral ? null : projetDuServiceBrut;
  const marqueDuProjet = projetCible ? (marques?.find((m) => m.projets.some((p) => p.id === projetCible.id)) ?? null) : null;
  React.useEffect(() => {
    if (!marqueDuProjet) return;
    if (!emplacement.marqueId || (enPageDeService && emplacement.marqueId !== marqueDuProjet.id && marques?.some((m) => m.id === emplacement.marqueId))) {
      onVise(cheminCommunicationV2({ marqueId: marqueDuProjet.id }));
    }
  }, [marqueDuProjet, emplacement.marqueId, enPageDeService, marques, onVise]);
  /* Une marque ouverte sur « Tous les projets » (un clic dans la liste, une adresse) : la portée devient son projet, et
     le fil dit « Communication / <projet> ». Revenir à « Tous les projets » (le nom du service, le chevron du projet)
     ramène à la liste des projets : c'est le fil qui le fait (`onTousLesProjets`). */
  React.useEffect(() => {
    if (!enPageDeService || portee !== TOUS_LES_PROJETS || !marque?.projets.length) return;
    choisirLaPortee?.(marque.projets[0]!.id);
  }, [portee, enPageDeService, marque, choisirLaPortee]);
  const aller = React.useCallback(
    (p?: PageCommunicationV2, ...el: string[]) => {
      if (!marque) return;
      onVise(cheminCommunicationV2({ marqueId: marque.id, ...(p ? { page: p } : {}), element: el }));
    },
    [marque, onVise],
  );
  const demander = React.useCallback(
    async (genre: GenreDeCoulisses, texte?: string, cibles?: Cibles) => {
      if (!marque) return false;
      try {
        await client.call({ type: 'communication.coulisses', marqueId: marque.id, genre, ...(texte ? { texte } : {}), ...(cibles?.campagneId ? { campagneId: cibles.campagneId } : {}), ...(cibles?.contenuId ? { contenuId: cibles.contenuId } : {}), ...(cibles?.messageId ? { messageId: cibles.messageId } : {}) } as never);
        return true;
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Demande non envoyée'));
        return false;
      }
    },
    [marque],
  );
  React.useEffect(() => {
    if (redirigee && marque && page) onVise(cheminCommunicationV2({ marqueId: marque.id, page }));
  }, [redirigee, marque, page, onVise]);
  const outils = React.useMemo<OutilsV2 | null>(() => (marque && page ? { marque, page, aller, coulisses, demander, declarerLaCampagne: setTitreDeLaCampagne, ...(onOuvrirCarte ? { ouvrirCarte: onOuvrirCarte } : {}) } : null), [marque, page, aller, coulisses, demander, onOuvrirCarte]);

  /* LA LISTE DES PROJETS : « Tous les projets » d'abord, puis l'accueil. */
  const versLesProjets = () => {
    if (enPageDeService && portee !== TOUS_LES_PROJETS) choisirLaPortee?.(TOUS_LES_PROJETS);
    onVise(null);
  };
  /* LE TÉLÉPHONE : la flèche de la barre d'en-tête remonte d'un cran — la fiche, puis les campagnes du projet, puis la
     liste des projets. */
  const retour = () => {
    if (marque && page === 'campagnes' && element[0] && element[0] !== 'nouvelle' && element.length > 1) return aller(page, element[0]);
    if (marque && page && (element.length || page !== 'campagnes')) return aller('campagnes');
    return versLesProjets();
  };
  useDeclarerLeProjetDuHaut(null);
  useDeclarerLeNiveauDuBas(telephone && marque ? 'communication2-marque' : null);
  const gestesDuBas = React.useMemo<GestesDuBas | null>(() => {
    if (!telephone || !marque) return null;
    const noms = nomsDesPages();
    const geste = (p: PageCommunicationV2) => {
      const Icone = ICONES[p];
      /* Une étape encore fermée garde sa place au menu du bas, mais le geste ouvre l'étape à terminer d'abord. */
      return { libelle: noms[p], icone: <Icone />, actif: page === p && !element.length, onClick: () => aller(pageAccessibleV2(p, marque.v2)), ...(p === 'reponses' && marque.messages ? { compte: marque.messages } : {}) };
    };
    return { 'v2-campagnes': geste('campagnes'), 'v2-connexion': geste('connexion'), 'v2-reponses': geste('reponses') };
  }, [telephone, marque, page, element.length, aller]);
  useDeclarerLesGestesDuBas(gestesDuBas);

  const campagneOuverte = page === 'campagnes' && !!element[0] && element[0] !== 'nouvelle';
  /* LES CRANS QUE COMMUNICATION ÉCRIT APRÈS « Service / Projet » : la page quand ce n'est pas la liste des campagnes
     (Connexion, Réponses, Réseaux), puis la fiche (la campagne, une nouvelle campagne, les réglages avancés). */
  const nomDeLaPage = page && page !== 'campagnes' ? nomsDesPages()[page] : null;
  const crans =
    marque && page ? (
      <>
        {nomDeLaPage ? (
          <CranDuFil dernier={!element.length} {...(element.length ? { adresse: adresseV2(marque.id, page), onClick: () => aller(page) } : {})} data-v2-cran={page}>
            {nomDeLaPage}
          </CranDuFil>
        ) : null}
        {page === 'canaux' && element[0] === 'reglages' ? <CranDuFil data-v2-cran-reglages>{t('Réglages avancés')}</CranDuFil> : null}
        {page === 'campagnes' && element[0] === 'nouvelle' ? <CranDuFil data-v2-cran-campagne="nouvelle">{t('Nouvelle campagne')}</CranDuFil> : null}
        {campagneOuverte && titreDeLaCampagne ? <CranDuFil data-v2-cran-campagne={element[0]}>{titreDeLaCampagne}</CranDuFil> : null}
      </>
    ) : null;
  const aDesCrans = !!marque && (!!nomDeLaPage || element.length > 0);

  /* UN PROJET SANS MARQUE se voit proposer de créer la sienne ; le temps que la marque du projet s'ouvre, une silhouette. */
  const enAttenteDeLaMarqueDuProjet =
    !!projetCible &&
    (enPageDeService
      ? marques === null || (!!marqueDuProjet && emplacement.marqueId !== marqueDuProjet.id)
      : !emplacement.marqueId && (marques === null || !!marqueDuProjet));
  const projetSansMarque = !!projetCible && marques !== null && !marqueDuProjet && (enPageDeService || !emplacement.marqueId);
  const contenu =
    projetSansMarque && projetCible ? (
      <CreerLaMarqueDuProjet projet={projetCible} marques={marques} onCree={(id) => onVise(cheminCommunicationV2({ marqueId: id }))} />
    ) : enAttenteDeLaMarqueDuProjet ? (
      <div className="w-full p-6">
        <SilhouetteMarketing />
      </div>
    ) : marque && page && outils ? (
      <ContexteV2.Provider value={outils}>
        <PageDeLaMarque key={marque.id} page={page} element={element} />
      </ContexteV2.Provider>
    ) : emplacement.marqueId && marques && !marque ? (
      <div className="p-6 text-[13.5px] text-muted" data-v2-marque-absente>
        {t('Cette marque n’existe plus, ou elle ne vous est pas ouverte.')}
      </div>
    ) : (
      /* L'ACCUEIL : LES PROJETS QUI COMMUNIQUENT (20/11/2026). */
      <AccueilDeCommunication marques={marques} erreur={erreur} onVise={onVise} />
    );

  return (
    <Dialog open modal={false}>
      {/* LA SUITE DU FIL EST POSÉE HORS DE LA RANGÉE DE LA PAGE (capture #fe29) : elle monte dans la barre, et ne peut plus
          tomber au milieu de l'écran. Rien à écrire sur la liste des campagnes : « Service / Projet » suffit — sauf sur
          téléphone, où la flèche du haut en a besoin pour remonter à la liste des projets. */}
      {marque && (aDesCrans || telephone) ? (
        <SuiteDuFil onRacine={() => aller()} retour={{ action: retour, reperes: { 'data-v2-retour': '' } }}>
          {crans}
        </SuiteDuFil>
      ) : null}
      {/* LE MENU « … » D'UN PROJET (20/11/2026) : ses comptes reliés et les réponses reçues hors d'une campagne. */}
      {marque && page && !element.length ? (
        <OptionsDePage enMenu>
          <OptionDePage icone={<Link2 className="h-3.5 w-3.5" />} onClick={() => aller('connexion')} data-v2-option="connexion">
            {t('Comptes reliés')}
          </OptionDePage>
          <OptionDePage icone={<Inbox className="h-3.5 w-3.5" />} onClick={() => aller('reponses')} data-v2-option="reponses">
            {marque.messages ? t('Réponses ({n})', { n: marque.messages }) : t('Réponses')}
          </OptionDePage>
        </OptionsDePage>
      ) : null}
      <div className="flex h-full min-h-0 w-full" data-communication2 data-v2-page={page ?? 'marques'} data-v2-marque={marque?.id ?? ''}>
        {/* LA PAGE D'UNE CAMPAGNE OUVERTE PREND TOUTE LA LARGEUR : son suivi se colle au bord droit, et la conversation se
            centre dans le reste. Les autres pages gardent leur plafond de 1320 px. */}
        <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !telephone && 'items-center')} data-v2-main>
          <div className={cn('flex min-h-0 w-full flex-1 flex-col', !telephone && !campagneOuverte && 'max-w-[1320px]')} data-v2-pleine-largeur={campagneOuverte ? '' : undefined}>
            {contenu}
          </div>
        </main>
      </div>
    </Dialog>
  );
}

/**
 * UN PROJET SANS MARQUE (décision du 13/11/2026) : un message court, et le geste qui crée la marque du projet — son nom
 * et son logo, rattachée à lui (`communication.marque.creer`, origine « projets »). Créée, elle s'ouvre sur ses
 * campagnes dès que la liste des marques la contient. Sur ordinateur le geste est en bas, pleine largeur ; sur
 * téléphone, sous le message.
 */
function CreerLaMarqueDuProjet({ projet, marques, onCree }: { projet: { id: string; name: string }; marques: MarqueV2[] | null; onCree: (marqueId: string) => void }) {
  const telephone = useTelephone();
  const [enCours, setEnCours] = React.useState(false);
  const [creee, setCreee] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (creee && marques?.some((m) => m.id === creee)) onCree(creee);
  }, [creee, marques, onCree]);
  const creer = async () => {
    if (enCours) return;
    setEnCours(true);
    try {
      const { marque } = await client.call<{ marque: { id: string } }>({ type: 'communication.marque.creer', nom: projet.name, origine: 'projets', projets: [projet.id] } as never);
      setCreee(marque.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La marque n’a pas pu être créée.'));
      setEnCours(false);
    }
  };
  const libelle = t('Créer la marque de {v0}', { v0: projet.name });
  return (
    <>
      <EtatVideDuProjet
        icone={<Megaphone />}
        titre={t('{v0} n’a pas encore de marque', { v0: projet.name })}
        texte={t('La marque réunit les campagnes, les comptes reliés et le calendrier des publications de ce projet. Elle prend son nom et son logo.')}
        {...(telephone ? { action: libelle, onAction: () => void creer(), enCours } : {})}
        fond={<SilhouetteTableauDeService lignes={8} />}
        data-v2-projet-sans-marque={projet.id}
      />
      {telephone ? null : (
        <GestePrincipal>
          <BoutonPrincipal onClick={() => void creer()} disabled={enCours} aria-busy={enCours || undefined} data-v2-creer-la-marque={projet.id}>
            {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {libelle}
          </BoutonPrincipal>
        </GestePrincipal>
      )}
    </>
  );
}

function PageDeLaMarque({ page, element }: { page: PageCommunicationV2; element: string[] }) {
  switch (page) {
    case 'canaux':
      return element[0] === 'reglages' ? <PageReglagesDesCanaux canal={element[1] ?? null} /> : <PageCanaux />;
    case 'campagnes':
      return <PageCampagnes element={element} />;
    case 'connexion':
      return <PageConnexion />;
    case 'calendrier':
      return <PageCampagnes element={[]} />;
    case 'reponses':
      return <PageReponses element={element} />;
  }
}
