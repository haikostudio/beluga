import * as React from 'react';
import { ArrowLeft, Ban, ChevronRight } from 'lucide-react';
import { POLICES_STUDIO } from '@beluga/shared';
import { Button, DialogTitle, Input, ListeDeroulante, Switch, Textarea, type OptionSelecteur } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { ecrireCouleur, lireCouleur } from './apercu';

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
  prefixe,
  ...reste
}: {
  valeur: number;
  onValider: (v: number) => void;
  min?: number;
  max?: number;
  pas?: number;
  unite?: string;
  /** UNE LETTRE OU UNE ICÔNE DANS LE CHAMP, à gauche (« X », « L »…) : la paire tient sur une ligne, comme dans Figma. */
  prefixe?: React.ReactNode;
} & Record<string, unknown>) {
  const [v, setV] = React.useState(String(valeur));
  React.useEffect(() => setV(String(Math.round(valeur * 1000) / 1000)), [valeur]);
  const valider = () => {
    const brut = Number(v.replace(',', '.'));
    const n = Number.isFinite(brut) ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, brut)) : brut;
    if (Number.isFinite(n) && n !== valeur) onValider(n);
    else setV(String(Math.round(valeur * 1000) / 1000));
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
        className={cn('h-8 w-full text-[13px] tabular-nums', unite && 'pr-8', prefixe !== undefined && 'pl-6')}
      />
      {prefixe !== undefined ? (
        <span className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center text-[11.5px] font-medium text-faint" aria-hidden>
          {prefixe}
        </span>
      ) : null}
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
 *
 * AVEC `transparence`, LA COULEUR GARDE SON OPACITÉ : un pourcentage à côté de la
 * pastille (posée sur un damier, elle montre la vraie couleur) et un bouton
 * « Aucune » (opacité 0). La valeur rendue est `#rrggbb` opaque, `#rrggbbaa` sinon.
 */
export function ChampCouleur({
  valeur,
  onValider,
  onApercu,
  transparence = false,
  ...reste
}: { valeur: string; onValider: (v: string) => void; onApercu?: (v: string) => void; transparence?: boolean } & Record<string, unknown>) {
  const lue = lireCouleur(valeur) ?? { hexa: '#ffffff', alpha: 1 };
  const hexa = lue.hexa;
  const alphaRecu = transparence ? lue.alpha : 1;
  const [v, setV] = React.useState(hexa);
  const [alpha, setAlpha] = React.useState(alphaRecu);
  const validee = React.useRef(ecrireCouleur(hexa, alphaRecu));
  /* PENDANT LE CHOIX, la valeur reçue n'est pas reprise : la couleur montrée en direct revient de l'aperçu
     (styles calculés) et deviendrait la valeur de départ — le choix ne partirait alors jamais. */
  const enChoix = React.useRef(false);
  React.useEffect(() => {
    if (enChoix.current) return;
    setV(hexa);
    setAlpha(alphaRecu);
    validee.current = ecrireCouleur(hexa, alphaRecu);
  }, [hexa, alphaRecu]);
  const alphaCourant = React.useRef(alpha);
  alphaCourant.current = alpha;
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
    const fermeture = () => valider.current(ecrireCouleur(el.value, alphaCourant.current > 0 ? alphaCourant.current : 1));
    el.addEventListener('change', fermeture);
    return () => el.removeEventListener('change', fermeture);
  }, []);
  const image = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(image.current), []);
  // Choisir une teinte sur une couleur « aucune » la rend visible : sinon le choix ne se verrait jamais.
  const alphaDuChoix = () => (alpha > 0 ? alpha : 1);
  const pourcent = Math.round(alpha * 100);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" data-studio-couleur-alpha={transparence ? pourcent : undefined}>
      <span
        className="relative h-7 w-8 shrink-0 overflow-hidden rounded border border-faint/40"
        style={{ backgroundImage: 'repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%)', backgroundSize: '8px 8px' }}
      >
        <span className="pointer-events-none absolute inset-0" style={{ backgroundColor: ecrireCouleur(v, alpha) }} aria-hidden />
        <input
          {...reste}
          ref={champ}
          type="color"
          value={v}
          onChange={(e) => {
            const x = e.target.value;
            enChoix.current = true;
            setV(x);
            if (alpha <= 0) setAlpha(1);
            if (!onApercu) return;
            const a = alphaDuChoix();
            cancelAnimationFrame(image.current);
            image.current = requestAnimationFrame(() => onApercu(ecrireCouleur(x, a)));
          }}
          onBlur={() => valider.current(ecrireCouleur(v, alpha))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span className="min-w-0 truncate text-[12px] uppercase tabular-nums text-faint">{transparence && alpha <= 0 ? t('Aucune') : v.slice(1)}</span>
      {transparence ? (
        <>
          <span className="ml-auto w-[3.6rem] shrink-0">
            <ChampNombre
              valeur={pourcent}
              min={0}
              max={100}
              pas={1}
              unite="%"
              aria-label="Opacité de la couleur"
              title={t('Opacité de la couleur')}
              data-studio-couleur-opacite=""
              onValider={(n) => {
                setAlpha(n / 100);
                valider.current(ecrireCouleur(v, n / 100));
              }}
            />
          </span>
          <button
            type="button"
            aria-label="Aucune couleur"
            title={alpha <= 0 ? t('Remettre la couleur') : t('Aucune couleur (transparent)')}
            aria-pressed={alpha <= 0}
            className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded text-faint hover:bg-raised/60 hover:text-text', alpha <= 0 && 'bg-accent/15 text-text')}
            onClick={(e) => {
              e.preventDefault();
              const a = alpha <= 0 ? 1 : 0;
              setAlpha(a);
              valider.current(ecrireCouleur(v, a));
            }}
            data-studio-couleur-aucune=""
          >
            <Ban className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}
    </span>
  );
}

/** Un repère `data-…` dont le nom est choisi par l'appelant (ce n'est pas un texte affiché). */
function repereDe(nom: string, valeur: string): Record<string, string> {
  return { ['data-'.concat(nom)]: valeur };
}

/** DES BOUTONS À ICÔNES, un seul pressé (alignements, style d'un texte…) : le choix part au clic. */
export function ChampBoutons<T extends string>({
  valeur,
  options,
  onValider,
  repere = 'studio-bouton',
  ...reste
}: {
  valeur: T | undefined;
  options: readonly { valeur: T; libelle: string; Icone: React.ComponentType<{ className?: string }> }[];
  onValider: (v: T) => void;
  /** Le repère posé sur chaque bouton (`data-<repere>="<valeur>"`), que les contrôles visent. */
  repere?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span className="flex flex-wrap items-center gap-0.5" data-valeur={valeur ?? ''} {...reste}>
      {options.map((o) => (
        <button
          key={o.valeur}
          type="button"
          aria-pressed={valeur === o.valeur}
          aria-label={o.libelle}
          title={o.libelle}
          onClick={(e) => {
            e.preventDefault();
            onValider(o.valeur);
          }}
          className={cn('flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-raised/60 hover:text-text', valeur === o.valeur && 'bg-accent/15 text-text')}
          {...repereDe(repere, o.valeur)}
        >
          <o.Icone className="h-3.5 w-3.5" />
        </button>
      ))}
    </span>
  );
}

/**
 * QUATRE VALEURS EN PIXELS (marges, coins) : une case par côté, dans l'ordre CSS (haut, droite, bas, gauche — ou les
 * coins dans le sens des aiguilles d'une montre), chacune marquée d'une lettre. Une case changée envoie les quatre.
 */
export function ChampQuatre({
  valeurs,
  lettres,
  libelles,
  min,
  onValider,
  ...reste
}: {
  valeurs: number[];
  lettres: readonly string[];
  libelles: readonly string[];
  min?: number;
  onValider: (v: [number, number, number, number]) => void;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span className="grid w-full grid-cols-4 gap-1" {...reste}>
      {[0, 1, 2, 3].map((i) => (
        <ChampNombre
          key={i}
          valeur={valeurs[i] ?? 0}
          pas={1}
          min={min}
          prefixe={lettres[i]}
          aria-label={libelles[i]}
          title={libelles[i]}
          data-studio-quatre={i}
          onValider={(n) => {
            const q = [0, 1, 2, 3].map((k) => (k === i ? n : valeurs[k] ?? 0)) as [number, number, number, number];
            onValider(q);
          }}
        />
      ))}
    </span>
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
 * LES ACCORDÉONS DE L'INSPECTEUR : chaque `Section` posée dedans se replie sous
 * son titre. TOUS OUVERTS au départ, chacun s'ouvre ou se ferme SANS toucher aux
 * autres, et son état est GARDÉ sur l'appareil par clé de bloc (`texte`,
 * `remplissage`, `segment`…) : le même d'une pièce à l'autre, d'une ouverture du
 * Studio à la suivante. Hors d'`Accordeons`, une `Section` reste un bloc toujours ouvert.
 */
const CLE_BLOCS_FERMES = 'beluga.studio.blocs-fermes';
const AccordeonOuvert = React.createContext<{ fermes: ReadonlySet<string>; basculer: (cle: string) => void } | null>(null);

/** Les blocs fermés, lus une fois puis tenus à jour ici : tous les inspecteurs ouverts suivent le même état. */
let blocsFermes: Set<string> | null = null;
const abonnes = new Set<() => void>();
function lireBlocsFermes(): Set<string> {
  if (blocsFermes) return blocsFermes;
  try {
    const brut = JSON.parse(window.localStorage.getItem(CLE_BLOCS_FERMES) ?? '[]');
    blocsFermes = new Set(Array.isArray(brut) ? brut.filter((x): x is string => typeof x === 'string').slice(0, 100) : []);
  } catch {
    blocsFermes = new Set();
  }
  return blocsFermes;
}
function basculerBloc(cle: string): void {
  const suivant = new Set(lireBlocsFermes());
  if (suivant.has(cle)) suivant.delete(cle);
  else suivant.add(cle);
  blocsFermes = suivant;
  try {
    window.localStorage.setItem(CLE_BLOCS_FERMES, JSON.stringify([...suivant]));
  } catch {
    /* stockage indisponible : l'état vit le temps de la page */
  }
  abonnes.forEach((f) => f());
}
function abonner(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

export function Accordeons({ children }: { children: React.ReactNode }) {
  const fermes = React.useSyncExternalStore(abonner, lireBlocsFermes, lireBlocsFermes);
  const valeur = React.useMemo(() => ({ fermes, basculer: basculerBloc }), [fermes]);
  return (
    <AccordeonOuvert.Provider value={valeur}>
      <div className="flex flex-col gap-2" data-studio-accordeons>
        {children}
      </div>
    </AccordeonOuvert.Provider>
  );
}

/**
 * UN BLOC DE L'INSPECTEUR. Par défaut c'est un FORMULAIRE en deux colonnes ;
 * `liste` en fait une simple pile pleine largeur (voix, médias, modèles, exports).
 * Dans `Accordeons`, son titre devient le bouton qui l'ouvre (clé : `cle`, sinon
 * le titre) ; l'`action` reste à côté, hors du bouton, et ne replie rien.
 */
export function Section({
  titre,
  children,
  action,
  liste,
  cle,
  ...reste
}: { titre: string; children: React.ReactNode; action?: React.ReactNode; liste?: boolean; cle?: string } & Record<`data-${string}`, string | undefined>) {
  const accordeon = React.useContext(AccordeonOuvert);
  const cleSection = cle ?? titre;
  const ouvert = !accordeon || !accordeon.fermes.has(cleSection);
  const intitule = <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">{titre}</h3>;
  return (
    <section
      className="flex flex-col gap-1.5 rounded-md bg-bloc px-3 py-2.5"
      data-studio-bloc={accordeon ? cleSection : undefined}
      data-ouvert={accordeon ? (ouvert ? 'oui' : 'non') : undefined}
      {...reste}
    >
      <header className="flex min-h-7 items-center gap-2">
        {accordeon ? (
          <button
            type="button"
            onClick={() => accordeon.basculer(cleSection)}
            aria-expanded={ouvert}
            className="-my-1 flex min-h-9 min-w-0 flex-1 items-center gap-1.5 text-left"
            data-studio-bloc-bascule={cleSection}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')} aria-hidden />
            {intitule}
          </button>
        ) : (
          intitule
        )}
        {action}
      </header>
      {/* Replié, le contenu QUITTE le flux : ses champs ne restent pas joignables au clavier. */}
      {!ouvert ? null : liste ? (
        <div className="flex flex-col gap-1">{children}</div>
      ) : (
        <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5 [&>:not([data-ligne])]:col-start-2" data-studio-grille>
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * L'ENTÊTE D'UNE FENÊTRE DU STUDIO : le RETOUR en haut à gauche (une flèche),
 * le TITRE au centre, et à droite ce que la fenêtre veut y poser (une aide).
 * Trois colonnes dont les deux de côté ont la même largeur : le titre reste
 * centré, qu'il y ait un retour ou non. Le geste principal, lui, va dans le
 * pied (`DialogFooter pleineLargeur`) — plus aucun bouton aligné à droite.
 */
export function EnteteDeFenetre({
  titre,
  sousTitre,
  onRetour,
  repereRetour = 'data-studio-retour',
  droite,
  croix,
  ...reste
}: {
  titre: string;
  /** Une ligne discrète sous le titre (l'étape d'un parcours). */
  sousTitre?: React.ReactNode;
  /** Le retour : absent, la colonne de gauche reste vide. */
  onRetour?: () => void;
  /** Le repère du bouton de retour, pour les contrôles (`data-studio-retour` par défaut). */
  repereRetour?: string;
  droite?: React.ReactNode;
  /**
   * La fenêtre porte déjà sa CROIX dans le coin haut droit (fenêtre d'ordinateur) : les deux colonnes de côté
   * s'élargissent d'autant, pour que l'aide tienne à gauche de la croix et que le titre reste au centre.
   */
  croix?: boolean;
} & Record<`data-${string}`, string | number | undefined>) {
  return (
    <div className={cn('grid items-center gap-1', croix ? 'grid-cols-[3.75rem_minmax(0,1fr)_3.75rem]' : 'grid-cols-[2rem_minmax(0,1fr)_2rem]')} data-studio-entete-fenetre {...reste}>
      {onRetour ? (
        <Button size="icon" variant="ghost" aria-label="Retour" title={t('Retour')} onClick={onRetour} {...{ [repereRetour]: '' }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 flex-col items-center text-center">
        <DialogTitle className="max-w-full truncate" data-studio-titre-fenetre>
          {titre}
        </DialogTitle>
        {sousTitre ? <span className="max-w-full truncate text-[11.5px] text-faint">{sousTitre}</span> : null}
      </div>
      <span className={cn('flex', croix ? 'justify-start' : 'justify-end')}>{droite}</span>
    </div>
  );
}
