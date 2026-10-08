import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { POLICES_STUDIO } from '@beluga/shared';
import { Input, ListeDeroulante, Switch, Textarea, type OptionSelecteur } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * LES CHAMPS DE L'INSPECTEUR DU STUDIO. Chacun garde sa valeur locale pendant
 * la saisie et ne la RENVOIE qu'au moment voulu (fin de frappe, curseur
 * relâché, case changée) : une opération par geste, donc une version par
 * geste — jamais une version par lettre tapée.
 *
 * ALIGNÉS EN DEUX COLONNES : chaque `Section` est une grille dont la première
 * colonne (largeur fixe) porte les libellés et la seconde les valeurs, pleine
 * largeur. Une `Ligne` ne pose aucune boîte (`display: contents`) ; ce qui
 * n'est pas une ligne (zone de texte sans libellé, note, bouton) se range DANS
 * la colonne des valeurs. Les unités (« s », « px ») vivent dans le champ.
 */

export function Ligne({ libelle, children, className }: { libelle: string; children: React.ReactNode; className?: string }) {
  return (
    <label className="contents" data-ligne>
      <span className="flex min-h-8 min-w-0 items-center self-start text-[12.5px] leading-tight text-muted">{libelle}</span>
      <span className={cn('flex min-h-8 min-w-0 items-center gap-2 text-[13px]', className)}>{children}</span>
    </label>
  );
}

export function ChampTexte({ valeur, onValider, long, ...reste }: { valeur: string; onValider: (v: string) => void; long?: boolean } & Record<string, unknown>) {
  const [v, setV] = React.useState(valeur);
  React.useEffect(() => setV(valeur), [valeur]);
  const valider = () => {
    if (v !== valeur) onValider(v);
  };
  if (long) {
    return (
      <Textarea
        {...reste}
        value={v}
        rows={3}
        onChange={(e) => setV(e.target.value)}
        onBlur={valider}
        onKeyDown={(e) => e.stopPropagation()}
        className="min-h-[64px] w-full text-[13px]"
      />
    );
  }
  return (
    <Input
      {...reste}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={valider}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
      className="h-8 w-full text-[13px]"
    />
  );
}

export function ChampNombre({
  valeur,
  onValider,
  min,
  max,
  pas = 0.1,
  unite,
  ...reste
}: { valeur: number; onValider: (v: number) => void; min?: number; max?: number; pas?: number; unite?: string } & Record<string, unknown>) {
  const [v, setV] = React.useState(String(valeur));
  React.useEffect(() => setV(String(Math.round(valeur * 1000) / 1000)), [valeur]);
  const valider = () => {
    const n = Number(v.replace(',', '.'));
    if (Number.isFinite(n) && n !== valeur) onValider(n);
    else setV(String(valeur));
  };
  return (
    // L'UNITÉ VIT DANS LE CHAMP : la valeur occupe toute la colonne, et rien ne déborde à droite.
    <span className="relative flex min-w-0 flex-1">
      <Input
        {...reste}
        inputMode="decimal"
        value={v}
        min={min}
        max={max}
        step={pas}
        onChange={(e) => setV(e.target.value)}
        onBlur={valider}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
        className={cn('h-8 w-full text-[13px] tabular-nums', unite && 'pr-8')}
      />
      {unite ? <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-faint">{unite}</span> : null}
    </span>
  );
}

/** Un curseur : la valeur suit le doigt, l'opération ne part qu'au relâché. Sa valeur lue reste DANS la colonne. */
export function ChampCurseur({ valeur, onValider, min, max, pas }: { valeur: number; onValider: (v: number) => void; min: number; max: number; pas: number }) {
  const [v, setV] = React.useState(valeur);
  React.useEffect(() => setV(valeur), [valeur]);
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={pas}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => v !== valeur && onValider(v)}
        onKeyUp={() => v !== valeur && onValider(v)}
        onKeyDown={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 accent-[hsl(var(--accent))]"
      />
      <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-muted">{Math.round(v * 100) / 100}</span>
    </>
  );
}

/**
 * UNE COULEUR. Le sélecteur du navigateur ne fait pas perdre le focus pendant le
 * choix : `onApercu` montre la couleur EN DIRECT (une fois par image), et la
 * valeur ne part (`onValider`, une seule opération, donc une seule annulation)
 * qu'à la fermeture du sélecteur (événement `change`) ou quand le champ perd le focus.
 */
export function ChampCouleur({
  valeur,
  onValider,
  onApercu,
  ...reste
}: { valeur: string; onValider: (v: string) => void; onApercu?: (v: string) => void } & Record<string, unknown>) {
  const hexa = /^#[0-9a-f]{6}$/i.test(valeur) ? valeur : /^#[0-9a-f]{3}$/i.test(valeur) ? `#${[...valeur.slice(1)].map((c) => c + c).join('')}` : '#ffffff';
  const [v, setV] = React.useState(hexa);
  const validee = React.useRef(hexa);
  /* PENDANT LE CHOIX, la valeur reçue n'est pas reprise : la couleur montrée en direct revient de l'aperçu
     (styles calculés) et deviendrait la valeur de départ — le choix ne partirait alors jamais. */
  const enChoix = React.useRef(false);
  React.useEffect(() => {
    if (enChoix.current) return;
    setV(hexa);
    validee.current = hexa;
  }, [hexa]);
  const valider = React.useRef((x: string) => undefined as void);
  valider.current = (x: string) => {
    enChoix.current = false;
    if (x === validee.current) return;
    validee.current = x;
    onValider(x);
  };
  const champ = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    const el = champ.current;
    if (!el) return;
    // L'événement NATIF `change` : le sélecteur se referme, le choix est fait (React n'expose que `input`).
    const fermeture = () => valider.current(el.value);
    el.addEventListener('change', fermeture);
    return () => el.removeEventListener('change', fermeture);
  }, []);
  const image = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(image.current), []);
  return (
    <>
      <input
        {...reste}
        ref={champ}
        type="color"
        value={v}
        onChange={(e) => {
          const x = e.target.value;
          enChoix.current = true;
          setV(x);
          if (!onApercu) return;
          cancelAnimationFrame(image.current);
          image.current = requestAnimationFrame(() => onApercu(x));
        }}
        onBlur={() => valider.current(v)}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <span className="text-[12px] tabular-nums text-faint">{v}</span>
    </>
  );
}

/** Un choix : la liste déroulante de l'application (icône, description, geste par ligne). */
export function ChampChoix({
  valeur,
  options,
  onValider,
  titre,
  ...reste
}: { valeur: string; options: (OptionSelecteur & { valeur: string })[]; onValider: (v: string) => void; titre?: string } & Record<`data-${string}`, string | number | boolean | undefined>) {
  return <ListeDeroulante valeur={valeur} options={options} onChoisir={onValider} titre={titre ?? ''} {...reste} />;
}

/* LES POLICES DU STUDIO, MONTRÉES DANS LEUR STYLE. Chargées dans l'application sous un nom à part (« Studio Inter ») : un
   même nom que celui d'une police de l'interface remplacerait sa graisse. Le fichier est celui que sert le cadre d'aperçu. */
const policesChargees = new Set<string>();
function chargerPolice(famille: string): void {
  const p = POLICES_STUDIO.find((x) => x.famille === famille);
  if (!p || policesChargees.has(famille) || typeof FontFace === 'undefined') return;
  policesChargees.add(famille);
  new FontFace(`Studio ${famille}`, `url(/studio/polices/${p.fichier})`, { display: 'swap' })
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => policesChargees.delete(famille));
}
const stylePolice = (famille: string): React.CSSProperties => ({ fontFamily: `'Studio ${famille}', ui-sans-serif, system-ui, sans-serif` });

/**
 * UNE LISTE DE POLICES : chaque nom s'écrit dans sa police, le champ fermé aussi. Seule la police retenue se charge
 * à l'affichage ; les autres à l'OUVERTURE de la liste (un écran qu'on n'a pas ouvert ne se télécharge pas).
 */
export function ChampPolice({
  valeur,
  onValider,
  titre,
  premiere,
}: {
  valeur: string;
  onValider: (v: string) => void;
  titre: string;
  /** Une première option sans police (« Celle de la marque »), valeur vide. */
  premiere?: string;
}) {
  React.useEffect(() => {
    if (valeur) chargerPolice(valeur);
  }, [valeur]);
  const options = [
    ...(premiere !== undefined ? [{ valeur: '', libelle: premiere }] : []),
    ...POLICES_STUDIO.map((p) => ({ valeur: p.famille, libelle: p.famille, style: stylePolice(p.famille) })),
  ];
  return (
    <ListeDeroulante
      valeur={valeur}
      options={options}
      onChoisir={onValider}
      titre={titre}
      surOuverture={() => POLICES_STUDIO.forEach((p) => chargerPolice(p.famille))}
      data-studio-champ-police={titre}
    />
  );
}

export function ChampBascule({ valeur, onValider }: { valeur: boolean; onValider: (v: boolean) => void }) {
  return <Switch checked={valeur} onCheckedChange={(v: boolean) => onValider(v)} />;
}

/**
 * UN BLOC QUI SE REPLIE : son titre est un bouton, son contenu (des `Section`)
 * ne se montre qu'ouvert. Sert à ranger « Toute la scène » sous la pièce
 * choisie : ce qui vaut pour la scène entière ne se mêle plus à ses réglages.
 */
export function BlocRepliable({
  titre,
  ouvertParDefaut,
  children,
  ...reste
}: { titre: string; ouvertParDefaut: boolean; children: React.ReactNode } & Record<`data-${string}`, string | undefined>) {
  const [ouvert, setOuvert] = React.useState(ouvertParDefaut);
  return (
    <div className="flex flex-col gap-2" data-ouvert={ouvert ? 'oui' : 'non'} {...reste}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-left text-[12.5px] font-semibold text-muted transition-colors hover:bg-raised/60 hover:text-text"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', ouvert && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{titre}</span>
      </button>
      {ouvert ? children : null}
    </div>
  );
}

/**
 * UN BLOC DE L'INSPECTEUR. Par défaut c'est un FORMULAIRE en deux colonnes ;
 * `liste` en fait une simple pile pleine largeur (voix, médias, modèles, exports).
 */
export function Section({
  titre,
  children,
  action,
  liste,
  ...reste
}: { titre: string; children: React.ReactNode; action?: React.ReactNode; liste?: boolean } & Record<`data-${string}`, string | undefined>) {
  return (
    <section className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5" {...reste}>
      <header className="flex min-h-7 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">{titre}</h3>
        {action}
      </header>
      {liste ? (
        <div className="flex flex-col gap-1">{children}</div>
      ) : (
        <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5 [&>:not([data-ligne])]:col-start-2" data-studio-grille>
          {children}
        </div>
      )}
    </section>
  );
}
