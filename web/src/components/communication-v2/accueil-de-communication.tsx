import * as React from 'react';
import { Image as ImageIcon, Loader2, Plus } from '@/components/ui/icones';
import { cheminCommunicationV2, type CompteSocial, type EtatDeLaLigneDeConnexion, type ReseauSocial } from '@beluga/shared';
import { BoutonPrincipal, GestePrincipal } from '@/components/entete-de-zone';
import { BasculeDePage, RechercheDuService, RubriquesDePage } from '@/components/fenetre-de-service';
import { useFiltreCentral, useProjetDuService } from '@/components/projet-du-service';
import { SilhouetteTableauDeService } from '@/components/silhouettes';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, ZoneDefilement } from '@/components/ui';
import { ApercuAuSurvol, BasculeTableauCartes, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { BoutonVue } from '@/components/ui/boutons-a-menu';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { colonneProjet } from '@/components/ui/colonne-projet';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { PastilleProjet } from '@/components/pastille-projet';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { Apercu, Badge2, PastilleReseau, TitreDeLigne, dateCourteLocale, instantCourt, libelleDuCanal } from './socle/pieces';
import { ApercuDeCampagne, EtatDeLaCampagne } from './page-campagnes';
import type { LigneDeCampagneV2 } from './donnees';
import type { MarqueV2 } from './contexte';

/**
 * L'ACCUEIL DE COMMUNICATION (carte « Services homogènes et centrés », 14/11/2026 : « l'outil communication ne pointe
 * sur rien du tout, ça me pointe sur le premier onglet du projet ; je veux le tableau avec l'ensemble des campagnes et
 * la colonne du nom du projet »). Plus de choix d'une marque : trois onglets à droite du titre —
 *  - CAMPAGNES : toutes les campagnes de toutes les marques, en tableau ou en cartes ;
 *  - COMPTES : les comptes de réseaux de chaque marque, reliés ou à relier ;
 *  - RÉPONSES : les commentaires et messages reçus, du plus récent au plus ancien.
 * Chaque ligne porte le projet de sa marque ; le filtre « Tous les projets » de la page filtre SUR PLACE. Un clic ouvre
 * l'élément dans sa marque, aux adresses de toujours (`#communication2/<marque>/…`). Les lectures sont celles de chaque
 * marque, réunies ici : rien de neuf côté démon.
 */
type Onglet = 'campagnes' | 'comptes' | 'reponses';

interface LigneDeConnexion {
  reseau: ReseauSocial;
  libelle: string;
  comptes: CompteSocial[];
  etat: EtatDeLaLigneDeConnexion;
}
interface LigneDeMessage {
  id: string;
  genre: string;
  reseau: string;
  auteur: string;
  texte: string;
  instant: number;
  repondu: boolean;
  masqueLe?: number | null;
}

/** Une lecture faite pour chaque marque, réunie : `null` tant que toutes ne sont pas revenues. */
function useLectureDesMarques<T>(marques: MarqueV2[] | null, type: string, actif: boolean): { marque: MarqueV2; donnees: T }[] | null {
  const state = useApp();
  const version = state.communicationVersion;
  const [resultat, setResultat] = React.useState<{ marque: MarqueV2; donnees: T }[] | null>(null);
  const cle = (marques ?? []).map((m) => m.id).join(',');
  React.useEffect(() => {
    if (!actif || !marques) return;
    let vivant = true;
    void Promise.all(
      marques.map((marque) =>
        client
          .call<T>({ type, marqueId: marque.id } as never)
          .then((donnees) => ({ marque, donnees }))
          .catch(() => null),
      ),
    ).then((lus) => {
      if (vivant) setResultat(lus.filter((x): x is { marque: MarqueV2; donnees: T } => x !== null));
    });
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, type, actif, version]);
  return resultat;
}

const projetDeLaMarque = (m: MarqueV2) => ({ id: m.projets[0]?.id ?? null, nom: m.projets[0]?.nom ?? m.nom });

export function AccueilDeCommunication({ marques, erreur, onVise }: { marques: MarqueV2[] | null; erreur: string | null; onVise: (chemin: string | null) => void }) {
  const telephone = useTelephone();
  const [onglet, setOnglet] = React.useState<Onglet>('campagnes');
  const [recherche, setRecherche] = React.useState('');
  const [vue, setVue] = useVueDeLaListe('communication.vueDeLAccueil');
  /* LE FILTRE DES PROJETS DE LA PAGE : les marques de ce projet seulement. */
  const projet = useProjetDuService();
  const filtreCentral = useFiltreCentral();
  const retenues = React.useMemo(
    () => (marques ? (projet && filtreCentral ? marques.filter((m) => m.projets.some((p) => p.id === projet.id)) : marques) : null),
    [marques, projet?.id, filtreCentral],
  );
  const campagnes = useLectureDesMarques<{ campagnes: LigneDeCampagneV2[] }>(retenues, 'communication.campagnes', true);
  const connexions = useLectureDesMarques<{ reseaux: LigneDeConnexion[] }>(retenues, 'communication.connexion', onglet === 'comptes');
  const messages = useLectureDesMarques<{ lignes: LigneDeMessage[] }>(retenues, 'communication.messages', onglet === 'reponses');

  const lignesDeCampagnes = React.useMemo(
    () => (campagnes ?? []).flatMap(({ marque, donnees }) => donnees.campagnes.map((c) => ({ marque, c }))).sort((a, b) => (b.c.debut ?? '').localeCompare(a.c.debut ?? '')),
    [campagnes],
  );
  const lignesDeComptes = React.useMemo(
    () =>
      (connexions ?? []).flatMap(({ marque, donnees }) =>
        donnees.reseaux.flatMap((r) =>
          r.comptes.length ? r.comptes.map((compte) => ({ id: `${marque.id}:${r.reseau}:${compte.id}`, marque, r, compte: compte as CompteSocial | null })) : [{ id: `${marque.id}:${r.reseau}`, marque, r, compte: null as CompteSocial | null }],
        ),
      ),
    [connexions],
  );
  const lignesDeReponses = React.useMemo(
    () => (messages ?? []).flatMap(({ marque, donnees }) => donnees.lignes.map((m) => ({ id: `${marque.id}:${m.id}`, marque, m }))).sort((a, b) => b.m.instant - a.m.instant),
    [messages],
  );
  const aTraiter = lignesDeReponses.filter((l) => !l.m.repondu && !l.m.masqueLe).length;
  const messagesDesMarques = (retenues ?? []).reduce((n, m) => n + (m.messages ?? 0), 0);

  const ouvrirCampagne = (l: { marque: MarqueV2; c: LigneDeCampagneV2 }) => onVise(cheminCommunicationV2({ marqueId: l.marque.id, page: 'campagnes', element: [l.c.id] }));

  const colonnesDesCampagnes: ColonneDuTableauCommun<{ marque: MarqueV2; c: LigneDeCampagneV2 }>[] = [
    { cle: 'apercu', libelle: '', largeur: 64, rendu: ({ c }) => <Apercu piece={c.image ?? c.apercu} genre="image" /> },
    { cle: 'campagne', libelle: t('Campagne'), valeur: ({ c }) => c.titre, rendu: ({ c }) => <TitreDeLigne titre={c.titre} sous={c.objectif ?? c.message ?? '—'} /> },
    colonneProjet(({ marque }) => projetDeLaMarque(marque), { largeur: 170 }),
    {
      cle: 'reseaux',
      libelle: t('Réseaux'),
      largeur: 100,
      secondaire: true,
      rendu: ({ c }) => (
        <span className="inline-flex gap-1">
          {c.reseaux.slice(0, 3).map((r) => (
            <PastilleReseau key={r} canal={r} />
          ))}
        </span>
      ),
    },
    {
      cle: 'periode',
      libelle: t('Période'),
      largeur: 170,
      secondaire: true,
      valeur: ({ c }) => c.debut ?? '',
      rendu: ({ c }) => <span className="whitespace-nowrap text-muted">{c.debut || c.fin ? `${dateCourteLocale(c.debut)} → ${dateCourteLocale(c.fin)}` : '—'}</span>,
    },
    {
      cle: 'visuels',
      libelle: t('Visuels'),
      largeur: 90,
      droite: true,
      valeur: ({ c }) => (c.visuels?.prevus ? c.visuels.faits / c.visuels.prevus : 0),
      rendu: ({ c }) => <span className="tabular-nums text-muted">{c.visuels?.prevus ? `${c.visuels.faits} / ${c.visuels.prevus}` : '—'}</span>,
    },
    { cle: 'etat', libelle: t('État'), largeur: 130, valeur: ({ c }) => c.statut, rendu: ({ c }) => <EtatDeLaCampagne campagne={c} /> },
  ];

  const colonnesDesComptes: ColonneDuTableauCommun<(typeof lignesDeComptes)[number]>[] = [
    { cle: 'reseau', libelle: t('Réseau'), largeur: 190, valeur: (l) => l.r.libelle, rendu: (l) => <PastilleReseau canal={l.r.reseau} avecNom /> },
    { cle: 'compte', libelle: t('Compte'), valeur: (l) => l.compte?.nom ?? '', rendu: (l) => (l.compte ? <span className="truncate font-medium text-text">{l.compte.nom}</span> : <span className="text-faint">{t('Aucun compte relié')}</span>) },
    colonneProjet((l) => projetDeLaMarque(l.marque), { largeur: 170 }),
    { cle: 'etat', libelle: t('État'), largeur: 170, valeur: (l) => etatDeLaConnexion(l.r.etat), rendu: (l) => <EtatDeConnexion etat={l.r.etat} /> },
  ];

  const colonnesDesReponses: ColonneDuTableauCommun<(typeof lignesDeReponses)[number]>[] = [
    { cle: 'reseau', libelle: t('Réseau'), largeur: 70, valeur: (l) => libelleDuCanal(l.m.reseau), rendu: (l) => <PastilleReseau canal={l.m.reseau} /> },
    { cle: 'message', libelle: t('Message'), valeur: (l) => `${l.m.auteur} ${l.m.texte}`, rendu: (l) => <TitreDeLigne titre={l.m.auteur} sous={l.m.texte} /> },
    colonneProjet((l) => projetDeLaMarque(l.marque), { largeur: 170 }),
    { cle: 'recu', libelle: t('Reçu'), largeur: 120, droite: true, valeur: (l) => l.m.instant, rendu: (l) => <span className="text-muted">{instantCourt(l.m.instant)}</span> },
    {
      cle: 'etat',
      libelle: t('État'),
      largeur: 120,
      valeur: (l) => (l.m.repondu ? 1 : l.m.masqueLe ? 2 : 0),
      rendu: (l) => (l.m.repondu ? <Badge2 ton="gris">{t('Répondu')}</Badge2> : l.m.masqueLe ? <Badge2 ton="gris">{t('Masqué')}</Badge2> : <Badge2 ton="attente">{t('À traiter')}</Badge2>),
    },
  ];

  const onglets: { cle: Onglet; libelle: string; nombre?: number }[] = [
    { cle: 'campagnes', libelle: t('Campagnes'), ...(campagnes ? { nombre: lignesDeCampagnes.length } : {}) },
    { cle: 'comptes', libelle: t('Comptes') },
    { cle: 'reponses', libelle: t('Réponses'), ...(messages ? { nombre: aTraiter } : messagesDesMarques ? { nombre: messagesDesMarques } : {}) },
  ];

  const chargement = (donnees: unknown) => (marques === null && !erreur) || (retenues !== null && retenues.length > 0 && donnees === null);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-v2-accueil={onglet}>
      <RubriquesDePage>
        {telephone ? (
          /* SUR TÉLÉPHONE, LES TROIS ONGLETS DEVIENNENT UN BOUTON À MENU : la rangée unique de la feuille n'en tient pas
             trois (même forme que « Audience » des Statistiques). */
          <BoutonVue
            repere="accueil-de-communication"
            valeur={onglet}
            onChoisir={setOnglet}
            className="bg-raised"
            choix={onglets.map((o) => ({ cle: o.cle, libelle: o.libelle, ...(o.nombre !== undefined ? { nombre: o.nombre } : {}), attributs: { 'data-v2-accueil-onglet': o.cle } }))}
          />
        ) : (
          <BarreDOnglets
            repere="accueil-de-communication"
            libelle={t('Communication')}
            onglets={onglets}
            valeur={onglet}
            onChange={setOnglet}
            attributsOnglet={(o) => ({ 'data-v2-accueil-onglet': o })}
          />
        )}
      </RubriquesDePage>
      <RechercheDuService
        valeur={recherche}
        onChange={setRecherche}
        placeholder={onglet === 'campagnes' ? t('Rechercher une campagne') : onglet === 'comptes' ? t('Rechercher un compte…') : t('Rechercher un message…')}
        data-v2-accueil-recherche
      />
      {onglet === 'campagnes' ? (
        <BasculeDePage>
          <BasculeTableauCartes repere="vue-de-l-accueil-communication" valeur={vue} onChange={setVue} />
        </BasculeDePage>
      ) : null}
      <ZoneDefilement fond="hsl(var(--bg))" className={telephone ? 'px-4 pb-6' : 'pb-6'}>
        {erreur ? (
          <p className="py-6 text-[13px] text-danger">{erreur}</p>
        ) : onglet === 'campagnes' ? (
          chargement(campagnes) ? (
            <SilhouetteTableauDeService lignes={4} zone="communication-accueil" />
          ) : (
            <ApercuAuSurvol lire={(id) => lignesDeCampagnes.find((l) => `${l.marque.id}:${l.c.id}` === id)} rendu={(l) => <ApercuDeCampagne campagne={l.c} />} actif={vue === 'tableau'}>
            <Tableau
              repere="accueil-campagnes"
              lignes={lignesDeCampagnes}
              cle={(l) => `${l.marque.id}:${l.c.id}`}
              onLigne={ouvrirCampagne}
              aere
              rechercheExterne={recherche}
              colonnes={colonnesDesCampagnes}
              vide={t('Aucune campagne pour l’instant : « Nouvelle campagne » en commence une.')}
              attributsLigne={(l) => ({ 'data-v2-accueil-campagne': l.c.id, 'data-v2-accueil-marque': l.marque.id })}
              pile={(l) => (
                <>
                  <Apercu piece={l.c.image ?? l.c.apercu} genre="image" />
                  <span className="min-w-0 flex-1">
                    <TitreDeLigne titre={l.c.titre} sous={projetDeLaMarque(l.marque).nom} />
                  </span>
                  <EtatDeLaCampagne campagne={l.c} />
                </>
              )}
              {...(vue === 'cartes'
                ? {
                    grille: (l: { marque: MarqueV2; c: LigneDeCampagneV2 }) => (
                      <CarteDeTableau
                        image={<ImageDeCampagne piece={l.c.image ?? l.c.apercu ?? null} />}
                        projet={projetDeLaMarque(l.marque)}
                        etat={<EtatDeLaCampagne campagne={l.c} />}
                        titre={l.c.titre}
                        texte={l.c.objectif ?? l.c.message ?? ''}
                        chiffres={[
                          { libelle: t('Période'), valeur: l.c.debut || l.c.fin ? `${dateCourteLocale(l.c.debut)} → ${dateCourteLocale(l.c.fin)}` : '—' },
                          { libelle: t('Visuels'), valeur: l.c.visuels?.prevus ? `${l.c.visuels.faits} / ${l.c.visuels.prevus}` : '—' },
                          {
                            libelle: t('Réseaux'),
                            valeur: (
                              <span className="inline-flex gap-1">
                                {l.c.reseaux.slice(0, 3).map((r) => (
                                  <PastilleReseau key={r} canal={r} />
                                ))}
                              </span>
                            ),
                          },
                        ]}
                        data-v2-accueil-carte={l.c.id}
                      />
                    ),
                  }
                : {})}
            />
            </ApercuAuSurvol>
          )
        ) : onglet === 'comptes' ? (
          chargement(connexions) ? (
            <SilhouetteTableauDeService lignes={4} zone="communication-accueil" />
          ) : (
            <Tableau
              repere="accueil-comptes"
              lignes={lignesDeComptes}
              cle={(l) => l.id}
              onLigne={(l) => onVise(cheminCommunicationV2({ marqueId: l.marque.id, page: 'connexion' }))}
              aere
              rechercheExterne={recherche}
              colonnes={colonnesDesComptes}
              vide={t('Aucun réseau choisi pour l’instant.')}
              attributsLigne={(l) => ({ 'data-v2-accueil-compte': l.id })}
            />
          )
        ) : chargement(messages) ? (
          <SilhouetteTableauDeService lignes={4} zone="communication-accueil" />
        ) : (
          <Tableau
            repere="accueil-reponses"
            lignes={lignesDeReponses}
            cle={(l) => l.id}
            onLigne={(l) => onVise(cheminCommunicationV2({ marqueId: l.marque.id, page: 'reponses', element: [l.m.id] }))}
            aere
            rechercheExterne={recherche}
            colonnes={colonnesDesReponses}
            vide={t('Aucun commentaire ni message reçu pour l’instant.')}
            attributsLigne={(l) => ({ 'data-v2-accueil-reponse': l.id })}
          />
        )}
      </ZoneDefilement>
      <NouvelleCampagne marques={retenues} onVise={onVise} />
    </div>
  );
}

function ImageDeCampagne({ piece }: { piece: string | null }) {
  const [casse, setCasse] = React.useState(false);
  return piece && !casse ? (
    <img src={adresseDePiece(piece, false, 480)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" onError={() => setCasse(true)} />
  ) : (
    <ImageIcon className="h-6 w-6 text-faint" />
  );
}

const etatDeLaConnexion = (e: EtatDeLaLigneDeConnexion): string =>
  ({
    officiel: t('Publication officielle'),
    chrome: t('Publication par Chrome'),
    en_cours: t('En cours'),
    bloque: t('Bloqué'),
    a_relier: t('À reconnecter'),
    a_connecter: t('Pas encore connecté.'),
  })[e];

function EtatDeConnexion({ etat }: { etat: EtatDeLaLigneDeConnexion }) {
  const ton = etat === 'officiel' || etat === 'chrome' ? 'vert' : etat === 'bloque' ? 'danger' : etat === 'en_cours' ? 'violet' : 'attente';
  return <Badge2 ton={ton}>{etatDeLaConnexion(etat)}</Badge2>;
}

/**
 * « NOUVELLE CAMPAGNE », EN BAS PLEINE LARGEUR : elle demande d'abord le projet — ses marques, puis les projets qui
 * n'en ont pas encore (le choix crée leur marque, à leur nom). La campagne se crée ensuite en conversation, comme
 * depuis la marque.
 */
function NouvelleCampagne({ marques, onVise }: { marques: MarqueV2[] | null; onVise: (chemin: string | null) => void }) {
  const projets = useApp().projects;
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const sansMarque = projets.filter((p) => !p.archived && !(marques ?? []).some((m) => m.projets.some((x) => x.id === p.id)));
  const creerLaMarque = async (projet: { id: string; name: string }) => {
    if (enCours) return;
    setEnCours(projet.id);
    try {
      const { marque } = await client.call<{ marque: { id: string } }>({ type: 'communication.marque.creer', nom: projet.name, origine: 'projets', projets: [projet.id] } as never);
      onVise(cheminCommunicationV2({ marqueId: marque.id, page: 'campagnes', element: ['nouvelle'] }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La marque n’a pas pu être créée.'));
    } finally {
      setEnCours(null);
    }
  };
  return (
    <GestePrincipal>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BoutonPrincipal disabled={!marques || !!enCours} data-v2-nouvelle-campagne-accueil>
            {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('Nouvelle campagne')}
          </BoutonPrincipal>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="sm:w-[280px]" data-v2-nouvelle-campagne-pour>
          <DropdownMenuLabel>{t('Pour quel projet ?')}</DropdownMenuLabel>
          {(marques ?? []).map((m) => (
            <DropdownMenuItem key={m.id} className="gap-2.5" onSelect={() => onVise(cheminCommunicationV2({ marqueId: m.id, page: 'campagnes', element: ['nouvelle'] }))} data-v2-nouvelle-pour-marque={m.id}>
              <PastilleProjet project={{ name: projetDeLaMarque(m).nom, favicon: m.projets[0]?.favicon ?? m.favicon ?? undefined }} />
              <span className="min-w-0 flex-1 truncate">{projetDeLaMarque(m).nom}</span>
            </DropdownMenuItem>
          ))}
          {sansMarque.length ? <DropdownMenuSeparator /> : null}
          {sansMarque.map((p) => (
            <DropdownMenuItem key={p.id} className="gap-2.5" onSelect={() => void creerLaMarque(p)} data-v2-nouvelle-pour-projet={p.id}>
              <PastilleProjet project={p} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </GestePrincipal>
  );
}
