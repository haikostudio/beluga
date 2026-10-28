import * as React from 'react';
import { Check, Download, Loader2, Pause, Play, Plus, Redo2, Trash2, Undo2, Volume2, VolumeX } from 'lucide-react';
import {
  ExtraitSonore,
  LIBELLES_PISTES_DU_STUDIO_SON,
  PISTES_DU_STUDIO_SON,
  dureeDuMontageSon,
  estRetenu,
  extraitsEntendus,
  type MontageSon,
  type PisteDuStudioSon,
} from '@beluga/shared';
import { Button, Switch, ZoneDefilement } from '@/components/ui';
import { Curseur } from '@/components/ui/elements-maison';
import { FormeDOnde, useOnde } from '@/components/studio/onde';
import { LecteurSon } from '@/components/lecteur-son';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { CroixDuVolet } from '@/components/feuille-du-volet';
import { client } from '@/lib/client';
import { fermerLeDocument } from '@/lib/document-de-carte';
import { useProduction } from '@/lib/production-de-carte';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE STUDIO SON D'UNE CRÉATION DE MÉDIA (décision de l'utilisateur du
 * 26/10/2026 : « un studio de montage son minimaliste mais fonctionnel ») —
 * l'étape « Montage » d'une voix, d'une musique ou de bruitages, GRATUITE.
 *
 * Trois pistes (voix, musique, bruitages), garnies d'office des sons VALIDÉS.
 * Chaque extrait se DÉPLACE sur la ligne de temps, se COUPE par ses deux bords,
 * se DOSE et s'adoucit (fondu d'entrée et de sortie) ; chaque piste a son
 * volume et se coupe. « Écouter » mixe dans le navigateur avec les mêmes
 * réglages ; l'EXPORT, lui, part sur le serveur en une commande ffmpeg
 * (`mixageFfmpeg`, `shared/src/studios-du-media.ts`), en MP3 ou en WAV, et
 * devient le média final de la carte. Chaque geste s'enregistre (on rouvre le
 * studio tel qu'on l'a laissé) et se défait (« Annuler », « Rétablir »).
 */
export default function StudioSon({ cardId }: { cardId: string }) {
  const production = useProduction(cardId);
  const [historique, setHistorique] = React.useState<{ pile: MontageSon[]; rang: number } | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ montage: MontageSon }>({ type: 'realisation.son.lire', cardId })
      .then((r) => vivant && setHistorique({ pile: [r.montage], rang: 0 }))
      .catch((err: any) => vivant && setErreur(err?.message ?? t('Le montage son n’a pas pu être lu')));
    return () => {
      vivant = false;
    };
  }, [cardId]);

  /* CHAQUE GESTE S'ENREGISTRE, un instant après le dernier. */
  const montage = historique ? historique.pile[historique.rang]! : null;
  React.useEffect(() => {
    if (!montage || !historique || historique.pile.length < 2) return;
    const minuterie = setTimeout(() => {
      void client.call({ type: 'realisation.son.enregistrer', cardId, montage }).catch(() => {});
    }, 600);
    return () => clearTimeout(minuterie);
  }, [montage]);

  if (erreur) return <p className="px-4 py-3 text-[13px] text-danger" data-studio-son={cardId}>{erreur}</p>;
  if (!montage || !historique) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-faint" data-studio-son={cardId}>
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('Chargement…')}
      </div>
    );
  }
  const changer = (suivant: MontageSon) => setHistorique((h) => (h ? { pile: [...h.pile.slice(0, h.rang + 1), suivant].slice(-80), rang: Math.min(h.rang + 1, 79) } : h));
  const valides = (production?.medias ?? []).filter((m) => estRetenu(m) && m.genre === 'son' && !!m.attachmentId);
  const absents = valides.filter((m) => !montage.extraits.some((x) => x.piece === m.attachmentId));
  return (
    <EditeurDeSon
      cardId={cardId}
      montage={montage}
      onChanger={changer}
      peutAnnuler={historique.rang > 0}
      peutRetablir={historique.rang < historique.pile.length - 1}
      onAnnuler={() => setHistorique((h) => (h ? { ...h, rang: Math.max(0, h.rang - 1) } : h))}
      onRetablir={() => setHistorique((h) => (h ? { ...h, rang: Math.min(h.pile.length - 1, h.rang + 1) } : h))}
      absents={absents.map((m) => ({ mediaId: m.id, piece: m.attachmentId!, nom: `${m.plan} v${m.version}`, capacite: m.capacite }))}
    />
  );
}

/* ------------------------------------------------------------------ */
/* L'écoute : un mixage dans le navigateur, avec les mêmes réglages    */
/* ------------------------------------------------------------------ */

const TAMPONS = new Map<string, Promise<AudioBuffer>>();
function tampon(contexte: AudioContext, piece: string): Promise<AudioBuffer> {
  const deja = TAMPONS.get(piece);
  if (deja) return deja;
  const travail = fetch(adresseDePiece(piece))
    .then((r) => r.arrayBuffer())
    .then((octets) => contexte.decodeAudioData(octets));
  TAMPONS.set(piece, travail);
  travail.catch(() => TAMPONS.delete(piece));
  return travail;
}

function useEcoute(montage: MontageSon) {
  const contexte = React.useRef<AudioContext | null>(null);
  const sources = React.useRef<AudioBufferSourceNode[]>([]);
  const [lecture, setLecture] = React.useState<{ depart: number; position: number } | null>(null);
  const [position, setPosition] = React.useState(0);
  const duree = dureeDuMontageSon(montage);
  const arreter = React.useCallback(() => {
    for (const s of sources.current) {
      try {
        s.stop();
      } catch {
        /* déjà arrêtée */
      }
    }
    sources.current = [];
    setLecture(null);
  }, []);
  React.useEffect(() => arreter, [arreter]);
  React.useEffect(() => {
    if (!lecture) return;
    let image = 0;
    const suivre = () => {
      const ici = lecture.position + (contexte.current!.currentTime - lecture.depart);
      setPosition(ici);
      if (ici >= duree) {
        arreter();
        setPosition(0);
        return;
      }
      image = requestAnimationFrame(suivre);
    };
    image = requestAnimationFrame(suivre);
    return () => cancelAnimationFrame(image);
  }, [lecture, duree, arreter]);
  /* LE CONTEXTE AUDIO S'OUVRE DANS LE GESTE (Safari sur iPhone ne joue rien sinon). */
  const jouer = async () => {
    if (lecture) return arreter();
    const ctx = contexte.current ?? new AudioContext();
    contexte.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const depart = ctx.currentTime + 0.05;
    const debutLecture = position >= duree ? 0 : position;
    for (const x of extraitsEntendus(montage)) {
      const fin = x.debut + x.duree;
      if (fin <= debutLecture) continue;
      const buffer = await tampon(ctx, x.piece).catch(() => null);
      if (!buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const quand = depart + Math.max(0, x.debut - debutLecture);
      const dejaJoue = Math.max(0, debutLecture - x.debut);
      const reste = x.duree - dejaJoue;
      gain.gain.setValueAtTime(x.fonduEntree > 0 && dejaJoue === 0 ? 0 : x.gain, quand);
      if (x.fonduEntree > 0 && dejaJoue === 0) gain.gain.linearRampToValueAtTime(x.gain, quand + Math.min(x.fonduEntree, x.duree / 2));
      if (x.fonduSortie > 0) {
        const debutFondu = quand + Math.max(0, reste - Math.min(x.fonduSortie, x.duree / 2));
        gain.gain.setValueAtTime(x.gain, debutFondu);
        gain.gain.linearRampToValueAtTime(0, quand + reste);
      }
      source.connect(gain).connect(ctx.destination);
      source.start(quand, x.entree + dejaJoue, reste);
      sources.current.push(source);
    }
    setLecture({ depart, position: debutLecture });
  };
  return { jouer, enLecture: !!lecture, position, setPosition, duree };
}

/* ------------------------------------------------------------------ */
/* L'éditeur                                                            */
/* ------------------------------------------------------------------ */

function EditeurDeSon({
  cardId,
  montage,
  onChanger,
  peutAnnuler,
  peutRetablir,
  onAnnuler,
  onRetablir,
  absents,
}: {
  cardId: string;
  montage: MontageSon;
  onChanger: (m: MontageSon) => void;
  peutAnnuler: boolean;
  peutRetablir: boolean;
  onAnnuler: () => void;
  onRetablir: () => void;
  absents: { mediaId: string; piece: string; nom: string; capacite: string }[];
}) {
  const [choisi, setChoisi] = React.useState<string | null>(montage.extraits[0]?.id ?? null);
  /* PENDANT UN GESTE, l'extrait suit le doigt sans écrire l'historique. */
  const [enCours, setEnCours] = React.useState<MontageSon | null>(null);
  const affiche = enCours ?? montage;
  const ecoute = useEcoute(affiche);
  const [largeur, setLargeur] = React.useState(600);
  const rail = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!rail.current) return;
    const observateur = new ResizeObserver(([e]) => setLargeur(Math.max(240, e!.contentRect.width)));
    observateur.observe(rail.current);
    return () => observateur.disconnect();
  }, []);
  const etendue = Math.max(10, Math.ceil(dureeDuMontageSon(affiche) + 3));
  const pps = largeur / etendue;
  const extrait = affiche.extraits.find((x) => x.id === choisi) ?? null;
  const modifier = (id: string, champs: Partial<ExtraitSonore>, valider = true) => {
    const suivant = { ...montage, extraits: montage.extraits.map((x) => (x.id === id ? { ...x, ...champs } : x)) };
    if (valider) {
      setEnCours(null);
      onChanger(suivant);
    } else setEnCours(suivant);
  };

  const [export_, setExport] = React.useState<{ format: 'mp3' | 'wav'; piece?: string; erreur?: string } | null>(null);
  const exporter = async (format: 'mp3' | 'wav') => {
    if (export_ && !export_.piece && !export_.erreur) return;
    setExport({ format });
    try {
      const r = await client.call<{ attachmentId: string }>({ type: 'realisation.son.exporter', cardId, montage, format });
      setExport({ format, piece: r.attachmentId });
    } catch (err: any) {
      setExport({ format, erreur: err?.message ?? t('L’export n’a pas pu être rendu') });
    }
  };
  const ajouter = (son: (typeof absents)[number]) => {
    const piste: PisteDuStudioSon = son.capacite === 'voix' ? 'voix' : son.capacite === 'musique' ? 'musique' : 'bruitages';
    const fin = Math.max(0, ...montage.extraits.filter((x) => x.piste === piste).map((x) => x.debut + x.duree));
    const id = `x${Date.now().toString(36)}`;
    onChanger({ ...montage, extraits: [...montage.extraits, ExtraitSonore.parse({ id, piste, piece: son.piece, mediaId: son.mediaId, nom: son.nom, debut: fin, duree: 10 })] });
    setChoisi(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-studio-son={cardId}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pb-2 pt-3">
        <span className="mr-auto min-w-0 truncate text-[14.5px] font-medium text-text">{t('Studio son')}</span>
        <Button type="button" size="sm" variant="ghost" title={t('Annuler')} disabled={!peutAnnuler} onClick={onAnnuler} data-annuler-son="">
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="ghost" title={t('Rétablir')} disabled={!peutRetablir} onClick={onRetablir} data-retablir-son="">
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" className="gap-1.5" onClick={() => void ecoute.jouer()} disabled={!extraitsEntendus(affiche).length} data-ecouter-son={ecoute.enLecture ? 'lecture' : 'arret'}>
          {ecoute.enLecture ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {ecoute.enLecture ? t('Pause') : t('Écouter')}
        </Button>
        <span className="text-[12px] tabular-nums text-faint">
          {ecoute.position.toFixed(1)} / {ecoute.duree.toFixed(1)} s
        </span>
        <CroixDuVolet genre="studio-son" onFermer={fermerLeDocument} className="-my-1 -mr-2" />
      </div>

      <ZoneDefilement className="min-h-0 flex-1 px-4 pb-3">
        <div className="flex flex-col gap-3">
          {/* LA LIGNE DE TEMPS : une rangée par piste, les extraits posés à leur instant. */}
          <div className="flex flex-col gap-1.5" data-ligne-de-temps-son="">
            {PISTES_DU_STUDIO_SON.map((piste) => {
              const muette = affiche.muettes.includes(piste);
              const volume = affiche.volumes[piste] ?? 1;
              return (
                <div key={piste} className="flex flex-col gap-1" data-piste-son={piste} data-piste-muette={muette ? '' : undefined}>
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="w-20 shrink-0 text-muted">{t(LIBELLES_PISTES_DU_STUDIO_SON[piste])}</span>
                    <button
                      type="button"
                      aria-pressed={muette}
                      title={muette ? t('Rétablir le son de la piste') : t('Couper la piste')}
                      onClick={() => onChanger({ ...montage, muettes: muette ? montage.muettes.filter((p) => p !== piste) : [...montage.muettes, piste] })}
                      data-couper-piste={piste}
                      className={cn('flex h-6 w-6 items-center justify-center rounded', muette ? 'bg-teinte-plein text-sur-couleur' : 'text-muted hover:bg-raised')}
                    >
                      {muette ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    <Curseur
                      valeur={Math.round(volume * 100)}
                      min={0}
                      max={200}
                      onChange={(v) => setEnCours({ ...montage, volumes: { ...montage.volumes, [piste]: v / 100 } })}
                      onValider={(v) => {
                        setEnCours(null);
                        onChanger({ ...montage, volumes: { ...montage.volumes, [piste]: v / 100 } });
                      }}
                      aria-label="Volume de la piste"
                      className="max-w-[140px] flex-1"
                      data-volume-piste={piste}
                    />
                    <span className="w-10 shrink-0 text-right tabular-nums text-faint">{Math.round(volume * 100)} %</span>
                  </div>
                  <div ref={piste === 'voix' ? rail : undefined} className={cn('relative h-14 overflow-hidden rounded-md bg-raised/60', muette && 'opacity-50')}>
                    {affiche.extraits
                      .filter((x) => x.piste === piste)
                      .map((x) => (
                        <BlocDExtrait
                          key={x.id}
                          extrait={x}
                          pps={pps}
                          choisi={x.id === choisi}
                          onChoisir={() => setChoisi(x.id)}
                          onBouger={(champs) => modifier(x.id, champs, false)}
                          onFinir={(champs) => modifier(x.id, champs, true)}
                        />
                      ))}
                    {/* LA TÊTE DE LECTURE */}
                    <span className="pointer-events-none absolute inset-y-0 w-px bg-teinte" style={{ left: ecoute.position * pps }} aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>

          {absents.length ? (
            <div className="flex flex-col gap-1">
              <p className="text-[12px] uppercase tracking-wide text-faint">{t('Sons validés à ajouter')}</p>
              <div className="flex flex-wrap gap-1.5">
                {absents.map((son) => (
                  <Button key={son.piece} type="button" size="sm" variant="ghost" className="gap-1" onClick={() => ajouter(son)} data-ajouter-son={son.mediaId}>
                    <Plus className="h-3.5 w-3.5" />
                    {son.nom}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {/* L'EXTRAIT CHOISI : volume, fondus, retrait. */}
          {extrait ? (
            <div className="flex flex-col gap-2 rounded-lg bg-raised/50 p-3" data-extrait-choisi={extrait.id}>
              <p className="flex items-center gap-2 text-[13px] text-text">
                <span className="min-w-0 flex-1 truncate">{extrait.nom || t('Extrait')}</span>
                <span className="shrink-0 tabular-nums text-faint">{`${extrait.debut.toFixed(1)} s · ${extrait.duree.toFixed(1)} s`}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  title={t('Retirer de la piste')}
                  onClick={() => {
                    onChanger({ ...montage, extraits: montage.extraits.filter((x) => x.id !== extrait.id) });
                    setChoisi(null);
                  }}
                  data-retirer-extrait=""
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </p>
              <ReglageDExtrait libelle={t('Volume')} valeur={Math.round(extrait.volume * 100)} min={0} max={200} unite=" %" onChange={(v) => modifier(extrait.id, { volume: v / 100 }, false)} onValider={(v) => modifier(extrait.id, { volume: v / 100 })} nom="volume" />
              <ReglageDExtrait libelle={t('Fondu d’entrée')} valeur={Math.round(extrait.fonduEntree * 10) / 10} min={0} max={5} pas={0.1} unite=" s" onChange={(v) => modifier(extrait.id, { fonduEntree: v }, false)} onValider={(v) => modifier(extrait.id, { fonduEntree: v })} nom="fondu-entree" />
              <ReglageDExtrait libelle={t('Fondu de sortie')} valeur={Math.round(extrait.fonduSortie * 10) / 10} min={0} max={5} pas={0.1} unite=" s" onChange={(v) => modifier(extrait.id, { fonduSortie: v }, false)} onValider={(v) => modifier(extrait.id, { fonduSortie: v })} nom="fondu-sortie" />
            </div>
          ) : null}

          <label className="flex items-center justify-between gap-3 text-[13px] text-text">
            {t('Égaliser le niveau final')}
            <Switch checked={montage.normaliser} onCheckedChange={(v: boolean) => onChanger({ ...montage, normaliser: v })} data-normaliser-son="" />
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['mp3', 'wav'] as const).map((format) => (
              <Button
                key={format}
                type="button"
                className="gap-1.5 bg-accent text-accent-fg hover:opacity-90"
                disabled={!extraitsEntendus(montage).length || (!!export_ && !export_.piece && !export_.erreur)}
                aria-busy={export_?.format === format && !export_.piece && !export_.erreur}
                onClick={() => void exporter(format)}
                data-exporter-son={format}
              >
                {export_?.format === format && !export_.piece && !export_.erreur ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {t('Exporter en {format}', { format: format.toUpperCase() })}
              </Button>
            ))}
          </div>
          {export_?.piece ? (
            <div className="flex flex-col gap-1.5" data-export-son={export_.piece}>
              <p className="flex items-center gap-2 text-[12.5px] text-text">
                <Check className="h-3.5 w-3.5 text-teinte" />
                {t('Mixage exporté : il sera le média final de cette carte.')}
              </p>
              <LecteurSon id={export_.piece} nom={t('Mixage')} compact />
            </div>
          ) : null}
          {export_?.erreur ? <p className="text-[12.5px] text-danger">{export_.erreur}</p> : null}
        </div>
      </ZoneDefilement>
    </div>
  );
}

/** Un extrait sur sa piste : se déplace, se coupe par ses bords ; l'onde réelle dessinée dedans. */
function BlocDExtrait({
  extrait,
  pps,
  choisi,
  onChoisir,
  onBouger,
  onFinir,
}: {
  extrait: ExtraitSonore;
  pps: number;
  choisi: boolean;
  onChoisir: () => void;
  onBouger: (champs: Partial<ExtraitSonore>) => void;
  onFinir: (champs: Partial<ExtraitSonore>) => void;
}) {
  const { onde } = useOnde(adresseDePiece(extrait.piece));
  const dureeSource = onde?.duree ?? extrait.entree + extrait.duree;
  const geste = React.useRef<{ genre: 'deplacer' | 'gauche' | 'droite'; x: number; depart: ExtraitSonore; dernier: Partial<ExtraitSonore> } | null>(null);
  const commencer = (genre: 'deplacer' | 'gauche' | 'droite') => (event: React.PointerEvent) => {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    onChoisir();
    geste.current = { genre, x: event.clientX, depart: extrait, dernier: {} };
  };
  const bouger = (event: React.PointerEvent) => {
    const g = geste.current;
    if (!g) return;
    const d = (event.clientX - g.x) / pps;
    const x = g.depart;
    let champs: Partial<ExtraitSonore>;
    if (g.genre === 'deplacer') champs = { debut: Math.max(0, Math.round((x.debut + d) * 20) / 20) };
    else if (g.genre === 'gauche') {
      /* Le bord gauche recule jusqu'au début du fichier ou de la ligne de temps, et avance jusqu'à 0,2 s du bord droit. */
      const borne = Math.max(-x.entree, -x.debut, Math.min(d, x.duree - 0.2));
      champs = { entree: Math.round((x.entree + borne) * 20) / 20, debut: Math.round((x.debut + borne) * 20) / 20, duree: Math.round((x.duree - borne) * 20) / 20 };
    } else champs = { duree: Math.round(Math.max(0.2, Math.min(dureeSource - x.entree, x.duree + d)) * 20) / 20 };
    g.dernier = champs;
    onBouger(champs);
  };
  const finir = (event: React.PointerEvent) => {
    const g = geste.current;
    if (!g) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    geste.current = null;
    if (Object.keys(g.dernier).length) onFinir(g.dernier);
  };
  const largeur = Math.max(8, extrait.duree * pps);
  return (
    <div
      className={cn('absolute inset-y-1 flex touch-none cursor-grab items-stretch overflow-hidden rounded bg-surface active:cursor-grabbing', choisi && 'ring-2 ring-teinte')}
      style={{ left: extrait.debut * pps, width: largeur }}
      onPointerDown={commencer('deplacer')}
      onPointerMove={bouger}
      onPointerUp={finir}
      onPointerCancel={finir}
      data-extrait-son={extrait.id}
      data-extrait-debut={extrait.debut}
      data-extrait-duree={extrait.duree}
    >
      <span className="w-1.5 shrink-0 cursor-ew-resize bg-faint/40 hover:bg-teinte" onPointerDown={commencer('gauche')} onPointerMove={bouger} onPointerUp={finir} data-bord-extrait="gauche" />
      <div className="relative min-w-0 flex-1 text-muted">
        {onde ? <FormeDOnde onde={onde} de={extrait.entree} a={extrait.entree + extrait.duree} colonnes={Math.max(4, Math.round(largeur / 3))} className="absolute inset-0 h-full w-full" /> : null}
        <span className="relative block truncate px-1 text-[10.5px] leading-4 text-text">{extrait.nom}</span>
      </div>
      <span className="w-1.5 shrink-0 cursor-ew-resize bg-faint/40 hover:bg-teinte" onPointerDown={commencer('droite')} onPointerMove={bouger} onPointerUp={finir} data-bord-extrait="droite" />
    </div>
  );
}

function ReglageDExtrait({
  libelle,
  valeur,
  min,
  max,
  pas = 1,
  unite,
  onChange,
  onValider,
  nom,
}: {
  libelle: string;
  valeur: number;
  min: number;
  max: number;
  pas?: number;
  unite: string;
  onChange: (v: number) => void;
  onValider: (v: number) => void;
  nom: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-reglage-extrait={nom}>
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-muted">{libelle}</span>
        <span className="tabular-nums text-text">
          {valeur}
          {unite}
        </span>
      </div>
      <Curseur valeur={valeur} min={min} max={max} pas={pas} onChange={onChange} onValider={onValider} aria-label={libelle} />
    </div>
  );
}
