import * as React from 'react';
import {
  ArrowLeft,
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
  Send,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  type Agent,
  type FormatStudio,
  type OperationStudio,
  type Piste,
  CLES_FORMATS_STUDIO,
  FORMATS_STUDIO,
  dureeExportee,
  piecesDuDessin,
  trouverSegment,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  DialogFooter,
  DialogTitle,
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
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { Apercu, ApercuEnDirect, type ApercuDirect, type BoiteDuCadre, type MessageDuCadre, type PoigneeApercu } from './apercu';
import { AvancementDeCreation } from './avancement';
import { EditeurElement } from './editeur-element';
import { PanneauSources, PanneauStyles, StylesCites, demandeDAppliquer, type StyleDeLaGalerie } from './styles';
import { LigneDeTemps, type QuoiAjouter } from './ligne-de-temps';
import { Calques, Inspecteur, ReglagesDeComposition } from './inspecteur';
import { DepensesEnAttente, PanneauBibliotheque, choisirEtImporter } from './panneaux';
import { EnteteDeFenetre } from './champs';
import { BoutonMiseEnProduction, FenetreMiseEnProduction } from './production';
import { libelleFormat } from './libelles';
import { VoletVerification } from './verification';
import type { DonneesCreation, LigneCreation, ResumeModele } from './types';

/**
 * LE STUDIO — visuels fixes et vidéos animées de chaque projet.
 *
 * Deux écrans : la LISTE des créations (par projet), puis l'ÉDITEUR d'une
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
    <Drawer open={open} onClose={onClose} enPage={enPage}>
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

function ListeDesCreations({ onOuvrir }: { onOuvrir: (id: string) => void }) {
  const state = useApp();
  const version = state.studioVersions['*'] ?? 0;
  const [vue, setVue] = React.useState<{ creations: LigneCreation[]; projets: { id: string; name: string }[] } | null>(null);
  const [nouvelle, setNouvelle] = React.useState(false);

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

  const parProjet = React.useMemo(() => {
    const groupes = new Map<string, { nom: string; creations: LigneCreation[] }>();
    for (const c of vue?.creations ?? []) {
      const g = groupes.get(c.projectId) ?? { nom: c.projet, creations: [] };
      g.creations.push(c);
      groupes.set(c.projectId, g);
    }
    return [...groupes.entries()];
  }, [vue]);

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Clapperboard className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Studio')}</DialogTitle>
        <Button size="sm" variant="default" onClick={() => setNouvelle(true)} data-studio-nouvelle>
          <Plus className="h-3.5 w-3.5" />
          {t('Nouvelle création')}
        </Button>
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4">
        {vue === null ? (
          <SilhouetteStudio />
        ) : !vue.creations.length ? (
          <div className="flex flex-col gap-2 px-1 py-4 text-[13.5px] leading-relaxed" data-studio-vide>
            <p className="text-text">{t('Aucune création pour l’instant.')}</p>
            <p className="text-muted">
              {t('Une création est un visuel ou une courte vidéo animée, faite de pièces séparées qu’on retouche à tout moment. L’agent du studio les dessine pour vous, puis vous l’exportez aux formats des réseaux.')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4" data-studio-liste>
            {parProjet.map(([projectId, g]) => (
              <section key={projectId} className="flex flex-col gap-2">
                <h3 className="px-1 text-[12.5px] font-semibold text-muted">{g.nom}</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {g.creations.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onOuvrir(c.id)}
                      className="flex flex-col overflow-hidden rounded-md bg-bloc text-left transition-colors hover:bg-raised"
                      data-studio-creation={c.id}
                    >
                      <span className="flex aspect-[4/5] items-center justify-center bg-raised">
                        {c.afficheId ? (
                          <img src={`/api/attachment?id=${encodeURIComponent(c.afficheId)}`} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Clapperboard className="h-6 w-6 text-faint" />
                        )}
                      </span>
                      <span className="flex flex-col gap-0.5 px-2.5 py-2">
                        <span className="truncate text-[13px] font-medium text-text">{c.titre}</span>
                        <span className="truncate text-[11.5px] text-faint">
                          {c.formats.map(libelleFormat).join(' · ')} · {(Math.round(c.duree * 10) / 10).toLocaleString(formatRegional())} s
                        </span>
                        {c.voixEnEssai ? <span className="text-[11.5px] text-en-cours">{t('{n} voix d’essai', { n: c.voixEnEssai })}</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
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
  const creer = async () => {
    const r = await client.call<{ creation: { id: string } }>(
      modele
        ? { type: 'studio.creation.creer', projectId: projet, titre: titre.trim() || undefined, depuisModele: modele }
        : { type: 'studio.creation.creer', projectId: projet, titre: titre.trim() || undefined, formats },
    );
    onClose();
    onCree(r.creation.id);
  };
  return (
    <Drawer open onClose={onClose} empile>
      <header className="shrink-0 px-3 pb-2">
        <EnteteDeFenetre titre={t('Nouvelle création')} onRetour={onClose} />
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="px-4 pb-3">
        <div className="text-[13.5px]" data-studio-formulaire>
          <FormulaireEnColonnes largeurLibelle="7rem">
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
        <Button variant="default" size="lg" disabled={!projet || (!modele && !formats.length)} onClick={creer} data-studio-creer>
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
/** Le volet de droite (ordinateur) : la conversation, ou « Style » ouvert par son bouton d'entête. */
type VoletDeDroite = Exclude<Panneau, 'reglages'>;

function Editeur({ creationId, onRetour, onOuvrir }: { creationId: string; onRetour: () => void; onOuvrir: (id: string) => void }) {
  const state = useApp();
  const telephone = useTelephone();
  // `reprise` avance après une coupure : la création ouverte se relit même si aucun signal ne l'a nommée.
  const version = (state.studioVersions[creationId] ?? 0) + (state.studioVersions.reprise ?? 0);
  const [donnees, setDonnees] = React.useState<DonneesCreation | null>(null);
  const [temps, setTemps] = React.useState(0);
  const [lecture, setLecture] = React.useState(false);
  const [muet, setMuet] = React.useState(false);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [element, setElement] = React.useState<string | null>(null);
  const [format, setFormat] = React.useState<FormatStudio | null>(null);
  const [panneau, setPanneau] = React.useState<VoletDeDroite>('agent');
  const [tiroir, setTiroir] = React.useState<Panneau | null>(null);
  /** LA GALERIE DE STYLES, dans son tiroir posé par-dessus l'application. */
  const [galerie, setGalerie] = React.useState(false);
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
  }, [basculerLecture, aller, duree, temps, selection, element, operer, annuler, retablir, editeur]);

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
  /** « Appliquer » un style : la demande part à l'agent de la création, et sa conversation s'ouvre. */
  const appliquerStyle = (style: StyleDeLaGalerie) =>
    client
      .call({ type: 'studio.assistant', creationId, demande: demandeDAppliquer(style) })
      .then(() => {
        client.pushToast('success', t('Demande envoyée à l’agent : « {titre} ».', { titre: style.titre }));
        setGalerie(false);
        if (telephone) setTiroir('agent');
        else setPanneau('agent');
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Envoi impossible')));
  const segmentChoisi = choisi ? trouverSegment(composition, choisi)?.segment ?? null : null;
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
      <PanneauAgent donnees={donnees} onAppliquerStyle={appliquerStyle} />
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

  return (
    <ApercuEnDirect.Provider value={direct}>
    <div className="flex min-h-0 flex-1 flex-col" data-studio-editeur={creationId}>
      <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        <Button variant="ghost" size="icon" aria-label="Toutes les créations" title={t('Toutes les créations')} onClick={onRetour} data-studio-retour>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <button type="button" className="min-w-0 shrink truncate text-left" onClick={() => setRenommer(true)} title={t('Renommer')}>
          <DialogTitle className="truncate">{donnees.creation.titre}</DialogTitle>
          <span className="block truncate text-[11.5px] text-faint">{donnees.projet}</span>
        </button>
        {/* DUPLIQUER ET SUPPRIMER SE COLLENT AU TITRE : ils parlent de la création elle-même. */}
        {!telephone ? (
          <span className="flex shrink-0 items-center" data-studio-gestes-creation>
            <Button variant="ghost" size="icon" aria-label="Dupliquer la création" title={t('Dupliquer la création')} onClick={async () => onOuvrir((await client.call<{ creation: { id: string } }>({ type: 'studio.creation.dupliquer', id: creationId })).creation.id)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Supprimer la création" title={t('Supprimer la création')} onClick={() => setSupprimer(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        ) : null}
        <span className="min-w-0 flex-1" aria-hidden />
        <Button variant="ghost" size="icon" aria-label="Annuler" title={t('Annuler (Ctrl+Z)')} disabled={!donnees.annulerRetablir.annuler} onClick={annuler} data-studio-annuler>
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Rétablir" title={t('Rétablir (Ctrl+Maj+Z)')} disabled={!donnees.annulerRetablir.retablir} onClick={retablir} data-studio-retablir>
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        {/* LA BIBLIOTHÈQUE DE STYLES ET LE VOLET « STYLE », entre Annuler/Rétablir et « Mettre en production ». */}
        <Button
          size="sm"
          variant={galerie ? 'subtle' : 'ghost'}
          onClick={() => setGalerie((g) => !g)}
          aria-pressed={galerie}
          aria-label="Bibliothèque"
          title={t('Bibliothèque de styles : une mise en scène à confier à l’agent')}
          data-studio-ouvrir-bibliotheque
        >
          <Library className="h-3.5 w-3.5" />
          {!telephone ? t('Bibliothèque') : null}
        </Button>
        {!telephone ? (
          <Button
            size="sm"
            variant={panneau === 'bibliotheque' ? 'subtle' : 'ghost'}
            onClick={() => setPanneau((p) => (p === 'bibliotheque' ? 'agent' : 'bibliotheque'))}
            aria-pressed={panneau === 'bibliotheque'}
            title={t('Style : kit de marque, médias et modèles du projet')}
            data-studio-onglet="bibliotheque"
          >
            <Palette className="h-3.5 w-3.5" />
            {t('Style')}
          </Button>
        ) : null}
        <BoutonMiseEnProduction compact={telephone} depenses={donnees.depenses} onClick={() => setProduction(true)} />
      </header>

      <DepensesEnAttente donnees={donnees} />

      {/* AU TÉLÉPHONE, CETTE RANGÉE GARDE SA HAUTEUR (celle de l'aperçu) : en `flex-1`, elle partageait la place à parts
          égales avec la ligne de temps, se retrouvait plus basse que l'aperçu qu'elle contient, et la ligne de temps
          (durée, règle des secondes) remontait SUR le bas de l'image. La ligne de temps prend ce qui reste. */}
      <div className={cn('flex min-h-0', telephone ? 'shrink-0 flex-col' : 'flex-1 flex-row gap-2 px-3')} data-studio-rangee-apercu>
        {/* LES CALQUES (ordinateur) : leur colonne à gauche de l'aperçu, la droite reste aux réglages. */}
        {!telephone ? (
          <aside className="flex w-[240px] shrink-0 flex-col overflow-hidden rounded-md bg-bloc xl:w-[260px]" data-studio-colonne-calques>
            <ZoneDefilement fond="color-mix(in srgb, hsl(var(--surface)) 92%, hsl(var(--voile)) 8%)" className="pb-2">
              {segmentChoisi?.genre === 'dessin' && piecesDuDessin(segmentChoisi.gabarit.html).length ? (
                <Calques
                  segment={segmentChoisi}
                  elementId={element}
                  format={formatAffiche}
                  formatDeBase={composition.format}
                  onOperation={operer}
                  onChoisirPiece={choisirPiece}
                  onOuvrirEditeur={(id) => ouvrirEditeur(segmentChoisi.id, id)}
                />
              ) : (
                <p className="px-3 py-3 text-[12.5px] text-faint" data-studio-calques-vide>
                  {t('Choisissez un dessin dans la ligne de temps pour voir ses calques.')}
                </p>
              )}
            </ZoneDefilement>
          </aside>
        ) : null}
        {/* L'APERÇU ET SES COMMANDES : le cadre foncé commence en haut de la rangée, et porte les formats, le son et la lecture. */}
        <div className={cn('flex min-h-0 min-w-0 flex-col', telephone ? 'h-[42vh] shrink-0 px-3' : 'flex-1')}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-bg" data-studio-cadre-apercu>
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
        </div>

        {/* LE VOLET DE CÔTÉ (ordinateur) */}
        {!telephone ? (
          <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-md bg-bloc xl:w-[400px]" data-studio-volet>
            {/* LE VOLET NE PORTE PLUS D'ONGLETS : la conversation avec l'agent, et le
                volet « Style » quand son bouton d'entête est allumé (un second clic
                ramène à la conversation). Les réglages d'un élément vivent dans sa
                fenêtre d'édition (double-clic, « Ouvrir l'éditeur »). */}
            {panneau === 'agent' ? (
              <div className="flex min-h-0 flex-1 flex-col">{contenuDuPanneau('agent')}</div>
            ) : (
              <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
                {contenuDuPanneau(panneau)}
              </ZoneDefilement>
            )}
          </aside>
        ) : null}
      </div>

      {/* LA LIGNE DE TEMPS */}
      <div className={cn('flex min-h-0 flex-col pt-2', telephone ? 'flex-1' : 'max-h-[34vh] shrink-0')} data-studio-rangee-ligne-de-temps>
        <ZoneDefilement fond="hsl(var(--surface))" className="px-1 pb-2">
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
          />
        </ZoneDefilement>
      </div>

      {/* TÉLÉPHONE : les volets en tiroirs pleins, sous le pouce */}
      {telephone ? (
        <nav className="flex shrink-0 items-center justify-around px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5" data-studio-barre-telephone>
          {onglets.map((o) => (
            <button key={o.cle} type="button" onClick={() => setTiroir(o.cle)} className="flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] text-muted" data-studio-ouvrir={o.cle}>
              <o.Icone className="h-4 w-4" />
              {o.libelle}
            </button>
          ))}
        </nav>
      ) : null}
      {telephone && tiroir ? (
        <Drawer open onClose={() => setTiroir(null)} empile plein>
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

      {/* LA BIBLIOTHÈQUE DE STYLES : un tiroir posé par-dessus l'application, jamais un volet de côté. */}
      {galerie ? (
        <Drawer open onClose={() => setGalerie(false)} empile>
          {/* RETOUR À GAUCHE, TITRE AU CENTRE : depuis les sources, la flèche ramène aux styles ; depuis les styles, elle referme.
              Les sources s'ouvrent par leur bouton, en haut à droite. */}
          <header className="shrink-0 px-3 pb-2">
            <EnteteDeFenetre
              titre={vueSources ? t('Sources de la bibliothèque') : t('Bibliothèque')}
              onRetour={vueSources ? () => setVueSources(false) : () => setGalerie(false)}
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

function PanneauAgent({ donnees, onAppliquerStyle }: { donnees: DonneesCreation; onAppliquerStyle: (s: StyleDeLaGalerie) => void }) {
  const state = useApp();
  const agentId = donnees.creation.agentId ?? null;
  const agent: Agent | null = agentId ? (state.agents[agentId] ?? null) : null;
  const [demande, setDemande] = React.useState('');

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
          avancementDansLeFil={({ todos, busy, dernierTexte }) => (
            <>
              <AvancementDeCreation todos={todos} busy={busy} />
              {/* Les pistes de mise en scène de l'agent citent des styles : leurs vignettes, cliquables. */}
              <StylesCites texte={dernierTexte} onAppliquer={onAppliquerStyle} />
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
        className="min-h-[96px] rounded-md border border-border bg-controle px-3 py-2 text-[13.5px] text-text"
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
  const [ouvert, setOuvert] = React.useState(false);
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
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0"
        title={t('Configuration de l’agent')}
        aria-label="Configuration de l’agent"
        aria-pressed={ouvert}
        onClick={() => setOuvert(true)}
        data-studio-config-agent-bouton
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </Button>
      <RunSelectors
        engines={state.engines}
        choix={choix}
        onSelect={(patch) => void choisir(patch)}
        comptes={state.quotas}
        masquerDeclencheur
        ouvertControle={ouvert}
        onOuvertControleChange={setOuvert}
      />
    </div>
  );
}
