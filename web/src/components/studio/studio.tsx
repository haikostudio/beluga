import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import { ApercuAuSurvol, BasculeTableauCartes, CorpsDApercu, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { ApercuDeLigne, TitreEtSous, dateDeLigne } from '@/components/ui/apercu-de-ligne';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { BasculeDePage, RechercheDuService, useSansLigneDeTitre } from '@/components/fenetre-de-service';
import { colonneProjet } from '@/components/ui/colonne-projet';
import * as React from 'react';
import { EtatVideDuProjet, useProjetDeLObjetOuvert, useProjetDuService } from '@/components/projet-du-service';
import {
  Bot,
  Route,
  Clapperboard,
  Copy,
  Globe,
  Library,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Download,
  History,
  Images,
  Redo2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Loader2,
  Maximize2,
  Hammer,
  Minimize2,
  ChevronDown,
} from '@/components/ui/icones';
import {
  type Agent,
  type Attachment,
  type Card,
  type FormatStudio,
  type OperationStudio,
  type Piste,
  CLES_FORMATS_STUDIO,
  agentTientSonTour,
  FORMATS_STUDIO,
  dureeExportee,
  instantDOuverture,
  etatDuBoutonDeProduction,
  minusculesSansAccents,
  premiereDemandeDuMode,
  aUnTrajetPossible,
  trouverSegment,
  type Composition,
  type ModeDisponible,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  DialogFooter,
  DialogTitle,
  TitreDePage,
  CLASSE_LARGEUR_DE_CONTENU,
  Drawer,
  EnteteDeFeuille,
  FormulaireEnColonnes,
  Input,
  LigneFormulaire,
  ListeDeroulante,
  PromptDialog,
  ZoneDefilement,
  CaseACocher,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { Chat } from '@/components/chat';
import { Composer } from '@/components/composer';
import { HAUTEUR_BOUTON_DU_FIL } from '@/components/parcours-carte';
import { useDocumentDeCarte } from '@/lib/document-de-carte';
import { RunSelectors, resoudreRun, type RunChoix } from '@/components/run-selectors';
import { SilhouetteConversation, SilhouetteStudio } from '@/components/silhouettes';
import { BoutonPrincipal, GestePrincipal, OptionDePage, OptionsDePage, SeparateurDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { CLASSE_SECTION_DE_SERVICE, ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { GesteDeCreationDeColonne, RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { client } from '@/lib/client';
import { useDeclarerLeProjetDuHaut, type EtageDuProjet } from '@/components/haut-du-telephone';
import { useDeclarerLeNiveauDuBas, useDeclarerLesGestesDuBas, type GestesDuBas } from '@/components/menu-du-bas';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { BulleDeReglages } from './bulle-de-reglages';
import { usePref } from '@/lib/prefs';
import { ResizeHandle, ResizeHandleHorizontale, useResizable } from '@/components/resizer';
import { formatRegional, t } from '@/lib/langue';
import { PasAPas } from '@/components/pas-a-pas';
import { cn } from '@/lib/utils';
import { Apercu, ApercuEnDirect, type ApercuDirect, type BoiteDuCadre, type MessageDuCadre, type PoigneeApercu } from './apercu';
import { EditeurElement } from './editeur-element';
import { PanneauStyles, type StyleDeLaGalerie } from './styles';
import { ArchivesDeLaCreation, MenuDesModeles, PanneauMedias, useRythme } from './outils-du-studio';
import { joindreAuChamp } from '@/lib/joindre-au-champ';
import { EVENEMENT_BIBLIOTHEQUE_DU_STUDIO } from '@/lib/bibliotheque-du-studio';
import { usePrechargementDesExtraits } from './panneaux';
import { LigneDeTemps, type QuoiAjouter } from './ligne-de-temps';
import { Inspecteur, ReglagesDeComposition } from './inspecteur';
import { ContexteConversationDuStudio } from '@/components/menu-du-media';
import { FournisseurDePose, useContexteDePose } from '@/components/pose-sur-piste';
import { ContexteFilDuStudio } from '@/components/flux-en-points';
import { DepensesEnAttente, PanneauBibliotheque, choisirEtImporter } from './panneaux';
import { EnteteDeFenetre, PolicesDuProjet } from './champs';
import { BoutonMiseEnProduction, FenetreMiseEnProduction, useProductionEnCours } from './production';
import { libelleFormat } from './libelles';
import type { DonneesCreation, LigneCreation, ResumeModele } from './types';

/**
 * LE STUDIO — visuels fixes et vidéos animées de chaque projet.
 *
 * Deux écrans : la LISTE des créations (une seule rangée de vignettes, avec une recherche), puis l'ÉDITEUR d'une
 * création — aperçu au centre (cadre isolé, même traduction que l'export),
 * ligne de temps en bas, inspecteur et agent à côté. Sur téléphone : aperçu en
 * haut, ligne de temps au doigt dessous, inspecteur, agent, voix et exports en
 * tiroirs pleins (`Drawer empile plein`).
 *
 * Tout ce qui se montre vient du serveur à l'ouverture (`studio.lister`,
 * `studio.creation.ouvrir`) et se relit à chaque événement `studio`.
 */
/** Les flèches du clavier → le pas d'une pièce poussée sur l'aperçu. */
const FLECHES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** L'ICÔNE D'UN FORMAT : un cadre aux proportions du format (9:16 debout, 16:9 couché…), tracé comme les icônes lucide. */
function IconeFormat({ format }: { format: FormatStudio }) {
  const { largeur, hauteur } = FORMATS_STUDIO[format];
  const k = 18 / Math.max(largeur, hauteur);
  const l = largeur * k;
  const h = hauteur * k;
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden data-studio-icone-format={format}>
      <rect x={12 - l / 2} y={12 - h / 2} width={l} height={h} rx={2} />
    </svg>
  );
}

/** La raison du bouton de Construction tant que la création se charge — clé française, traduite à l'affichage. */
const CLE_CHARGEMENT_DE_LA_CREATION = 'Chargement de la création…';

export function Studio({
  open,
  onClose,
  enPage,
  vise,
  onVise,
}: {
  open: boolean;
  onClose: () => void;
  enPage?: boolean;
  /** LA CRÉATION DÉSIGNÉE PAR L'ADRESSE : « #studio/<création> ». */
  vise?: string | null;
  onVise?: (creationId: string | null) => void;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      enPage={enPage}
      // L'atelier d'une création prend toute la largeur ; la liste garde la colonne centrée.
      className={vise ? 'max-w-none sm:px-3 sm:pt-2' : undefined}
    >
      {vise ? (
        <Editeur key={vise} creationId={vise} onRetour={() => onVise?.(null)} onOuvrir={(id) => onVise?.(id)} />
      ) : (
        <ListeDesCreations onOuvrir={(id) => onVise?.(id)} />
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* La liste                                                             */
/* ------------------------------------------------------------------ */

/** Un bouton de la barre du haut bloqué pendant le travail de l'agent : grisé à 50 % (le bouton, lui, grise à 40 %). */
const BLOQUE = 'disabled:opacity-50';

/**
 * LES GESTES SUR LA CRÉATION ELLE-MÊME — renommer, dupliquer, supprimer — DANS LE MENU À TROIS POINTS VERTICAUX,
 * tout à droite de la barre (31/10/2026 : ils ne se collent plus au titre du fil d'Ariane). Sur téléphone, ce sont
 * les dernières lignes du menu de l'atelier.
 */
function GestesSurLaCreation({ bloque, onRenommer, onDupliquer, onSupprimer }: { bloque: boolean; onRenommer: () => void; onDupliquer: () => void; onSupprimer: () => void }) {
  const raison = bloque ? t('L’agent travaille') : undefined;
  return (
    <>
      <OptionDePage icone={<Pencil className="h-3.5 w-3.5" />} onClick={onRenommer} aria-label="Renommer la création" data-studio-renommer>
        {t('Renommer')}
      </OptionDePage>
      <OptionDePage icone={<Copy className="h-3.5 w-3.5" />} disabled={bloque} title={raison} onClick={onDupliquer} aria-label="Dupliquer la création" data-studio-dupliquer>
        {t('Dupliquer')}
      </OptionDePage>
      <OptionDePage icone={<Trash2 className="h-3.5 w-3.5" />} disabled={bloque} title={raison} onClick={onSupprimer} aria-label="Supprimer la création" data-studio-supprimer>
        {t('Supprimer')}
      </OptionDePage>
    </>
  );
}

/**
 * LES OPTIONS DE L'ATELIER SUR TÉLÉPHONE : les lignes du menu à trois points de
 * la barre d'en-tête — chaque rubrique ouvre son TIROIR, comme sur ordinateur.
 * Composant à part : seul lui se redessine à chaque pas de l'export, et son
 * bouton tourne tant que la production avance.
 */
function OptionsDeLAtelierAuTelephone({
  donnees,
  gestes,
}: {
  donnees: DonneesCreation;
  bloque?: boolean;
  onTiroir?: (t: TiroirDeLAtelier) => void;
  gestes: React.ReactNode;
}) {
  const enCours = useProductionEnCours(donnees.depenses, donnees.exports);
  return (
    /* MÉDIAS, TÉLÉCHARGEMENTS, STYLE ET ARCHIVES ONT QUITTÉ CE MENU (03/11/2026) : ils sont le bas de l'écran. */
    <OptionsDePage enCours={enCours}>
      {gestes}
    </OptionsDePage>
  );
}

/** Les colonnes du tableau des créations (14/11/2026). */
function colonnesDuStudio(): ColonneDuTableauCommun<LigneCreation>[] {
  return [
    {
      cle: 'titre',
      libelle: t('Création'),
      valeur: (c) => c.titre,
      filtre: 'texte',
      rendu: (c) => (
        <span className="flex min-w-0 items-center gap-3">
          <ApercuDeLigne piece={c.afficheId} genre="image" taille={40} />
          <span className="min-w-0 truncate font-medium text-text">{c.titre}</span>
        </span>
      ),
    },
    /* LE PROJET EN COLONNE (14/11/2026) : il n'est plus écrit sous le titre. */
    colonneProjet<LigneCreation>((c) => ({ nom: c.projet })),
    { cle: 'formats', libelle: t('Formats'), largeur: 200, secondaire: true, valeur: (c) => c.formats.map(libelleFormat).join(' · '), rendu: (c) => <span className="truncate text-muted">{c.formats.map(libelleFormat).join(' · ')}</span> },
    { cle: 'duree', libelle: t('Durée'), largeur: 96, droite: true, valeur: (c) => c.duree, rendu: (c) => <span className="tabular-nums text-muted">{dureeDeCreation(c.duree)}</span> },
    { cle: 'maj', libelle: t('Mis à jour'), largeur: 150, droite: true, valeur: (c) => c.majLe, rendu: (c) => <span className="text-muted">{dateDeLigne(c.majLe)}</span> },
  ];
}

function dureeDeCreation(duree: number): string {
  return `${(Math.round(duree * 10) / 10).toLocaleString(formatRegional())} s`;
}

/** L'aperçu d'une création au survol : l'affiche en grand, le titre, le projet, les chiffres utiles. */
function ApercuDeCreation({ creation: c }: { creation: LigneCreation }) {
  return (
    <CorpsDApercu
      image={c.afficheId ? <img src={`/api/attachment?id=${encodeURIComponent(c.afficheId)}`} alt="" className="h-full w-full object-cover object-top" /> : <span className="flex h-full w-full items-center justify-center text-faint"><Clapperboard className="h-6 w-6" /></span>}
      sous={c.projet}
      titre={c.titre}
      chiffres={[
        { libelle: t('Formats'), valeur: c.formats.map(libelleFormat).join(' · ') || '—' },
        { libelle: t('Durée'), valeur: dureeDeCreation(c.duree) },
        { libelle: t('Mis à jour'), valeur: dateDeLigne(c.majLe) },
      ]}
    >
      {c.voixEnEssai ? <p className="pt-1 text-[12px] text-en-cours">{t('{n} voix d’essai', { n: c.voixEnEssai })}</p> : null}
    </CorpsDApercu>
  );
}

function ListeDesCreations({ onOuvrir }: { onOuvrir: (id: string) => void }) {
  const state = useApp();
  const version = state.studioVersions['*'] ?? 0;
  const [vue, setVue] = React.useState<{ creations: LigneCreation[]; projets: { id: string; name: string }[] } | null>(null);
  const [nouvelle, setNouvelle] = React.useState(false);
  useTiroirAdresse('nouvelle-creation-studio', nouvelle, setNouvelle);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ creations: LigneCreation[]; projets: { id: string; name: string }[] }>({ type: 'studio.lister' })
      .then((r) => vivant && setVue(r))
      .catch((err: any) => {
        if (!vivant) return;
        client.pushToast('error', err?.message ?? t('Studio illisible'));
        setVue((v) => v ?? { creations: [], projets: [] });
      });
    return () => {
      vivant = false;
    };
  }, [version]);

  const [recherche, setRecherche] = React.useState('');
  const [vueDeLaListe, setVueDeLaListe] = useVueDeLaListe('studio.vueDeLaListe');
  /* LA COLONNE DE GAUCHE EST CELLE DU STUDIO (demande du 12/10/2026) : le geste
     qui crée, détaché, « Toutes les créations » et un classement par projet.
     Sur téléphone, le geste reste dans la page. */
  const dansLaColonne = useColonneDeService();
  /** Le projet retenu dans la colonne (son nom, tel que la ligne le porte) ; `null` : tous. */
  const [projetRetenuALaMain, setProjetRetenu] = React.useState<string | null>(null);
  /* DANS L'ONGLET D'UN PROJET (refonte du 13/11/2026) : ses créations seulement, sans classement par projet. */
  const projetDuService = useProjetDuService();
  const projetRetenu = projetDuService?.name ?? projetRetenuALaMain;
  const projetsDesCreations = React.useMemo(() => {
    const comptes = new Map<string, number>();
    for (const c of vue?.creations ?? []) comptes.set(c.projet, (comptes.get(c.projet) ?? 0) + 1);
    return [...comptes].sort((a, b) => a[0].localeCompare(b[0]));
  }, [vue]);
  /* Le filtre est LOCAL (titre et projet, sans casse ni accents) : aucune frappe n'appelle le serveur. */
  const affichees = React.useMemo(() => {
    const cherche = minusculesSansAccents(recherche.trim());
    const toutes = (vue?.creations ?? []).filter((c) => !projetRetenu || c.projet === projetRetenu);
    return cherche ? toutes.filter((c) => minusculesSansAccents(`${c.titre} ${c.projet}`).includes(cherche)) : toutes;
  }, [vue, recherche, projetRetenu]);

  return (
    <>
      {/* Sur téléphone, le nom du service est déjà centré en haut : pas de second titre (03/11/2026). */}
      <TitreDePage className="max-sm:sr-only">{t('Studio')}</TitreDePage>
      {dansLaColonne ? (
        <ColonneDeService>
          <nav aria-label="Rubriques du studio" data-colonne-studio className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
            <GesteDeCreationDeColonne
              libelle={t('Nouvelle création')}
              aria-label="Nouvelle création"
              data-studio-nouvelle
              onClick={() => setNouvelle(true)}
            />
            {projetDuService ? null : (
              <RubriqueDeColonne
                icone={<Clapperboard />}
                libelle={t('Toutes les créations')}
                compte={vue?.creations.length}
                actif={projetRetenu === null}
                onClick={() => setProjetRetenu(null)}
                data-studio-rubrique="toutes"
              />
            )}
            {!projetDuService && (projetsDesCreations.length > 1 || projetRetenu) ? <p className={CLASSE_SECTION_DE_SERVICE}>{t('Par projet')}</p> : null}
            {!projetDuService && (projetsDesCreations.length > 1 || projetRetenu)
              ? projetsDesCreations.map(([nom, nombre]) => (
                  <RubriqueDeColonne
                    key={nom}
                    icone={<Globe />}
                    libelle={nom}
                    compte={nombre}
                    actif={projetRetenu === nom}
                    onClick={() => setProjetRetenu(nom)}
                    data-studio-rubrique-projet={nom}
                  />
                ))
              : null}
          </nav>
        </ColonneDeService>
      ) : (
        <GestePrincipal>
          <BoutonPrincipal onClick={() => setNouvelle(true)} data-studio-nouvelle>
            <Plus className="h-3.5 w-3.5" />
            {t('Nouvelle création')}
          </BoutonPrincipal>
        </GestePrincipal>
      )}
      <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
        {vue === null ? (
          <SilhouetteStudio />
        ) : projetDuService && !affichees.length && !recherche ? (
          /* UN PROJET SANS CRÉATION, OUVERT EN ONGLET : il le dit, et propose de commencer. */
          <EtatVideDuProjet
            icone={<Clapperboard />}
            titre={t('Aucune création pour {v0}', { v0: projetDuService.name })}
            texte={t('Une création est un visuel ou une courte vidéo animée, que l’agent du studio dessine pour vous et que vous exportez aux formats des réseaux.')}
            action={t('Nouvelle création')}
            onAction={() => setNouvelle(true)}
            fond={<SilhouetteStudio vignettes={9} />}
            data-studio-vide-projet
          />
        ) : !vue.creations.length ? (
          <div data-studio-vide>
            <PasAPas
              repere="studio"
              titre={t('Aucune création pour l’instant.')}
              explication={t('Une création est un visuel ou une courte vidéo animée, faite de pièces séparées qu’on retouche à tout moment. L’agent du studio les dessine pour vous, puis vous l’exportez aux formats des réseaux.')}
              etapes={[
                t('Cliquez sur « Nouvelle création » et décrivez ce que vous voulez.'),
                t('L’agent du studio la dessine ; retouchez chaque pièce à votre goût.'),
                t('Exportez-la aux formats des réseaux.'),
              ]}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* LA LOUPE EN HAUT À DROITE SUR ORDINATEUR, avant « Nouvelle création » (carte « Refonte de l'espace Médias ») ; le
                champ pleine largeur au téléphone. */}
            <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher une création…')} aria-label="Rechercher une création" data-studio-recherche />
            <BasculeDePage>
              <BasculeTableauCartes repere="vue-du-studio" valeur={vueDeLaListe} onChange={setVueDeLaListe} />
            </BasculeDePage>
            {affichees.length ? (
              vueDeLaListe === 'tableau' ? (
                /* LE TABLEAU PAR DÉFAUT (carte « Onglets, services et listes repensés », 14/11/2026) : affiche, titre et
                   projet, formats, durée, mise à jour ; l'affiche en grand au survol. Les vignettes restent l'autre vue. */
                <ApercuAuSurvol lire={(id) => affichees.find((c) => c.id === id)} rendu={(c) => <ApercuDeCreation creation={c} />}>
                  <Tableau
                    repere="studio"
                    lignes={affichees}
                    cle={(c) => c.id}
                    onLigne={(c) => onOuvrir(c.id)}
                    aere
                    attributsRacine={{ 'data-studio-liste': '' }}
                    attributsLigne={(c) => ({ 'data-studio-creation': c.id })}
                    colonnes={colonnesDuStudio()}
                    pile={(c) => (
                      <>
                        <ApercuDeLigne piece={c.afficheId} genre="image" taille={36} />
                        <span className="min-w-0 flex-1">
                          <TitreEtSous titre={c.titre} sous={c.projet} />
                        </span>
                        <span className="shrink-0 text-[11.5px] text-faint">{dateDeLigne(c.majLe)}</span>
                      </>
                    )}
                  />
                </ApercuAuSurvol>
              ) : (
                /* UNE SEULE RANGÉE POUR TOUT : des vignettes de taille fixe (même forme 4/5), qui passent à la ligne. */
                <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-4" data-studio-liste>
                  {affichees.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onOuvrir(c.id)}
                      className="flex flex-col overflow-hidden rounded-xl bg-surface text-left transition-colors hover:bg-raised"
                      data-studio-creation={c.id}
                    >
                      <span className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-raised">
                        {/* L'image remplit la boîte SANS la tirer : une affiche verticale ne rend pas sa vignette plus haute. */}
                        {c.afficheId ? (
                          <img src={`/api/attachment?id=${encodeURIComponent(c.afficheId)}`} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Clapperboard className="h-5 w-5 text-faint" />
                        )}
                      </span>
                      <span className="flex flex-col gap-0.5 px-2 py-1.5">
                        <span className="truncate text-[12.5px] font-medium text-text">{c.titre}</span>
                        <span className="truncate text-[11px] text-muted" data-studio-creation-projet>
                          {c.projet}
                        </span>
                        <span className="truncate text-[11px] text-faint">
                          {c.formats.map(libelleFormat).join(' · ')} · {(Math.round(c.duree * 10) / 10).toLocaleString(formatRegional())} s
                        </span>
                        {c.voixEnEssai ? <span className="text-[11px] text-en-cours">{t('{n} voix d’essai', { n: c.voixEnEssai })}</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <p className="px-1 py-4 text-[13.5px] text-muted" data-studio-aucun-resultat>
                {t('Aucune création ne correspond à cette recherche.')}
              </p>
            )}
          </div>
        )}
      </ZoneDefilement>
      {nouvelle ? <NouvelleCreation projets={vue?.projets ?? []} onClose={() => setNouvelle(false)} onCree={onOuvrir} /> : null}
    </>
  );
}

function NouvelleCreation({ projets, onClose, onCree }: { projets: { id: string; name: string }[]; onClose: () => void; onCree: (id: string) => void }) {
  const state = useApp();
  const [projet, setProjet] = React.useState(state.activeProjectId && projets.some((p) => p.id === state.activeProjectId) ? state.activeProjectId : (projets[0]?.id ?? ''));
  const [titre, setTitre] = React.useState('');
  /* TOUS LES FORMATS COCHÉS D'OFFICE (31/10/2026) : l'export ne propose que ceux de la création ; on décoche ce qui ne sert pas. */
  const [formats, setFormats] = React.useState<FormatStudio[]>([...CLES_FORMATS_STUDIO]);
  /* PARTIR D'UN MODÈLE : les vidéos validées du projet choisi. */
  const [modeles, setModeles] = React.useState<ResumeModele[]>([]);
  const [modele, setModele] = React.useState('');
  React.useEffect(() => {
    let vivant = true;
    setModele('');
    if (!projet) return;
    client
      .call<{ modeles: ResumeModele[] }>({ type: 'studio.modele.lister', projectId: projet })
      .then((r) => vivant && setModeles(r.modeles))
      .catch(() => vivant && setModeles([]));
    return () => {
      vivant = false;
    };
  }, [projet]);
  /* UNE CRÉATION, UN CLIC : le bouton tourne pendant l'appel et n'en part qu'un ;
     un refus se dit, et le volet reste ouvert pour réessayer. */
  const [enCours, setEnCours] = React.useState(false);
  const creer = async () => {
    if (enCours) return;
    setEnCours(true);
    try {
      const r = await client.call<{ creation: { id: string } }>(
        modele
          ? { type: 'studio.creation.creer', projectId: projet, titre: titre.trim() || undefined, depuisModele: modele }
          : { type: 'studio.creation.creer', projectId: projet, titre: titre.trim() || undefined, formats },
      );
      onClose();
      onCree(r.creation.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Création impossible'));
    } finally {
      setEnCours(false);
    }
  };
  return (
    <Drawer open onClose={onClose} empile>
      <header className="shrink-0 px-3 pb-2">
        <EnteteDeFenetre titre={t('Nouvelle création')} onRetour={onClose} />
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-3">
        <div className="text-[13.5px]" data-studio-formulaire>
          <FormulaireEnColonnes>
            <LigneFormulaire libelle={t('Projet')}>
              <ListeDeroulante
                valeur={projet}
                titre={t('Projet')}
                repere="studio-projet"
                data-studio-projet
                onChoisir={setProjet}
                empile
                options={projets.map((p) => ({ valeur: p.id, libelle: p.name }))}
              />
            </LigneFormulaire>
            {modeles.length ? (
              <LigneFormulaire libelle={t('Partir de')}>
                <ListeDeroulante
                  valeur={modele}
                  titre={t('Partir de')}
                  repere="studio-depuis-modele"
                  data-studio-depuis-modele
                  onChoisir={setModele}
                  empile
                  options={[
                    { valeur: '', libelle: t('Une création vierge') },
                    ...modeles.map((m) => ({ valeur: m.id, libelle: m.titre, detail: t('Modèle · {d} s · {n} scène(s)', { d: Math.round(m.duree * 10) / 10, n: m.scenes }) })),
                  ]}
                />
              </LigneFormulaire>
            ) : null}
            <LigneFormulaire libelle={t('Titre')}>
              <Input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder={t('Lancement de la nouvelle offre')} data-studio-titre />
            </LigneFormulaire>
            {modele ? null : <LigneFormulaire libelle={t('Formats')}>
              {CLES_FORMATS_STUDIO.map((f) => (
                <label key={f} className="flex min-h-7 items-center gap-2">
                  <CaseACocher
                    checked={formats.includes(f)}
                    onCheckedChange={(coche) => setFormats((x) => (coche ? [...x, f] : x.filter((y) => y !== f)))}
                    data-studio-format-coche={f}
                  />
                  {libelleFormat(f)} <span className="text-faint">({f}, {FORMATS_STUDIO[f].largeur}×{FORMATS_STUDIO[f].hauteur})</span>
                </label>
              ))}
            </LigneFormulaire>}
          </FormulaireEnColonnes>
        </div>
      </ZoneDefilement>
      <DialogFooter pleineLargeur>
        <Button variant="default" size="lg" disabled={enCours || !projet || (!modele && !formats.length)} onClick={creer} data-studio-creer>
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('Créer')}
        </Button>
      </DialogFooter>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* L'éditeur                                                            */
/* ------------------------------------------------------------------ */

/**
 * CE QUE MONTRE LE VOLET DE L'ATELIER. Ordinateur : TOUJOURS la conversation (31/10/2026 : plus aucune rubrique ne
 * prend sa place). Téléphone : Montage / Agent / Réglages en onglets, le reste par le menu à trois points.
 */
type Panneau = 'montage' | 'agent' | 'reglages';
/**
 * LES TIROIRS DE L'ATELIER, MÊME SUR ORDINATEUR (demande du 31/10/2026) : les rubriques de la colonne de gauche
 * (Médias, Téléchargements, Style), la bibliothèque de styles (icône du champ d'écriture, ou « Voir la
 * bibliothèque » d'une question du directeur) et, au téléphone, les archives. Voix et exports vivent dans la
 * fenêtre « Construction ».
 */
type TiroirDeLAtelier = 'medias' | 'fichiers' | 'style' | 'styles' | 'archives';

/** Ce que l'éditeur lit du magasin, et RIEN d'autre : une progression d'export ou un message d'une autre carte ne le redessine pas. */
function useVersionDeLaCreation(creationId: string): number {
  return React.useSyncExternalStore(client.subscribe, () => {
    const s = client.lireEtat();
    return (s.studioVersions[creationId] ?? 0) + (s.studioVersions.reprise ?? 0);
  });
}

const StudioPhoto = React.lazy(() => import('@/components/creation/studio-photo'));
const StudioSon = React.lazy(() => import('@/components/creation/studio-son'));
const PageTelechargement = React.lazy(() => import('@/components/creation/page-telechargement'));

function useCarteLue(cardId: string | null): Card | null {
  return React.useSyncExternalStore(client.subscribe, () => (cardId ? (client.lireEtat().cards[cardId] ?? null) : null));
}

/** Un volet qui parle de la carte, avant la première demande : elle naît avec le directeur. */
function AvantLeDirecteur() {
  return <p className="p-3 text-[12.5px] text-muted">{t('Les fichiers à télécharger paraissent ici dès votre première demande au directeur artistique.')}</p>;
}

function useAgentLu(agentId: string | null): Agent | null {
  return React.useSyncExternalStore(client.subscribe, () => (agentId ? (client.lireEtat().agents[agentId] ?? null) : null));
}

export function Editeur({ creationId, onRetour, onOuvrir }: { creationId: string; onRetour: () => void; onOuvrir: (id: string) => void }) {
  const telephone = useTelephone();
  /* Conversation à gauche, volet à droite : pas de ligne de titre au-dessus (22/11/2026). */
  useSansLigneDeTitre();
  /* Sur ordinateur, « Bibliothèque » et « Style » sont des rubriques de la colonne de gauche — sauf dans une carte, qui n'en a pas. */
  const colonneDeService = useColonneDeService();
  const dansLaColonne = colonneDeService;
  // Ordinateur : colonnes, hauteur de la ligne de temps et repli, mémorisés EN BASE (même mise en page partout).
  // Les plafonds suivent LA PLACE DE L'ATELIER, pour qu'on ne puisse pas écraser l'aperçu : la fenêtre moins la
  // colonne de gauche de l'application (`--zone-principale-gauche`, posée par app.tsx). Mesurés sur la fenêtre
  // entière, ils laissaient 194 px à l'aperçu sur un écran de 1440 px, conversation tirée à fond.
  const largeurDeLAtelier =
    window.innerWidth - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zone-principale-gauche')) || 0);
  // LE VOLET N'A PLUS DE PLAFOND À 820 PX (01/11/2026) : la conversation y reste centrée dans sa colonne de 820 px
  // (`CLASSE_CONVERSATION_DU_STUDIO`), le volet peut s'élargir au-delà, avec du vide de chaque côté.
  const voletDeLAgent = useResizable('studio.volet-agent', { initial: 480, min: 320, max: Math.round(largeurDeLAtelier * 0.55) });
  const hauteurTimeline = useResizable('studio.timeline', { axe: 'y', initial: 300, min: 150, max: Math.max(220, Math.round(window.innerHeight * 0.6)) });
  const [timelineOuverte, setTimelineOuverte] = usePref<boolean>('studio.timelineOuverte', true);
  // `reprise` avance après une coupure : la création ouverte se relit même si aucun signal ne l'a nommée.
  const version = useVersionDeLaCreation(creationId);
  const [donnees, setDonnees] = React.useState<DonneesCreation | null>(null);
  const [temps, setTemps] = React.useState(0);
  /** La création dont l'instant d'ouverture est déjà posé : une nouvelle version ne déplace pas la tête de lecture. */
  const instantPose = React.useRef<string | null>(null);
  const [lecture, setLecture] = React.useState(false);
  const [muet, setMuet] = React.useState(false);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [element, setElement] = React.useState<string | null>(null);
  const [format, setFormat] = React.useState<FormatStudio | null>(null);
  /* UN SEUL VOLET, DES ONGLETS, AUCUN TIROIR : la conversation d'abord sur ordinateur, la ligne de temps d'abord au téléphone. */
  const [onglet, setOnglet] = React.useState<Panneau>(telephone ? 'montage' : 'agent');
  /** Le tiroir ouvert par-dessus l'atelier : une rubrique de la colonne, la bibliothèque de styles ou les archives. */
  const [tiroir, setTiroir] = React.useState<TiroirDeLAtelier | null>(null);
  /* « VOIR LA BIBLIOTHÈQUE », depuis une question du directeur : le tiroir des styles s'ouvre (`bibliotheque-du-studio.ts`). */
  React.useEffect(() => {
    const ouvrir = (event: Event) => {
      (event as CustomEvent<{ recu: boolean }>).detail.recu = true;
      setTiroir('styles');
    };
    window.addEventListener(EVENEMENT_BIBLIOTHEQUE_DU_STUDIO, ouvrir);
    return () => window.removeEventListener(EVENEMENT_BIBLIOTHEQUE_DU_STUDIO, ouvrir);
  }, []);
  /* LES ÉCOUTES DES VOIX DÉJÀ FABRIQUÉES SE CHARGENT À L'OUVERTURE : le choix de la voix finale joue sans attendre. */
  usePrechargementDesExtraits();
  const [renommer, setRenommer] = React.useState(false);
  const [supprimer, setSupprimer] = React.useState(false);
  const [erreursDuCadre, setErreursDuCadre] = React.useState<string[]>([]);
  /** LA FENÊTRE D'ÉDITION D'UN ÉLÉMENT (double-clic, ou « Ouvrir l'éditeur » sur l'aperçu). */
  const [editeur, setEditeur] = React.useState<{ segmentId: string; elementId: string | null } | null>(null);
  /* LA BULLE DE RÉGLAGES DE LA FRISE : le bloc cliqué (sans glisser), ou rien (`bulle-de-reglages.tsx`). */
  const [bulle, setBulle] = React.useState<string | null>(null);
  const fermerLaBulle = React.useCallback(() => setBulle(null), []);
  /* LE MODE « ARRIVÉE » (« Régler l'arrivée » du menu d'options) : le bloc dont on tire l'arrivée du trajet dans l'aperçu. */
  const [arrivee, setArrivee] = React.useState<string | null>(null);
  /** TÉLÉPHONE : l'aperçu prend toute la hauteur, le bas s'efface. */
  const [apercuPlein, setApercuPlein] = React.useState(false);
  const clavierOuvert = useClavierOuvert();
  /* Une autre sélection (clic ailleurs, Maj+clic, aperçu) referme la bulle du bloc d'avant. */
  React.useEffect(() => {
    if (bulle && !(selection.length === 1 && selection[0] === bulle)) setBulle(null);
  }, [selection, bulle]);
  /** LA PIÈCE CHOISIE telle que l'aperçu la voit (nature, vraies couleurs, texte) : l'inspecteur part de là. */
  const [boite, setBoite] = React.useState<BoiteDuCadre | null>(null);
  /** LA FENÊTRE « CONSTRUCTION » (voix finale, modèle, export). */
  const [production, setProduction] = React.useState(false);
  useTiroirAdresse('production-studio', production, setProduction);
  const apercu = React.useRef<PoigneeApercu | null>(null);
  /** Une couleur choisie dans l'inspecteur se voit dans l'aperçu PENDANT le choix. */
  const direct = React.useCallback((m: ApercuDirect) => apercu.current?.direct(m), []);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<DonneesCreation>({ type: 'studio.creation.ouvrir', id: creationId })
      .then((r) => {
        if (!vivant) return;
        /* L'INSTANT D'OUVERTURE, posé une seule fois par création : la tête de lecture laissée, sinon un instant
           parlant — à 0 les pièces entrent en fondu, le cadre est vide (`shared/src/studio-ouverture.ts`). */
        if (instantPose.current !== creationId) {
          instantPose.current = creationId;
          setTemps(instantDOuverture({ pistes: r.composition.pistes, duree: dureeExportee(r.composition), curseurRetenu: r.curseurRetenu }));
        }
        setDonnees(r);
        setFormat((f) => (f && r.creation.formats.includes(f) ? f : r.creation.formats[0] ?? r.composition.format));
      })
      .catch((err: any) => {
        if (!vivant) return;
        client.pushToast('error', err?.message ?? t('Création introuvable'));
        onRetour();
      });
    return () => {
      vivant = false;
    };
  }, [creationId, version]);

  const composition = donnees?.composition;
  /* La création ouverte range le fil sous SON projet. */
  useProjetDeLObjetOuvert(donnees?.creation.projectId ? [donnees.creation.projectId] : null);
  const rythme = useRythme(creationId, donnees?.creation.version ?? 0);
  /* L'AGENT DE LA CRÉATION TRAVAILLE : le témoin suit l'agent (tour vivant, ou statut en cours), pas un message.
     Tant qu'il travaille, la barre du haut est grisée à 50 % et sans effet — ses gestes se marcheraient dessus. */
  /*
   * LA CONVERSATION EST CELLE DE LA CARTE DE LA CRÉATION : son directeur artistique,
   * qu'elle soit née au Studio ou montée depuis une carte caméra (un seul fil). Une
   * création d'avant le retour du Studio n'a pas de directeur (agent de volet, rôle
   * « task ») : son premier message en ouvre un.
   */
  const cardId = donnees?.creation.cardId ?? null;
  const carte = useCarteLue(cardId);
  const agentId = carte?.agentId ?? donnees?.creation.agentId ?? null;
  const agentLu = useAgentLu(agentId);
  const agentDeLaCreation = agentLu?.role === 'cadrage' ? agentLu : null;
  const agentTravaille = agentDeLaCreation ? agentTientSonTour(agentDeLaCreation) : false;
  /*
   * LE TÉLÉPHONE DANS UNE CRÉATION (03/11/2026, maquette 5) : en haut, la flèche de retour et le NOM de la création,
   * centré, qui ouvre la liste des créations ; en bas, Médias, Téléchargements, Style et Archives, chacun en tiroir.
   */
  useDeclarerLeNiveauDuBas(telephone ? 'studio-creation' : null);
  const etatDeProduction = donnees
    ? etatDuBoutonDeProduction({ composition: donnees.composition, depenses: donnees.depenses, agentTravaille })
    : { pret: false, raison: CLE_CHARGEMENT_DE_LA_CREATION };
  const gestesDuBas = React.useMemo<GestesDuBas | null>(
    () =>
      telephone
        ? {
            'medias-studio': { libelle: t('Médias'), icone: <Images />, actif: tiroir === 'medias', onClick: () => setTiroir('medias') },
            telechargements: { libelle: t('Téléchargements'), court: t('Fichiers'), icone: <Download />, actif: tiroir === 'fichiers', onClick: () => setTiroir('fichiers') },
            style: { libelle: t('Style'), icone: <Palette />, actif: tiroir === 'style', desactive: agentTravaille, onClick: () => setTiroir('style') },
            archives: { libelle: t('Archives'), icone: <History />, actif: tiroir === 'archives', onClick: () => setTiroir('archives') },
            /* LE ROND VIOLET DU CENTRE : la « Construction » (version finale et export), comme sur ordinateur. Éteinte, elle
               dit pourquoi au lieu de rester muette. */
            'mise-en-production': {
              libelle: t('Construction'),
              icone: <Hammer />,
              onClick: () => (etatDeProduction.pret ? setProduction(true) : client.pushToast('info', t(etatDeProduction.raison ?? 'Pas encore prêt'))),
            },
          }
        : null,
    [telephone, tiroir, agentTravaille, etatDeProduction.pret, etatDeProduction.raison],
  );
  useDeclarerLesGestesDuBas(gestesDuBas);
  const [creationsDuHaut, setCreationsDuHaut] = React.useState<LigneCreation[] | null>(null);
  React.useEffect(() => {
    if (!telephone) return;
    let vivant = true;
    client
      .call<{ creations: LigneCreation[] }>({ type: 'studio.lister' })
      .then((r) => vivant && setCreationsDuHaut(r.creations))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [telephone]);
  const titreDeLaCreation = donnees?.creation.titre ?? null;
  const etageDuHaut = React.useMemo<EtageDuProjet | null>(
    () =>
      telephone && titreDeLaCreation
        ? {
            libelle: titreDeLaCreation,
            valeur: creationId,
            titre: t('Créations'),
            genre: 'creations',
            options: (creationsDuHaut ?? [{ id: creationId, titre: titreDeLaCreation } as LigneCreation]).map((c) => ({ valeur: c.id, libelle: c.titre })),
            onChoisir: (id) => {
              if (id !== creationId) onOuvrir(id);
            },
          }
        : null,
    [telephone, titreDeLaCreation, creationId, creationsDuHaut, onOuvrir],
  );
  useDeclarerLeProjetDuHaut(etageDuHaut);
  const documentDeLaCarte = useDocumentDeCarte(cardId ?? undefined);
  React.useEffect(() => {
    /* UN GESTE DU PARCOURS OUVRE SA PAGE DES FICHIERS : ici, le tiroir « Téléchargements ». Le suivi n'a plus de volet au Studio. */
    if (documentDeLaCarte?.genre === 'telechargement' || documentDeLaCarte?.genre === 'studio-photo' || documentDeLaCarte?.genre === 'studio-son') setTiroir('fichiers');
  }, [documentDeLaCarte]);
  React.useEffect(() => {
    if (cardId && !carte) void client.chargerCarte(cardId);
  }, [cardId, !!carte]);
  /* LE FIL DE LA CARTE, DEMANDÉ COMME LE FAIT SON VOLET : sans cela, la conversation reste sur sa silhouette. */
  React.useEffect(() => {
    if (cardId) client.ouvrirLesDonneesDeCarte(cardId);
  }, [cardId]);
  React.useEffect(() => {
    // Sur téléphone, le volet de l'agent n'est pas monté : sans cela, son travail resterait invisible d'ici.
    if (agentId && !agentDeLaCreation) void client.chargerAgent(agentId);
  }, [agentId, !!agentDeLaCreation]);
  // La vidéo dure jusqu'au marqueur bleu : la lecture s'y arrête, comme l'export.
  const duree = composition ? dureeExportee(composition) : 0;
  const formatAffiche: FormatStudio = format ?? composition?.format ?? '9:16';

  /* LA SÉLECTION PART AU SERVEUR (un peu après le dernier geste) : l'agent la
     lit avec chaque demande — « ce titre », « ici » désignent ce qu'on regarde. */
  React.useEffect(() => {
    if (!donnees) return;
    const minuteur = window.setTimeout(() => {
      void client
        .call({ type: 'studio.selection', creationId, segmentIds: selection, ...(element ? { elementId: element } : {}), curseur: temps, format: formatAffiche })
        .catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(minuteur);
  }, [selection, element, lecture ? Math.floor(temps) : temps, formatAffiche, !!donnees]);

  const operer = React.useCallback(
    async (op: OperationStudio) => {
      try {
        const r = await client.call<{ composition: DonneesCreation['composition']; annulerRetablir: DonneesCreation['annulerRetablir'] }>({ type: 'studio.operation', creationId, operation: op });
        setDonnees((d) => (d ? { ...d, composition: r.composition, annulerRetablir: r.annulerRetablir } : d));
        return r;
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Geste refusé'));
        throw err;
      }
    },
    [creationId],
  );

  const aller = React.useCallback((x: number) => {
    setLecture(false);
    setTemps(x);
    apercu.current?.aller(x);
  }, []);

  /**
   * « RÉGLER L'ARRIVÉE » : la tête de lecture va à la fin du bloc, sa pièce est choisie, et l'aperçu passe en mode
   * arrivée — la pièce, montrée où elle arrive, se tire là où elle doit arriver (`arrivee-posee`).
   */
  const reglerLArrivee = React.useCallback(
    (segmentId: string) => {
      const s = composition ? trouverSegment(composition, segmentId)?.segment : null;
      if (!s || !aUnTrajetPossible(s.genre)) return;
      setBulle(null);
      setArrivee(segmentId);
      aller(Math.max(s.debut, s.debut + s.duree - 0.02));
      setSelection([segmentId]);
      setElement(s.genre);
      apercu.current?.selectionner(segmentId, s.genre);
    },
    [composition, aller],
  );
  // Le bloc a disparu (supprimé, annulé) : le mode arrivée s'éteint.
  React.useEffect(() => {
    if (arrivee && composition && !trouverSegment(composition, arrivee)) setArrivee(null);
  }, [arrivee, composition]);

  /* APRÈS UNE POSE : la composition rendue, et la tête de lecture sur ce qui vient d'être posé, sauf pendant une lecture. */
  const poseRef = React.useRef<ReturnType<typeof useContexteDePose>>(null);
  const lectureCourante = React.useRef(lecture);
  lectureCourante.current = lecture;
  const montrerLaPose = React.useCallback(
    (segmentId: string | null, debut: number) => {
      if (lectureCourante.current) return;
      aller(debut);
      if (segmentId) setSelection([segmentId]);
    },
    [aller],
  );
  /* LE FOND N'EST PAS UNI : le fichier part dans le champ de l'agent, avec la demande à compléter. */
  const demanderLeFondALAgent = React.useCallback(
    (attachmentId: string) => {
      const projet = donnees?.creation.projectId ?? '';
      const piece = (client.lireEtat().attachments[projet] ?? []).find((p: Attachment) => p.id === attachmentId);
      const cible = agentId ?? cleDuChampSansAgent(creationId);
      setOnglet('agent');
      setApercuPlein(false);
      window.setTimeout(() => {
        if (piece) joindreAuChamp({ agentId: cible, piece });
        joindreAuChamp({ agentId: cible, texte: t('Retire le fond de ce média : il n’est pas uni. ') });
      }, 300);
    },
    [agentId, creationId, donnees?.creation.projectId],
  );
  const apresLaPose = React.useCallback(
    (r: { composition: DonneesCreation['composition']; annulerRetablir: unknown; segmentId: string | null; debut: number }) => {
      setDonnees((d) => (d ? { ...d, composition: r.composition, annulerRetablir: r.annulerRetablir as DonneesCreation['annulerRetablir'] } : d));
      montrerLaPose(r.segmentId, r.debut);
    },
    [montrerLaPose],
  );
  /* UN CHOIX DANS LA CONVERSATION A POSÉ UN MÉDIA : l'écran le montre, sans clic de plus. */
  const aMontrer = React.useSyncExternalStore(client.subscribe, () => client.lireEtat().studioMontrer);
  const dejaMontre = React.useRef(aMontrer?.n ?? 0);
  React.useEffect(() => {
    if (!aMontrer || aMontrer.n === dejaMontre.current) return;
    dejaMontre.current = aMontrer.n;
    if (aMontrer.creationId === creationId) montrerLaPose(aMontrer.segmentId, aMontrer.debut);
  }, [aMontrer, creationId, montrerLaPose]);

  const basculerLecture = React.useCallback(() => {
    if (lecture) {
      apercu.current?.pause();
      setLecture(false);
    } else {
      apercu.current?.lire(temps >= duree - 0.05 ? 0 : temps);
      setLecture(true);
    }
  }, [lecture, temps, duree]);

  const surMessage = React.useCallback(
    (m: MessageDuCadre) => {
      if (m.type === 'pret') {
        setErreursDuCadre(m.erreurs ?? []);
        if (selection[0]) apercu.current?.selectionner(selection[0], element);
      } else if (m.type === 'erreurs') setErreursDuCadre(m.liste ?? []);
      else if (m.type === 'temps' && typeof m.t === 'number') setTemps(m.t);
      else if (m.type === 'fin') {
        setLecture(false);
        if (typeof m.t === 'number') setTemps(m.t);
      } else if (m.type === 'selection') {
        setSelection(m.segmentId ? [m.segmentId] : []);
        setElement(m.elementId ?? null);
        /* Sur téléphone, la pièce touchée garde l'écran : sa barre de boutons est posée sur l'image
           (« Ouvrir l'éditeur » mène à ses réglages) — plus de tiroir qui la recouvre d'office. */
      } else if (m.type === 'arrivee-posee' && m.segmentId && composition) {
        /* LE DÉCALAGE TIRÉ EN MODE ARRIVÉE s'ajoute à l'arrivée du trajet ; le départ ne bouge pas. */
        const s = trouverSegment(composition, m.segmentId)?.segment;
        if (!s || (!m.dx && !m.dy)) return;
        const avant = s.trajet?.arrivee ?? s.trajet?.depart ?? { x: 0, y: 0 };
        const trajet = { ...(s.trajet?.depart ? { depart: s.trajet.depart } : {}), arrivee: { x: avant.x + (m.dx ?? 0), y: avant.y + (m.dy ?? 0) } };
        void operer({ op: 'proprietes', segmentId: m.segmentId, valeurs: { trajet } }).catch(() => undefined);
      } else if (m.type === 'retouche' && m.segmentId && m.elementId && m.retouche) {
        void operer({ op: 'retouche', segmentId: m.segmentId, elementId: m.elementId, retouche: m.retouche, format: formatAffiche }).catch(() => undefined);
      } else if (m.type === 'effacer' && m.segmentId && m.elementId) {
        // « Remettre comme à l'origine » : la retouche de la pièce s'efface (une version, annulable).
        void operer({ op: 'effacer-retouche', segmentId: m.segmentId, elementId: m.elementId, format: formatAffiche }).catch(() => undefined);
      } else if (m.type === 'texte' && m.segmentId && m.elementId && typeof m.texte === 'string') {
        void operer({ op: 'retouche', segmentId: m.segmentId, elementId: m.elementId, retouche: { texte: m.texte }, format: formatAffiche }).catch(() => undefined);
      }
    },
    [operer, formatAffiche, selection, element, telephone, composition],
  );

  const choisir = React.useCallback((segmentId: string | null, ajouter: boolean) => {
    setElement(null);
    if (!segmentId) {
      setSelection([]);
      apercu.current?.selectionner(null);
      return;
    }
    setSelection((s) => (ajouter ? (s.includes(segmentId) ? s.filter((x) => x !== segmentId) : [...s, segmentId]) : [segmentId]));
    apercu.current?.selectionner(segmentId, null);
  }, []);

  /**
   * LE DOUBLE-CLIC (bloc, calque) et « Ouvrir l'éditeur » : la sélection est
   * posée, et la FENÊTRE D'ÉDITION de l'élément s'ouvre (réglages et bande du
   * temps), quel que soit l'onglet affiché.
   */
  const ouvrirEditeur = React.useCallback((segmentId: string, elementId: string | null = null) => {
    setSelection([segmentId]);
    setElement(elementId);
    apercu.current?.selectionner(segmentId, elementId);
    setEditeur({ segmentId, elementId });
  }, []);

  const annuler = React.useCallback(() => client.call({ type: 'studio.annuler', creationId }).catch((err: any) => client.pushToast('info', err?.message ?? '')), [creationId]);
  const retablir = React.useCallback(() => client.call({ type: 'studio.retablir', creationId }).catch((err: any) => client.pushToast('info', err?.message ?? '')), [creationId]);

  /* LES RACCOURCIS : espace (lire), flèches (une image, ou une seconde avec Maj — ou, une pièce choisie, la pousser d'un pixel), Suppr, Ctrl+Z / Ctrl+Maj+Z, S (couper). */
  React.useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;
      // Dans la bulle de réglages, la touche sert au champ ou au bouton visé, jamais au montage derrière.
      if (cible?.closest?.('[data-bulle-reglages]')) return;
      // La fenêtre d'édition ouverte ne garde que annuler / rétablir : Suppr ou Espace y viseraient l'éditeur derrière.
      if (editeur && !((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key))) return;
      // L'agent travaille : annuler, rétablir et supprimer sont bloqués au clavier comme à la souris.
      if (agentTravaille && ((e.ctrlKey || e.metaKey) ? /^[zy]$/i.test(e.key) : e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && arrivee) {
        e.preventDefault();
        setArrivee(null);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        basculerLecture();
      } else if (FLECHES[e.key] && element && selection.length === 1 && apercu.current?.decaler(FLECHES[e.key]![0] * (e.shiftKey ? 10 : 1), FLECHES[e.key]![1] * (e.shiftKey ? 10 : 1))) {
        // UNE PIÈCE CHOISIE SUR L'APERÇU : les flèches la poussent d'un pixel (dix avec Maj), la tête de lecture ne bouge pas.
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const pas = e.shiftKey ? 1 : 1 / 30;
        aller(Math.max(0, Math.min(duree, temps + (e.key === 'ArrowLeft' ? -pas : pas))));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        void operer(selection.length > 1 ? { op: 'lot', operations: selection.map((segmentId) => ({ op: 'supprimer', segmentId }) as OperationStudio) } : { op: 'supprimer', segmentId: selection[0]! }).catch(() => undefined);
        setSelection([]);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? retablir() : annuler());
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void retablir();
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && selection.length === 1) {
        void operer({ op: 'scinder', segmentId: selection[0]!, a: temps }).catch(() => undefined);
      }
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [basculerLecture, aller, duree, temps, selection, element, operer, annuler, retablir, editeur, agentTravaille, arrivee]);

  const voixEssai = React.useCallback(
    async (segmentId?: string) => {
      try {
        const r = await client.call<{ faites: number }>({ type: 'studio.voix.essai', creationId, ...(segmentId ? { segmentId } : {}) });
        client.pushToast('success', t('{n} voix d’essai prête(s).', { n: r.faites }));
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Voix d’essai impossible'));
      }
    },
    [creationId],
  );

  if (!donnees || !composition) {
    return (
      <div className="px-3">
        <SilhouetteStudio />
      </div>
    );
  }

  const choisi = selection.length === 1 ? selection[0]! : null;
  const choisirPiece = (id: string | null) => {
    setElement(id);
    if (choisi) apercu.current?.selectionner(choisi, id);
    setEditeur((e) => (e ? { ...e, elementId: id } : e));
  };
  /** Une pièce choisie depuis la colonne : son dessin peut ne pas être celui de la ligne de temps — on le choisit avec. */
  const images = donnees.medias.filter((m) => m.genre === 'image').map((m) => ({ valeur: m.id, libelle: m.nom }));
  /** « Modifier » sur une image de l'aperçu : un fichier de la bibliothèque, ou un nouveau importé. */
  const changerImage = (boite: BoiteDuCadre, valeur: string) => {
    if (!boite.segmentId) return;
    const poser = (mediaId: string) =>
      void operer(
        boite.image === 'parametre' && boite.parametre
          ? { op: 'parametre', segmentId: boite.segmentId!, id: boite.parametre, valeur: mediaId }
          : { op: 'remplacer-media', segmentId: boite.segmentId!, mediaId },
      ).catch(() => undefined);
    if (valeur === '__importer') void choisirEtImporter(donnees, 'image/*', (m) => poser(m.id));
    else if (valeur) poser(valeur);
  };
  /**
   * CHOISIR UN STYLE DE LA BIBLIOTHÈQUE (31/10/2026) : il se pose en ÉTIQUETTE dans le champ d'écriture, comme une
   * pièce jointe — sa vignette, nommée « Style <titre> » (`studio.style.joindre`) —, au curseur. Rien ne part :
   * l'utilisateur écrit avant ou après, puis envoie. Le champ suit le directeur, ou la création avant sa naissance.
   */
  const choisirStyle = async (style: StyleDeLaGalerie) => {
    try {
      const { attachment } = await client.call<{ attachment: Attachment }>({ type: 'studio.style.joindre', creationId, styleId: style.id });
      setTiroir(null);
      const cible = agentId ?? cleDuChampSansAgent(creationId);
      if (joindreAuChamp({ agentId: cible, piece: attachment })) return;
      /* Le champ n'est pas à l'écran (téléphone sur un autre onglet) : on l'y ramène, puis la pièce s'y pose. */
      setOnglet('agent');
      window.setTimeout(() => joindreAuChamp({ agentId: cible, piece: attachment }), 300);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Style impossible à joindre'));
    }
  };
  /** LES BOUTONS DU STUDIO DANS LE CHAMP D'ÉCRITURE : la bibliothèque de styles, puis le menu des modèles de fabrication. */
  const outilsDuChamp = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        disabled={agentTravaille}
        title={agentTravaille ? t('L’agent travaille') : t('Bibliothèque de styles')}
        aria-label="Bibliothèque de styles"
        onClick={() => setTiroir('styles')}
        data-studio-ouvrir-bibliotheque
      >
        <Library className="h-3.5 w-3.5" />
      </Button>
      <MenuDesModeles donnees={donnees} />
    </>
  );
  const contenuDuPanneau = (p: Panneau): React.ReactNode => {
    if (p === 'agent')
      return (
        <PanneauAgent
          donnees={donnees}
          agent={agentDeLaCreation}
          carte={carte}
          outilsDuChamp={outilsDuChamp}
          agentTravaille={agentTravaille}
          onProduction={() => setProduction(true)}
        />
      );
    if (p === 'reglages')
      return (
        <Inspecteur
          composition={composition}
          segmentId={choisi}
          elementId={element}
          format={formatAffiche}
          temps={temps}
          medias={donnees.medias}
          voixEssai={donnees.voixEssai}
          onOperation={operer}
          onVoixEssai={(id) => voixEssai(id)}
          piece={boite}
        />
      );
    return null;
  };

  /** AU TÉLÉPHONE SEULEMENT, la rangée d'onglets : Montage, Agent, Réglages — le reste vit dans le menu à trois points. */
  const onglets: { cle: Panneau; libelle: string; Icone: typeof Bot }[] = [
    { cle: 'montage', libelle: t('Montage'), Icone: Clapperboard },
    { cle: 'agent', libelle: t('Agent'), Icone: Bot },
    { cle: 'reglages', libelle: t('Réglages'), Icone: SlidersHorizontal },
  ];
  const rangeeDesOnglets = (
    <div className="grid w-full grid-cols-3 gap-1" aria-label="Volet de l’atelier" role="navigation" data-studio-onglets>
      {onglets.map((o) => (
        <Button
          key={o.cle}
          size="sm"
          variant={onglet === o.cle && !apercuPlein ? 'subtle' : 'ghost'}
          className="w-full justify-center"
          onClick={() => {
            setOnglet(o.cle);
            setApercuPlein(false);
          }}
          aria-pressed={onglet === o.cle}
          aria-label={`Onglet ${o.cle}`}
          title={o.libelle}
          data-studio-ouvrir={o.cle}
        >
          <o.Icone className="h-3.5 w-3.5" />
          {o.libelle}
        </Button>
      ))}
    </div>
  );
  /* ANNULER ET RÉTABLIR : dans la barre d'en-tête sur ordinateur ; sur téléphone,
     dans la rangée de l'aperçu, à côté du son et de la lecture — on s'en sert
     sans arrêt, ils restent à un seul appui au lieu de partir dans un menu. */
  const annulerEtRetablir = (
    <>
      <Button variant="ghost" size="icon" aria-label="Annuler" title={agentTravaille ? t('L’agent travaille') : t('Annuler (Ctrl+Z)')} className={BLOQUE} disabled={agentTravaille || !donnees.annulerRetablir.annuler} onClick={annuler} data-studio-annuler>
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Rétablir" title={agentTravaille ? t('L’agent travaille') : t('Rétablir (Ctrl+Maj+Z)')} className={BLOQUE} disabled={agentTravaille || !donnees.annulerRetablir.retablir} onClick={retablir} data-studio-retablir>
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
    </>
  );
  /* La conversation gère son propre défilement ; l'inspecteur défile dans sa zone. Sur ordinateur, le volet est
     toujours la conversation : les rubriques s'ouvrent en tiroir par-dessus. */
  const voletOuvert =
    onglet === 'agent' || !telephone ? (
      /* AU TÉLÉPHONE, la conversation pose elle-même ses marges : sous celles de la page, elle se serrait de deux fois 16 px (capture #4582). */
      <div className={cn('flex min-h-0 flex-1 flex-col', telephone && '-mx-4')}>
        {/* EN HAUT À DROITE DU FIL (décision du 14/11/2026) : annuler, rétablir et le menu de la création quittent le
            coin de la page pour la colonne de la conversation. Lecture et volume restent sur l'aperçu. */}
        {!telephone ? (
          <div className="flex shrink-0 items-center justify-end gap-0.5 px-2 pb-0.5" data-studio-gestes-du-fil>
            {annulerEtRetablir}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Options de la création" title={t('Options de la création')} className="h-8 w-8 text-muted data-[state=open]:bg-raised" data-studio-menu-creation>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="sm:w-[200px]">
                <DropdownMenuItem onSelect={() => setRenommer(true)} data-studio-renommer>
                  <Pencil className="text-muted" />
                  {t('Renommer')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={agentTravaille} onSelect={() => void dupliquer()} data-studio-dupliquer>
                  <Copy className="text-muted" />
                  {t('Dupliquer')}
                </DropdownMenuItem>
                {/* SUPPRIMER SEUL EN DERNIER, APRÈS UN TRAIT, EN ROUGE (MEM-7808). */}
                <DropdownMenuSeparator />
                <DropdownMenuItem danger disabled={agentTravaille} onSelect={() => setSupprimer(true)} data-studio-supprimer>
                  <Trash2 />
                  {t('Supprimer')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        {contenuDuPanneau('agent')}
      </div>
    ) : (
      <ZoneDefilement fond="hsl(var(--surface))" classeEnveloppe="min-h-0 flex-1" data-studio-volet={onglet}>
        {contenuDuPanneau(onglet)}
      </ZoneDefilement>
    );

  /**
   * LE TIROIR OUVERT, au même dessin sur ordinateur et téléphone : Médias, Téléchargements (la seule liste des
   * fichiers), Style, la bibliothèque de styles, ou les archives (téléphone). UNE FEUILLE DU BAS (demande du
   * 31/10/2026) : un `Drawer` sans `feuille` est une page de zone, et ces options s'ouvraient en page sur ordinateur.
   */
  const titresDesTiroirs: Record<TiroirDeLAtelier, string> = {
    medias: t('Médias'),
    fichiers: t('Téléchargements'),
    style: t('Style'),
    styles: t('Bibliothèque de styles'),
    archives: t('Archives'),
  };
  const tiroirOuvert = tiroir ? (
    <Drawer open onClose={() => setTiroir(null)} feuille empile plein={telephone} hauteurFixe>
      <EnteteDeFeuille titre={titresDesTiroirs[tiroir]} data-entete-tiroir-studio={tiroir} />
      {tiroir === 'medias' ? (
        <PanneauMedias donnees={donnees} />
      ) : tiroir === 'archives' ? (
        <div className="flex min-h-0 flex-1 flex-col px-1 pb-3" data-studio-tiroir="archives">
          <ArchivesDeLaCreation donnees={donnees} bloque={agentTravaille} />
        </div>
      ) : (
        <ZoneDefilement fond="hsl(var(--surface))" className="pb-3" data-studio-tiroir={tiroir}>
          {tiroir === 'style' ? (
            <div className="flex flex-col gap-2 p-3" data-studio-tiroir-style>
              <ReglagesDeComposition composition={composition} onOperation={operer} />
              <PanneauBibliotheque donnees={donnees} temps={temps} onOperation={operer} onOuvrir={onOuvrir} />
            </div>
          ) : tiroir === 'styles' ? (
            <div className="p-3" data-studio-tiroir-bibliotheque>
              <PanneauStyles onAppliquer={(style) => void choisirStyle(style)} />
            </div>
          ) : cardId ? (
            <React.Suspense fallback={null}>
              <div data-studio-telechargements>
                {documentDeLaCarte?.genre === 'studio-photo' ? (
                  <StudioPhoto cardId={cardId} {...(documentDeLaCarte.source ? { source: documentDeLaCarte.source } : {})} />
                ) : documentDeLaCarte?.genre === 'studio-son' ? (
                  <StudioSon cardId={cardId} />
                ) : (
                  <PageTelechargement cardId={cardId} listeSeule />
                )}
              </div>
            </React.Suspense>
          ) : (
            <AvantLeDirecteur />
          )}
        </ZoneDefilement>
      )}
    </Drawer>
  ) : null;

  /** LE « + » D'UNE PISTE : ce qu'elle accepte, posé à l'instant visé, par la même porte que tout autre ajout. */
  const ajouterSurLaPiste = (piste: Piste, quoi: QuoiAjouter, debut: number) => {
    const poser = (segment: Record<string, unknown>) => void poseRef.current?.poser({ segment, pisteId: piste.id, debut });
    if (quoi === 'texte') poser({ genre: 'texte', duree: 3, texte: t('Votre texte'), taille: 96, couleur: '#ffffff', position: { x: 50, y: 50 }, gras: true, entree: 'glisse-haut' });
    else if (quoi === 'voix') poser({ genre: 'voix', duree: 3, texte: '', voixEssai: donnees.espace.voixEssai ?? 'fr_FR-siwis-medium', etat: 'aucune', volume: 1 });
    else if (quoi === 'sous-titres') poser({ genre: 'sous-titres', duree: 3, auto: true, mots: [], motsParGroupe: 2, style: {} });
    else if (quoi === 'dessin')
      poser({
        genre: 'dessin',
        duree: 3,
        nom: t('Fond'),
        gabarit: { html: '<div class="fond" data-studio-id="fond"></div>', css: '.fond{position:absolute;inset:0;background:var(--p-couleur)}', animation: '' },
        parametres: [{ id: 'couleur', type: 'couleur', libelle: t('Couleur'), defaut: '#1d2440' }],
      });
    else
      void choisirEtImporter(donnees, quoi === 'son' ? 'audio/*' : quoi === 'video-importee' ? 'video/*' : 'image/*', (m) => void poseRef.current?.poser({ mediaId: m.id, pisteId: piste.id, debut }));
  };

  /*
   * LES DEUX MOITIÉS DE LA BARRE DE L'ATELIER, posées dans la barre d'en-tête de
   * l'application sur ordinateur COMME SUR TÉLÉPHONE : le nom de la création en
   * dernier cran du fil d'Ariane, les gestes à droite. L'atelier n'a plus de
   * rangée à lui (demande du 11/10/2026).
   */
  /* LE NOM DE LA CRÉATION, SEUL (31/10/2026) : ni le nom du projet derrière lui, ni gestes collés — renommer, dupliquer
     et supprimer vivent dans le menu à trois points, à droite de la barre. */
  const cranDeLaCreation = (
    <button
      type="button"
      className="-mx-1 flex min-w-0 shrink items-baseline gap-2 truncate rounded-md px-1.5 sm:px-1 py-1.5 sm:py-1 text-left transition-colors hover:bg-raised"
      onClick={() => setRenommer(true)}
      title={t('Renommer')}
      data-studio-titre-creation
    >
      <DialogTitle className="truncate text-[14.5px] font-medium">{donnees.creation.titre}</DialogTitle>
    </button>
  );
  const dupliquer = async () => {
    try {
      onOuvrir((await client.call<{ creation: { id: string } }>({ type: 'studio.creation.dupliquer', id: creationId })).creation.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Duplication impossible'));
    }
  };
  const gestesSurLaCreation = (
    <GestesSurLaCreation bloque={agentTravaille} onRenommer={() => setRenommer(true)} onDupliquer={() => void dupliquer()} onSupprimer={() => setSupprimer(true)} />
  );

  /* LA LIGNE DE TEMPS : sur ordinateur, sa hauteur est celle que l'on a choisie (poignée au-dessus) ; repliée, il ne reste que sa barre.
     La poignée est LE SEUL TRAIT entre l'aperçu et la ligne de temps : sa marge haute la pose à mi-chemin des deux.
     SUR ORDINATEUR, ELLE VIT SOUS L'APERÇU, À SA LARGEUR (demande du 14/10/2026) : la conversation, à droite, prend alors
     toute la hauteur de l'atelier, au lieu de s'arrêter au-dessus d'une ligne de temps qui traversait la page. Au
     téléphone, rien ne change : elle suit la rangée de l'aperçu et prend ce qui reste. */
  const ligneDeTemps = (
    <>
      {!telephone && timelineOuverte ? (
        <ResizeHandleHorizontale
          className="mt-1.5"
          onPointerDown={(event) => hauteurTimeline.start(event, 'bottom')}
          onDoubleClick={hauteurTimeline.reset}
          data-studio-poignee="timeline"
        />
      ) : null}
      <div
        className={cn('flex min-h-0 flex-col pt-2', telephone ? 'flex-1' : 'shrink-0')}
        /* UNE HAUTEUR MAXIMALE, PLUS UNE HAUTEUR (14/11/2026) : peu de pistes, la frise s'arrête sous le dernier
           « + Piste » au lieu de laisser un grand vide ; beaucoup, elle défile dans la hauteur choisie. */
        style={!telephone && timelineOuverte ? { maxHeight: hauteurTimeline.size } : undefined}
        data-studio-rangee-ligne-de-temps
      >
        {/* Sans `fond` imposé : le fondu suit le fond de la PAGE qui porte la ligne de temps (un gris de tiroir y laissait une bande). */}
        {/* AUCUN VOILE EN HAUT : la barre et la règle y restent collées, un voile les aurait estompées. */}
        <ZoneDefilement className="px-1 pb-2" sansVoileDebut>
          <LigneDeTemps
            composition={composition}
            adressesMedias={donnees.adressesMedias}
            temps={temps}
            selection={selection}
            onAller={aller}
            onChoisir={choisir}
            onOperation={(op) => void operer(op).catch(() => undefined)}
            onAjouter={ajouterSurLaPiste}
            onReglages={(id) => setBulle(id)}
            onDeplacement={fermerLaBulle}
            rythme={rythme}
            onCalerSurLeRythme={() =>
              void client
                .call({ type: 'studio.rythme.caler', creationId })
                .catch((err: any) => client.pushToast('error', err?.message ?? t('Calage impossible')))
            }
            notes={donnees.notes ?? []}
            creationId={creationId}
            ouverte={telephone || timelineOuverte}
            onBasculer={telephone ? undefined : () => setTimelineOuverte(!timelineOuverte)}
          />
        </ZoneDefilement>
      </div>
    </>
  );

  return (
    <FournisseurDePose
      creationId={creationId}
      composition={composition}
      temps={temps}
      onApres={apresLaPose}
      onRubrique={(visible) => setTiroir(visible ? 'medias' : null)}
      fondsRetires={donnees.fondsRetires}
      onDemanderAuSujetDuFond={demanderLeFondALAgent}
      onGlisser={fermerLaBulle}
    >
    <RelaisDePose cible={poseRef} />
    <ApercuEnDirect.Provider value={direct}>
    <PolicesDuProjet kit={donnees.espace.kit}>
    <div className="flex min-h-0 flex-1 flex-col" data-studio-editeur={creationId}>
      {/* UNE SEULE BARRE D'EN-TÊTE (demande du 11/10/2026 : « pour le studio, il
          faut qu'il n'y ait qu'une header, celle avec le fil d'Ariane ») : la
          création ouverte est le dernier cran du fil — « Services › Studio ›
          Lancement service » —, « Studio » y ramène à toutes les créations, et
          les gestes de l'atelier montent à droite de la barre.
          SUR TÉLÉPHONE AUSSI, depuis la même date : la flèche de retour est dans
          la barre (`retour`), « Bibliothèque » et « Construction » sont
          les lignes du menu à trois points, Annuler / Rétablir vivent dans la
          rangée de l'aperçu. Montage / Agent / Réglages ont pris la bande du bas de
          l'écran (`GestePrincipal`), qui prolonge le fond de la page. */}
      <>
      <SuiteDuFil onRacine={onRetour} retour={{ action: onRetour, reperes: { 'data-studio-retour': '' } }}>
        <SeparateurDuFil />
        {cranDeLaCreation}
        {/* L'ALLER-RETOUR : un montage venu d'une carte y ramène d'un clic. */}
        {cardId && !donnees.creation.agentId ? (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => client.openCard(cardId)} data-studio-retour-carte>
            {t('Revenir à la carte')}
          </Button>
        ) : null}
      </SuiteDuFil>
      {/* LA COLONNE DE GAUCHE PORTE LA CRÉATION OUVERTE : son titre, la flèche qui ramène à la liste, puis Médias,
          Téléchargements et Style — chacun ouvre son TIROIR, même sur ordinateur (31/10/2026) — et, séparées
          d'elles, les ARCHIVES : les vingt dernières modifications, avec leur retour au survol. */}
      <ColonneDeService niveau={{ titre: donnees.creation.titre }}>
        <nav aria-label="Rubriques de la création" data-colonne-studio-creation className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
          <RubriqueDeColonne
            icone={<Images />}
            libelle={t('Médias')}
            actif={tiroir === 'medias'}
            title={t('Les images, vidéos et sons du projet, à écouter et à poser sur la ligne de temps')}
            onClick={() => setTiroir('medias')}
            aria-pressed={tiroir === 'medias'}
            data-studio-ouvrir="medias"
          />
          <RubriqueDeColonne
            icone={<Download />}
            libelle={t('Téléchargements')}
            actif={tiroir === 'fichiers'}
            title={t('Les fichiers de la création, prêts à télécharger')}
            onClick={() => setTiroir('fichiers')}
            aria-pressed={tiroir === 'fichiers'}
            data-studio-ouvrir="fichiers"
          />
          <RubriqueDeColonne
            icone={<Palette />}
            libelle={t('Style')}
            actif={tiroir === 'style'}
            disabled={agentTravaille}
            title={agentTravaille ? t('L’agent travaille') : t('Style : kit de marque, médias et modèles du projet')}
            onClick={() => setTiroir('style')}
            aria-pressed={tiroir === 'style'}
            data-studio-ouvrir="style"
          />
          <ArchivesDeLaCreation donnees={donnees} bloque={agentTravaille} />
        </nav>
      </ColonneDeService>
      {telephone ? (
        <OptionsDeLAtelierAuTelephone
          donnees={donnees}
          bloque={agentTravaille}
          onTiroir={setTiroir}
          gestes={gestesSurLaCreation}
        />
      ) : (
        /* Sur ordinateur, annuler, rétablir et le menu de la création vivent en haut à droite du fil (14/11/2026). */
        null
      )}
      </>

      <DepensesEnAttente donnees={donnees} />

      {/* AU TÉLÉPHONE, CETTE RANGÉE GARDE SA HAUTEUR (celle de l'aperçu) : en `flex-1`, elle partageait la place à parts
          égales avec la ligne de temps, se retrouvait plus basse que l'aperçu qu'elle contient, et la ligne de temps
          (durée, règle des secondes) remontait SUR le bas de l'image. La ligne de temps prend ce qui reste. */}
      <div className={cn('flex min-h-0', telephone ? (apercuPlein ? 'flex-1 flex-col' : 'shrink-0 flex-col') : 'flex-1 flex-row gap-2 px-3 pb-2')} data-studio-rangee-apercu>
        {/* L'AGENT À GAUCHE, L'IMAGE À DROITE, COMME UNE CARTE DU DIRECTEUR ARTISTIQUE (demande du 30/10/2026) : la
            conversation et ses onglets sur le fond de la page, l'aperçu et la ligne de temps à côté. */}
        {!telephone ? (
          /* `pr-4` : LA CONVERSATION SE CENTRE ENTRE LA COLONNE DE GAUCHE ET L'APERÇU (capture #bbb9, 01/11/2026). À gauche,
             la zone et cette rangée posent 24 px ; à droite, seuls les 8 px de l'écart séparaient le volet du cadre de
             l'aperçu — le fil paraissait collé à droite. Les 16 px de plus égalisent les deux bords visibles. */
          <aside className="flex shrink-0 flex-col overflow-hidden pr-4" style={{ width: voletDeLAgent.width }} data-studio-volet-agent>
            {voletOuvert}
          </aside>
        ) : null}
        {!telephone ? (
          <ResizeHandle
            className="-mx-1.5"
            onPointerDown={(event) => voletDeLAgent.start(event, 'left')}
            onDoubleClick={voletDeLAgent.reset}
            data-studio-poignee="volet"
          />
        ) : null}
        {/* L'APERÇU ET SES COMMANDES : le canevas commence en haut de la rangée, et porte les formats, le son et la lecture.
            SON FOND EST UN GRIS TRÈS CLAIR (`--surface`) : il se détache du fond de la page comme du cadre de la vidéo, qui
            garde le sien — sur le fond de la page, une vidéo blanche se perdait dans le blanc. */}
        {/* AU TÉLÉPHONE, LE CLAVIER PREND SUR L'APERÇU, jamais sur le champ d'écriture (`--clavier`, posé par app.tsx). */}
        <div
          className={cn('flex min-h-0 min-w-0 flex-col', telephone && !apercuPlein ? 'shrink-0 overflow-hidden' : 'flex-1')}
          style={telephone && !apercuPlein ? { height: `max(0px, calc(${onglet === 'agent' ? 24 : 34}dvh - var(--clavier, 0px)))` } : undefined}
          data-studio-colonne-apercu
          data-studio-apercu-plein={apercuPlein ? '' : undefined}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-surface" data-studio-cadre-apercu>
            <div className="flex shrink-0 items-center gap-1 px-1.5 pt-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" data-studio-formats>
                {donnees.creation.formats.map((f) => (
                  <Button
                    key={f}
                    size="icon"
                    variant={f === formatAffiche ? 'subtle' : 'ghost'}
                    onClick={() => setFormat(f)}
                    data-studio-format={f}
                    aria-pressed={f === formatAffiche}
                    aria-label={libelleFormat(f)}
                    title={libelleFormat(f)}
                  >
                    <IconeFormat format={f} />
                  </Button>
                ))}
              </div>
              {/* L'APERÇU SUR TOUTE LA HAUTEUR : le bas s'efface, sans perdre où en était la frise. */}
              {telephone ? (
                <Button
                  size="icon"
                  variant={apercuPlein ? 'subtle' : 'ghost'}
                  aria-pressed={apercuPlein}
                  aria-label={apercuPlein ? 'Réduire l’aperçu' : 'Agrandir l’aperçu'}
                  title={apercuPlein ? t('Réduire l’aperçu') : t('Agrandir l’aperçu')}
                  onClick={() => setApercuPlein((p) => !p)}
                  data-studio-apercu-agrandir
                >
                  {apercuPlein ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </Button>
              ) : null}
              {telephone ? annulerEtRetablir : null}
              <Button size="icon" variant="ghost" aria-label={muet ? 'Remettre le son' : 'Couper le son'} title={muet ? t('Remettre le son') : t('Couper le son')} onClick={() => setMuet((m) => !m)}>
                {muet ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="default" onClick={basculerLecture} data-studio-lire aria-label={lecture ? 'Pause' : 'Lire'}>
                {lecture ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {!telephone ? (lecture ? t('Pause') : t('Lire')) : null}
              </Button>
            </div>
            {/* L'image se pose SOUS la bande, dans une boîte positionnée qui la borne : au téléphone, l'aperçu passait
                par-dessus la règle de la ligne de temps (une hauteur en pourcentage dans une flexbox n'est pas résolue
                partout, Safari notamment) ; une boîte `absolute inset-2` se mesure partout. */}
            <div className="relative min-h-0 flex-1">
              <Apercu
                ref={apercu}
                composition={composition}
                format={formatAffiche}
                kit={donnees.espace.kit}
                adressesMedias={donnees.adressesMedias}
                temps={temps}
                muet={muet}
                lecture={lecture}
                arrivee={arrivee}
                onMessage={surMessage}
                images={images}
                onChangerImage={changerImage}
                onOuvrirEditeur={ouvrirEditeur}
                onBoite={setBoite}
                className="absolute inset-2 flex items-center justify-center"
              />
              {arrivee ? <BandeauDArrivee composition={composition} segmentId={arrivee} onRetirer={() => void operer({ op: 'proprietes', segmentId: arrivee, valeurs: { trajet: null } }).catch(() => undefined)} onFermer={() => setArrivee(null)} /> : null}
            </div>
          </div>
          {erreursDuCadre.length ? (
            <p className="shrink-0 pt-1 text-[12px] text-danger" data-studio-erreurs-cadre>
              {t('Un dessin a une erreur : {erreur}', { erreur: erreursDuCadre[0]! })}
            </p>
          ) : null}
          {!telephone ? ligneDeTemps : null}
        </div>

      </div>

      {/* AU TÉLÉPHONE : sous l'aperçu, les onglets, puis ce qu'ils ouvrent — la ligne de temps, la conversation ou un volet. Aucun tiroir. */}
      {telephone ? (
        <div className={cn('min-h-0 flex-1 flex-col', apercuPlein ? 'hidden' : 'flex')} data-studio-volet-telephone={onglet}>
          {/* MONTAGE / AGENT / RÉGLAGES : une rangée dans la page, au-dessus de ce qu'ils ouvrent — le bas de l'écran
              est aux tiroirs de la création (03/11/2026). Le clavier la cache, le champ de l'agent garde la place. */}
          {!clavierOuvert ? <div className="shrink-0 pb-2 pt-1">{rangeeDesOnglets}</div> : null}
          {onglet === 'montage' ? ligneDeTemps : voletOuvert}
        </div>
      ) : null}
      {/* LE MENU FIXE DU BAS : le clavier le cache, le champ de l'agent garde toute la place. */}

      {production ? (
        <FenetreMiseEnProduction donnees={donnees} format={formatAffiche} temps={temps} onVoixEssai={voixEssai} onOperation={operer} onOuvrir={onOuvrir} onClose={() => setProduction(false)} />
      ) : null}
      {tiroirOuvert}
      {bulle && !editeur ? (
        <BulleDeReglages
          composition={composition}
          segmentId={bulle}
          temps={temps}
          bloque={agentTravaille}
          telephone={telephone}
          medias={donnees.medias}
          onOperation={(op) => void operer(op).catch(() => undefined)}
          onToutRegler={(id) => {
            setBulle(null);
            ouvrirEditeur(id);
          }}
          onRegleArrivee={reglerLArrivee}
          onFermer={fermerLaBulle}
        />
      ) : null}
      {editeur ? (
        <EditeurElement
          donnees={donnees}
          composition={composition}
          segmentId={editeur.segmentId}
          elementId={editeur.elementId}
          format={formatAffiche}
          temps={temps}
          onOperation={operer}
          onVoixEssai={voixEssai}
          onMessageApercu={surMessage}
          onChoisirPiece={choisirPiece}
          onChangerImage={changerImage}
          onAller={aller}
          onClose={() => setEditeur(null)}
        />
      ) : null}
      {renommer ? (
        <PromptDialog
          open
          title={t('Renommer la création')}
          defaultValue={donnees.creation.titre}
          confirmLabel={t('Renommer')}
          onClose={() => setRenommer(false)}
          onConfirm={(titre: string) => {
            setRenommer(false);
            void client.call({ type: 'studio.creation.modifier', id: creationId, titre }).catch((err: any) => client.pushToast('error', err?.message ?? ''));
          }}
        />
      ) : null}
      {supprimer ? (
        <ConfirmDialog
          open
          title={t('Supprimer cette création ?')}
          description={t('Ses versions, ses voix et ses exports seront effacés. Les fichiers importés restent dans la bibliothèque du projet.')}
          confirmLabel={t('Supprimer')}
          danger
          onClose={() => setSupprimer(false)}
          onConfirm={() => {
            setSupprimer(false);
            void client
              .call({ type: 'studio.creation.supprimer', id: creationId })
              .then(onRetour)
              .catch((err: any) => client.pushToast('error', err?.message ?? ''));
          }}
        />
      ) : null}
    </div>
    </PolicesDuProjet>
    </ApercuEnDirect.Provider>
    </FournisseurDePose>
  );
}

/** Le « + » d'une piste est écrit au-dessus du fournisseur : il retrouve sa fonction de pose par ce relais. */
/** Le clavier du téléphone est-il ouvert ? `--clavier` est posée sur la racine par l'application. */
function useClavierOuvert(): boolean {
  const [ouvert, setOuvert] = React.useState(false);
  React.useEffect(() => {
    const racine = document.documentElement;
    const lire = () => setOuvert(parseFloat(racine.style.getPropertyValue('--clavier')) > 0);
    lire();
    const obs = new MutationObserver(lire);
    obs.observe(racine, { attributes: true, attributeFilter: ['style'] });
    return () => obs.disconnect();
  }, []);
  return ouvert;
}

function RelaisDePose({ cible }: { cible: React.MutableRefObject<ReturnType<typeof useContexteDePose>> }) {
  cible.current = useContexteDePose();
  return null;
}

/* ------------------------------------------------------------------ */
/* L'agent de la création                                               */
/* ------------------------------------------------------------------ */

/** La clé du champ d'écriture d'une création sans directeur : son brouillon et ses pièces jointes lui restent propres. */
function cleDuChampSansAgent(creationId: string): string {
  return `studio-${creationId}`;
}

/**
 * LA CONVERSATION DU STUDIO A L'ALLURE DE CELLE DES AGENTS (31/10/2026) : à largeur limitée et centrée dans son volet
 * (`CLASSE_LARGEUR_DE_CONTENU`), sans bande grise autour du champ (`--fond-du-pied` transparent), avec la même barre
 * d'écriture et ses boutons — plus, propres au Studio, la bibliothèque de styles et le menu des modèles. Plus de barre
 * d'étapes en tête (décision de l'utilisateur). Avant la première demande, le directeur n'existe pas encore : le même
 * champ d'écriture sert (`envoyerSansAgent`), son envoi le fait naître (`studio.assistant`, pièces jointes comprises),
 * et les TYPES DE MÉDIA s'offrent en liste illustrée au-dessus.
 */
const CLASSE_CONVERSATION_DU_STUDIO = cn(
  'mx-auto flex min-h-0 w-full flex-1 flex-col [--fond-du-pied:transparent] [--largeur-de-l-agent:100%]',
  CLASSE_LARGEUR_DE_CONTENU,
);

function PanneauAgent({
  donnees,
  agent,
  carte,
  outilsDuChamp,
  agentTravaille,
  onProduction,
}: {
  donnees: DonneesCreation;
  agent: Agent | null;
  carte: Card | null;
  outilsDuChamp: React.ReactNode;
  agentTravaille: boolean;
  onProduction: () => void;
}) {
  const state = useApp();
  /* LE SEUL BOUTON DU STUDIO (demande du 01/11/2026) : « Construction », en bas de la conversation, à la place
     du bouton d'étape — allumé dès qu'une version se lit et qu'aucune fabrication n'est en cours (`etatDuBoutonDeProduction`). */
  const etat = etatDuBoutonDeProduction({ composition: donnees.composition, depenses: donnees.depenses, agentTravaille });
  const actionDuStudio = {
    allume: etat.pret,
    noeud: <BoutonMiseEnProduction raison={etat.raison} depenses={donnees.depenses} exports={donnees.exports} onClick={onProduction} />,
  };
  if (agent && carte) {
    return (
      <div className={CLASSE_CONVERSATION_DU_STUDIO} data-studio-agent="conversation" data-studio-agent-carte={carte.id}>
        {/* Le montage d'une carte du tableau garde son « Valider » ; une création du Studio avance par la discussion. */}
        <ContexteConversationDuStudio.Provider value={!(donnees.creation.cardId && !donnees.creation.agentId)}>
          <ContexteFilDuStudio.Provider value>
          <Chat
            agent={agent}
            projectId={donnees.creation.projectId}
            cardId={carte.id}
            creuxReserveAilleurs
            suiviAilleurs
            sansBarreDEtapes
            actionDuStudio={actionDuStudio}
            outilsDuChamp={outilsDuChamp}
          />
          </ContexteFilDuStudio.Provider>
        </ContexteConversationDuStudio.Provider>
      </div>
    );
  }
  /* LE MONTAGE D'UNE CARTE qui n'a pas encore de directeur chargé : une silhouette, jamais l'accueil d'un agent à naître. */
  if (donnees.creation.cardId && !donnees.creation.agentId) {
    return (
      <div className={CLASSE_CONVERSATION_DU_STUDIO} data-studio-agent="chargement">
        <div className="px-3">
          <SilhouetteConversation bulles={3} />
        </div>
      </div>
    );
  }
  const envoyer = async (texte: string, pieces: string[]) => {
    await client.call({ type: 'studio.assistant', creationId: donnees.creation.id, demande: texte, ...(pieces.length ? { attachments: pieces } : {}) });
  };
  return (
    <div className={CLASSE_CONVERSATION_DU_STUDIO} data-studio-agent="accueil">
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="flex flex-col gap-3 px-3 pb-3 pt-1.5">
        <ModesDeRealisation creationId={donnees.creation.id} onLancer={envoyer} />
      </ZoneDefilement>
      <Composer
        agent={null}
        engines={state.engines}
        queue={[]}
        busy={false}
        projectId={donnees.creation.projectId}
        dansTiroir
        libelleDuChamp={t('Une vidéo de 15 secondes qui présente notre nouvelle offre, ton enjoué…')}
        boutonPrincipal={<BarreDuDirecteur donnees={donnees} />}
        reglages={outilsDuChamp}
        envoyerSansAgent={envoyer}
        cleSansAgent={cleDuChampSansAgent(donnees.creation.id)}
      />
    </div>
  );
}

/**
 * LES TYPES DE MÉDIA, EN LISTE VERTICALE ILLUSTRÉE (demande du 31/10/2026) : une photo réaliste à gauche (fabriquée
 * par Codex, `outils/modes-du-studio`), le titre et la description à droite. Un clic CHOISIT le type et LANCE la
 * conversation : la première demande part au directeur, qui pose ensuite les questions propres à ce type
 * (`ligneDuModeDuStudio`). Un type qu'aucun service branché ne sait faire reste affiché, éteint, avec sa raison.
 */
function ModesDeRealisation({ creationId, onLancer }: { creationId: string; onLancer: (texte: string, pieces: string[]) => Promise<void> }) {
  const [lus, setLus] = React.useState<{ modes: ModeDisponible[]; choisi: string | null } | null>(null);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ modes: ModeDisponible[]; choisi: string | null }>({ type: 'studio.modes.lister', creationId })
      .then((r) => vivant && setLus(r))
      .catch(() => vivant && setLus({ modes: [], choisi: null }));
    return () => {
      vivant = false;
    };
  }, [creationId]);
  if (!lus?.modes.length) return null;
  const lancer = async (id: string) => {
    if (enCours) return;
    setEnCours(id);
    setLus({ ...lus, choisi: id });
    try {
      await client.call({ type: 'studio.mode.choisir', creationId, mode: id });
      await onLancer(premiereDemandeDuMode(id), []);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Choix impossible'));
      setEnCours(null);
    }
  };
  return (
    <section className="flex flex-col gap-2" data-studio-modes>
      <p className="px-1 text-[13.5px] font-medium text-text">{t('Que voulez-vous réaliser ?')}</p>
      <ul className="flex flex-col gap-1.5">
        {lus.modes.map(({ mode, disponible }) => {
          const retenu = lus.choisi === mode.id;
          return (
            <li key={mode.id}>
              <button
                type="button"
                disabled={!disponible || !!enCours}
                onClick={() => void lancer(mode.id)}
                aria-pressed={retenu}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl p-1.5 pr-3 text-left transition-colors disabled:cursor-not-allowed',
                  retenu ? 'bg-teinte-plein text-sur-couleur' : 'bg-raised hover:bg-fond-survol',
                  !disponible && 'opacity-50',
                )}
                data-studio-mode={mode.id}
                data-studio-mode-disponible={disponible ? 'oui' : 'non'}
                data-studio-mode-choisi={retenu ? '' : undefined}
              >
                <span className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-surface">
                  <img src={`/api/studio/mode-image?id=${encodeURIComponent(mode.id)}`} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 h-full w-full object-cover" data-studio-mode-image />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn('text-[13.5px] font-medium', retenu ? 'text-sur-couleur' : 'text-text')}>{t(mode.titre)}</span>
                  <span className={cn('text-[12.5px] leading-snug', retenu ? 'text-sur-couleur/90' : 'text-muted')}>{t(mode.description)}</span>
                  {disponible ? null : (
                    <span className="text-[11.5px] text-faint" data-studio-mode-indisponible>
                      {t('Indisponible : aucun service branché ne sait le faire.')}
                    </span>
                  )}
                </span>
                {enCours === mode.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * LA BARRE DU DIRECTEUR, AVANT SA PREMIÈRE DEMANDE — la même que celle d'un agent (« Lancer et valider · Claude
 * Opus 5.5 · High » et ses réglages collés à droite, capture du 31/10/2026) : ce qui partira, puis l'icône qui ouvre
 * moteur, modèle, réflexion et compte. MODIFIABLE À TOUT MOMENT (décision de l'utilisateur, 08.10.2026) : le choix
 * vit sur la création (`studio.creation.agent`) et sert au démarrage (`lancerAgentStudio`). Une fois le directeur né,
 * c'est la barre de sa carte qui prend le relais (`BarreDAction`).
 */
function BarreDuDirecteur({ donnees }: { donnees: DonneesCreation }) {
  const state = useApp();
  const choisi = donnees.creation.runAgent;
  const choix = (choisi ?? { engine: 'claude' }) as RunChoix;
  const retenu = resoudreRun(state.engines, choix);
  // Avant tout choix, le démarrage prend le modèle le plus capable de Claude : on ne prétend pas en nommer un.
  const resume = [
    t('Directeur artistique'),
    choisi?.model ? (retenu.model?.label ?? choisi.model) : (retenu.engine?.label ?? choix.engine),
    choisi?.model && retenu.thinking ? retenu.thinking.label : choisi?.model ? null : t('Automatique'),
  ]
    .filter(Boolean)
    .join(' · ');

  const choisir = async (patch: RunChoix) => {
    try {
      const souhait: RunChoix = patch.engine ? { engine: patch.engine } : { ...choix, ...patch };
      const r = resoudreRun(state.engines, souhait);
      if (!r.engine) return;
      await client.call({
        type: 'studio.creation.agent',
        id: donnees.creation.id,
        run: {
          engine: r.engine.id,
          ...(r.model ? { model: r.model.id } : {}),
          ...(r.thinking ? { thinking: r.thinking.id } : {}),
          ...(souhait.account && !patch.engine ? { account: souhait.account } : {}),
        },
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réglage impossible'));
    }
  };

  return (
    <div className="flex items-stretch" data-studio-config-agent="creation">
      <span
        className={cn(HAUTEUR_BOUTON_DU_FIL, 'flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg rounded-r-none bg-raised px-3 text-[13px] font-medium text-muted')}
        data-studio-config-resume={resume}
      >
        <Sparkles className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">{resume}</span>
      </span>
      {/* L'icône est le bouton du menu des réglages : collée à droite, au même ton, jour d'un pixel. */}
      <RunSelectors
        engines={state.engines}
        choix={choix}
        onSelect={(patch) => void choisir(patch)}
        comptes={state.quotas}
        declencheur={
          <Button
            type="button"
            variant="ghost"
            className={cn(HAUTEUR_BOUTON_DU_FIL, 'ml-px w-[43px] shrink-0 rounded-lg rounded-l-none bg-raised p-0 text-text hover:bg-fond-survol sm:w-9 sm:px-0')}
            title={t('Configuration de l’agent')}
            aria-label="Configuration de l’agent"
            data-studio-config-agent-bouton
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
          </Button>
        }
      />
    </div>
  );
}

/**
 * LE BANDEAU DU MODE « ARRIVÉE », posé en haut de l'aperçu : il dit quoi faire (tirer la pièce là où elle arrive),
 * propose de retirer le trajet s'il existe, et « Terminé » (ou Échap) referme le mode. Le départ reste la position
 * posée de la pièce : on le règle en la déplaçant au début du bloc, comme d'habitude.
 */
function BandeauDArrivee({ composition, segmentId, onRetirer, onFermer }: { composition: Composition | undefined; segmentId: string; onRetirer: () => void; onFermer: () => void }) {
  const s = composition ? trouverSegment(composition, segmentId)?.segment : null;
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-center" data-studio-mode-arrivee={segmentId} data-studio-trajet={s?.trajet ? 'oui' : 'non'}>
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-lg bg-teinte-plein px-3 py-1.5 text-[12.5px] text-sur-couleur shadow-lg">
        <Route className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{t('Glissez l’élément là où il doit arriver')}</span>
        {s?.trajet ? (
          <button type="button" onClick={onRetirer} className="shrink-0 rounded-md px-1.5 py-0.5 underline-offset-2 hover:underline" data-studio-arrivee-retirer>
            {t('Retirer le trajet')}
          </button>
        ) : null}
        <button type="button" onClick={onFermer} className="shrink-0 rounded-md bg-black/20 px-2 py-0.5 font-semibold hover:bg-black/30" data-studio-arrivee-terminer>
          {t('Terminé')}
        </button>
      </div>
    </div>
  );
}
