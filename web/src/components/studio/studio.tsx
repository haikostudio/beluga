import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import * as React from 'react';
import {
  Bot,
  Clapperboard,
  Copy,
  Globe,
  Library,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Loader2,
} from 'lucide-react';
import {
  type Agent,
  type FormatStudio,
  type OperationStudio,
  type Piste,
  CLES_FORMATS_STUDIO,
  agentTientSonTour,
  FORMATS_STUDIO,
  dureeExportee,
  piecesDuDessin,
  minusculesSansAccents,
  trouverSegment,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  DialogFooter,
  DialogTitle,
  TitreDePage,
  Drawer,
  FormulaireEnColonnes,
  Input,
  LigneFormulaire,
  ListeDeroulante,
  PromptDialog,
  ZoneDefilement,
} from '@/components/ui';
import { Chat } from '@/components/chat';
import { RunSelectors, resoudreRun, type RunChoix } from '@/components/run-selectors';
import { SilhouetteConversation, SilhouetteStudio } from '@/components/silhouettes';
import { BoutonPrincipal, GestePrincipal, GestesDePage, OptionDePage, OptionsDePage, SeparateurDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { CLASSE_SECTION_DE_SERVICE, ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { GesteDeCreationDeColonne, RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { client } from '@/lib/client';
import { writePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { usePref } from '@/lib/prefs';
import { ResizeHandle, ResizeHandleHorizontale, useResizable } from '@/components/resizer';
import { formatRegional, t } from '@/lib/langue';
import { PasAPas } from '@/components/pas-a-pas';
import { cn } from '@/lib/utils';
import { Apercu, ApercuEnDirect, type ApercuDirect, type BoiteDuCadre, type MessageDuCadre, type PoigneeApercu } from './apercu';
import { AvancementDeCreation } from './avancement';
import { EditeurElement } from './editeur-element';
import { PanneauSources, PanneauStyles, StylesCites, demandeDAppliquer, type StyleDeLaGalerie } from './styles';
import { EncadreServices } from './services';
import { LigneDeTemps, nomDuSegment, type QuoiAjouter } from './ligne-de-temps';
import { Calques, Inspecteur, ReglagesDeComposition } from './inspecteur';
import { DepensesEnAttente, PanneauBibliotheque, choisirEtImporter } from './panneaux';
import { EnteteDeFenetre } from './champs';
import { BoutonMiseEnProduction, FenetreMiseEnProduction, useProductionEnCours } from './production';
import { libelleFormat } from './libelles';
import { VoletVerification } from './verification';
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
  /* « #studio/verification:<source> » : l'alerte de la cloche mène droit au volet « Passer la vérification » de CETTE source. */
  const verification = vise?.startsWith('verification:') ? vise.slice('verification:'.length) : null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      enPage={enPage}
      // L'atelier d'une création prend toute la largeur ; la liste garde la colonne centrée.
      className={vise && !verification ? 'max-w-none sm:px-3 sm:pt-2' : 'max-w-[980px]'}
    >
      {vise && !verification ? (
        <Editeur key={vise} creationId={vise} onRetour={() => onVise?.(null)} onOuvrir={(id) => onVise?.(id)} />
      ) : (
        <ListeDesCreations onOuvrir={(id) => onVise?.(id)} />
      )}
      {verification ? <VoletVerification sourceId={verification} onClose={() => onVise?.(null)} /> : null}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* La liste                                                             */
/* ------------------------------------------------------------------ */

/** Un bouton de la barre du haut bloqué pendant le travail de l'agent : grisé à 50 % (le bouton, lui, grise à 40 %). */
const BLOQUE = 'disabled:opacity-50';

/**
 * LES OPTIONS DE L'ATELIER SUR TÉLÉPHONE : les lignes du menu à trois points de
 * la barre d'en-tête. Composant à part : seul lui se redessine à chaque pas de
 * l'export, et son bouton tourne tant que la production avance — le menu fermé
 * ne montre pas ses lignes.
 */
function OptionsDeLAtelierAuTelephone({
  donnees,
  bloque,
  onBibliotheque,
  onProduction,
}: {
  donnees: DonneesCreation;
  bloque: boolean;
  onBibliotheque: () => void;
  onProduction: () => void;
}) {
  const enCours = useProductionEnCours(donnees.depenses, donnees.exports);
  return (
    <OptionsDePage enCours={enCours}>
      <OptionDePage icone={<Library className="h-3.5 w-3.5" />} disabled={bloque} onClick={onBibliotheque} aria-label="Bibliothèque" data-studio-ouvrir-bibliotheque>
        {t('Bibliothèque')}
      </OptionDePage>
      <BoutonMiseEnProduction compact bloque={bloque} depenses={donnees.depenses} exports={donnees.exports} onClick={onProduction} />
    </OptionsDePage>
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
  /* LA COLONNE DE GAUCHE EST CELLE DU STUDIO (demande du 12/10/2026) : le geste
     qui crée, détaché, « Toutes les créations » et un classement par projet.
     Sur téléphone, le geste reste dans la page. */
  const dansLaColonne = useColonneDeService();
  /** Le projet retenu dans la colonne (son nom, tel que la ligne le porte) ; `null` : tous. */
  const [projetRetenu, setProjetRetenu] = React.useState<string | null>(null);
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
      <TitreDePage>{t('Studio')}</TitreDePage>
      {dansLaColonne ? (
        <ColonneDeService>
          <nav aria-label="Rubriques du studio" data-colonne-studio className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
            <GesteDeCreationDeColonne
              libelle={t('Nouvelle création')}
              aria-label="Nouvelle création"
              data-studio-nouvelle
              onClick={() => setNouvelle(true)}
            />
            <RubriqueDeColonne
              icone={<Clapperboard />}
              libelle={t('Toutes les créations')}
              compte={vue?.creations.length}
              actif={projetRetenu === null}
              onClick={() => setProjetRetenu(null)}
              data-studio-rubrique="toutes"
            />
            {projetsDesCreations.length > 1 || projetRetenu ? <p className={CLASSE_SECTION_DE_SERVICE}>{t('Par projet')}</p> : null}
            {projetsDesCreations.length > 1 || projetRetenu
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
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
              <Input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder={t('Rechercher une création…')}
                aria-label="Rechercher une création"
                className="h-10 rounded-xl pl-10 text-[14px]"
                data-studio-recherche
              />
            </div>
            {affichees.length ? (
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
  const [formats, setFormats] = React.useState<FormatStudio[]>(['9:16']);
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
                  <input
                    type="checkbox"
                    checked={formats.includes(f)}
                    onChange={(e) => setFormats((x) => (e.target.checked ? [...x, f] : x.filter((y) => y !== f)))}
                    className="h-4 w-4 accent-[hsl(var(--accent))]"
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
 * LES VOLETS DE DROITE. `bibliotheque` (clé gardée) s'AFFICHE « Style » : kit de
 * marque, médias et modèles du projet. La galerie de styles (« Bibliothèque »)
 * n'est PAS un volet : le bouton posé en haut à droite de l'aperçu l'ouvre dans
 * un TIROIR par-dessus l'application, sur ordinateur comme sur téléphone. Voix et exports vivent dans la fenêtre « Mettre
 * en production ».
 */
type Panneau = 'reglages' | 'agent' | 'bibliotheque';

/**
 * LE FOND D'UN PANNEAU DE L'ATELIER, DIT À CE QUI DÉFILE DEDANS. Les calques et la conversation sont posés sur
 * `.bg-bloc` (styles.css) ; leurs zones qui défilent s'estompent vers `--fond-zone-defilement`, que la page règle sur
 * SON fond. Sans cette teinte reposée par le panneau, la conversation portait une bande claire en haut et en bas, et
 * les calques une ombre : deux fonds de trop dans une zone qui n'en a qu'un.
 */
const FOND_DE_PANNEAU: React.CSSProperties = {
  ['--fond-zone-defilement' as string]: 'color-mix(in srgb, hsl(var(--raised)) 55%, hsl(var(--surface)))',
};

function Editeur({ creationId, onRetour, onOuvrir }: { creationId: string; onRetour: () => void; onOuvrir: (id: string) => void }) {
  const state = useApp();
  const telephone = useTelephone();
  /* Sur ordinateur, « Bibliothèque » et « Style » sont des rubriques de la colonne de gauche. */
  const dansLaColonne = useColonneDeService();
  // Ordinateur : colonnes, hauteur de la ligne de temps et repli, mémorisés EN BASE (même mise en page partout).
  // Les plafonds suivent LA PLACE DE L'ATELIER, pour qu'on ne puisse pas écraser l'aperçu : la fenêtre moins la
  // colonne de gauche de l'application (`--zone-principale-gauche`, posée par app.tsx). Mesurés sur la fenêtre
  // entière, ils laissaient 194 px à l'aperçu sur un écran de 1440 px, calques et conversation tirés à fond.
  const largeurDeLAtelier =
    window.innerWidth - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zone-principale-gauche')) || 0);
  const voletDeDroite = useResizable('studio.volet', { initial: 400, min: 300, max: Math.min(640, Math.round(largeurDeLAtelier * 0.4)) });
  const hauteurTimeline = useResizable('studio.timeline', { axe: 'y', initial: 300, min: 150, max: Math.max(220, Math.round(window.innerHeight * 0.6)) });
  const [timelineOuverte, setTimelineOuverte] = usePref<boolean>('studio.timelineOuverte', true);
  // `reprise` avance après une coupure : la création ouverte se relit même si aucun signal ne l'a nommée.
  const version = (state.studioVersions[creationId] ?? 0) + (state.studioVersions.reprise ?? 0);
  const [donnees, setDonnees] = React.useState<DonneesCreation | null>(null);
  const [temps, setTemps] = React.useState(0);
  const [lecture, setLecture] = React.useState(false);
  const [muet, setMuet] = React.useState(false);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [element, setElement] = React.useState<string | null>(null);
  const [format, setFormat] = React.useState<FormatStudio | null>(null);
  const [tiroir, setTiroir] = React.useState<Exclude<Panneau, 'bibliotheque'> | null>(null);
  /**
   * « STYLE » S'OUVRE DANS UN VOLET, plus dans la colonne de droite (demande du
   * 09/10/2026) : composition, kit de marque et médias du projet, posés
   * par-dessus l'éditeur, sur ordinateur comme sur téléphone. La colonne de
   * droite ne montre plus que la conversation avec l'agent.
   */
  const [styleOuvert, setStyleOuvert] = React.useState(false);
  /* Une AUTRE création ouverte (depuis un modèle du volet « Style », par
     exemple) repart sans volet : on arrive sur elle, pas sur le style. */
  const creationVue = React.useRef(creationId);
  React.useEffect(() => {
    if (creationVue.current === creationId) return;
    creationVue.current = creationId;
    setStyleOuvert(false);
  }, [creationId]);
  /** LA GALERIE DE STYLES, dans son tiroir posé par-dessus l'application. */
  const [galerie, setGalerie] = React.useState(false);
  useTiroirAdresse('galerie-studio', galerie, setGalerie);
  const [vueSources, setVueSources] = React.useState(false);
  const [renommer, setRenommer] = React.useState(false);
  const [supprimer, setSupprimer] = React.useState(false);
  const [erreursDuCadre, setErreursDuCadre] = React.useState<string[]>([]);
  /** LA FENÊTRE D'ÉDITION D'UN ÉLÉMENT (double-clic, ou « Ouvrir l'éditeur » sur l'aperçu). */
  const [editeur, setEditeur] = React.useState<{ segmentId: string; elementId: string | null } | null>(null);
  /** LA PIÈCE CHOISIE telle que l'aperçu la voit (nature, vraies couleurs, texte) : l'inspecteur part de là. */
  const [boite, setBoite] = React.useState<BoiteDuCadre | null>(null);
  /** LA FENÊTRE « METTRE EN PRODUCTION » (voix finale, modèle, export). */
  const [production, setProduction] = React.useState(false);
  useTiroirAdresse('production-studio', production, setProduction);
  /** LE TEXTE DE L'ACCUEIL (création sans agent) : « Appliquer » un style le remplit sans l'envoyer. */
  const [demandeAccueil, setDemandeAccueil] = React.useState('');
  /** Un style appliqué pendant que la conversation est affichée : déposé dans son champ, qui le complète à la suite. */
  const [depot, setDepot] = React.useState<{ texte: string; nonce: number } | null>(null);
  const apercu = React.useRef<PoigneeApercu | null>(null);
  /** Une couleur choisie dans l'inspecteur se voit dans l'aperçu PENDANT le choix. */
  const direct = React.useCallback((m: ApercuDirect) => apercu.current?.direct(m), []);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<DonneesCreation>({ type: 'studio.creation.ouvrir', id: creationId })
      .then((r) => {
        if (!vivant) return;
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
  /* L'AGENT DE LA CRÉATION TRAVAILLE : le témoin suit l'agent (tour vivant, ou statut en cours), pas un message.
     Tant qu'il travaille, la barre du haut est grisée à 50 % et sans effet — ses gestes se marcheraient dessus. */
  const agentId = donnees?.creation.agentId ?? null;
  const agentDeLaCreation = agentId ? (state.agents[agentId] ?? null) : null;
  const agentTravaille = agentDeLaCreation ? agentTientSonTour(agentDeLaCreation) : false;
  React.useEffect(() => {
    // Le bouton « Style » est éteint pendant le travail de l'agent : son volet se referme.
    if (agentTravaille) setStyleOuvert(false);
  }, [agentTravaille]);
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
      } else if (m.type === 'retouche' && m.segmentId && m.elementId && m.retouche) {
        void operer({ op: 'retouche', segmentId: m.segmentId, elementId: m.elementId, retouche: m.retouche, format: formatAffiche }).catch(() => undefined);
      } else if (m.type === 'effacer' && m.segmentId && m.elementId) {
        // « Remettre comme à l'origine » : la retouche de la pièce s'efface (une version, annulable).
        void operer({ op: 'effacer-retouche', segmentId: m.segmentId, elementId: m.elementId, format: formatAffiche }).catch(() => undefined);
      } else if (m.type === 'texte' && m.segmentId && m.elementId && typeof m.texte === 'string') {
        void operer({ op: 'retouche', segmentId: m.segmentId, elementId: m.elementId, retouche: { texte: m.texte }, format: formatAffiche }).catch(() => undefined);
      }
    },
    [operer, formatAffiche, selection, element, telephone],
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
      // La fenêtre d'édition ouverte ne garde que annuler / rétablir : Suppr ou Espace y viseraient l'éditeur derrière.
      if (editeur && !((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key))) return;
      // L'agent travaille : annuler, rétablir et supprimer sont bloqués au clavier comme à la souris.
      if (agentTravaille && ((e.ctrlKey || e.metaKey) ? /^[zy]$/i.test(e.key) : e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
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
  }, [basculerLecture, aller, duree, temps, selection, element, operer, annuler, retablir, editeur, agentTravaille]);

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
  const choisirPieceDe = (segmentId: string, id: string | null) => {
    if (segmentId === choisi) return choisirPiece(id);
    setSelection([segmentId]);
    setElement(id);
    apercu.current?.selectionner(segmentId, id);
    setEditeur((e) => (e ? { segmentId, elementId: id } : e));
  };
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
   * « Appliquer » un style : la demande s'ÉCRIT dans le champ de l'agent, à la suite de ce qui s'y trouve, et
   * ne part PAS — l'utilisateur la complète puis l'envoie. Avec un agent, c'est son brouillon (`draft.<agent>`,
   * que le champ suit ou charge à son ouverture) ; sans agent, le texte de l'accueil.
   */
  const appliquerStyle = (style: StyleDeLaGalerie) => {
    const demande = demandeDAppliquer(style);
    const suite = (avant: string) => (avant.trim() ? `${avant.replace(/\s+$/, '')}\n${demande}` : demande);
    if (agentId) {
      if (document.querySelector('[data-studio-agent="conversation"] textarea')) {
        // Le champ est à l'écran : il garde ce qu'on y tape à la volée (pas encore dans le brouillon) et prend le curseur.
        setDepot({ texte: demande, nonce: Date.now() });
        window.setTimeout(() => setDepot(null), 300);
      } else {
        // Volet fermé (téléphone) : le brouillon de l'agent, que le champ affichera à son ouverture.
        const cle = `draft.${agentId}`;
        writePref(cle, suite(String(client.lireEtat().prefs[cle] ?? '')));
      }
    } else setDemandeAccueil(suite(demandeAccueil));
    setGalerie(false);
    setStyleOuvert(false);
    if (telephone) setTiroir('agent');
    // Le champ prend le curseur, à la fin du texte, une fois le volet (re)monté.
    window.setTimeout(() => {
      const zone = document.querySelector<HTMLTextAreaElement>('[data-studio-agent] textarea');
      if (!zone) return;
      zone.focus();
      zone.setSelectionRange(zone.value.length, zone.value.length);
      zone.scrollTop = zone.scrollHeight;
    }, 250);
  };
  /** TOUS LES DESSINS DE L'ANIMATION, dans l'ordre du temps : leurs calques vivent dans la colonne de gauche. */
  const dessins = composition.pistes
    .flatMap((piste) => piste.segments)
    .filter((seg): seg is Extract<typeof seg, { genre: 'dessin' }> => seg.genre === 'dessin' && piecesDuDessin(seg.gabarit.html).length > 0)
    .sort((a, b) => a.debut - b.debut);
  const contenuDuPanneau = (p: Panneau) =>
    p === 'reglages' ? (
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
        onChoisirPiece={choisirPiece}
        calquesAilleurs={!telephone}
        piece={boite}
      />
    ) : p === 'agent' ? (
      <PanneauAgent donnees={donnees} onAppliquerStyle={appliquerStyle} demande={demandeAccueil} onDemande={setDemandeAccueil} depot={depot} />
    ) : (
      <div className="flex flex-col gap-2">
        <ReglagesDeComposition composition={composition} onOperation={operer} />
        <PanneauBibliotheque donnees={donnees} temps={temps} onOperation={operer} onOuvrir={onOuvrir} />
      </div>
    );

  /** LES ONGLETS DU TÉLÉPHONE, sous le pouce (l'ordinateur n'en a plus : son volet est la conversation). */
  const onglets: { cle: Panneau; libelle: string; Icone: typeof Bot }[] = [
    { cle: 'agent', libelle: t('Agent'), Icone: Bot },
    { cle: 'reglages', libelle: t('Réglages'), Icone: SlidersHorizontal },
    { cle: 'bibliotheque', libelle: t('Style'), Icone: Palette },
  ];

  /** LE « + » D'UNE PISTE : ce qu'elle accepte, posé à l'instant visé. */
  const ajouterSurLaPiste = (piste: Piste, quoi: QuoiAjouter, debut: number) => {
    const poser = (segment: Record<string, unknown>) => void operer({ op: 'inserer', pisteId: piste.id, segment }).catch(() => undefined);
    if (quoi === 'texte') poser({ genre: 'texte', debut, duree: 3, texte: t('Votre texte'), taille: 96, couleur: '#ffffff', position: { x: 50, y: 50 }, gras: true, entree: 'glisse-haut' });
    else if (quoi === 'voix') poser({ genre: 'voix', debut, duree: 3, texte: '', voixEssai: donnees.espace.voixEssai ?? 'fr_FR-siwis-medium', etat: 'aucune', volume: 1 });
    else if (quoi === 'sous-titres') poser({ genre: 'sous-titres', debut, duree: 3, auto: true, mots: [], motsParGroupe: 2, style: {} });
    else if (quoi === 'dessin')
      poser({
        genre: 'dessin',
        debut,
        duree: 3,
        nom: t('Fond'),
        gabarit: { html: '<div class="fond" data-studio-id="fond"></div>', css: '.fond{position:absolute;inset:0;background:var(--p-couleur)}', animation: '' },
        parametres: [{ id: 'couleur', type: 'couleur', libelle: t('Couleur'), defaut: '#1d2440' }],
      });
    else
      void choisirEtImporter(donnees, quoi === 'son' ? 'audio/*' : 'image/*,video/*', (m) => {
        const longueur = m.duree && m.duree > 0 ? Math.min(m.duree, 60) : 4;
        poser(
          m.genre === 'audio'
            ? { genre: 'audio', debut, duree: longueur, mediaId: m.id, debutMedia: 0, volume: 0.8 }
            : m.genre === 'video'
              ? { genre: 'video', debut, duree: longueur, mediaId: m.id, debutMedia: 0, volume: 1, ajustement: 'couvrir' }
              : { genre: 'image', debut, duree: longueur, mediaId: m.id, ajustement: 'couvrir' },
        );
      });
  };

  /*
   * LES DEUX MOITIÉS DE LA BARRE DE L'ATELIER, posées dans la barre d'en-tête de
   * l'application sur ordinateur COMME SUR TÉLÉPHONE : le nom de la création en
   * dernier cran du fil d'Ariane, les gestes à droite. L'atelier n'a plus de
   * rangée à lui (demande du 11/10/2026).
   */
  const cranDeLaCreation = (
    <>
      <button
        type="button"
        className="-mx-1 flex min-w-0 shrink items-baseline gap-2 truncate rounded-md px-1 py-1 text-left transition-colors hover:bg-raised"
        onClick={() => setRenommer(true)}
        title={t('Renommer')}
        data-studio-titre-creation
      >
        <DialogTitle className="truncate text-[14.5px] font-medium">{donnees.creation.titre}</DialogTitle>
        <span className="hidden truncate text-[12.5px] text-faint md:block">{donnees.projet}</span>
      </button>
      {/* DUPLIQUER ET SUPPRIMER SE COLLENT AU TITRE : ils parlent de la création elle-même. */}
      {!telephone ? (
        <span className="flex shrink-0 items-center" data-studio-gestes-creation>
          <Button variant="ghost" size="icon" className={BLOQUE} disabled={agentTravaille} aria-label="Dupliquer la création" title={agentTravaille ? t('L’agent travaille') : t('Dupliquer la création')} onClick={async () => onOuvrir((await client.call<{ creation: { id: string } }>({ type: 'studio.creation.dupliquer', id: creationId })).creation.id)}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className={BLOQUE} disabled={agentTravaille} aria-label="Supprimer la création" title={agentTravaille ? t('L’agent travaille') : t('Supprimer la création')} onClick={() => setSupprimer(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      ) : null}
    </>
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
  const gestesDeLAtelier = (
    <>
      {annulerEtRetablir}
      {/* LA BIBLIOTHÈQUE DE STYLES ET LE VOLET « STYLE », entre Annuler/Rétablir et
          « Mettre en production » — SUR TÉLÉPHONE ; sur ordinateur, ce sont deux
          rubriques de la colonne de gauche (demande du 12/10/2026). */}
      {dansLaColonne ? null : (<>
      <Button
        size="sm"
        variant={galerie ? 'subtle' : 'ghost'}
        onClick={() => setGalerie((g) => !g)}
        className={BLOQUE}
        disabled={agentTravaille}
        aria-pressed={galerie}
        aria-label="Bibliothèque"
        title={agentTravaille ? t('L’agent travaille') : t('Bibliothèque de styles : une mise en scène à confier à l’agent')}
        data-studio-ouvrir-bibliotheque
      >
        <Library className="h-3.5 w-3.5" />
        {t('Bibliothèque')}
      </Button>
      <Button
        size="sm"
        variant={styleOuvert ? 'subtle' : 'ghost'}
        onClick={() => setStyleOuvert((ouvert) => !ouvert)}
        className={BLOQUE}
        disabled={agentTravaille}
        aria-pressed={styleOuvert}
        title={agentTravaille ? t('L’agent travaille') : t('Style : kit de marque, médias et modèles du projet')}
        data-studio-onglet="bibliotheque"
      >
        <Palette className="h-3.5 w-3.5" />
        {t('Style')}
      </Button>
      </>)}
      <BoutonMiseEnProduction compact bloque={agentTravaille} depenses={donnees.depenses} exports={donnees.exports} onClick={() => setProduction(true)} />
    </>
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
        style={!telephone && timelineOuverte ? { height: hauteurTimeline.size } : undefined}
        data-studio-rangee-ligne-de-temps
      >
        {/* Sans `fond` imposé : le fondu suit le fond de la PAGE qui porte la ligne de temps (un gris de tiroir y laissait une bande). */}
        <ZoneDefilement className="px-1 pb-2">
          <LigneDeTemps
            composition={composition}
            adressesMedias={donnees.adressesMedias}
            temps={temps}
            selection={selection}
            onAller={aller}
            onChoisir={choisir}
            onOperation={(op) => void operer(op).catch(() => undefined)}
            onAjouter={ajouterSurLaPiste}
            onOuvrirEditeur={(id) => ouvrirEditeur(id)}
            ouverte={telephone || timelineOuverte}
            onBasculer={telephone ? undefined : () => setTimelineOuverte(!timelineOuverte)}
          />
        </ZoneDefilement>
      </div>
    </>
  );

  return (
    <ApercuEnDirect.Provider value={direct}>
    <div className="flex min-h-0 flex-1 flex-col" data-studio-editeur={creationId}>
      {/* UNE SEULE BARRE D'EN-TÊTE (demande du 11/10/2026 : « pour le studio, il
          faut qu'il n'y ait qu'une header, celle avec le fil d'Ariane ») : la
          création ouverte est le dernier cran du fil — « Services › Studio ›
          Lancement service » —, « Studio » y ramène à toutes les créations, et
          les gestes de l'atelier montent à droite de la barre.
          SUR TÉLÉPHONE AUSSI, depuis la même date : la flèche de retour est dans
          la barre (`retour`), « Bibliothèque » et « Mettre en production » sont
          les lignes du menu à trois points, Annuler / Rétablir vivent dans la
          rangée de l'aperçu. L'atelier ne pose AUCUN bouton en bas de l'écran :
          le bas porte déjà Agent / Réglages / Style. */}
      <SuiteDuFil onRacine={onRetour} retour={{ action: onRetour, reperes: { 'data-studio-retour': '' } }}>
        <SeparateurDuFil />
        {cranDeLaCreation}
      </SuiteDuFil>
      {/* LA COLONNE DE GAUCHE PORTE LA CRÉATION OUVERTE : son titre, la flèche
          qui ramène à la liste, puis « Bibliothèque » et « Style ». */}
      <ColonneDeService niveau={{ titre: donnees.creation.titre, onRetour }}>
        <nav aria-label="Rubriques de la création" data-colonne-studio-creation className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
          <RubriqueDeColonne
            icone={<Library />}
            libelle={t('Bibliothèque')}
            actif={galerie}
            disabled={agentTravaille}
            title={agentTravaille ? t('L’agent travaille') : t('Bibliothèque de styles : une mise en scène à confier à l’agent')}
            onClick={() => setGalerie((g) => !g)}
            aria-pressed={galerie}
            data-studio-ouvrir-bibliotheque
          />
          <RubriqueDeColonne
            icone={<Palette />}
            libelle={t('Style')}
            actif={styleOuvert}
            disabled={agentTravaille}
            title={agentTravaille ? t('L’agent travaille') : t('Style : kit de marque, médias et modèles du projet')}
            onClick={() => setStyleOuvert((ouvert) => !ouvert)}
            aria-pressed={styleOuvert}
            data-studio-onglet="bibliotheque"
          />
          {/* LES CALQUES DE TOUTE L'ANIMATION (demande du 12/10/2026), un groupe par dessin : la
              pièce choisie dans l'aperçu s'y marque et vient à l'écran. Ils ont quitté la colonne
              posée à gauche de l'aperçu, qui laisse sa place à l'image. Les identifiants de pièces
              ne sont uniques que dans leur dessin : seul le dessin choisi reçoit la pièce choisie. */}
          <p className={CLASSE_SECTION_DE_SERVICE}>{t('Calques')}</p>
          <ZoneDefilement className="min-h-0 flex-1 pb-4" data-studio-colonne-calques>
            {dessins.length ? (
              dessins.map((dessin) => (
                <Calques
                  key={dessin.id}
                  enColonne
                  titre={nomDuSegment(dessin)}
                  actif={dessin.id === choisi}
                  onChoisirDessin={() => choisir(dessin.id, false)}
                  segment={dessin}
                  elementId={dessin.id === choisi ? element : null}
                  format={formatAffiche}
                  formatDeBase={composition.format}
                  onOperation={operer}
                  onChoisirPiece={(id) => choisirPieceDe(dessin.id, id)}
                  onOuvrirEditeur={(id) => ouvrirEditeur(dessin.id, id)}
                />
              ))
            ) : (
              <p className="px-2.5 py-2 text-[12.5px] text-faint" data-studio-calques-vide>
                {t('Aucun dessin dans l’animation pour l’instant.')}
              </p>
            )}
          </ZoneDefilement>
        </nav>
      </ColonneDeService>
      {telephone ? (
        <OptionsDeLAtelierAuTelephone
          donnees={donnees}
          bloque={agentTravaille}
          onBibliotheque={() => setGalerie((g) => !g)}
          onProduction={() => setProduction(true)}
        />
      ) : (
        <GestesDePage>{gestesDeLAtelier}</GestesDePage>
      )}

      <DepensesEnAttente donnees={donnees} />

      {/* AU TÉLÉPHONE, CETTE RANGÉE GARDE SA HAUTEUR (celle de l'aperçu) : en `flex-1`, elle partageait la place à parts
          égales avec la ligne de temps, se retrouvait plus basse que l'aperçu qu'elle contient, et la ligne de temps
          (durée, règle des secondes) remontait SUR le bas de l'image. La ligne de temps prend ce qui reste. */}
      <div className={cn('flex min-h-0', telephone ? 'shrink-0 flex-col' : 'flex-1 flex-row gap-2 px-3 pb-2')} data-studio-rangee-apercu>
        {/* L'APERÇU ET SES COMMANDES : le canevas commence en haut de la rangée, et porte les formats, le son et la lecture.
            SON FOND EST UN GRIS TRÈS CLAIR (`--surface`) : il se détache du fond de la page comme du cadre de la vidéo, qui
            garde le sien — sur le fond de la page, une vidéo blanche se perdait dans le blanc. */}
        <div className={cn('flex min-h-0 min-w-0 flex-col', telephone ? 'h-[42vh] shrink-0' : 'flex-1')} data-studio-colonne-apercu>
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
                onMessage={surMessage}
                images={images}
                onChangerImage={changerImage}
                onOuvrirEditeur={ouvrirEditeur}
                onBoite={setBoite}
                className="absolute inset-2 flex items-center justify-center"
              />
            </div>
          </div>
          {erreursDuCadre.length ? (
            <p className="shrink-0 pt-1 text-[12px] text-danger" data-studio-erreurs-cadre>
              {t('Un dessin a une erreur : {erreur}', { erreur: erreursDuCadre[0]! })}
            </p>
          ) : null}
          {!telephone ? ligneDeTemps : null}
        </div>

        {/* LE VOLET DE CÔTÉ (ordinateur) */}
        {!telephone ? (
          <ResizeHandle
            className="-mx-1.5"
            onPointerDown={(event) => voletDeDroite.start(event, 'right')}
            onDoubleClick={voletDeDroite.reset}
            data-studio-poignee="volet"
          />
        ) : null}
        {!telephone ? (
          <aside className="flex shrink-0 flex-col overflow-hidden rounded-md bg-bloc" style={{ width: voletDeDroite.width, ...FOND_DE_PANNEAU }} data-studio-volet>
            {/* LE VOLET DE DROITE N'EST QUE LA CONVERSATION avec l'agent. « Style »
                s'ouvre dans son propre volet, par-dessus (plus bas) ; les réglages
                d'un élément vivent dans sa fenêtre d'édition (double-clic, « Ouvrir
                l'éditeur »). */}
            <div className="flex min-h-0 flex-1 flex-col">{contenuDuPanneau('agent')}</div>
          </aside>
        ) : null}
      </div>

      {/* Au téléphone, la ligne de temps reste sous la rangée de l'aperçu ; sur ordinateur, elle vit DANS la colonne de l'aperçu. */}
      {telephone ? ligneDeTemps : null}

      {/* TÉLÉPHONE : les volets en tiroirs pleins, sous le pouce */}
      {telephone ? (
        <nav className="flex shrink-0 items-center justify-around px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5" data-studio-barre-telephone>
          {onglets.map((o) => (
            <button
              key={o.cle}
              type="button"
              onClick={() => (o.cle === 'bibliotheque' ? setStyleOuvert(true) : setTiroir(o.cle))}
              className="flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] text-muted" data-studio-ouvrir={o.cle}>
              <o.Icone className="h-4 w-4" />
              {o.libelle}
            </button>
          ))}
        </nav>
      ) : null}
      {telephone && tiroir ? (
        <Drawer open onClose={() => setTiroir(null)} empile plein adresse={`${tiroir}-studio`}>
          <header className="shrink-0 px-3 pb-2">
            <EnteteDeFenetre titre={onglets.find((o) => o.cle === tiroir)?.libelle ?? ''} onRetour={() => setTiroir(null)} />
          </header>
          {tiroir === 'agent' ? (
            <div className="flex min-h-0 flex-1 flex-col">{contenuDuPanneau('agent')}</div>
          ) : (
            <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4">
              {contenuDuPanneau(tiroir)}
            </ZoneDefilement>
          )}
        </Drawer>
      ) : null}

      {/* « STYLE » : composition, kit de marque, médias et modèles du projet, dans
          un volet posé par-dessus l'éditeur — sur ordinateur comme sur téléphone. */}
      <Drawer
        open={styleOuvert}
        onClose={() => setStyleOuvert(false)}
        onOuvrir={() => setStyleOuvert(true)}
        adresse="style-studio"
        empile
        plein={telephone}
        hauteurFixe={!telephone}
      >
        <header className="shrink-0 px-3 pb-2">
          <EnteteDeFenetre titre={t('Style')} onRetour={() => setStyleOuvert(false)} />
        </header>
        <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-4">
          <div data-studio-tiroir-style>{contenuDuPanneau('bibliotheque')}</div>
        </ZoneDefilement>
      </Drawer>

      {/* LA BIBLIOTHÈQUE DE STYLES : un tiroir posé par-dessus l'application, jamais un volet de côté. */}
      {galerie ? (
        <Drawer open onClose={() => setGalerie(false)} empile>
          {/* RETOUR À GAUCHE, TITRE AU CENTRE : depuis les sources, la flèche ramène aux styles ; depuis les styles, elle referme.
              Les sources s'ouvrent par leur bouton, en haut à droite. */}
          <header className="shrink-0 px-3 pb-2">
            <EnteteDeFenetre
              titre={vueSources ? t('Sources de la bibliothèque') : t('Bibliothèque')}
              onRetour={vueSources ? () => setVueSources(false) : () => setGalerie(false)}
              /* Depuis les sources, la flèche est un retour INTERNE : elle reste sous le fil d'Ariane. */
              retourInterne={vueSources}
              repereRetour={vueSources ? 'data-studio-bibliotheque-sources' : 'data-studio-retour'}
              droite={
                vueSources ? null : (
                  <Button size="icon" variant="ghost" aria-label="Sources" title={t('Sources : d’où viennent les styles')} onClick={() => setVueSources(true)} data-studio-bibliotheque-sources>
                    <Globe className="h-3.5 w-3.5" />
                  </Button>
                )
              }
            />
          </header>
          <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-4">
            <div data-studio-tiroir-bibliotheque>{vueSources ? <PanneauSources /> : <PanneauStyles onAppliquer={appliquerStyle} />}</div>
          </ZoneDefilement>
        </Drawer>
      ) : null}
      {production ? (
        <FenetreMiseEnProduction donnees={donnees} format={formatAffiche} temps={temps} onVoixEssai={voixEssai} onClose={() => setProduction(false)} />
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
    </ApercuEnDirect.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* L'agent de la création                                               */
/* ------------------------------------------------------------------ */

function PanneauAgent({
  donnees,
  onAppliquerStyle,
  demande,
  onDemande: setDemande,
  depot,
}: {
  donnees: DonneesCreation;
  onAppliquerStyle: (s: StyleDeLaGalerie) => void;
  demande: string;
  onDemande: (texte: string) => void;
  depot: { texte: string; nonce: number } | null;
}) {
  const state = useApp();
  const agentId = donnees.creation.agentId ?? null;
  const agent: Agent | null = agentId ? (state.agents[agentId] ?? null) : null;

  React.useEffect(() => {
    if (agentId && !agent) void client.chargerAgent(agentId);
  }, [agentId, !!agent]);

  /* LE BOUTON DE CONFIGURATION, EN TÊTE DE LA CONVERSATION : présent dès
     l'accueil (avant la première demande), puis tout au long du fil. */
  const configuration = <ConfigurationDeLAgent donnees={donnees} agent={agent} />;

  if (agent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-studio-agent="conversation">
        {configuration}
        <Chat
          agent={agent}
          projectId={donnees.creation.projectId}
          creuxReserveAilleurs
          depot={depot}
          avancementDansLeFil={({ todos, busy, dernierTexte }) => (
            <>
              <AvancementDeCreation todos={todos} busy={busy} />
              {/* Les pistes de mise en scène de l'agent citent des styles : leurs vignettes, cliquables. */}
              <StylesCites texte={dernierTexte} onAppliquer={onAppliquerStyle} />
              {/* « Vidéo » sans modèle retenu : l'agent écrit le repère, l'encadré propose les modèles ou mène aux paramètres. */}
              <EncadreServices texte={dernierTexte} donnees={donnees} />
            </>
          )}
        />
      </div>
    );
  }
  if (agentId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-studio-agent="chargement">
        {configuration}
        <div className="px-3">
          <SilhouetteConversation bulles={3} />
        </div>
      </div>
    );
  }
  const envoyer = async () => {
    const texte = demande.trim();
    if (!texte) return;
    await client.call({ type: 'studio.assistant', creationId: donnees.creation.id, demande: texte });
    setDemande('');
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-studio-agent="accueil">
      {configuration}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <p className="text-[13.5px] leading-relaxed text-text">
        {t('L’agent du studio dessine vos visuels en code, pièce par pièce : vous gardez la main sur chaque texte, couleur et position. Il prépare aussi les voix d’essai et les sous-titres.')}
      </p>
      <p className="text-[12.5px] text-muted">
        {t('Dites-lui ce que vous voulez. Il vous pose d’abord quelques questions pour cerner la vidéo, vous propose des pistes de mise en scène, puis suit son plan pas à pas, ici même. Rien de payant ne part sans votre clic.')}
      </p>
      <textarea
        value={demande}
        onChange={(e) => setDemande(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void envoyer();
        }}
        rows={4}
        placeholder={t('Une vidéo de 15 secondes qui présente notre nouvelle offre, ton enjoué…')}
        className="min-h-[96px] rounded-md border border-transparent bg-controle px-3 py-2 text-[13.5px] text-text"
        data-studio-demande
      />
      <Button variant="default" disabled={!demande.trim()} onClick={envoyer} data-studio-envoyer>
        <Send className="h-3.5 w-3.5" />
        {t('Confier à l’agent')}
      </Button>
      </div>
    </div>
  );
}

/**
 * LA CONFIGURATION DE L'AGENT DE LA CRÉATION — moteur, modèle, réflexion,
 * compte, comme pour une carte, mais MODIFIABLE À TOUT MOMENT (décision de
 * l'utilisateur, 08.10.2026) : le nouveau réglage vaut à la demande suivante,
 * et l'agent repart d'un fil neuf avec le résumé de la conversation (nouvelle
 * clé de session, `cleDeSession` / `filARappeler`).
 *
 * - Agent né : `agent.config` (le démon tranche la cascade et écrit aussi la
 *   carte de l'agent, sans toucher aux défauts du projet).
 * - Avant la première demande : le choix vit sur la création
 *   (`studio.creation.agent`) et sert au démarrage (`lancerAgentStudio`).
 */
function ConfigurationDeLAgent({ donnees, agent }: { donnees: DonneesCreation; agent: Agent | null }) {
  const state = useApp();
  const choisi = agent?.run ?? donnees.creation.runAgent;
  const choix = (choisi ?? { engine: 'claude' }) as RunChoix;
  const retenu = resoudreRun(state.engines, choix);
  // Avant tout choix, le démarrage prend le modèle le plus capable de Claude : on ne prétend pas en nommer un.
  const resume = [retenu.engine?.label ?? choix.engine, choisi?.model ? (retenu.model?.label ?? choisi.model) : t('Automatique')].filter(Boolean).join(' · ');

  const choisir = async (patch: RunChoix) => {
    try {
      if (agent) {
        const run: RunChoix = patch.engine ? { engine: patch.engine } : { model: patch.model, thinking: patch.thinking, account: patch.account };
        await client.call({ type: 'agent.config', agentId: agent.id, run });
        return;
      }
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
    <div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-1.5" data-studio-config-agent={agent ? 'agent' : 'creation'}>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted" data-studio-config-resume={resume}>
        {resume}
      </span>
      {/* L'icône est le bouton du menu des réglages : il s'ouvre sous elle. */}
      <RunSelectors
        engines={state.engines}
        choix={choix}
        onSelect={(patch) => void choisir(patch)}
        comptes={state.quotas}
        declencheur={
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            title={t('Configuration de l’agent')}
            aria-label="Configuration de l’agent"
            data-studio-config-agent-bouton
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        }
      />
    </div>
  );
}
