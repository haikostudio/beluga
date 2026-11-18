import * as React from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Loader2 } from '@/components/ui/icones';
import { pisteAccepte, pistesPourUnSegment, type Composition, type GenrePiste, type GenreSegment, type ModeDePose, type Piste } from '@beluga/shared';
import { usePointerDrag, type DragItem, type DropTarget } from '@/lib/dnd';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { VignetteVideo } from '@/components/lecteur-video';

/**
 * POSER UN MÉDIA SUR UNE PISTE, DANS LE STUDIO (décisions de l'utilisateur du
 * 02/11/2026) : à tout moment, même après une validation, depuis le menu d'un
 * média, en le glissant à la souris, ou par les boutons de l'atelier. Tout passe
 * par UNE seule fonction (`poser`) et une seule commande (`studio.poser`) : gratuit,
 * sans réveiller l'agent, une seule version donc un seul « Annuler ».
 *
 * Une place prise n'est jamais écrasée en silence : la question Remplacer / Ajouter
 * se pose ici, sur l'écran. Le glisser passe par `usePointerDrag`, seul mécanisme de
 * l'application. Au téléphone, la conversation et la ligne de temps ne sont jamais
 * visibles ensemble : seul le menu y sert.
 */

export interface PoseDemandee {
  attachmentId?: string;
  mediaId?: string;
  segment?: Record<string, unknown>;
  pisteId?: string;
  /** Toujours sur une piste neuve de son type (« Nouvelle piste » du menu). */
  nouvellePiste?: boolean;
  /** Sans instant : la tête de lecture. */
  debut?: number;
  valider?: boolean;
}

export interface SourceVersUnePiste {
  attachmentId: string;
  genre: 'image' | 'video' | 'son';
  nom: string;
  /** Il part de la rubrique Médias, qui recouvre la ligne de temps : elle s'efface le temps du geste. */
  depuisLaRubrique?: boolean;
}

/** Ce que la ligne de temps prête au glisser venu d'ailleurs. */
export interface PoigneeDeLaLigne {
  instantSous: (clientX: number) => number;
  aimanter: (instant: number) => number;
  zones: () => (HTMLElement | null)[];
}

interface ContexteDePose {
  poser: (d: PoseDemandee) => Promise<void>;
  pistes: (genre: GenreSegment, capacite?: string | null) => Piste[];
  nomDePiste: (p: Piste) => string;
  commencer: (event: React.PointerEvent, source: SourceVersUnePiste) => void;
  ligne: React.MutableRefObject<PoigneeDeLaLigne | null>;
  /** Où en est le fond de ce fichier : en cours de retrait, déjà retiré, ou entier. */
  etatDuFond: (attachmentId: string) => 'en-cours' | 'retire' | 'entier';
  gesteDuFond: (geste: 'retirer' | 'remettre', attachmentId: string) => void;
}

/** Fichier détouré → son original, et s'il a été remis (`studio-fond.ts`, côté serveur). */
export type FondsRetires = Record<string, { original: string; remis: boolean }>;

/** Y a-t-il une version sans fond EN SERVICE pour ce fichier, qu'il soit l'original ou la version elle-même ? */
export function fondRetire(fonds: FondsRetires | undefined, attachmentId: string): boolean {
  if (!fonds) return false;
  const lui = fonds[attachmentId];
  if (lui) return !lui.remis;
  return Object.values(fonds).some((f) => f.original === attachmentId && !f.remis);
}

interface EtatDuGlisser {
  genre: GenreSegment;
  cible: string | null;
  instant: number | null;
}

const Contexte = React.createContext<ContexteDePose | null>(null);
/* À part : il change à chaque mouvement, et seule la ligne de temps le lit. */
const ContexteDuGlisser = React.createContext<EtatDuGlisser | null>(null);

export const useContexteDePose = () => React.useContext(Contexte);
export const useEtatDuGlisserVersUnePiste = () => React.useContext(ContexteDuGlisser);

const SEGMENT_DE_LA_SOURCE: Record<SourceVersUnePiste['genre'], GenreSegment> = { image: 'image', video: 'video', son: 'audio' };

/** Le nom d'une piste : celui qu'on lui a choisi, sinon, dans la langue de l'écran, son type et son rang parmi ceux de ce type. */
export function nomDeLaPiste(pistes: readonly Pick<Piste, 'id' | 'genre'>[], p: Pick<Piste, 'id' | 'genre' | 'nomChoisi'>): string {
  if (p.nomChoisi) return p.nomChoisi;
  const n = pistes.filter((x) => x.genre === p.genre).findIndex((x) => x.id === p.id) + 1;
  const noms: Record<GenrePiste, string> = {
    image: t('Image {n}', { n }),
    video: t('Vidéo {n}', { n }),
    vecteur: t('Vecteur {n}', { n }),
    'sous-titres': t('Sous-titres {n}', { n }),
    voix: t('Voix {n}', { n }),
    son: t('Son {n}', { n }),
  };
  return noms[p.genre];
}

export function FournisseurDePose({
  creationId,
  composition,
  temps,
  onApres,
  onRubrique,
  fondsRetires,
  onDemanderAuSujetDuFond,
  onGlisser,
  children,
}: {
  creationId: string;
  composition: Composition;
  temps: number;
  /** La pose a eu lieu : l'écran reprend la composition rendue et amène la tête dessus. */
  onApres: (r: { composition: Composition; annulerRetablir: unknown; segmentId: string | null; debut: number }) => void;
  /** La rubrique Médias s'efface (faux) ou revient (vrai) pendant un glisser parti d'elle. */
  onRubrique?: (visible: boolean) => void;
  fondsRetires?: FondsRetires;
  /** Le fond n'est pas uni : l'utilisateur confie le fichier à l'agent, dans le champ d'écriture. */
  onDemanderAuSujetDuFond?: (attachmentId: string) => void;
  /** Un glisser démarre vraiment : ce qui est ouvert sur la frise se referme. */
  onGlisser?: () => void;
  children: React.ReactNode;
}) {
  const telephone = useTelephone();
  const compositionCourante = React.useRef(composition);
  compositionCourante.current = composition;
  const tempsCourant = React.useRef(temps);
  tempsCourant.current = temps;
  const surApres = React.useRef(onApres);
  surApres.current = onApres;
  const surRubrique = React.useRef(onRubrique);
  surRubrique.current = onRubrique;
  const ligne = React.useRef<PoigneeDeLaLigne | null>(null);
  const [question, setQuestion] = React.useState<{ demande: PoseDemandee & { debut: number }; nom: string } | null>(null);
  const [tranche, setTranche] = React.useState<ModeDePose | null>(null);

  const envoyer = React.useCallback(
    async (d: PoseDemandee & { debut: number }, mode?: ModeDePose) => {
      try {
        const r = await client.call<{ occupe?: { pisteId: string; nom: string }; composition: Composition; annulerRetablir: unknown; segmentId: string | null }>({ type: 'studio.poser', creationId, ...d, ...(mode ? { mode } : {}) });
        if (r.occupe) {
          setQuestion({ demande: { ...d, pisteId: d.pisteId ?? r.occupe.pisteId }, nom: r.occupe.nom });
          return;
        }
        setQuestion(null);
        surApres.current({ composition: r.composition, annulerRetablir: r.annulerRetablir, segmentId: r.segmentId, debut: d.debut });
        client.pushToast('success', t('Posé sur la ligne de temps.'));
      } catch (err: any) {
        setQuestion(null);
        client.pushToast('error', err?.message ?? t('Geste refusé'));
      }
    },
    [creationId],
  );

  const poser = React.useCallback((d: PoseDemandee) => envoyer({ ...d, debut: d.debut ?? Math.round(tempsCourant.current * 100) / 100 }), [envoyer]);

  const trancher = async (mode: ModeDePose) => {
    if (!question || tranche) return;
    setTranche(mode);
    await envoyer(question.demande, mode);
    setTranche(null);
  };

  /* ------------------------------ Le glisser ------------------------------ */
  const sources = React.useRef(new Map<string, SourceVersUnePiste>());
  const courant = React.useRef<SourceVersUnePiste | null>(null);

  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const source = courant.current;
    const rangee = element.closest<HTMLElement>('[data-piste-id][data-piste-genre]');
    if (!source || !rangee) return null;
    if (!pisteAccepte(rangee.dataset.pisteGenre as GenrePiste, SEGMENT_DE_LA_SOURCE[source.genre])) return null;
    if (compositionCourante.current.pistes.find((p) => p.id === rangee.dataset.pisteId)?.masquee) return null;
    return { id: rangee.dataset.pisteId!, kind: 'piste', position: 'inside' };
  }, []);

  /** Le dernier point visé : relu au lâcher, car la ligne a pu défiler dessous. */
  const dernierX = React.useRef(0);

  const terminer = React.useCallback((id: string) => {
    const source = sources.current.get(id);
    courant.current = null;
    if (source?.depuisLaRubrique) surRubrique.current?.(true);
    /* LE CLIC QUI SUIT UN GLISSER NE COMPTE PAS : sans ça, lâcher une image l'ouvrait en grand. */
    const avaler = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', avaler, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', avaler, { capture: true }), 80);
    return source;
  }, []);

  const onDrop = React.useCallback(
    (item: DragItem, target: DropTarget | null) => {
      const source = terminer(item.id);
      if (!source || !target) return;
      const l = ligne.current;
      const instant = l ? l.aimanter(l.instantSous(dernierX.current)) : tempsCourant.current;
      void envoyer({ attachmentId: source.attachmentId, pisteId: target.id, debut: Math.round(instant * 100) / 100, valider: true });
    },
    [envoyer, terminer],
  );

  const zones = React.useCallback(() => ligne.current?.zones() ?? [], []);
  const { dragging, target, pointer, start } = usePointerDrag({ resolve, onDrop, onAbandon: (item) => void terminer(item.id), defilementAuBord: zones });
  if (pointer) dernierX.current = pointer.x;
  const enCours = dragging ? (sources.current.get(dragging.id) ?? null) : null;

  const commencer = React.useCallback(
    (event: React.PointerEvent, source: SourceVersUnePiste) => {
      if (telephone || event.pointerType !== 'mouse' || event.button !== 0) return;
      /* Les boutons posés sur le média (menu « … », lecteur) gardent leur geste. */
      if ((event.target as Element).closest('[data-menu-actions], [data-valider-media], [data-retirer-la-validation], [data-menu-du-media-du-fil] button')) return;
      const id = `piece:${source.attachmentId}`;
      sources.current.set(id, source);
      courant.current = source;
      start(event, { id, kind: 'media-vers-piste', label: source.nom });
    },
    [telephone, start],
  );

  /* LA RUBRIQUE MÉDIAS RECOUVRE LA LIGNE DE TEMPS : elle s'efface dès que le geste démarre vraiment. */
  const rubriqueEffacee = React.useRef(false);
  React.useEffect(() => {
    if (enCours?.depuisLaRubrique && !rubriqueEffacee.current) {
      rubriqueEffacee.current = true;
      surRubrique.current?.(false);
    } else if (!enCours) rubriqueEffacee.current = false;
  }, [enCours]);

  /* UN GLISSER LAISSE LA PLACE LIBRE : le menu d'options d'un bloc se referme dès que le geste démarre. */
  const surGlisser = React.useRef(onGlisser);
  surGlisser.current = onGlisser;
  const glisse = !!enCours;
  React.useEffect(() => {
    if (glisse) surGlisser.current?.();
  }, [glisse]);

  /* ------------------------------ Le fond ------------------------------ */
  const [fondsEnCours, setFondsEnCours] = React.useState<ReadonlySet<string>>(new Set());
  const [fondRefuse, setFondRefuse] = React.useState<{ attachmentId: string; raison: string } | null>(null);
  const fondsCourants = React.useRef(fondsRetires);
  fondsCourants.current = fondsRetires;
  const fondsEnCoursRef = React.useRef(fondsEnCours);
  fondsEnCoursRef.current = fondsEnCours;
  const etatDuFond = React.useCallback((attachmentId: string) => (fondsEnCoursRef.current.has(attachmentId) ? ('en-cours' as const) : fondRetire(fondsCourants.current, attachmentId) ? ('retire' as const) : ('entier' as const)), []);
  const oublierLeFondEnCours = React.useCallback((cle: string) => {
    setFondsEnCours((avant) => {
      const apres = new Set(avant);
      apres.delete(cle);
      return apres;
    });
  }, []);
  const gesteDuFond = React.useCallback(
    (geste: 'retirer' | 'remettre', attachmentId: string) => {
      /* L'ATTENTE SE VOIT DÈS LE CLIC : la réponse part tout de suite, l'issue arrive par l'événement du Studio. */
      setFondsEnCours((avant) => new Set(avant).add(attachmentId));
      void client.call({ type: geste === 'retirer' ? 'studio.fond.retirer' : 'studio.fond.remettre', creationId, attachmentId }).catch((err: any) => {
        oublierLeFondEnCours(attachmentId);
        client.pushToast('error', err?.message ?? t('Geste refusé'));
      });
    },
    [creationId, oublierLeFondEnCours],
  );
  const issueDuFond = React.useSyncExternalStore(client.subscribe, () => client.lireEtat().studioFond);
  const dejaLue = React.useRef(issueDuFond?.n ?? 0);
  React.useEffect(() => {
    if (!issueDuFond || issueDuFond.n === dejaLue.current) return;
    dejaLue.current = issueDuFond.n;
    if (issueDuFond.creationId !== creationId) return;
    oublierLeFondEnCours(issueDuFond.cle);
    if (issueDuFond.etat === 'non-uni') setFondRefuse({ attachmentId: issueDuFond.cle, raison: issueDuFond.raison ?? '' });
    else if (issueDuFond.etat === 'echec') client.pushToast('error', issueDuFond.raison ?? t('Geste refusé'));
    else if (issueDuFond.geste === 'remettre') client.pushToast('success', t('Le fond est remis.'));
    else client.pushToast('success', issueDuFond.segments ? t('Fond retiré, partout où ce média est posé.') : t('Fond retiré : la version sans fond rejoint les Médias.'));
  }, [issueDuFond, creationId, oublierLeFondEnCours]);

  const pistes = React.useCallback((genre: GenreSegment, capacite?: string | null) => pistesPourUnSegment(compositionCourante.current, genre, capacite), []);
  const nomDePiste = React.useCallback((p: Piste) => nomDeLaPiste(compositionCourante.current.pistes, p), []);

  /* `fondsEnCours` et `fondsRetires` dans les dépendances : un menu ouvert relit l'état du fond dès qu'il change. */
  const valeur = React.useMemo<ContexteDePose>(() => ({ poser, pistes, nomDePiste, commencer, ligne, etatDuFond, gesteDuFond }), [poser, pistes, nomDePiste, commencer, etatDuFond, gesteDuFond, fondsEnCours, fondsRetires]);
  const etat = React.useMemo<EtatDuGlisser | null>(() => {
    if (!enCours) return null;
    const l = ligne.current;
    return { genre: SEGMENT_DE_LA_SOURCE[enCours.genre], cible: target?.id ?? null, instant: target && pointer && l ? l.aimanter(l.instantSous(pointer.x)) : null };
  }, [enCours, target, pointer]);

  return (
    <Contexte.Provider value={valeur}>
      <ContexteDuGlisser.Provider value={etat}>{children}</ContexteDuGlisser.Provider>
      {enCours && pointer
        ? createPortal(
            <div
              aria-hidden
              data-apercu-du-glisser-vers-piste={enCours.genre}
              className="pointer-events-none fixed z-[80] flex h-14 w-24 items-center justify-center overflow-hidden rounded-md bg-raised px-1 text-center text-[11px] leading-tight text-text opacity-90 shadow-lg ring-1 ring-faint/25"
              style={{ left: pointer.x + 12, top: pointer.y + 12 }}
            >
              {enCours.genre === 'video' ? (
                <VignetteVideo id={enCours.attachmentId} nom={enCours.nom} className="pointer-events-none h-full w-full object-cover" />
              ) : enCours.genre === 'image' ? (
                <ImageDePiece id={enCours.attachmentId} alt={enCours.nom} className="h-full w-full object-cover" />
              ) : (
                <span className="line-clamp-3">{enCours.nom}</span>
              )}
            </div>,
            document.body,
          )
        : null}
      {fondRefuse ? (
        <Dialog open onOpenChange={(ouvert) => !ouvert && setFondRefuse(null)}>
          <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]" data-studio-fond-non-uni>
            <DialogHeader>
              <DialogTitle>{t('Ce fond n’est pas uni')}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="mt-0">{t('Le retrait automatique ne sait pas le séparer du sujet ({raison}). L’agent peut proposer de le refaire.', { raison: fondRefuse.raison })}</DialogDescription>
            <DialogFooter pleineLargeur>
              {onDemanderAuSujetDuFond ? (
                <Button
                  onClick={() => {
                    onDemanderAuSujetDuFond(fondRefuse.attachmentId);
                    setFondRefuse(null);
                  }}
                  data-studio-fond-demander-agent
                >
                  {t('Demander à l’agent')}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setFondRefuse(null)}>
                {t('Fermer')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {question ? (
        <Dialog open onOpenChange={(ouvert) => !ouvert && !tranche && setQuestion(null)}>
          <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]" data-studio-question-de-place>
            <DialogHeader>
              <DialogTitle>{t('Cette place est déjà prise')}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="mt-0">{t('« {nom} » occupe déjà cet endroit de la piste.', { nom: question.nom })}</DialogDescription>
            <DialogFooter pleineLargeur>
              <Button onClick={() => void trancher('remplacer')} disabled={!!tranche} data-studio-place-remplacer>
                {tranche === 'remplacer' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('Remplacer')}
              </Button>
              <Button variant="subtle" onClick={() => void trancher('ajouter')} disabled={!!tranche} data-studio-place-ajouter>
                {tranche === 'ajouter' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('Ajouter sur une piste en plus')}
              </Button>
              <Button variant="ghost" onClick={() => setQuestion(null)} disabled={!!tranche} data-studio-place-annuler>
                {t('Annuler')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Contexte.Provider>
  );
}

/** Ce qu'un média étale pour se glisser sur une piste : rien hors du Studio, ni au téléphone. */
export function useSourceVersUnePiste(source: SourceVersUnePiste | null): React.HTMLAttributes<HTMLElement> & { 'data-glissable-vers-une-piste'?: string } {
  const contexte = React.useContext(Contexte);
  const telephone = useTelephone();
  if (!contexte || !source || telephone) return {};
  return {
    onPointerDown: (event: React.PointerEvent) => contexte.commencer(event, source),
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
    'data-glissable-vers-une-piste': source.genre,
  };
}

/** LA PRISE D'UN LECTEUR (son, vidéo) : le lecteur garde ses gestes, c'est ce petit repère qui se glisse. */
export function PriseDUnMedia({ source }: { source: SourceVersUnePiste }) {
  const prise = useSourceVersUnePiste(source);
  if (!prise.onPointerDown) return null;
  return (
    <span {...prise} title={t('Glisser sur une piste')} className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-faint hover:bg-raised hover:text-text" data-prise-du-media={source.attachmentId} style={{ touchAction: 'none' }}>
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );
}
