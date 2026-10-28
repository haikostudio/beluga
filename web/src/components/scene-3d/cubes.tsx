import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  ANGLES_DE_VUE,
  PARAMETRES_DES_ANGLES,
  angleAimante,
  directionAimantee,
  directionBornee,
  reponseDeLumiere,
  type AngleDeVue,
  type DirectionDeLumiere,
  type DirectionsDuModele,
  type NomDAngle,
  type SphereDeLaQuestion,
} from '@beluga/shared';
import { Button, ListeDeroulante } from '@/components/ui';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { SceneDuMannequin, positionDeLaCamera, positionDeLaLumiere, troisDPossible, type CouleursDeLaScene, type ModeDeLaScene } from './scene-du-mannequin';

/**
 * LES DEUX CUBES 3D DES RETOUCHES (décision du 26/10/2026, captures #129c et
 * #8c9bf : « un émulateur 3D qui permette, via la souris ou le doigt, de
 * sélectionner l'angle… un personnage au centre »).
 *
 *  - `CubeDAngle` (« Autres angles ») : on fait tourner la caméra autour du
 *    mannequin en glissant (rotation, hauteur), la molette ou le pincement la
 *    rapproche (cadrage) ; elle se cale sur un angle nommé quand elle passe
 *    tout près (`angleAimante`). Le menu déroulant au-dessus va droit à un
 *    angle nommé.
 *  - `CubeDeLumiere` (« Changer la lumière », et la question de lumière d'un
 *    agent) : on déplace la source, le mannequin s'éclaire et s'ombre en
 *    direct. Libre avec un modèle qui accepte une direction décrite ; calée
 *    sur les directions marquées d'un modèle à directions fixes
 *    (`directionAimantee`, le démon le vérifie aussi).
 *
 * Ce n'est pas un glisser-déposer (rien ne change de place dans une liste) :
 * un réglage continu tenu par la capture du pointeur, comme un curseur. La
 * toile coupe le défilement tactile (`touch-action: none`) : glisser dans le
 * cube ne fait ni défiler la page ni descendre la feuille du bas, qui ne se
 * tire que par sa poignée. Les flèches du clavier tournent de 5° (15° avec
 * Maj). Sans 3D sur l'appareil, le menu reste, avec une phrase qui le dit.
 *
 * Ce fichier et three.js ne se chargent qu'à l'ouverture d'un de ces écrans
 * (`index.tsx`, `React.lazy`).
 */

/** Une couleur du thème, lue sur la page : les jetons sont des triplets HSL. */
function couleurDuTheme(variable: string): string {
  const sonde = document.createElement('span');
  sonde.style.color = `hsl(var(${variable}))`;
  sonde.style.display = 'none';
  document.body.appendChild(sonde);
  const brut = getComputedStyle(sonde).color;
  sonde.remove();
  const m = /(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(brut);
  return m ? `rgb(${Math.round(Number(m[1]))}, ${Math.round(Number(m[2]))}, ${Math.round(Number(m[3]))})` : 'rgb(128, 128, 128)';
}

function couleursDuTheme(): CouleursDeLaScene {
  return { texte: couleurDuTheme('--text'), faible: couleurDuTheme('--faint'), fond: couleurDuTheme('--raised'), teinte: couleurDuTheme('--teinte') };
}

/**
 * LA TOILE ET SA SCÈNE : une toile NEUVE à chaque montage, posée dans son
 * cadre et retirée au démontage avec son contexte graphique — une toile dont
 * le contexte a été rendu ne se réutilise pas (il revient « perdu », et la
 * scène tombait au second montage). À la largeur du cadre ; les couleurs
 * suivent le thème (classe ou style de la page qui change).
 */
function useScene(mode: ModeDeLaScene, cadre: React.RefObject<HTMLDivElement>) {
  const [scene, setScene] = React.useState<SceneDuMannequin | null>(null);
  const [possible] = React.useState(() => troisDPossible());
  const [echec, setEchec] = React.useState(false);
  React.useEffect(() => {
    if (!possible || !cadre.current) return;
    const toile = document.createElement('canvas');
    toile.className = 'block w-full';
    toile.setAttribute('data-toile-3d', mode === 'angle' ? 'angle' : 'lumiere');
    cadre.current.appendChild(toile);
    let s: SceneDuMannequin;
    try {
      s = new SceneDuMannequin(toile, mode, couleursDuTheme());
    } catch (err) {
      console.warn('WebGL', err);
      toile.remove();
      setEchec(true);
      return;
    }
    const mesurer = () => {
      const largeur = Math.round(cadre.current?.clientWidth ?? 280);
      /* Un carré, ou presque : le cube y tient en entier. */
      s.taille(largeur, Math.round(Math.min(340, Math.max(240, largeur * 0.9))));
    };
    mesurer();
    const observe = new ResizeObserver(mesurer);
    observe.observe(cadre.current);
    const theme = new MutationObserver(() => s.couleurs(couleursDuTheme()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ambiance'] });
    setScene(s);
    return () => {
      observe.disconnect();
      theme.disconnect();
      s.liberer();
      toile.remove();
      setScene(null);
    };
  }, [mode, possible]);
  return { scene, possible: possible && !echec };
}

/** Le glisser dans la toile : des écarts en pixels, et le pincement (deux doigts) en rapport d'écart. */
function useGlisser(surGlisser: (dx: number, dy: number) => void, surPincer?: (facteur: number) => void) {
  const pointeurs = React.useRef(new Map<number, { x: number; y: number }>());
  const ecart = React.useRef<number | null>(null);
  const distance = () => {
    const [a, b] = [...pointeurs.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      pointeurs.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      ecart.current = distance();
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const avant = pointeurs.current.get(event.pointerId);
      if (!avant) return;
      pointeurs.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointeurs.current.size >= 2) {
        const d = distance();
        if (d && ecart.current && surPincer) surPincer(d / ecart.current);
        ecart.current = d;
        return;
      }
      surGlisser(event.clientX - avant.x, event.clientY - avant.y);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      pointeurs.current.delete(event.pointerId);
      ecart.current = distance();
    },
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
      pointeurs.current.delete(event.pointerId);
      ecart.current = null;
    },
  };
}

const bornerHauteur = (v: number, bornes: { verticalMin: number; verticalMax: number }) => Math.min(bornes.verticalMax, Math.max(bornes.verticalMin, v));
const tour = (h: number) => (((Math.round(h) % 360) + 360) % 360);

/** Le libellé d'un angle réglé à la main : son nom s'il est calé, sinon ses valeurs. */
export function libelleDeLAngle(a: AngleDeVue & { nom?: NomDAngle | null }): string {
  if (a.nom) return t(PARAMETRES_DES_ANGLES[a.nom].libelle);
  return t('rotation {h}°, hauteur {v}°, cadrage {z}/10', { h: a.horizontal, v: a.vertical, z: a.zoom });
}

export function CubeDAngle({
  bornes = { verticalMin: -30, verticalMax: 90 },
  onChange,
}: {
  /** La hauteur de caméra que le modèle accepte. */
  bornes?: { verticalMin: number; verticalMax: number };
  /** L'angle retenu, calé ou non, avec son nom s'il en a un. */
  onChange: (angle: AngleDeVue & { nom: NomDAngle | null }) => void;
}) {
  const cadre = React.useRef<HTMLDivElement>(null);
  const { scene, possible } = useScene('angle', cadre);
  /* L'angle BRUT suit la main ; l'angle MONTRÉ est calé par l'aimant. */
  const [brut, setBrut] = React.useState<AngleDeVue>({ horizontal: 0, vertical: 0, zoom: 5 });
  const montre = React.useMemo(() => {
    const a = angleAimante(brut);
    return { ...a, vertical: bornerHauteur(a.vertical, bornes) };
  }, [brut, bornes.verticalMin, bornes.verticalMax]);
  const animation = React.useRef(0);

  React.useEffect(() => {
    if (!scene) return;
    scene.reperes(
      ANGLES_DE_VUE.filter((nom) => nom !== 'gros-plan' && nom !== 'plan-large').map((nom) => ({
        cle: nom,
        position: positionDeLaCamera({ ...PARAMETRES_DES_ANGLES[nom], vertical: bornerHauteur(PARAMETRES_DES_ANGLES[nom].vertical, bornes), zoom: 5 }),
      })),
      montre.nom === 'gros-plan' || montre.nom === 'plan-large' ? 'face' : montre.nom,
    );
  }, [scene, montre.nom, bornes.verticalMin, bornes.verticalMax]);
  React.useEffect(() => {
    scene?.placer(positionDeLaCamera(montre));
  }, [scene, montre.horizontal, montre.vertical, montre.zoom]);
  React.useEffect(() => {
    onChange(montre);
  }, [montre.horizontal, montre.vertical, montre.zoom, montre.nom]);
  React.useEffect(() => () => cancelAnimationFrame(animation.current), []);
  /* La molette règle le cadrage SANS faire défiler la feuille : écouteur non passif. */
  React.useEffect(() => {
    const zone = cadre.current;
    if (!zone) return;
    const molette = (event: WheelEvent) => {
      event.preventDefault();
      setBrut((a) => ({ ...a, zoom: Math.min(10, Math.max(0, a.zoom - Math.sign(event.deltaY) * 0.5)) }));
    };
    zone.addEventListener('wheel', molette, { passive: false });
    return () => zone.removeEventListener('wheel', molette);
  }, [possible]);

  /* Un angle choisi au menu : la caméra y glisse en 300 ms, par le plus court chemin. */
  const allerA = (nom: NomDAngle) => {
    const p = PARAMETRES_DES_ANGLES[nom];
    const depart = { ...brut };
    const cible = { horizontal: p.horizontal, vertical: bornerHauteur(p.vertical, bornes), zoom: p.zoom };
    const dh = ((cible.horizontal - depart.horizontal + 540) % 360) - 180;
    const t0 = performance.now();
    cancelAnimationFrame(animation.current);
    const pas = (maintenant: number) => {
      const k = Math.min(1, (maintenant - t0) / 300);
      const e = 1 - Math.pow(1 - k, 3);
      setBrut({ horizontal: tour(depart.horizontal + dh * e), vertical: depart.vertical + (cible.vertical - depart.vertical) * e, zoom: depart.zoom + (cible.zoom - depart.zoom) * e });
      if (k < 1) animation.current = requestAnimationFrame(pas);
      else setBrut(cible);
    };
    animation.current = requestAnimationFrame(pas);
  };

  const glisser = useGlisser(
    (dx, dy) => setBrut((a) => ({ ...a, horizontal: tour(a.horizontal - dx * 0.6), vertical: bornerHauteur(a.vertical - dy * 0.5, bornes) })),
    (facteur) => setBrut((a) => ({ ...a, zoom: Math.min(10, Math.max(0, a.zoom + (facteur - 1) * 12)) })),
  );
  const clavier = (event: React.KeyboardEvent) => {
    const pas = event.shiftKey ? 15 : 5;
    const suite: Partial<Record<string, (a: AngleDeVue) => AngleDeVue>> = {
      ArrowLeft: (a) => ({ ...a, horizontal: tour(a.horizontal + pas) }),
      ArrowRight: (a) => ({ ...a, horizontal: tour(a.horizontal - pas) }),
      ArrowUp: (a) => ({ ...a, vertical: bornerHauteur(a.vertical + pas, bornes) }),
      ArrowDown: (a) => ({ ...a, vertical: bornerHauteur(a.vertical - pas, bornes) }),
      '+': (a) => ({ ...a, zoom: Math.min(10, a.zoom + 1) }),
      '-': (a) => ({ ...a, zoom: Math.max(0, a.zoom - 1) }),
    };
    const f = suite[event.key];
    if (!f) return;
    event.preventDefault();
    setBrut(f);
  };

  return (
    <section className="flex flex-col gap-2" data-cube-d-angle="" data-angle-position={`${montre.horizontal},${montre.vertical},${Math.round(montre.zoom * 10) / 10}`} data-angle-nom={montre.nom ?? ''}>
      <ListeDeroulante
        titre={t('Angle de vue')}
        valeur={montre.nom ?? ''}
        placeholder={t('Angle libre')}
        onChoisir={(v) => allerA(v as NomDAngle)}
        empile
        className="h-9"
        data-angles-du-panneau=""
        options={ANGLES_DE_VUE.map((nom) => ({ valeur: nom, libelle: t(PARAMETRES_DES_ANGLES[nom].libelle) }))}
      />
      {possible ? (
        <div
          ref={cadre}
          role="slider"
          tabIndex={0}
          aria-label="Angle de vue"
          aria-valuetext={libelleDeLAngle(montre)}
          className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-lg bg-raised outline-none focus-visible:ring-2 focus-visible:ring-text/30 active:cursor-grabbing sm:max-w-[360px]"
          onKeyDown={clavier}
          {...glisser}
        >
        </div>
      ) : (
        <p className="text-[12.5px] text-faint" data-cube-sans-3d="">
          {t('La 3D n’est pas disponible sur cet appareil : choisissez l’angle dans la liste.')}
        </p>
      )}
      <p className="text-[12.5px] leading-snug text-muted">
        {t('Glissez pour tourner la caméra autour du personnage ; la molette ou deux doigts la rapprochent.')}
      </p>
      <p className="select-text text-[12.5px] tabular-nums text-text" data-angle-libelle="">
        {libelleDeLAngle(montre)}
      </p>
    </section>
  );
}

export function CubeDeLumiere({
  sphere,
  onRepondre,
  onChange,
}: {
  sphere: SphereDeLaQuestion;
  /** Dans une question de l'agent : le bouton « Valider » lui répond. */
  onRepondre?: (reponse: string, images: string[]) => Promise<void>;
  /** Dans le panneau « Changer la lumière » : la direction suit la main, le bouton à prix du panneau part. */
  onChange?: (direction: DirectionDeLumiere) => void;
}) {
  const libre = sphere.directions === 'libre';
  const permises = (libre ? 'libre' : sphere.directions) as DirectionsDuModele;
  const fixes = libre ? [] : (sphere.directions as { azimut: number; elevation: number; libelle: string }[]);
  const cadre = React.useRef<HTMLDivElement>(null);
  const { scene, possible } = useScene('lumiere', cadre);
  const [brut, setBrut] = React.useState<DirectionDeLumiere>(() => (fixes[0] ? { azimut: fixes[0].azimut, elevation: fixes[0].elevation } : { azimut: -45, elevation: 30 }));
  const direction = React.useMemo(() => {
    const d = directionBornee(brut)!;
    return libre ? d : directionAimantee(d, permises);
  }, [brut, libre, permises]);
  const [envoi, setEnvoi] = React.useState(false);

  React.useEffect(() => {
    if (!scene) return;
    scene.reperes(
      fixes.map((p) => ({ cle: `${p.azimut},${p.elevation}`, position: positionDeLaLumiere(p) })),
      `${direction.azimut},${direction.elevation}`,
    );
  }, [scene, fixes.length, direction.azimut, direction.elevation]);
  React.useEffect(() => {
    scene?.placer(positionDeLaLumiere(direction));
  }, [scene, direction.azimut, direction.elevation]);
  React.useEffect(() => {
    onChange?.(direction);
  }, [direction.azimut, direction.elevation]);

  const glisser = useGlisser((dx, dy) =>
    setBrut((d) => ({ azimut: d.azimut + dx * 0.6, elevation: Math.min(90, Math.max(-90, d.elevation - dy * 0.5)) })),
  );
  const clavier = (event: React.KeyboardEvent) => {
    const pas = event.shiftKey ? 15 : 5;
    const sens = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (!libre && fixes.length) {
      /* Calée : les flèches passent d'une direction permise à la suivante. */
      const ici = fixes.findIndex((p) => p.azimut === direction.azimut && p.elevation === direction.elevation);
      const suivante = fixes[(ici + sens + fixes.length) % fixes.length]!;
      setBrut({ azimut: suivante.azimut, elevation: suivante.elevation });
      return;
    }
    setBrut((d) =>
      event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        ? { ...d, azimut: d.azimut + sens * pas }
        : { ...d, elevation: Math.min(90, Math.max(-90, d.elevation + sens * pas)) },
    );
  };
  const valider = async () => {
    if (envoi || !onRepondre) return;
    setEnvoi(true);
    try {
      await onRepondre(reponseDeLumiere(direction), []);
    } finally {
      setEnvoi(false);
    }
  };
  /* Sans 3D : les directions usuelles en liste. */
  const directionsDuMenu = fixes.length
    ? fixes.map((p) => ({ valeur: `${p.azimut},${p.elevation}`, libelle: p.libelle }))
    : [
        { valeur: '0,15', libelle: t('De face') },
        { valeur: '-60,30', libelle: t('De la gauche') },
        { valeur: '60,30', libelle: t('De la droite') },
        { valeur: '0,75', libelle: t('D’en haut') },
        { valeur: '0,-60', libelle: t('D’en bas') },
        { valeur: '180,20', libelle: t('Contre-jour') },
      ];

  return (
    <section
      className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4"
      data-emulateur-lumiere=""
      data-cube-de-lumiere=""
      data-lumiere-mode={libre ? 'libre' : 'bloque'}
      data-lumiere-position={`${direction.azimut},${direction.elevation}`}
    >
      {possible ? (
        <div
          ref={cadre}
          role="slider"
          tabIndex={0}
          aria-label="Direction de la lumière"
          aria-valuetext={t('azimut {a}°, élévation {e}°', { a: direction.azimut, e: direction.elevation })}
          className="relative w-full shrink-0 cursor-grab touch-none select-none overflow-hidden rounded-lg bg-raised outline-none focus-visible:ring-2 focus-visible:ring-text/30 active:cursor-grabbing sm:w-[340px]"
          onKeyDown={clavier}
          {...glisser}
        >
        </div>
      ) : (
        <div className="flex flex-col gap-1.5" data-cube-sans-3d="">
          <p className="text-[12.5px] text-faint">{t('La 3D n’est pas disponible sur cet appareil : choisissez la direction dans la liste.')}</p>
          <ListeDeroulante
            titre={t('Direction de la lumière')}
            valeur={`${direction.azimut},${direction.elevation}`}
            placeholder={t('Direction libre')}
            onChoisir={(v) => {
              const [azimut, elevation] = v.split(',').map(Number);
              setBrut({ azimut: azimut!, elevation: elevation! });
            }}
            empile
            className="h-9"
            options={directionsDuMenu}
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {sphere.image ? (
          <div className="h-24 w-32 overflow-hidden rounded bg-raised p-1">
            <ImageDePiece id={sphere.image} alt="" className="h-full w-full rounded object-contain" />
          </div>
        ) : null}
        <p className="text-[12.5px] leading-snug text-muted">
          {libre
            ? t('Glissez pour déplacer la lumière autour du personnage : il s’éclaire en direct.')
            : t('Ce modèle n’accepte que les directions marquées : la lumière s’y cale.')}
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
