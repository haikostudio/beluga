import * as React from 'react';
import { EtatVideDuProjet, useFiltreCentral, useProjetDeLObjetOuvert, useProjetDuService as useProjetDuServiceBrut } from '@/components/projet-du-service';
import { AccueilDeCommunication } from './accueil-de-communication';
import { CalendarDays, Flag, Inbox, Link2, Loader2, Megaphone, Plus, Radio } from '@/components/ui/icones';
import { PAGE_D_OUVERTURE_V2, cheminCommunicationV2, etapeQuiBloqueV2, etapesDeLaMarqueV2, lireCheminCommunicationV2, pageAccessibleV2, type GenreDeCoulisses, type PageCommunicationV2 } from '@beluga/shared';
import { ColonneDeService, CLASSE_SECTION_DE_SERVICE, useColonneDeService } from '@/components/colonne-de-service';
import { BoutonPrincipal, CranDuFil, GestePrincipal, SeparateurDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { useDeclarerLeProjetDuHaut } from '@/components/haut-du-telephone';
import { useDeclarerLeNiveauDuBas, useDeclarerLesGestesDuBas, type GestesDuBas } from '@/components/menu-du-bas';
import { RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { SelecteurDeProjet } from '@/components/selecteur-de-projet';
import { SilhouetteMarketing, SilhouetteProjets, SilhouetteTableauDeService } from '@/components/silhouettes';
import { Button, Dialog, ListeDeroulante, TELEPHONE_SOUS_LA_BARRE, ZoneDefilement } from '@/components/ui';
import { LienInterne } from '@/components/ui/lien-interne';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { LogoDeMarque } from '@/components/communication-v2/socle/logo-de-marque';
import { useLecture } from '@/components/communication-v2/socle/pieces';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { RubriquesDePage, useDansUnePageDeService } from '@/components/fenetre-de-service';
import { adresseV2, ContexteV2, type Cibles, type EtatDesCoulisses, type MarqueV2, type OutilsV2 } from './contexte';
import { RondDEtape } from '@/components/barre-etapes';
import { chefSurLEtape, formeDeLEtapeV2, raisonDuVerrouV2 } from './pieces';
import { PageCanaux } from './page-canaux';
import { PageReglagesDesCanaux } from './page-reglages-canaux';
import { PageConnexion } from './page-connexion';
import { PageCampagnes } from './page-campagnes';
import { PageCalendrier } from './page-calendrier';
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
  /* SANS MENU À PART (zone centrale, fenêtre des outils de création) : les étapes de la marque se posent en rangée
     d'onglets en tête de la page. */
  const dansLaColonne = useColonneDeService();
  const { donnees, erreur } = useLecture<{ marques: MarqueV2[] }>({ type: 'communication.marques' }, []);
  const marques = donnees?.marques ?? null;
  const emplacement = React.useMemo(() => lireCheminCommunicationV2(vise), [vise]);
  const marque = emplacement.marqueId ? (marques?.find((m) => m.id === emplacement.marqueId) ?? null) : null;
  const etapes = React.useMemo(() => (marque ? etapesDeLaMarqueV2(marque.v2) : null), [marque]);
  /* SANS PAGE, LA MARQUE S'OUVRE TOUJOURS SUR SES CAMPAGNES (décision du 12/11/2026, `PAGE_D_OUVERTURE_V2`) — plus
     jamais sur « l'étape à faire ». Une adresse précise est respectée. L'adresse n'est PAS réécrite : un retour arrière
     ramène toujours à la liste des marques, sans entrée d'historique en plus. */
  const demandee: PageCommunicationV2 | null = marque ? (emplacement.page ?? PAGE_D_OUVERTURE_V2) : null;
  /* LES ÉTAPES S'OUVRENT DANS L'ORDRE (08/11/2026, `pageAccessibleV2`) : une adresse vers une étape encore fermée
     ouvre l'étape à terminer d'abord — et l'adresse se corrige (plus bas), pour qu'un retour arrière n'y ramène pas. */
  const page: PageCommunicationV2 | null = marque && demandee ? pageAccessibleV2(demandee, marque.v2) : demandee;
  /* Une ANCIENNE adresse (la page « plan », l'étape « Réseaux » nue) se lit sur les campagnes : elle se corrige aussi. */
  const pageEcrite = String(vise ?? '').split('/').filter(Boolean)[1];
  const redirigee = !!marque && !!emplacement.page && (page !== emplacement.page || pageEcrite !== emplacement.page);
  const element = redirigee ? [] : (emplacement.element ?? []);
  const coulisses = useCoulisses(marque?.id ?? null);
  /* Une CAMPAGNE ouverte (objet réel, en onglet) se range sous un projet de SA marque. */
  useProjetDeLObjetOuvert(marque && element.length ? marque.projets.map((p) => p.id) : null);
  /* LE NOM DE LA CAMPAGNE OUVERTE, pour le fil d'Ariane : déclaré par sa page (qui l'a déjà lu), effacé en la quittant. */
  const [titreDeLaCampagne, setTitreDeLaCampagne] = React.useState<string | null>(null);

  /* DANS L'ONGLET D'UN PROJET (refonte du 13/11/2026) : la marque qui porte ce projet s'ouvre d'elle-même — on ne
     choisit plus une marque parmi toutes. */
  /* …SAUF DEPUIS LE FILTRE « TOUS LES PROJETS » DE LA PAGE DU SERVICE (14/11/2026) : l'accueil filtre alors ses
     tableaux sur place, comme les neuf autres services. */
  const filtreCentral = useFiltreCentral();
  const projetDuServiceBrut = useProjetDuServiceBrut();
  const projetDuService = filtreCentral ? null : projetDuServiceBrut;
  const marqueDuProjet = projetDuService ? (marques?.find((m) => m.projets.some((p) => p.id === projetDuService.id)) ?? null) : null;
  React.useEffect(() => {
    if (marqueDuProjet && !emplacement.marqueId) onVise(cheminCommunicationV2({ marqueId: marqueDuProjet.id }));
  }, [marqueDuProjet, emplacement.marqueId, onVise]);
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

  /* LE TÉLÉPHONE : la flèche de la barre d'en-tête remonte d'un cran — l'élément, puis la liste des marques. */
  const retour = () => {
    if (marque && page === 'campagnes' && element[0] && element[0] !== 'nouvelle' && element.length > 1) return aller(page, element[0]);
    if (marque && page && element.length) return aller(page);
    return onVise(null);
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
    return { 'v2-campagnes': geste('campagnes'), 'v2-connexion': geste('connexion'), 'v2-calendrier': geste('calendrier'), 'v2-reponses': geste('reponses') };
  }, [telephone, marque, page, element.length, aller]);
  useDeclarerLesGestesDuBas(gestesDuBas);

  const nomDeLaPage = page ? nomsDesPages()[page] : null;
  const campagneOuverte = page === 'campagnes' && !!element[0] && element[0] !== 'nouvelle';
  /*
   * OUVERTE DEPUIS UN PROJET, COMMUNICATION NE MONTRE QUE LA MARQUE DE CE PROJET (décision du 13/11/2026) : jamais la
   * liste des marques. Le temps que la marque du projet s'ouvre, une silhouette ; un projet SANS marque se voit
   * proposer de créer la sienne (son nom et son logo).
   */
  const enAttenteDeLaMarqueDuProjet = !!projetDuService && !emplacement.marqueId && (marques === null || !!marqueDuProjet);
  const projetSansMarque = !!projetDuService && !emplacement.marqueId && marques !== null && !marqueDuProjet;
  const contenu =
    projetSansMarque && projetDuService ? (
      <CreerLaMarqueDuProjet projet={projetDuService} marques={marques} onCree={(id) => onVise(cheminCommunicationV2({ marqueId: id }))} />
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
      /* L'ACCUEIL : TOUTES LES CAMPAGNES (carte « Services homogènes et centrés », 14/11/2026) — plus de choix d'une marque. */
      <AccueilDeCommunication marques={marques} erreur={erreur} onVise={onVise} />
    );

  return (
    <Dialog open modal={false}>
      <div className="flex h-full min-h-0 w-full" data-communication2 data-v2-page={page ?? 'marques'} data-v2-marque={marque?.id ?? ''}>
        <ColonneDeService>
          <ColonneV2 marques={marques} erreur={erreur} marque={marque} page={page} onVise={onVise} genreAuTravail={coulisses?.enCours?.genre ?? null} />
        </ColonneDeService>
        {marque ? (
          <SuiteDuFil onRacine={() => onVise(null)} retour={{ action: retour, reperes: { 'data-v2-retour': '' } }}>
            <SeparateurDuFil />
            <SelecteurDeProjet
              dansLeFil
              id={marque.id}
              nom={marque.nom}
              icone={<LogoDeMarque marque={marque} />}
              choix={(projetDuService ? [marque] : (marques ?? [])).map((m) => ({ id: m.id, nom: m.nom, icone: <LogoDeMarque marque={m} />, projetId: m.projets[0]?.id ?? m.id }))}
              onChoisir={(id) => (id === marque.id ? undefined : onVise(cheminCommunicationV2({ marqueId: id, ...(page ? { page } : {}) })))}
              onNom={() => onVise(cheminCommunicationV2({ marqueId: marque.id }))}
              repere="communication2"
              libelleFiltre={t('Filtrer les marques')}
              libelleVide={t('Aucune marque ne correspond.')}
            />
            {nomDeLaPage ? (
              element.length ? (
                <CranDuFil
                  dernier={false}
                  adresse={adresseV2(marque.id, page!)}
                  onClick={() => aller(page!)}
                  /* LES AUTRES PAGES DE LA MARQUE, sous le chevron du cran (14/11/2026). */
                  voisins={{
                    nom: nomDeLaPage,
                    valeur: page!,
                    titre: t('Pages de la marque'),
                    repere: 'v2-page',
                    options: (['campagnes', 'connexion', 'calendrier', 'reponses', 'canaux'] as PageCommunicationV2[]).map((p) => {
                      const Icone = ICONES[p];
                      return { valeur: p, libelle: nomsDesPages()[p], icone: <Icone /> };
                    }),
                    onChoisir: (p) => aller(pageAccessibleV2(p as PageCommunicationV2, marque.v2)),
                  }}
                  data-v2-cran={page}
                >
                  {nomDeLaPage}
                </CranDuFil>
              ) : (
                <CranDuFil data-v2-cran={page}>{nomDeLaPage}</CranDuFil>
              )
            ) : null}
            {/* LA CAMPAGNE OUVERTE, par son nom (capture #38ee) : dernier cran de sa page — sa conversation (10/11/2026). */}
            {page === 'canaux' && element[0] === 'reglages' ? <CranDuFil data-v2-cran-reglages>{t('Réglages avancés')}</CranDuFil> : null}
            {page === 'campagnes' && element[0] === 'nouvelle' ? <CranDuFil data-v2-cran-campagne="nouvelle">{t('Nouvelle campagne')}</CranDuFil> : null}
            {page === 'campagnes' && element[0] && element[0] !== 'nouvelle' && titreDeLaCampagne ? <CranDuFil data-v2-cran-campagne={element[0]}>{titreDeLaCampagne}</CranDuFil> : null}
          </SuiteDuFil>
        ) : null /* L'accueil est la page du service : son titre reste « Communication », sans cran « Mes marques ». */}
        {/* LA PAGE D'UNE CAMPAGNE OUVERTE PREND TOUTE LA LARGEUR (carte « Volet des campagnes comme un plan ») : son
            volet se colle au bord droit, comme le plan d'une carte, et la conversation se centre dans le reste. Les
            autres pages gardent leur plafond de 1320 px. */}
        <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !telephone && 'items-center')} data-v2-main>
          <div className={cn('flex min-h-0 w-full flex-1 flex-col', !telephone && !campagneOuverte && 'max-w-[1320px]')} data-v2-pleine-largeur={campagneOuverte ? '' : undefined}>
            {!dansLaColonne && marque && !projetDuService ? <ChoixDeLaMarqueTelephone marques={marques} marque={marque} page={page} onVise={onVise} /> : null}
            {/* UNE CAMPAGNE OUVERTE N'A PLUS DE RANGÉE EN HAUT (décision du 14/11/2026) : son parcours est en bas, la
                connexion et les réponses s'y ouvrent. Une nouvelle campagne non plus. */}
            {!dansLaColonne && !telephone && marque && !(page === 'campagnes' && element[0]) ? <EtapesDeLaMarqueEnRangee marque={marque} page={page} onVise={onVise} /> : null}
            {contenu}
          </div>
        </main>
      </div>
    </Dialog>
  );
}

/**
 * LES ÉTAPES DE LA MARQUE EN RANGÉE D'ONGLETS, sur ordinateur, là où il n'y a plus de menu à gauche (13/11/2026) :
 * Campagnes, Connexion, Calendrier, puis Réponses. Une étape encore fermée reste à sa place, éteinte, et son
 * infobulle dit laquelle terminer d'abord.
 */
function EtapesDeLaMarqueEnRangee({ marque, page, onVise }: { marque: MarqueV2; page: PageCommunicationV2 | null; onVise: (chemin: string | null) => void }) {
  const dansUnePage = useDansUnePageDeService();
  const noms = nomsDesPages();
  const { etapes } = etapesDeLaMarqueV2(marque.v2);
  /* LE CALENDRIER N'EST PLUS UNE ÉTAPE DE LA MARQUE (14/11/2026) : le calendrier général, toutes campagnes réunies,
     s'ouvre par « Services › Calendrier » ; l'adresse « …/calendrier » mène toujours à sa page. */
  const onglets = [
    ...etapes.filter((e) => e.id !== 'calendrier').map((e) => {
      const bloquante = etapeQuiBloqueV2(e.id, marque.v2);
      const Icone = ICONES[e.id];
      return { cle: e.id as PageCommunicationV2, libelle: noms[e.id], icone: <Icone className="h-3.5 w-3.5" />, desactive: !!bloquante, ...(bloquante ? { titre: raisonDuVerrouV2(bloquante) } : {}) };
    }),
    { cle: 'reponses' as PageCommunicationV2, libelle: noms.reponses, icone: <Inbox className="h-3.5 w-3.5" />, ...(marque.messages ? { nombre: marque.messages } : {}) },
  ];
  return (
    /* DANS UNE PAGE DE SERVICE (14/11/2026), LES RUBRIQUES MONTENT À GAUCHE DE LA RANGÉE DE LA PAGE (`RubriquesDePage`). */
    <RubriquesDePage>
    <div className={cn('flex shrink-0', dansUnePage ? '' : 'justify-center px-4 pb-2 pt-3')} data-v2-etapes-en-rangee>
      <BarreDOnglets
        repere="etapes-de-la-marque"
        libelle={t('Les étapes')}
        onglets={onglets}
        valeur={page ?? 'campagnes'}
        onChange={(p) => onVise(cheminCommunicationV2({ marqueId: marque.id, page: p }))}
        adresseDe={(p) => adresseV2(marque.id, p).replace(/^#/, '')}
        attributsOnglet={(p) => ({ 'data-v2-etape': p })}
      />
    </div>
    </RubriquesDePage>
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
      return <PageCalendrier element={element} />;
    case 'reponses':
      return <PageReponses element={element} />;
  }
}

/**
 * LA COLONNE : sans marque ouverte, la liste des marques ; dans une marque, son nom (qui ramène à l'étape à faire),
 * les QUATRE ÉTAPES au rond des barres d'étapes des agents — l'étape ouverte en violet —, un trait, et « Réponses ».
 */
function ColonneV2({
  marques,
  erreur,
  marque,
  page,
  onVise,
  genreAuTravail,
}: {
  marques: MarqueV2[] | null;
  erreur: string | null;
  marque: MarqueV2 | null;
  page: PageCommunicationV2 | null;
  onVise: (chemin: string | null) => void;
  /** Ce que le chef prépare en ce moment : la roue tourne sur son étape. */
  genreAuTravail: GenreDeCoulisses | null;
}) {
  const noms = nomsDesPages();
  const etapes = marque ? etapesDeLaMarqueV2(marque.v2) : null;
  return (
    <ZoneDefilement hauteur={16} className="pb-4" classeEnveloppe="w-full">
      <nav aria-label="Communication" data-v2-colonne>
        {marque && etapes ? (
          <>
            <div className="px-1 pb-2 pt-1">
              <ListeDeroulante
                titre={t('Marques')}
                repere="marque-communication2"
                valeur={marque.id}
                seuilRecherche={8}
                icone={<LogoDeMarque marque={marque} taille={20} />}
                options={(marques ?? []).map((m) => ({ valeur: m.id, libelle: m.nom, icone: <LogoDeMarque marque={m} taille={20} /> }))}
                onChoisir={(id) => onVise(cheminCommunicationV2({ marqueId: id }))}
                className="w-full bg-surface"
              />
            </div>
            <p className={CLASSE_SECTION_DE_SERVICE}>{t('Les étapes')}</p>
            <div data-v2-etapes>
              {/* LES ÉTAPES DE LA COLONNE SE LISENT COMME LA BARRE D'UN AGENT (capture #3a2f, 08/11/2026) : le même rond
                  (`RondDEtape` — coché une fois fait, cerclé là où l'on en est, une roue quand le chef y travaille,
                  vide et pâle à venir), relié au suivant par un trait vertical, plein jusqu'où l'on est arrivé. Chaque
                  ligne trace sa moitié de trait au-dessus et au-dessous de son rond, rognée à ses bords
                  (`overflow-y-clip`) : le trait reste continu quelle que soit la hauteur des lignes. */}
              {etapes.etapes.map((e, i) => {
                /* LES ÉTAPES S'OUVRENT DANS L'ORDRE (08/11/2026) : une étape fermée reste à sa place, pâle, sans lien ;
                   son infobulle dit laquelle terminer d'abord. */
                const bloquante = etapeQuiBloqueV2(e.id, marque.v2);
                const raison = bloquante ? raisonDuVerrouV2(bloquante) : null;
                /* UN « + » SUR LA LIGNE CAMPAGNES (demande du 08/11/2026), seulement quand l'étape est ouverte : il ouvre
                   l'assistant de campagne. Posé À CÔTÉ du lien de la ligne, jamais dedans (un bouton dans un lien est
                   invalide et son clic traverserait vers la ligne). */
                const plus = e.id === 'campagnes' && !raison;
                const ligne = (
                <RubriqueDeColonne
                  key={e.id}
                  className={cn('overflow-y-clip', raison && 'cursor-default opacity-50 hover:bg-transparent')}
                  icone={
                    <span className="relative flex [&_svg]:!h-3 [&_svg]:!w-3" data-v2-rond-colonne={formeDeLEtapeV2(e)}>
                      {i > 0 ? <span aria-hidden className={cn('absolute bottom-full left-1/2 h-12 w-px -translate-x-1/2', etapes.etapes[i - 1]!.etat === 'fait' ? 'bg-text/60' : 'bg-faint/60')} /> : null}
                      <RondDEtape forme={formeDeLEtapeV2(e, chefSurLEtape(genreAuTravail, e.id))} />
                      {i < etapes.etapes.length - 1 ? <span aria-hidden className={cn('absolute left-1/2 top-full h-12 w-px -translate-x-1/2', e.etat === 'fait' ? 'bg-text/60' : 'bg-faint/60')} /> : null}
                    </span>
                  }
                  libelle={noms[e.id]}
                  actif={page === e.id}
                  detail={e.etat === 'fait' ? t('Fait') : e.etat === 'en_cours' ? t('À faire maintenant') : undefined}
                  {...(raison
                    ? { 'aria-disabled': true, title: raison, 'data-v2-verrou': raison }
                    : { adresse: adresseV2(marque.id, e.id), onClick: () => onVise(cheminCommunicationV2({ marqueId: marque.id, page: e.id })) })}
                  data-v2-etape={e.id}
                  data-etat={e.etat}
                />
                );
                if (!plus) return <React.Fragment key={e.id}>{ligne}</React.Fragment>;
                return (
                  <div key={e.id} className="relative [&>a]:pr-10" data-v2-ligne-avec-plus>
                    {ligne}
                    <Button
                      type="button"
                      size="icon-barre"
                      variant="ghost"
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-text group-data-[bande]/colonne:hidden"
                      aria-label="Nouvelle campagne"
                      title={t('Nouvelle campagne')}
                      onClick={() => onVise(cheminCommunicationV2({ marqueId: marque.id, page: 'campagnes', element: ['nouvelle'] }))}
                      data-v2-plus-campagne
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="mx-2.5 my-2 h-px bg-faint/25" aria-hidden />
            <RubriqueDeColonne
              icone={<Inbox className="h-4 w-4 text-muted" />}
              libelle={noms.reponses}
              actif={page === 'reponses'}
              compte={marque.messages || undefined}
              adresse={adresseV2(marque.id, 'reponses')}
              onClick={() => onVise(cheminCommunicationV2({ marqueId: marque.id, page: 'reponses' }))}
              data-v2-etape="reponses"
            />
          </>
        ) : (
          <>
            <p className={CLASSE_SECTION_DE_SERVICE}>{t('Mes marques')}</p>
            {marques === null ? (
              erreur ? <p className="px-2.5 text-[12px] text-danger">{erreur}</p> : <SilhouetteProjets lignes={4} />
            ) : (
              marques.map((m) => <LigneDeMarqueV2 key={m.id} m={m} onVise={onVise} />)
            )}
          </>
        )}
      </nav>
    </ZoneDefilement>
  );
}

/** Le nom de l'étape suivante d'une marque, en clair. */
function etapeSuivante(m: MarqueV2): string {
  const { suivante, etapes } = etapesDeLaMarqueV2(m.v2);
  if (!suivante) return t('Tout est en place');
  const e = etapes.find((x) => x.id === suivante)!;
  return t('Étape {n} · {nom}', { n: e.rang, nom: nomsDesPages()[suivante] });
}

function LigneDeMarqueV2({ m, onVise }: { m: MarqueV2; onVise: (chemin: string | null) => void }) {
  return (
    <LienInterne
      adresse={adresseV2(m.id)}
      onClick={() => onVise(cheminCommunicationV2({ marqueId: m.id }))}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-raised"
      data-v2-marque-ligne={m.id}
    >
      <LogoDeMarque marque={m} taille={26} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-text">{m.nom}</span>
        <span className="block truncate text-[11px] text-faint">{etapeSuivante(m)}</span>
      </span>
    </LienInterne>
  );
}

/** SUR TÉLÉPHONE, la marque se change en tête de la page (la colonne n'y est pas) : la page ouverte est gardée. */
function ChoixDeLaMarqueTelephone({ marques, marque, page, onVise }: { marques: MarqueV2[] | null; marque: MarqueV2; page: PageCommunicationV2 | null; onVise: (chemin: string | null) => void }) {
  if (!marques?.length) return null;
  return (
    <div className={cn('shrink-0 px-4 pb-0 pt-3', TELEPHONE_SOUS_LA_BARRE)} data-v2-choix-marque={marque.id}>
      <ListeDeroulante
        titre={t('Marques')}
        repere="marque-communication2-telephone"
        valeur={marque.id}
        seuilRecherche={8}
        icone={<LogoDeMarque marque={marque} taille={20} />}
        options={marques.map((m) => ({ valeur: m.id, libelle: m.nom, detail: etapeSuivante(m), icone: <LogoDeMarque marque={m} taille={20} /> }))}
        onChoisir={(id) => onVise(cheminCommunicationV2({ marqueId: id, ...(page ? { page } : {}) }))}
        className="w-full bg-surface"
      />
    </div>
  );
}
