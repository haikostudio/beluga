/*
 * LA BULLE DE RÉGLAGES DE LA FRISE (demande du 01/11/2026, capture #6481 : « quand je clique sur un élément,
 * j'aimerais des options de configuration, par exemple le volume d'un son »).
 *
 * UN DOUBLE-CLIC sur un bloc de la frise (au doigt : un appui long, décision du 02/11/2026) ouvre une petite bulle COLLÉE au bloc, avec les réglages
 * courants de son genre — un son : volume, coupure du son, vitesse, fondus ; une voix : volume, vitesse, texte
 * dit ; une vidéo : volume, coupure, vitesse, fondus, cadrage ; une image : cadrage ; un dessin ou un texte : son
 * entrée et sa sortie —, plus trois gestes : couper à la tête de lecture, supprimer, et « Tout régler », qui ouvre
 * la grande fenêtre d'édition. Sur téléphone, le même contenu monte en FEUILLE DU BAS. Sur un visuel : son œil et son
 * opacité ; sur une image ou une vidéo : retirer ou remettre son fond, sans agent ; sur une vidéo, une image ou un
 * texte : « Régler l'arrivée » de son trajet (l'aperçu passe en mode arrivée), et le retirer.
 *
 * LE CORPS EST SUR `--surface`, L'EN-TÊTE ET LES CHAMPS SUR `--raised` : les champs du Studio ont ce fond partout, ils
 * tranchent ainsi sur le corps sans qu'on touche à l'inspecteur.
 *
 * Chaque réglage passe par `onOperation` (une `OperationStudio`) : une version par geste, annulable par Ctrl+Z,
 * comme tout le montage. La bulle se ferme à Échap, à un clic dehors, au changement de sélection, à la disparition
 * du bloc, et dès qu'un glisser démarre. Ses champs ne réveillent pas les raccourcis du montage (`data-bulle-reglages`, `studio.tsx`).
 */
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Eraser, Eye, EyeOff, Loader2, Route, Scissors, SlidersHorizontal, Trash2, Volume2, VolumeX, X } from '@/components/ui/icones';
import { type Composition, type OperationStudio, type Segment, RECETTES_ANIMATION, aUnTrajetPossible, trouverSegment } from '@beluga/shared';
import { Button, Drawer, EnteteDeFeuille, ZoneDefilement } from '@/components/ui';
import { useContexteDePose } from '@/components/pose-sur-piste';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { ChampChoix, ChampCurseur, ChampNombre, ChampTexte, Ligne } from './champs';
import { ChampVitesse } from './inspecteur';
import { libelleDuGenre, libelleRecette } from './libelles';
import { iconeDeRecette, nomDuSegment } from './ligne-de-temps';

/** Le volume d'avant la coupure, par bloc, le temps de la page : rallumer le son rend ce volume-là. */
const volumesAvantCoupure = new Map<string, number>();

function ReglagesRapides({
  segment: s,
  temps,
  bloque,
  pieceDuMedia,
  onOperation,
  onToutRegler,
  onRegleArrivee,
}: {
  segment: Segment;
  temps: number;
  bloque: boolean;
  /** Le fichier d'une image ou d'une vidéo : son fond se retire ou se remet. */
  pieceDuMedia: string | null;
  onOperation: (op: OperationStudio) => unknown;
  onToutRegler: () => void;
  /** « Régler l'arrivée » : l'aperçu passe en mode arrivée sur ce bloc (absent : le geste ne paraît pas). */
  onRegleArrivee?: () => void;
}) {
  const prop = (valeurs: Record<string, unknown>) => onOperation({ op: 'proprietes', segmentId: s.id, valeurs });
  const fin = s.debut + s.duree;
  const peutCouper = temps > s.debut + 0.1 && temps < fin - 0.1 && s.genre !== 'voix' && s.genre !== 'sous-titres';
  const avecSon = s.genre === 'audio' || s.genre === 'video' || s.genre === 'voix';
  const volume = avecSon ? (s as { volume: number }).volume : 0;
  const muet = avecSon && volume === 0;
  const basculerLeSon = () => {
    if (muet) return prop({ volume: volumesAvantCoupure.get(s.id) ?? 1 });
    volumesAvantCoupure.set(s.id, volume);
    return prop({ volume: 0 });
  };
  const vitesse = avecSon ? ((s as { vitesse?: number }).vitesse ?? 1) : 1;
  const fondus = s.genre === 'audio' || s.genre === 'video';
  const animations = RECETTES_ANIMATION.map((r) => ({ valeur: r, libelle: libelleRecette(r), icone: iconeDeRecette(r, 'h-3.5 w-3.5') }));
  const visuel = s.genre === 'dessin' || s.genre === 'texte' || s.genre === 'image' || s.genre === 'video';
  const pose = useContexteDePose();
  const etatDuFond = pose && pieceDuMedia ? pose.etatDuFond(pieceDuMedia) : null;
  return (
    <fieldset disabled={bloque} className="flex min-w-0 flex-col gap-2.5" data-reglages-rapides={s.genre}>
      {visuel ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Ligne libelle={t('Opacité')}>
              <ChampCurseur valeur={s.opacite ?? 1} min={0} max={1} pas={0.05} onValider={(v) => prop({ opacite: v })} />
            </Ligne>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-pressed={!!s.masque}
            aria-label={s.masque ? 'Afficher cet élément' : 'Masquer cet élément'}
            title={s.masque ? t('Afficher cet élément') : t('Masquer cet élément')}
            onClick={() => void prop({ masque: !s.masque })}
            data-bulle-oeil={s.masque ? 'masque' : 'visible'}
            className="mb-0.5 shrink-0"
          >
            {s.masque ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      ) : null}
      {avecSon ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Ligne libelle={t('Volume')}>
              <ChampCurseur valeur={volume} min={0} max={2} pas={0.05} onValider={(v) => prop({ volume: v })} />
            </Ligne>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-pressed={muet}
            aria-label={muet ? 'Remettre le son' : 'Couper le son'}
            title={muet ? t('Remettre le son') : t('Couper le son')}
            onClick={() => void basculerLeSon()}
            data-bulle-couper-le-son={muet ? 'muet' : 'son'}
            className="mb-0.5 shrink-0"
          >
            {muet ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>
      ) : null}
      {avecSon ? (
        <Ligne libelle={t('Vitesse')}>
          <ChampVitesse valeur={vitesse} onValider={(v) => prop({ vitesse: v })} />
        </Ligne>
      ) : null}
      {fondus ? (
        <div className="grid grid-cols-2 gap-2">
          <Ligne libelle={t('Fondu d’entrée')}>
            <ChampNombre valeur={(s as { fonduEntree?: number }).fonduEntree ?? 0} unite="s" onValider={(v) => prop({ fonduEntree: v })} />
          </Ligne>
          <Ligne libelle={t('Fondu de sortie')}>
            <ChampNombre valeur={(s as { fonduSortie?: number }).fonduSortie ?? 0} unite="s" onValider={(v) => prop({ fonduSortie: v })} />
          </Ligne>
        </div>
      ) : null}
      {s.genre === 'voix' ? (
        <Ligne libelle={t('Texte dit')}>
          <ChampTexte long valeur={s.texte} onValider={(v) => prop({ texte: v })} />
        </Ligne>
      ) : null}
      {s.genre === 'image' || s.genre === 'video' ? (
        <Ligne libelle={t('Cadrage')}>
          <ChampChoix
            titre={t('Cadrage')}
            valeur={s.ajustement}
            options={[
              { valeur: 'couvrir', libelle: t('Remplir le cadre') },
              { valeur: 'contenir', libelle: t('Tout montrer') },
            ]}
            onValider={(v) => prop({ ajustement: v })}
          />
        </Ligne>
      ) : null}
      {s.genre === 'dessin' || s.genre === 'texte' || s.genre === 'image' ? (
        <div className="grid grid-cols-2 gap-2">
          <Ligne libelle={t('Entrée')}>
            <ChampChoix titre={t('Entrée')} valeur={s.entree ?? 'aucune'} options={animations} onValider={(v) => prop({ entree: v })} />
          </Ligne>
          <Ligne libelle={t('Sortie')}>
            <ChampChoix titre={t('Sortie')} valeur={s.sortie ?? 'aucune'} options={animations} onValider={(v) => prop({ sortie: v })} />
          </Ligne>
        </div>
      ) : null}
      {etatDuFond && pieceDuMedia ? (
        <Button
          size="sm"
          variant="subtle"
          className="w-full gap-1.5"
          disabled={etatDuFond === 'en-cours'}
          onClick={() => pose!.gesteDuFond(etatDuFond === 'retire' ? 'remettre' : 'retirer', pieceDuMedia)}
          {...(etatDuFond === 'retire' ? { 'data-bulle-remettre-le-fond': '' } : { 'data-bulle-retirer-le-fond': '' })}
        >
          {etatDuFond === 'en-cours' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eraser className="h-3.5 w-3.5" />}
          {etatDuFond === 'en-cours' ? t('Fond en cours de retrait…') : etatDuFond === 'retire' ? t('Remettre le fond') : t('Retirer le fond')}
        </Button>
      ) : null}
      {/* LE TRAJET : « tu pars d'ici et tu arrives là ». Le départ est la position posée ; l'arrivée se tire dans l'aperçu. */}
      {onRegleArrivee && aUnTrajetPossible(s.genre) ? (
        <div className="flex items-center gap-1" data-bulle-trajet={s.trajet ? 'oui' : 'non'}>
          <Button size="sm" variant="outline" className="min-w-0 flex-1 justify-start gap-1.5" onClick={onRegleArrivee} data-bulle-regler-arrivee>
            <Route className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{s.trajet ? t('Modifier l’arrivée') : t('Régler l’arrivée')}</span>
          </Button>
          {s.trajet ? (
            <Button size="icon" variant="ghost" aria-label="Retirer le trajet" title={t('Retirer le trajet')} onClick={() => prop({ trajet: null })} data-bulle-retirer-trajet>
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-1 pt-0.5">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Couper à la tête de lecture"
          title={t('Couper à la tête de lecture')}
          disabled={!peutCouper}
          onClick={() => void onOperation({ op: 'scinder', segmentId: s.id, a: temps })}
          data-bulle-couper
        >
          <Scissors className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Supprimer"
          title={t('Supprimer')}
          onClick={() => void onOperation({ op: 'supprimer', segmentId: s.id })}
          data-bulle-supprimer
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto gap-1.5" onClick={onToutRegler} data-bulle-tout-regler>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t('Tout régler')}
        </Button>
      </div>
    </fieldset>
  );
}

export function BulleDeReglages({
  composition,
  segmentId,
  temps,
  bloque,
  telephone,
  medias,
  onOperation,
  onToutRegler,
  onRegleArrivee,
  onFermer,
}: {
  composition: Composition;
  segmentId: string;
  temps: number;
  /** L'agent travaille sur la création : les réglages sont gelés, comme les autres gestes. */
  bloque: boolean;
  telephone: boolean;
  medias: readonly { id: string; attachmentId?: string }[];
  onOperation: (op: OperationStudio) => unknown;
  onToutRegler: (segmentId: string) => void;
  onRegleArrivee?: (segmentId: string) => void;
  onFermer: () => void;
}) {
  const trouve = trouverSegment(composition, segmentId);
  /* Le bloc de la frise sert d'ancre : la bulle le suit au défilement et au zoom. */
  const ancre = React.useRef<Element | null>(null);
  ancre.current = typeof document !== 'undefined' ? document.querySelector(`[data-studio-segment="${CSS.escape(segmentId)}"]`) : null;
  /* Le bloc a disparu (supprimé, coupé, annulé) : la bulle se referme d'elle-même. */
  React.useEffect(() => {
    if (!trouve) onFermer();
  }, [trouve, onFermer]);
  if (!trouve) return null;
  const s = trouve.segment;
  const titre = `${libelleDuGenre(s.genre)} — ${nomDuSegment(s)}`;
  const pieceDuMedia = s.genre === 'image' || s.genre === 'video' ? (medias.find((m) => m.id === s.mediaId)?.attachmentId ?? null) : null;
  const contenu = (
    <ReglagesRapides
      segment={s}
      temps={temps}
      bloque={bloque}
      pieceDuMedia={pieceDuMedia}
      onOperation={onOperation}
      onToutRegler={() => onToutRegler(s.id)}
      {...(onRegleArrivee ? { onRegleArrivee: () => onRegleArrivee(s.id) } : {})}
    />
  );
  if (telephone) {
    return (
      <Drawer open onClose={onFermer} feuille empile>
        <EnteteDeFeuille titre={titre} />
        <div className="bg-surface px-4 pb-6 pt-3" data-bulle-reglages={s.id}>
          {contenu}
        </div>
      </Drawer>
    );
  }
  if (!ancre.current) return null;
  return (
    <PopoverPrimitive.Root open onOpenChange={(ouvert) => !ouvert && onFermer()}>
      <PopoverPrimitive.Anchor virtualRef={ancre as React.RefObject<Element>} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          avoidCollisions
          /* Le focus reste où il était : la barre d'espace continue de lancer la lecture. */
          onOpenAutoFocus={(e) => e.preventDefault()}
          data-bulle-reglages={s.id}
          className={cn(
            'z-[60] flex max-h-[min(70vh,var(--radix-popover-content-available-height))] w-[320px] flex-col overflow-hidden rounded-lg border border-border bg-surface text-text shadow-xl animate-fade-in',
          )}
        >
          {/* LE TITRE ENTIER, sur un fond à lui : un nom long passe à la ligne, il n'est plus coupé. */}
          <p className="shrink-0 break-words bg-raised px-3 py-2.5 text-[13px] font-semibold leading-snug" data-bulle-titre>
            {titre}
          </p>
          <ZoneDefilement fond="hsl(var(--surface))" classeEnveloppe="min-h-0 flex-1" className="p-3">
            {contenu}
          </ZoneDefilement>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
