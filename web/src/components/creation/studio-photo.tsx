import * as React from 'react';
import { Check, Eye, Loader2, Redo2, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import {
  CURSEURS_DE_LA_PHOTO,
  FORMATS_DE_RECADRAGE,
  LIBELLES_CURSEURS_DE_LA_PHOTO,
  cadreDuFormat,
  dimensionsTournees,
  estRetenu,
  facteurDeRedressement,
  forceDuVignettage,
  matriceDeCouleur,
  noyauDeNettete,
  photoInchangee,
  rapportDuFormat,
  realisationDeLaCarte,
  reglagesPhotoLus,
  reglagesPhotoNeutres,
  tableDeTon,
  type CurseurDeLaPhoto,
  type FormatDeRecadrage,
  type MediaDuSuivi,
  type ReglagesPhoto,
} from '@beluga/shared';
import { Button, ZoneDefilement } from '@/components/ui';
import { Curseur } from '@/components/ui/elements-maison';
import { adresseDePiece, ImageDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { useProduction } from '@/lib/production-de-carte';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE STUDIO PHOTO D'UNE CRÉATION DE MÉDIA (décision de l'utilisateur du
 * 26/10/2026 : « un studio qui permette de retravailler le cadrage, les
 * couleurs, les contrastes ») — l'étape « Montage » d'une image, GRATUITE.
 *
 * Chaque image VALIDÉE de la carte se retouche : recadrage (libre ou aux
 * formats des réseaux), quart de tour, redressement, exposition, contraste,
 * hautes lumières, ombres, température, teinte, saturation, vivacité, netteté
 * et vignettage, avec un avant/après, « Annuler » et « Rétablir ».
 *
 * L'APERÇU CONCORDE AVEC LE RENDU : la même matrice de couleur, la même courbe
 * de ton et le même noyau de netteté (`shared/src/studios-du-media.ts`) servent
 * le filtre SVG d'ici ET la chaîne ffmpeg du serveur — calculés en sRGB des
 * deux côtés. « Enregistrer la retouche » rend l'image sur le serveur
 * (`realisation.photo.rendre`) : elle devient le média final de cette image.
 */
export default function StudioPhoto({ cardId, source }: { cardId: string; source?: string }) {
  const carte = useApp().cards[cardId];
  const production = useProduction(cardId);
  const images = React.useMemo(
    () => (production?.medias ?? []).filter((m) => estRetenu(m) && m.genre === 'image' && !!m.attachmentId).sort((a, b) => a.creeLe - b.creeLe),
    [production?.medias],
  );
  const [choisie, setChoisie] = React.useState<string | null>(source ?? null);
  const image = images.find((m) => m.id === choisie) ?? images[0] ?? null;
  const finaux = realisationDeLaCarte(carte).finaux ?? [];

  if (!production) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-faint" data-studio-photo={cardId}>
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('Chargement…')}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col" data-studio-photo={cardId}>
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">{t('Studio photo')}</span>
        <span className="shrink-0 text-[12px] text-faint">{t('Gratuit')}</span>
      </div>
      {images.length ? (
        <>
          <ZoneDefilement axe="horizontal" className="shrink-0 px-4 pb-2">
            <div className="flex gap-1.5">
              {images.map((m) => {
                const retouchee = finaux.some((f) => f.studio === 'photo' && f.source === m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={m.id === image?.id}
                    onClick={() => setChoisie(m.id)}
                    title={m.plan}
                    data-vignette-photo={m.id}
                    className={cn('relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-raised', m.id === image?.id && 'ring-2 ring-teinte')}
                  >
                    <ImageDePiece id={m.attachmentId!} alt={m.plan} className="h-full w-full object-cover" />
                    {retouchee ? (
                      <span className="absolute bottom-0.5 left-0.5 rounded-sm bg-surface/85 px-1 text-[10px] leading-4 text-muted">{t('Retouchée')}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </ZoneDefilement>
          {image ? <EditeurDePhoto key={image.id} cardId={cardId} image={image} enregistres={realisationDeLaCarte(carte).retouchesPhoto?.[image.id]} /> : null}
        </>
      ) : (
        <p className="px-4 py-3 text-[13px] text-faint" data-studio-photo-vide="">
          {t('Aucune image validée : validez une esquisse pour la retoucher ici.')}
        </p>
      )}
    </div>
  );
}

/** Le filtre SVG de l'aperçu, construit avec les mêmes règles que le rendu du serveur. */
function FiltreDeLaPhoto({ id, reglages }: { id: string; reglages: ReglagesPhoto }) {
  const m = matriceDeCouleur(reglages);
  const matrice = [...m[0]!, 0, 0, ...m[1]!, 0, 0, ...m[2]!, 0, 0, 0, 0, 0, 1, 0].join(' ');
  const table = tableDeTon(reglages).join(' ');
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id={id} colorInterpolationFilters="sRGB" data-filtre-photo="">
        <feColorMatrix type="matrix" values={matrice} />
        <feComponentTransfer>
          <feFuncR type="table" tableValues={table} />
          <feFuncG type="table" tableValues={table} />
          <feFuncB type="table" tableValues={table} />
        </feComponentTransfer>
        {reglages.nettete ? <feConvolveMatrix order="3" kernelMatrix={noyauDeNettete(reglages.nettete).join(' ')} preserveAlpha="true" /> : null}
      </filter>
    </svg>
  );
}

/** Un coin ou un bord du cadre de recadrage. */
type Poignee = 'deplacer' | 'no' | 'ne' | 'so' | 'se';

function EditeurDePhoto({ cardId, image, enregistres }: { cardId: string; image: MediaDuSuivi; enregistres?: unknown }) {
  const depart = React.useMemo(() => (enregistres ? reglagesPhotoLus(enregistres) : reglagesPhotoNeutres()), [image.id]);
  const [historique, setHistorique] = React.useState<{ pile: ReglagesPhoto[]; rang: number }>({ pile: [depart], rang: 0 });
  const valides = historique.pile[historique.rang]!;
  /* PENDANT UN GESTE (curseur tenu, cadre tiré), l'aperçu suit sans écrire l'historique. */
  const [enCours, setEnCours] = React.useState<ReglagesPhoto | null>(null);
  const reglages = enCours ?? valides;
  const [avant, setAvant] = React.useState(false);
  const [dimensions, setDimensions] = React.useState<{ largeur: number; hauteur: number } | null>(null);
  const [envoi, setEnvoi] = React.useState(false);
  const [resultat, setResultat] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const idDuFiltre = `filtre-photo-${image.id}`;

  const valider = (suivants: ReglagesPhoto) => {
    setEnCours(null);
    setResultat(null);
    setHistorique((h) => ({ pile: [...h.pile.slice(0, h.rang + 1), suivants].slice(-60), rang: Math.min(h.rang + 1, 59) }));
  };
  const peutAnnuler = historique.rang > 0;
  const peutRetablir = historique.rang < historique.pile.length - 1;

  const tournee = dimensions ? dimensionsTournees(dimensions.largeur, dimensions.hauteur, reglages.quartDeTour) : null;
  const k = tournee ? facteurDeRedressement(tournee.largeur, tournee.hauteur, reglages.redressement) : 1;
  const rapport = tournee ? tournee.largeur / tournee.hauteur : 16 / 9;
  const cadre = reglages.recadrage ?? { x: 0, y: 0, largeur: 1, hauteur: 1 };

  /* LE CADRE SE TIRE AU POINTEUR CAPTURÉ, comme le curseur : un geste, une entrée d'historique. */
  const zone = React.useRef<HTMLDivElement>(null);
  const geste = React.useRef<{ poignee: Poignee; x: number; y: number; cadre: typeof cadre } | null>(null);
  const commencer = (poignee: Poignee) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    geste.current = { poignee, x: event.clientX, y: event.clientY, cadre };
  };
  const bouger = (event: React.PointerEvent) => {
    const g = geste.current;
    const boite = zone.current?.getBoundingClientRect();
    if (!g || !boite) return;
    const dx = (event.clientX - g.x) / boite.width;
    const dy = (event.clientY - g.y) / boite.height;
    const c = { ...g.cadre };
    const fixe = rapportDuFormat(reglages.format);
    const min = 0.05;
    if (g.poignee === 'deplacer') {
      c.x = Math.min(1 - c.largeur, Math.max(0, c.x + dx));
      c.y = Math.min(1 - c.hauteur, Math.max(0, c.y + dy));
    } else {
      const gauche = g.poignee === 'no' || g.poignee === 'so';
      const haut = g.poignee === 'no' || g.poignee === 'ne';
      let largeur = Math.max(min, gauche ? c.largeur - dx : c.largeur + dx);
      let hauteur = Math.max(min, haut ? c.hauteur - dy : c.hauteur + dy);
      /* UN FORMAT FIXE GARDE SA PROPORTION (en pixels de l'image redressée). */
      if (fixe) hauteur = (largeur * rapport) / fixe;
      if (gauche) largeur = Math.min(largeur, c.x + c.largeur);
      else largeur = Math.min(largeur, 1 - c.x);
      if (haut) hauteur = Math.min(hauteur, c.y + c.hauteur);
      else hauteur = Math.min(hauteur, 1 - c.y);
      if (fixe) {
        const l2 = (hauteur * fixe) / rapport;
        if (l2 < largeur) largeur = l2;
        else hauteur = (largeur * rapport) / fixe;
      }
      c.x = gauche ? c.x + c.largeur - largeur : c.x;
      c.y = haut ? c.y + c.hauteur - hauteur : c.y;
      c.largeur = largeur;
      c.hauteur = hauteur;
    }
    setEnCours({ ...valides, recadrage: c });
  };
  const finir = (event: React.PointerEvent) => {
    if (!geste.current) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    geste.current = null;
    if (enCours) valider(reglagesPhotoLus(enCours));
  };

  const choisirLeFormat = (format: FormatDeRecadrage) => {
    const cadreFixe = tournee ? cadreDuFormat(format, tournee.largeur, tournee.hauteur) : undefined;
    const suivants: ReglagesPhoto = { ...valides, format };
    if (cadreFixe) suivants.recadrage = cadreFixe;
    else delete suivants.recadrage;
    valider(reglagesPhotoLus(suivants));
  };
  const tourner = (sens: 1 | -1) => {
    const suivants: ReglagesPhoto = { ...valides, quartDeTour: (((valides.quartDeTour + sens) % 4) + 4) % 4 };
    delete suivants.recadrage;
    suivants.format = 'libre';
    valider(suivants);
  };

  const enregistrer = async () => {
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await client.call<{ attachmentId: string }>({ type: 'realisation.photo.rendre', cardId, source: image.id, reglages: valides });
      setResultat(r.attachmentId);
    } catch (err: any) {
      setErreur(err?.message ?? t('La retouche n’a pas pu être rendue'));
    } finally {
      setEnvoi(false);
    }
  };

  /* L'image tournée (quart de tour), redressée sans coins vides, dans un cadre de la proportion de l'image tournée. */
  const rotation = reglages.quartDeTour * 90 + reglages.redressement;
  const echelle = 1 / k;
  const portrait = reglages.quartDeTour % 2 === 1 && tournee && dimensions;
  const styleImage: React.CSSProperties = {
    transform: `rotate(${rotation}deg) scale(${echelle})`,
    filter: avant ? undefined : `url(#${idDuFiltre})`,
    ...(portrait ? { width: `${(dimensions!.largeur / tournee!.largeur) * 100}%`, height: `${(dimensions!.hauteur / tournee!.hauteur) * 100}%` } : { width: '100%', height: '100%' }),
  };
  const vignette = forceDuVignettage(reglages.vignettage);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-4">
        <FiltreDeLaPhoto id={idDuFiltre} reglages={reglages} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center rounded-lg bg-raised/50 p-3">
          <div
            ref={zone}
            className="relative max-h-full max-w-full overflow-hidden"
            style={{ aspectRatio: String(rapport), width: rapport >= 1 ? '100%' : undefined, height: rapport < 1 ? '100%' : undefined }}
            onPointerMove={bouger}
            onPointerUp={finir}
            onPointerCancel={finir}
            data-apercu-photo={image.id}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src={adresseDePiece(image.attachmentId!, false, 1600)}
                alt={image.plan}
                draggable={false}
                onLoad={(event) => setDimensions({ largeur: event.currentTarget.naturalWidth, hauteur: event.currentTarget.naturalHeight })}
                className="max-w-none select-none object-cover"
                style={styleImage}
              />
            </div>
            {!avant && vignette ? (
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${(0.6 * vignette).toFixed(3)}) 100%)` }}
                aria-hidden
              />
            ) : null}
            {/* LE CADRE DE RECADRAGE : l'extérieur assombri, quatre coins à tirer, le cadre se déplace. */}
            {!avant ? (
              <div
                className="absolute cursor-move touch-none"
                style={{ left: `${cadre.x * 100}%`, top: `${cadre.y * 100}%`, width: `${cadre.largeur * 100}%`, height: `${cadre.hauteur * 100}%`, boxShadow: reglages.recadrage ? '0 0 0 9999px rgba(0,0,0,0.45)' : undefined }}
                onPointerDown={commencer('deplacer')}
                data-cadre-recadrage={reglages.recadrage ? 'pose' : 'entier'}
              >
                <div className="pointer-events-none absolute inset-0 ring-1 ring-white/80" />
                {(['no', 'ne', 'so', 'se'] as const).map((coin) => (
                  <span
                    key={coin}
                    onPointerDown={commencer(coin)}
                    data-coin-recadrage={coin}
                    className={cn(
                      'absolute h-4 w-4 touch-none rounded-sm bg-white shadow',
                      coin === 'no' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                      coin === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                      coin === 'so' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                      coin === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-formats-photo="">
          {FORMATS_DE_RECADRAGE.map((format) => (
            <button
              key={format}
              type="button"
              aria-pressed={reglages.format === format}
              onClick={() => choisirLeFormat(format)}
              data-format-photo={format}
              className={cn('h-8 rounded-md px-2.5 text-[12.5px] transition-colors', reglages.format === format ? 'bg-teinte-plein text-white' : 'bg-raised text-text hover:bg-raised/70')}
            >
              {format === 'libre' ? t('Libre') : format}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-faint/40" aria-hidden />
          <Button type="button" size="sm" variant="ghost" title={t('Tourner à gauche')} onClick={() => tourner(-1)} data-tourner-photo="gauche">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="ghost" title={t('Tourner à droite')} onClick={() => tourner(1)} data-tourner-photo="droite">
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        {resultat ? (
          <p className="flex items-center gap-2 text-[12.5px] text-text" data-retouche-enregistree={resultat}>
            <Check className="h-3.5 w-3.5 text-teinte" />
            {t('Retouche enregistrée : elle sera le média final de cette image.')}
          </p>
        ) : null}
        {erreur ? <p className="text-[12.5px] text-danger">{erreur}</p> : null}
      </div>

      <ZoneDefilement className="min-h-0 shrink-0 px-4 pb-3 lg:w-[300px]">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="ghost" title={t('Annuler')} disabled={!peutAnnuler} onClick={() => setHistorique((h) => ({ ...h, rang: Math.max(0, h.rang - 1) }))} data-annuler-photo="">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="sm" variant="ghost" title={t('Rétablir')} disabled={!peutRetablir} onClick={() => setHistorique((h) => ({ ...h, rang: Math.min(h.pile.length - 1, h.rang + 1) }))} data-retablir-photo="">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={avant}
              onPointerDown={() => setAvant(true)}
              onPointerUp={() => setAvant(false)}
              onPointerLeave={() => setAvant(false)}
              onKeyDown={(event) => event.key === ' ' && setAvant(true)}
              onKeyUp={() => setAvant(false)}
              title={t('Maintenir pour voir l’original')}
              data-avant-apres=""
              className="gap-1"
            >
              <Eye className="h-3.5 w-3.5" />
              {t('Avant / après')}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={photoInchangee(valides)} onClick={() => valider(reglagesPhotoNeutres())} data-reinitialiser-photo="">
              {t('Réinitialiser')}
            </Button>
          </div>
          <LigneDeCurseur
            nom="redressement"
            libelle={t('Redressement')}
            valeur={reglages.redressement}
            min={-45}
            max={45}
            pas={0.5}
            unite="°"
            onChange={(v) => setEnCours({ ...valides, redressement: v })}
            onValider={(v) => valider(reglagesPhotoLus({ ...valides, redressement: v }))}
          />
          {CURSEURS_DE_LA_PHOTO.map((c: CurseurDeLaPhoto) => (
            <LigneDeCurseur
              key={c}
              nom={c}
              libelle={t(LIBELLES_CURSEURS_DE_LA_PHOTO[c])}
              valeur={reglages[c]}
              min={c === 'nettete' || c === 'vignettage' ? 0 : -100}
              max={100}
              onChange={(v) => setEnCours({ ...valides, [c]: v })}
              onValider={(v) => valider(reglagesPhotoLus({ ...valides, [c]: v }))}
            />
          ))}
          <Button
            type="button"
            className="mt-1 gap-1.5 bg-accent text-accent-fg hover:opacity-90"
            disabled={envoi}
            aria-busy={envoi}
            onClick={() => void enregistrer()}
            data-enregistrer-photo=""
          >
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {envoi ? t('Rendu en cours…') : t('Enregistrer la retouche')}
          </Button>
        </div>
      </ZoneDefilement>
    </div>
  );
}

function LigneDeCurseur({
  nom,
  libelle,
  valeur,
  min,
  max,
  pas = 1,
  unite = '',
  onChange,
  onValider,
}: {
  nom: string;
  libelle: string;
  valeur: number;
  min: number;
  max: number;
  pas?: number;
  unite?: string;
  onChange: (v: number) => void;
  onValider: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1" data-curseur-photo={nom}>
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-muted">{libelle}</span>
        <span className="tabular-nums text-text">
          {valeur > 0 && min < 0 ? '+' : ''}
          {valeur}
          {unite}
        </span>
      </div>
      <Curseur valeur={valeur} min={min} max={max} pas={pas} onChange={onChange} onValider={onValider} aria-label={libelle} />
    </div>
  );
}
