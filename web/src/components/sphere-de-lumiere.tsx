import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { directionAimantee, directionBornee, reponseDeLumiere, type DirectionDeLumiere, type DirectionsDuModele, type SphereDeLaQuestion } from '@beluga/shared';
import { Button } from '@/components/ui';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LA SPHÈRE DE LUMIÈRE (agent créatif, 24/10/2026) : « Changer la lumière »
 * d'une image, après le choix du modèle. Une sphère ombrée, éclairée en direct
 * par le point de lumière qu'on déplace à la souris ou au doigt — au centre,
 * la lumière vient de face ; au bord de la sphère, de côté ; dans l'anneau
 * autour, de derrière le sujet (contre-jour). Les flèches du clavier la
 * tournent de 5° en 5°.
 *
 * LIBRE avec un modèle qui accepte une direction décrite (Higgsfield,
 * OpenRouter) ; BLOQUÉE avec un modèle à directions fixes (IC-Light, Fibo) :
 * ses directions sont marquées, et le point s'y aimante — on ne peut pas
 * valider une direction que le modèle refuserait (le démon le vérifie aussi).
 *
 * Ce n'est pas un glisser-déposer (rien ne se déplace d'une liste à l'autre) :
 * un réglage continu, tenu par la capture du pointeur, comme un curseur.
 * Monochrome : la sphère et le point suivent le texte et les fonds du thème.
 */
const TAILLE = 176;
/** Le rayon de la sphère dans le dessin ; l'anneau du contre-jour va jusqu'au double. */
const RAYON = 52;

/** La direction depuis un point du dessin (centre = face, bord = côté, anneau = derrière). */
function directionDuPoint(x: number, y: number): DirectionDeLumiere {
  const r = Math.hypot(x, y);
  const d = Math.min(2, r / RAYON);
  const theta = (d * Math.PI) / 2;
  const ux = r ? x / r : 0;
  const uy = r ? -y / r : 0;
  const vx = Math.sin(theta) * ux;
  const vy = Math.sin(theta) * uy;
  const vz = Math.cos(theta);
  return directionBornee({ azimut: (Math.atan2(vx, vz) * 180) / Math.PI, elevation: (Math.asin(Math.max(-1, Math.min(1, vy))) * 180) / Math.PI })!;
}

/** Le point du dessin d'une direction (l'inverse de `directionDuPoint`). */
function pointDeLaDirection(d: DirectionDeLumiere): { x: number; y: number } {
  const az = (d.azimut * Math.PI) / 180;
  const el = (d.elevation * Math.PI) / 180;
  const vx = Math.cos(el) * Math.sin(az);
  const vy = Math.sin(el);
  const vz = Math.cos(el) * Math.cos(az);
  const theta = Math.acos(Math.max(-1, Math.min(1, vz)));
  const s = Math.hypot(vx, vy);
  const r = ((theta / (Math.PI / 2)) * RAYON);
  return s ? { x: (vx / s) * r, y: (-vy / s) * r } : { x: 0, y: vz < 0 ? -2 * RAYON : 0 };
}

/** Une couleur du thème, lue sur la page (les jetons ne sont pas tous en hexadécimal). */
function couleurDuTheme(variable: string): [number, number, number] {
  const sonde = document.createElement('span');
  sonde.style.color = `var(${variable})`;
  sonde.style.display = 'none';
  document.body.appendChild(sonde);
  const brut = getComputedStyle(sonde).color;
  sonde.remove();
  const m = /(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(brut);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
}

export function SphereDeLumiere({
  sphere,
  onRepondre,
  onChange,
}: {
  sphere: SphereDeLaQuestion;
  /** Dans une question : le bouton « Valider » répond à l'agent. */
  onRepondre?: (reponse: string, images: string[]) => Promise<void>;
  /**
   * DANS LE PANNEAU « CHANGER LA LUMIÈRE » d'un média (26/10/2026) : la
   * direction suit le doigt, et c'est le bouton à prix du panneau qui part —
   * la sphère n'a alors pas de bouton à elle.
   */
  onChange?: (direction: DirectionDeLumiere) => void;
}) {
  const libre = sphere.directions === 'libre';
  /* La question ne porte que la direction et son nom : la valeur envoyée au service reste au démon. */
  const permises = (libre ? 'libre' : sphere.directions) as DirectionsDuModele;
  const depart = libre ? { azimut: -45, elevation: 30 } : { azimut: (sphere.directions as { azimut: number }[])[0]!.azimut, elevation: (sphere.directions as { elevation: number }[])[0]!.elevation };
  const [direction, setDirection] = React.useState<DirectionDeLumiere>(depart);
  const [envoi, setEnvoi] = React.useState(false);
  const toile = React.useRef<HTMLCanvasElement>(null);
  const tenu = React.useRef(false);

  const poser = React.useCallback((d: DirectionDeLumiere) => setDirection(libre ? d : directionAimantee(d, permises)), [libre, permises]);

  /* LE DESSIN : un éclairage diffus (Lambert) plus un léger reflet, du fond vers la couleur du texte. */
  React.useEffect(() => {
    const canvas = toile.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const echelle = window.devicePixelRatio || 1;
    canvas.width = TAILLE * echelle;
    canvas.height = TAILLE * echelle;
    ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
    ctx.clearRect(0, 0, TAILLE, TAILLE);
    const fond = couleurDuTheme('--raised');
    const encre = couleurDuTheme('--text');
    const az = (direction.azimut * Math.PI) / 180;
    const el = (direction.elevation * Math.PI) / 180;
    const L = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const image = ctx.createImageData(Math.round(RAYON * 2 * echelle), Math.round(RAYON * 2 * echelle));
    const cote = image.width;
    for (let py = 0; py < cote; py++) {
      for (let px = 0; px < cote; px++) {
        const nx = (px / cote) * 2 - 1;
        const ny = -((py / cote) * 2 - 1);
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);
        const diffus = Math.max(0, nx * L[0]! + ny * L[1]! + nz * L[2]!);
        const reflet = Math.pow(Math.max(0, 2 * diffus * nz - L[2]!), 24) * 0.35;
        const k = Math.min(1, 0.08 + 0.85 * diffus + reflet);
        const i = (py * cote + px) * 4;
        image.data[i] = fond[0] + (encre[0] - fond[0]) * k;
        image.data[i + 1] = fond[1] + (encre[1] - fond[1]) * k;
        image.data[i + 2] = fond[2] + (encre[2] - fond[2]) * k;
        image.data[i + 3] = 255;
      }
    }
    const centre = TAILLE / 2;
    ctx.putImageData(image, Math.round((centre - RAYON) * echelle), Math.round((centre - RAYON) * echelle));
  }, [direction]);

  const versDirection = (event: React.PointerEvent<HTMLDivElement>) => {
    const boite = event.currentTarget.getBoundingClientRect();
    poser(directionDuPoint(event.clientX - boite.left - boite.width / 2, event.clientY - boite.top - boite.height / 2));
  };
  const clavier = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const pas = event.shiftKey ? 15 : 5;
    const suite =
      event.key === 'ArrowLeft'
        ? { ...direction, azimut: direction.azimut - pas }
        : event.key === 'ArrowRight'
          ? { ...direction, azimut: direction.azimut + pas }
          : event.key === 'ArrowUp'
            ? { ...direction, elevation: direction.elevation + pas }
            : event.key === 'ArrowDown'
              ? { ...direction, elevation: direction.elevation - pas }
              : null;
    if (!suite) return;
    event.preventDefault();
    if (libre) {
      setDirection(directionBornee(suite)!);
      return;
    }
    /* Bloquée : les flèches passent d'une direction permise à la suivante. */
    const liste = sphere.directions as { azimut: number; elevation: number }[];
    const ici = liste.findIndex((p) => p.azimut === direction.azimut && p.elevation === direction.elevation);
    const sens = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    const suivante = liste[(ici + sens + liste.length) % liste.length]!;
    setDirection({ azimut: suivante.azimut, elevation: suivante.elevation });
  };
  React.useEffect(() => {
    onChange?.(direction);
  }, [direction.azimut, direction.elevation]);
  const point = pointDeLaDirection(direction);
  const valider = async () => {
    if (envoi || !onRepondre) return;
    setEnvoi(true);
    try {
      await onRepondre(reponseDeLumiere(direction), []);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <section className="mt-2 flex flex-wrap items-center gap-4" data-emulateur-lumiere="" data-lumiere-mode={libre ? 'libre' : 'bloque'} data-lumiere-position={`${direction.azimut},${direction.elevation}`}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Direction de la lumière"
        aria-valuetext={t('azimut {a}°, élévation {e}°', { a: direction.azimut, e: direction.elevation })}
        className="relative shrink-0 touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-text/30"
        style={{ width: TAILLE, height: TAILLE }}
        onPointerDown={(event) => {
          tenu.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          versDirection(event);
        }}
        onPointerMove={(event) => {
          if (tenu.current) versDirection(event);
        }}
        onPointerUp={(event) => {
          tenu.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => (tenu.current = false)}
        onKeyDown={clavier}
        data-sphere-de-lumiere=""
      >
        {/* L'anneau du contre-jour : la lumière vient de derrière le sujet. */}
        <span className="pointer-events-none absolute inset-0 rounded-full bg-raised/40" aria-hidden />
        <canvas ref={toile} className="pointer-events-none absolute inset-0" style={{ width: TAILLE, height: TAILLE }} aria-hidden />
        {libre
          ? null
          : (sphere.directions as { azimut: number; elevation: number; libelle: string }[]).map((p) => {
              const q = pointDeLaDirection(p);
              return (
                <span
                  key={`${p.azimut},${p.elevation},${p.libelle}`}
                  title={p.libelle}
                  className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-faint"
                  style={{ left: TAILLE / 2 + q.x, top: TAILLE / 2 + q.y }}
                  data-direction-permise={p.libelle}
                />
              );
            })}
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text ring-2 ring-surface"
          style={{ left: TAILLE / 2 + point.x, top: TAILLE / 2 + point.y }}
          aria-hidden
          data-point-de-lumiere=""
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {sphere.image ? (
          <div className="h-24 w-32 overflow-hidden rounded bg-raised p-1">
            <ImageDePiece id={sphere.image} alt="" className="h-full w-full rounded object-contain" />
          </div>
        ) : null}
        <p className="text-[12.5px] leading-snug text-muted">
          {libre ? t('Direction libre : déplacez le point. Au centre, la lumière vient de face ; dans l’anneau, de derrière.') : t('Ce modèle n’accepte que les directions marquées : le point s’y cale.')}
        </p>
        <p className="select-text text-[12.5px] tabular-nums text-text" data-lumiere-libelle="">
          {t('azimut {a}°, élévation {e}°', { a: direction.azimut, e: direction.elevation })} · {sphere.modele}
        </p>
        {onRepondre ? (
          <Button size="sm" className={cn('self-start gap-1.5')} onClick={() => void valider()} disabled={envoi} data-valider-lumiere="">
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t('Valider cette lumière')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
