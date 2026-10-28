import * as React from 'react';
import { createPortal } from 'react-dom';
import { carteDeMedia, decoupageDuMedia, type MediaDuSuivi } from '@beluga/shared';
import { usePointerDrag, type DragItem, type DropTarget } from '@/lib/dnd';
import { client } from '@/lib/client';
import { useProduction } from '@/lib/production-de-carte';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { placerDansUnPlan } from '@/components/menu-du-media';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { VignetteVideo } from '@/components/lecteur-video';

/**
 * GLISSER UNE IMAGE VERS UN PLAN, À LA SOURIS (28/10/2026 : « sur ordi, on doit
 * pouvoir drag une image du chat à droite, et à droite déplacer une image dans
 * une autre section du plan, en respectant le type de zone de dépôt »).
 *
 * UN SEUL MÉCANISME DE GLISSER DANS L'APPLICATION : `usePointerDrag`
 * (`web/src/lib/dnd.ts`), le même que le tableau. Le fournisseur est posé par la page de la
 * carte autour de la conversation ET du volet de droite — le suivi y est rendu
 * par un portail, mais dans le même document : la case sous le pointeur se lit
 * par `elementFromPoint`.
 *
 *  - LES SOURCES : les médias finis du fil (médias livrés, bloc d'un média
 *    fabriqué, vignettes de « Ce que l'agent a vu ») et les cases pleines du
 *    suivi. À la souris seulement : au doigt, rien ne change.
 *  - LES CIBLES : les cases des plans du suivi (`data-case-du-plan` +
 *    `data-genre-accepte`). Une image ne se lâche que sur une case d'image,
 *    une vidéo que sur une case de séquence ; les autres s'estompent pendant le
 *    geste, celles qui acceptent s'éclairent en violet.
 *  - LE DÉPÔT : `production.placer` (après l'inscription d'un média du fil
 *    encore inconnu). Relâché hors d'une case : rien. Un clic sans mouvement
 *    ouvre toujours l'image en grand ; le clic qui suit un glisser est avalé.
 */

export interface SourceDuGlisser {
  /**
   * Le média de la production quand on le connaît ; sinon il se retrouve au
   * dépôt par sa pièce, et une pièce encore inconnue de la production y est
   * inscrite (`production.inscrire`).
   */
  mediaId?: string | null;
  attachmentId: string;
  genre: 'image' | 'video';
  nom: string;
  /** La case du suivi d'où il part, pour une case pleine : la lâcher sur elle-même ne fait rien. */
  plan?: string;
}

interface ContexteDuGlisser {
  commencer: (event: React.PointerEvent, source: SourceDuGlisser) => void;
  /** Ce qui se glisse en ce moment, ou rien. */
  enCours: SourceDuGlisser | null;
  /** La case sous le pointeur qui accepte le média, ou rien. */
  cible: string | null;
}

const Contexte = React.createContext<ContexteDuGlisser | null>(null);

/** Le genre de média qu'une case accepte, lu sur son repère. */
function caseSous(element: Element): { cle: string; genre: string } | null {
  const c = element.closest<HTMLElement>('[data-case-du-plan][data-genre-accepte]');
  if (!c) return null;
  return { cle: c.dataset.caseDuPlan!, genre: c.dataset.genreAccepte! };
}

export function FournisseurGlisserVersUnPlan({ cardId, children }: { cardId: string; children: React.ReactNode }) {
  const carte = useApp().cards[cardId];
  const telephone = useTelephone();
  const media = !!carte && carteDeMedia(carte);
  const production = useProduction(media ? cardId : null);
  /* Seulement dans une création de média découpée en plans, et à l'ordinateur. */
  const actif = media && !telephone && !!production && decoupageDuMedia(production.elements).some((p) => p.visuel);
  const productionCourante = React.useRef(production);
  productionCourante.current = production;
  const sources = React.useRef(new Map<string, SourceDuGlisser>());
  /* Ce qui se glisse, lu par `resolve` : seule une case du bon genre, autre que celle d'où il part, est une cible. */
  const courant = React.useRef<SourceDuGlisser | null>(null);

  const resolve = React.useCallback((element: Element): DropTarget | null => {
    const c = caseSous(element);
    const source = courant.current;
    if (!c || !source || c.genre !== source.genre || c.cle === source.plan) return null;
    return { id: c.cle, kind: c.genre, position: 'inside' };
  }, []);

  const onDrop = React.useCallback(
    (item: DragItem, target: DropTarget | null) => {
      const source = sources.current.get(item.id);
      courant.current = null;
      /* LE CLIC QUI SUIT UN GLISSER NE COMPTE PAS : sans ça, lâcher une image ouvrait son aperçu en grand. */
      const avaler = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener('click', avaler, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', avaler, { capture: true }), 80);
      if (!source || !target || target.kind !== source.genre) return;
      void (async () => {
        try {
          let mediaId = source.mediaId ?? productionCourante.current?.medias.find((m) => m.attachmentId === source.attachmentId)?.id ?? null;
          if (!mediaId) {
            const r = await client.call<{ media: MediaDuSuivi }>({ type: 'production.inscrire', cardId, attachmentId: source.attachmentId });
            mediaId = r.media.id;
          }
          await placerDansUnPlan(cardId, mediaId, target.id);
        } catch (err: any) {
          client.pushToast('error', err?.message ?? t('La validation n’a pas pu être enregistrée'));
        }
      })();
    },
    [cardId],
  );

  const { dragging, target, pointer, start } = usePointerDrag({ resolve, onDrop });
  const enCours = dragging ? (sources.current.get(dragging.id) ?? null) : null;
  const cible = enCours && target ? target.id : null;

  const commencer = React.useCallback(
    (event: React.PointerEvent, source: SourceDuGlisser) => {
      if (!actif || event.pointerType !== 'mouse' || event.button !== 0) return;
      /* Les boutons posés sur la vignette (menu « … », Valider, retirer) gardent leur geste. */
      if ((event.target as Element).closest('[data-menu-actions], [data-valider-media], [data-retirer-la-validation], [data-menu-du-media-du-fil] button')) return;
      const id = source.mediaId || `piece:${source.attachmentId}`;
      sources.current.set(id, source);
      courant.current = source;
      start(event, { id, kind: source.genre, label: source.nom });
    },
    [actif, start],
  );

  const valeur = React.useMemo<ContexteDuGlisser>(() => ({ commencer, enCours, cible }), [commencer, enCours, cible]);

  return (
    <Contexte.Provider value={valeur}>
      {children}
      {enCours && pointer
        ? createPortal(
            <div
              aria-hidden
              data-apercu-du-glisser={enCours.genre}
              className="pointer-events-none fixed z-[80] h-14 w-24 overflow-hidden rounded-md bg-raised opacity-90 shadow-lg ring-1 ring-faint/25"
              style={{ left: pointer.x + 12, top: pointer.y + 12 }}
            >
              {enCours.genre === 'video' ? (
                <VignetteVideo id={enCours.attachmentId} nom={enCours.nom} className="pointer-events-none h-full w-full object-cover" />
              ) : (
                <ImageDePiece id={enCours.attachmentId} alt={enCours.nom} className="h-full w-full object-cover" />
              )}
            </div>,
            document.body,
          )
        : null}
    </Contexte.Provider>
  );
}

/**
 * CE QU'UNE VIGNETTE DU FIL OU DU SUIVI ÉTALE POUR SE GLISSER : rien hors du
 * fournisseur, pour un son, ou sans pièce. Le glisser natif de l'image est
 * coupé — c'est le pointeur qui mène.
 */
export function useSourceDuGlisser(source: SourceDuGlisser | null): React.HTMLAttributes<HTMLElement> & { 'data-glissable-vers-un-plan'?: string } {
  const contexte = React.useContext(Contexte);
  if (!contexte || !source) return {};
  return {
    onPointerDown: (event: React.PointerEvent) => contexte.commencer(event, source),
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
    'data-glissable-vers-un-plan': source.genre,
  };
}

/**
 * L'ÉTAT D'UNE CASE PENDANT UN GLISSER : `accepte` (cerclée de violet),
 * `survolee` (le pointeur est dessus), `refuse` (estompée), ou rien hors d'un
 * glisser.
 */
export function useEtatDeLaCase(cle: string, genre: 'image' | 'video'): 'accepte' | 'survolee' | 'refuse' | null {
  const contexte = React.useContext(Contexte);
  if (!contexte?.enCours) return null;
  if (contexte.enCours.genre !== genre) return 'refuse';
  /* La case d'où part le média n'est pas une cible, sans être un refus. */
  if (contexte.enCours.plan === cle) return null;
  return contexte.cible === cle ? 'survolee' : 'accepte';
}

/**
 * UNE VIGNETTE DU FIL QUI SE GLISSE, sans toucher à sa mise en page : une
 * boîte `contents` reçoit l'appui de la souris qui remonte de la vignette.
 */
export function GlissableVersUnPlan({ attachmentId, genre, nom, children }: { attachmentId: string | null | undefined; genre: string | null | undefined; nom: string; children: React.ReactNode }) {
  const source = useSourceDuGlisser(attachmentId && (genre === 'image' || genre === 'video') ? { attachmentId, genre, nom } : null);
  return (
    <div className="contents" {...source}>
      {children}
    </div>
  );
}
