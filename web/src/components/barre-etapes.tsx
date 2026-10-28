import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { LIBELLE_ETAPE_DE_SUIVI, tonDuSegmentDeSuivi, type EtapeDeSuivi, type SegmentDeSuivi } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * Sous cette largeur de barre, les cinq noms se marchent dessus : seul celui de
 * l'étape mise en avant s'écrit. Calibré sur « Compréhension » + « À déployer »
 * en 13 px, avec les ronds et les traits ; mesuré sur la barre elle-même, jamais
 * sur la fenêtre (la conversation se règle à la souris, le menu se replie).
 */
const LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS = 560;
/** Les six étapes d'une création de média (« Images clés et prix ») demandent plus de place. */
const LARGEUR_DE_LA_BARRE_POUR_SIX_NOMS = 720;

/** Ce que montre un rond d'étape : fait, ici (une roue tant qu'on y travaille, « ! » tombé), à venir. */
export type FormeDuRondDEtape = 'faite' | 'travail' | 'erreur' | 'ici' | 'avenir';

/**
 * LE ROND D'UNE ÉTAPE, en noir et blanc : plein avec sa coche une fois fait,
 * cerclé avec un point (ou une roue, ou « ! ») là où l'on est, vide et pâle à
 * venir. Partagé par la barre d'étapes de la carte et le chemin du tournage du
 * mode Réalisation : les deux se lisent de la même façon.
 */
export function RondDEtape({ forme }: { forme: FormeDuRondDEtape }) {
  return (
    <span
      aria-hidden
      data-rond-etape={forme}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors',
        forme === 'faite' ? 'bg-text text-bg' : forme === 'avenir' ? 'border-[1.5px] border-faint/50 text-faint' : 'border-[1.5px] border-text text-text',
      )}
    >
      {forme === 'faite' ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : forme === 'travail' ? (
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
      ) : forme === 'erreur' ? (
        <span className="text-[11px] font-bold leading-none text-danger">!</span>
      ) : forme === 'ici' ? (
        <span className="h-2 w-2 rounded-full bg-text" />
      ) : null}
    </span>
  );
}

/**
 * LA BARRE D'ÉTAPES : UNE RANGÉE DE RONDS, LEUR NOM À CÔTÉ, ET UN RACCOURCI.
 *
 * LES CINQ DE LA FRISE DE « TABLEAUX DE BORD » — Demande, Compréhension,
 * Travail, À déployer, Archivée (`barreDeSuivi`, `shared`) : une carte se lit
 * de la même façon ouverte ou dans la liste.
 *
 * LE DESSIN EST CELUI DE LA MAQUETTE, EN NOIR ET BLANC — plus aucune couleur :
 *  - une étape FAITE : un rond plein, sa coche dedans, son nom en texte plein ;
 *  - l'étape OÙ L'ON EST : un rond cerclé avec un point au centre (une roue
 *    tant que l'agent y travaille, un point d'exclamation quand elle est
 *    tombée), son nom en texte plein ;
 *  - une étape À VENIR : un rond vide et pâle, son nom en gris.
 * Un trait relie deux étapes : plein jusqu'où l'on est arrivé, pâle au-delà.
 *
 * C'est un MOYEN DE NAVIGATION : toucher une étape fait défiler la discussion
 * jusqu'au passage correspondant. L'étape mise en avant suit le passage visible
 * pendant le défilement (`active`) ; elle se dit à voix haute (`aria-current`).
 *
 * SUR TÉLÉPHONE, ET DÈS QUE LA BARRE EST TROP ÉTROITE (`compacte`, mesurée),
 * seul le nom de l'étape mise en avant s'écrit : cinq noms ne tiennent pas sur
 * 390 px, ni dans une conversation calée à côté de l'aperçu. Les ronds, eux,
 * restent tous là. Chaque étape y prend LA PLACE DE SON CONTENU, et les traits se partagent le reste : à
 * largeurs égales, le nom écrit (« Compréhension ») débordait de sa case et
 * recouvrait le rond suivant. Il est aussi un cran plus petit, et se coupe en
 * dernier recours plutôt que de chevaucher.
 */
export function BarreDEtapes({
  segments,
  active,
  courante,
  onAller,
}: {
  segments: SegmentDeSuivi[];
  /** L'étape mise en avant : le point visible, ou l'étape courante. */
  active: EtapeDeSuivi;
  /** L'étape où se trouve la carte (`segmentActifDeSuivi`). */
  courante: EtapeDeSuivi;
  onAller: (etape: EtapeDeSuivi) => void;
}) {
  const [liste, setListe] = React.useState<HTMLOListElement | null>(null);
  const [compacte, setCompacte] = React.useState(false);
  React.useEffect(() => {
    if (!liste) return;
    const seuil = segments.length > 5 ? LARGEUR_DE_LA_BARRE_POUR_SIX_NOMS : LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS;
    const mesurer = () => setCompacte(liste.clientWidth < seuil);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(liste);
    return () => observateur.disconnect();
  }, [liste, segments.length]);

  return (
    <ol
      ref={setListe}
      className="flex items-center gap-2 sm:gap-3"
      aria-label="Étapes du parcours"
      data-barre-etapes={active}
      data-barre-compacte={compacte ? '' : undefined}
    >
      {segments.map((segment, i) => {
        const estActive = segment.etape === active;
        const ton = tonDuSegmentDeSuivi(segment, courante);
        const dernier = i === segments.length - 1;
        const faite = segment.etat === 'fait' && segment.etape !== courante;
        const ici = segment.etape === courante || segment.etat === 'encours' || segment.etat === 'question' || segment.etat === 'erreur';
        const atteinte = segment.etat !== 'avenir';
        return (
          <li
            key={segment.etape}
            className={cn(
              'flex min-w-0 items-center gap-2 sm:gap-3',
              dernier ? 'shrink-0' : compacte ? 'flex-auto' : 'flex-auto sm:flex-1',
            )}
          >
            <button
              type="button"
              data-segment={segment.etape}
              data-segment-etat={segment.etat}
              data-segment-ton={ton}
              /* UNE ÉTAPE NON ATTEINTE LE DIT, au lieu de compter sur le seul
                 gris : son infobulle l'écrit, et le repère suit. La discussion,
                 elle, ne montre plus ce qui n'est pas encore arrivé. */
              data-point-avenir={atteinte ? undefined : ''}
              aria-current={estActive ? 'step' : undefined}
              onClick={() => onAller(segment.etape)}
              title={
                atteinte
                  ? t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])
                  : `${t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])} · ${t('à venir')}`
              }
              className={cn('group flex min-w-0 items-center gap-2 py-1.5 sm:py-1', !compacte && 'sm:shrink-0')}
            >
              <RondDEtape
                forme={faite ? 'faite' : segment.etat === 'encours' ? 'travail' : segment.etat === 'erreur' ? 'erreur' : ici && atteinte ? 'ici' : 'avenir'}
              />
              <span
                className={cn(
                  'min-w-0 truncate text-[12px] leading-normal transition-colors group-hover:text-text sm:text-[13px] sm:leading-none',
                  !compacte && 'sm:overflow-visible',
                  atteinte ? 'font-medium text-text' : 'text-faint',
                  !estActive && (compacte ? 'hidden' : 'max-sm:hidden'),
                )}
              >
                {t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])}
              </span>
            </button>
            {/* Un trait qui porte une information : plein jusqu'où l'on est
                arrivé (`--text`), pâle au-delà. */}
            {dernier ? null : (
              <span aria-hidden className={cn('h-px min-w-2 flex-1', faite ? 'bg-text/60' : 'bg-border')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Une étape d'une rangée générique : sa clé, son nom, son rond, et si on peut y aller. */
export interface EtapeDeRangee {
  cle: string;
  libelle: string;
  forme: FormeDuRondDEtape;
  /** Atteinte : son nom s'écrit en plein et on peut y aller ; sinon pâle, « à venir ». */
  atteinte: boolean;
}

/**
 * LA MÊME BARRE, POUR UN AUTRE PARCOURS que celui d'une carte : les ronds de
 * `RondDEtape`, le nom écrit à côté, un trait plein jusqu'où l'on est arrivé,
 * la version compacte sous `LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS` (seul le nom
 * de l'étape affichée s'écrit). Le service qui l'emploie donne ses étapes et
 * ses repères (`donnees`), sans rien savoir de la frise des cartes.
 */
export function RangeeDEtapes({
  etapes,
  active,
  onAller,
  libelle,
  donnees,
  classeActive = 'text-text',
  ...reste
}: {
  etapes: EtapeDeRangee[];
  active: string;
  onAller: (cle: string) => void;
  /** Le nom de la rangée, lu à voix haute. */
  libelle: string;
  /** Les repères posés sur le bouton de chaque étape. */
  donnees?: (e: EtapeDeRangee) => Record<string, string | undefined>;
  /** La teinte du nom de l'étape AFFICHÉE : le service qui l'emploie la choisit (sa couleur d'élément choisi). */
  classeActive?: string;
} & Omit<React.HTMLAttributes<HTMLOListElement>, 'onChange'>) {
  const [liste, setListe] = React.useState<HTMLOListElement | null>(null);
  const [compacte, setCompacte] = React.useState(false);
  React.useEffect(() => {
    if (!liste) return;
    const seuil = etapes.length > 5 ? LARGEUR_DE_LA_BARRE_POUR_SIX_NOMS : LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS;
    const mesurer = () => setCompacte(liste.clientWidth < seuil);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(liste);
    return () => observateur.disconnect();
  }, [liste, etapes.length]);
  return (
    <ol ref={setListe} className="flex items-center gap-2 sm:gap-3" aria-label={libelle} data-barre-compacte={compacte ? '' : undefined} {...reste}>
      {etapes.map((e, i) => {
        const estActive = e.cle === active;
        const dernier = i === etapes.length - 1;
        return (
          <li key={e.cle} className={cn('flex min-w-0 items-center gap-2 sm:gap-3', dernier ? 'shrink-0' : compacte ? 'flex-auto' : 'flex-auto sm:flex-1')}>
            <button
              type="button"
              aria-current={estActive ? 'step' : undefined}
              aria-disabled={!e.atteinte || undefined}
              onClick={() => e.atteinte && onAller(e.cle)}
              title={e.atteinte ? e.libelle : `${e.libelle} · ${t('à venir')}`}
              className={cn('group flex min-w-0 items-center gap-2 py-1.5 sm:py-1', !compacte && 'sm:shrink-0', !e.atteinte && 'cursor-default')}
              {...(donnees?.(e) ?? {})}
            >
              <RondDEtape forme={e.forme} />
              <span
                className={cn(
                  'min-w-0 truncate text-[12px] leading-normal transition-colors sm:text-[13px] sm:leading-none',
                  /* Le survol n'éteint jamais la teinte de l'étape affichée (la souris y reste après le clic). */
                  e.atteinte && !estActive && 'group-hover:text-text',
                  !compacte && 'sm:overflow-visible',
                  /* L'étape AFFICHÉE porte la teinte que le service choisit ; toutes les autres se lisent en noir et blanc. */
                  estActive ? cn('font-medium', classeActive) : e.atteinte ? 'font-medium text-text' : 'text-faint',
                  !estActive && (compacte ? 'hidden' : 'max-sm:hidden'),
                )}
                data-rangee-libelle
              >
                {e.libelle}
              </span>
            </button>
            {/* Un trait qui porte une information suit `--faint`, jamais `--border`. */}
            {dernier ? null : <span aria-hidden className={cn('h-px min-w-2 flex-1', e.forme === 'faite' ? 'bg-text/60' : 'bg-faint/40')} />}
          </li>
        );
      })}
    </ol>
  );
}
