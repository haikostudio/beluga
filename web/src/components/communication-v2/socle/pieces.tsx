import * as React from 'react';
import { FileText, Film, Music } from '@/components/ui/icones';
import { FICHES_RESEAUX, type ReseauSocial, RESEAUX_SOCIAUX, type ValeurFiltrable, type ValeurTriable } from '@beluga/shared';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { ListeDeroulante } from '@/components/ui';
import { SelecteurPeriode } from '@/components/selecteur-periode';
import { LogoReseau } from '@/components/logos-reseaux';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/**
 * LES PIÈCES DE L'ESPACE COMMUNICATION : un seul tableau, une seule tuile, un seul aperçu.
 *
 * TOUTE LISTE EST UN TABLEAU À COLONNES ALIGNÉES (décision de l'utilisateur du 02/11/2026) : pas de grille
 * de vignettes. Largeurs fixées par un `colgroup` : l'en-tête et ses cellules ont la même abscisse. Quand
 * la place manque, les colonnes secondaires se retirent ; sur téléphone, chaque ligne s'empile.
 */

/* ------------------------------------------------------------------ */
/* Lire les données d'un lieu                                           */
/* ------------------------------------------------------------------ */

/** Une lecture du démon, relue dès que la marque bouge. La valeur précédente reste affichée pendant la relecture. */
export function useLecture<T>(commande: { type: string } & Record<string, unknown>, deps: readonly unknown[]): { donnees: T | null; erreur: string | null; relire: () => void } {
  const state = useApp();
  const version = state.communicationVersion + Object.values(state.marketingVersions).reduce((a, b) => a + b, 0);
  const [donnees, setDonnees] = React.useState<T | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [relance, setRelance] = React.useState(0);
  const cle = JSON.stringify(commande);
  React.useEffect(() => {
    setDonnees(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<T>(commande as never)
      .then((r) => {
        if (!vivant) return;
        setDonnees(r);
        setErreur(null);
      })
      .catch((err: unknown) => {
        if (vivant) setErreur(err instanceof Error ? err.message : String(err));
      });
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, version, relance]);
  return { donnees, erreur, relire: () => setRelance((n) => n + 1) };
}

/** Joue un geste de l'utilisateur, et dit l'échec s'il y en a un. */
export async function jouerUnGeste(geste: string, id: string | undefined, donnees?: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    return await client.call<Record<string, unknown>>({ type: 'communication.geste', geste, ...(id ? { id } : {}), ...(donnees ? { donnees } : {}) } as never);
  } catch (err: any) {
    client.pushToast('error', err?.message ?? t('Geste refusé'));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Le tableau                                                           */
/* ------------------------------------------------------------------ */

export interface ColonneDeTableau<L> {
  cle: string;
  titre: string;
  /** En pixels ; absente, la colonne prend ce qui reste. */
  largeur?: number;
  droite?: boolean;
  /** Se retire quand la place manque. */
  secondaire?: boolean;
  rendu: (ligne: L) => React.ReactNode;
  /** La valeur de tri : la colonne se trie d'un clic sur son titre. */
  valeur?: (ligne: L) => ValeurTriable;
  /** Le filtre de la colonne, dans l'en-tête. */
  filtre?: 'texte' | 'choix';
  lireFiltre?: (ligne: L) => ValeurFiltrable;
  libelleDuChoix?: (valeur: string) => string;
}

/**
 * LE TABLEAU DE L'ESPACE : une enveloppe mince du TABLEAU COMMUN (`ui/tableau.tsx`, 03/11/2026) — en-tête
 * contrasté, tri et filtre par colonne, largeurs déclarées, colonnes secondaires retirées quand c'est étroit,
 * lignes empilées sur téléphone. Les repères de l'espace (`data-communication-tableau`, `-ligne`) sont gardés.
 */
export function TableauDeCommunication<L>({
  colonnes,
  lignes,
  cleDe,
  onLigne,
  repere,
  ligneChoisie,
  pile,
  sansEntete,
  recherche,
  vide,
  ordreAffiche,
  rechercheExterne,
  cibleDesOutils,
  grille,
}: {
  /** Les lignes en CARTES d'une grille, le concept de tableau gardé (recherche, filtres, tri) — `Tableau`. */
  grille?: (ligne: L) => React.ReactNode;
  /** Le texte de la loupe posée dans l'en-tête de la page (`RechercheEnIcone`) : le tableau n'a plus son champ. */
  rechercheExterne?: string;
  /** L'en-tête où le bouton filtre du tableau rejoint la loupe. */
  cibleDesOutils?: HTMLElement | null;
  /** L'ordre que le tableau affiche, pour passer d'une fiche à la suivante (`Tableau`). */
  ordreAffiche?: React.MutableRefObject<readonly L[] | null>;
  colonnes: ColonneDeTableau<L>[];
  lignes: readonly L[];
  cleDe: (ligne: L) => string;
  onLigne?: (ligne: L) => void;
  repere: string;
  ligneChoisie?: string | null;
  /** Sur téléphone, le rendu empilé d'une ligne. */
  pile?: (ligne: L) => React.ReactNode;
  sansEntete?: boolean;
  recherche?: boolean | string;
  vide?: string;
}) {
  const communes = React.useMemo<ColonneDuTableauCommun<L>[]>(
    () =>
      colonnes.map((c) => ({
        cle: c.cle,
        libelle: c.titre,
        rendu: c.rendu,
        ...(c.valeur ? { valeur: c.valeur } : {}),
        ...(c.filtre ? { filtre: c.filtre } : {}),
        ...(c.lireFiltre ? { lireFiltre: c.lireFiltre } : {}),
        ...(c.libelleDuChoix ? { libelleDuChoix: c.libelleDuChoix } : {}),
        /* LES CELLULES AÉRÉES ONT 8 PX DE MARGE DE PLUS DE CHAQUE CÔTÉ (`aere`) : la largeur déclarée garde la place
           de leur contenu, elle ne la perd pas dans la marge. */
        ...(c.largeur ? { largeur: typeof c.largeur === 'number' ? c.largeur + 16 : c.largeur } : {}),
        ...(c.droite ? { droite: true } : {}),
        ...(c.secondaire ? { secondaire: true } : {}),
      })),
    [colonnes],
  );
  return (
    <Tableau
      repere={repere}
      colonnes={communes}
      lignes={lignes}
      cle={cleDe}
      {...(onLigne ? { onLigne } : {})}
      ligneChoisie={ligneChoisie ?? null}
      {...(pile ? { pile } : {})}
      {...(sansEntete ? { sansEntete } : {})}
      {...(recherche ? { recherche } : {})}
      {...(vide ? { vide } : {})}
      {...(ordreAffiche ? { ordreAffiche } : {})}
      taille={50}
      aere
      {...(rechercheExterne !== undefined ? { rechercheExterne } : {})}
      {...(cibleDesOutils ? { cibleDesOutils } : {})}
      {...(grille ? { grille } : {})}
      attributsRacine={{ 'data-communication-tableau': repere }}
      attributsLigne={(l) => ({ 'data-communication-ligne': cleDe(l) })}
    />
  );
}

/**
 * Le titre et son sous-titre gris : la cellule principale d'un tableau. À LA TAILLE DU TEXTE COURANT (13 px, échelle
 * unique du 03/11/2026), en demi-gras : un titre de ligne n'est jamais plus gros que le texte qui l'entoure.
 */
export function TitreDeLigne({ titre, sous, gras = true }: { titre: React.ReactNode; sous?: React.ReactNode; gras?: boolean }) {
  return (
    <span className="block min-w-0 flex-1">
      <span className={cn('block truncate text-[13px]', gras ? 'font-medium text-text' : 'text-text')} data-titre-de-ligne>
        {titre}
      </span>
      {sous ? <span className="block truncate text-[12px] text-muted">{sous}</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* L'aperçu d'un média                                                  */
/* ------------------------------------------------------------------ */

/** LA VIGNETTE D'UNE LIGNE : réduite côté serveur, jamais l'original ; une vidéo sans affiche montre sa première image. */
export function Apercu({
  piece,
  genre,
  taille = 44,
  className,
  repli,
}: {
  piece?: string | null;
  genre?: string | null;
  taille?: number;
  className?: string;
  /** L'icône sans aperçu : le type de ce qui manque. */
  repli?: React.ReactNode;
}) {
  const [casse, setCasse] = React.useState(false);
  const style = { width: taille, height: taille };
  const classe = cn('block shrink-0 rounded-lg bg-raised object-cover object-top', className);
  if (piece && !casse && genre !== 'son') {
    if (genre === 'video') {
      return <video src={`${adresseDePiece(piece)}#t=0.5`} preload="metadata" muted playsInline style={style} className={classe} onError={() => setCasse(true)} data-communication-apercu={piece} />;
    }
    return <img src={adresseDePiece(piece, false, 160)} alt="" loading="lazy" decoding="async" style={style} className={classe} onError={() => setCasse(true)} data-communication-apercu={piece} />;
  }
  return (
    <span style={style} className={cn('flex shrink-0 items-center justify-center rounded-lg bg-raised text-faint', className)} data-communication-apercu-vide>
      {repli ?? (genre === 'son' ? <Music className="h-4 w-4" /> : genre === 'video' ? <Film className="h-4 w-4" /> : <FileText className="h-4 w-4" />)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Les réseaux, les états                                               */
/* ------------------------------------------------------------------ */

export function estUnReseau(canal: string): canal is ReseauSocial {
  return (RESEAUX_SOCIAUX as readonly string[]).includes(canal);
}

export function libelleDuCanal(canal: string): string {
  return estUnReseau(canal) ? FICHES_RESEAUX[canal].libelle : t(canal.charAt(0).toUpperCase() + canal.slice(1).replace(/-/g, ' '));
}

/** Le vrai logo d'un réseau, ou le nom d'un canal qui n'en a pas (courriel, communautés). */
export function PastilleReseau({ canal, avecNom }: { canal: string; avecNom?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={libelleDuCanal(canal)} data-communication-reseau={canal}>
      {estUnReseau(canal) ? <LogoReseau reseau={canal} className="h-4 w-4" /> : <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-raised text-[10px] font-semibold text-muted">{libelleDuCanal(canal).charAt(0)}</span>}
      {avecNom ? <span className="truncate">{libelleDuCanal(canal)}</span> : null}
    </span>
  );
}

export type TonDeBadge = 'attente' | 'violet' | 'gris' | 'neutre' | 'vert' | 'danger';

const TONS: Record<TonDeBadge, string> = {
  /* LE JAUNE DES QUESTIONS : ce qui attend l'utilisateur. */
  attente: 'bg-comprehension-fond text-comprehension',
  violet: 'bg-teinte/20 text-teinte',
  gris: 'bg-raised text-muted',
  neutre: 'bg-raised text-text',
  vert: 'bg-success/15 text-success',
  danger: 'bg-danger/15 text-danger',
};

export function Badge2({ ton, children, ...reste }: { ton: TonDeBadge; children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px] leading-[15px]', TONS[ton])} {...reste}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tuiles, courbes, blocs                                               */
/* ------------------------------------------------------------------ */

/** Une petite courbe dessinée à la main : pas de bibliothèque pour un trait. */
export function Courbe({ valeurs, largeur = 70, hauteur = 22, className }: { valeurs: readonly number[]; largeur?: number; hauteur?: number; className?: string }) {
  if (valeurs.length < 2 || !valeurs.some((v) => v > 0)) return null;
  const max = Math.max(...valeurs, 1);
  const points = valeurs.map((v, i) => `${((i / (valeurs.length - 1)) * largeur).toFixed(1)},${(hauteur - 2 - (v / max) * (hauteur - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={largeur} height={hauteur} viewBox={`0 0 ${largeur} ${hauteur}`} className={cn('shrink-0 text-teinte', className)} aria-hidden data-communication-courbe>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}

export function Tuile({ titre, valeur, detail, serie, ...reste }: { titre: string; valeur: React.ReactNode; detail?: React.ReactNode; serie?: readonly number[] } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-surface px-3 py-2.5" data-communication-tuile={titre} {...reste}>
      <span className="truncate text-[11.5px] text-muted">{titre}</span>
      <span className="truncate text-[21px] font-semibold leading-7 tracking-tight text-text">{valeur}</span>
      <span className="flex min-h-[22px] min-w-0 items-end justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted">{detail}</span>
        {serie ? <Courbe valeurs={serie} /> : null}
      </span>
    </div>
  );
}

export function Bloc({
  titre,
  detail,
  fin,
  attente,
  children,
  className,
  ...reste
}: {
  titre?: React.ReactNode;
  detail?: React.ReactNode;
  fin?: React.ReactNode;
  /** Le cadre jaune : ce bloc attend l'utilisateur. */
  attente?: boolean;
  children: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section className={cn('min-w-0 rounded-xl bg-surface px-3 py-2.5 [--fond-pied-tableau:hsl(var(--surface))]', attente && 'ring-1 ring-inset ring-comprehension', className)} {...reste}>
      {titre ? (
        <header className="mb-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-[13.5px] font-semibold text-text">{titre}</h3>
          {detail ? <span className="min-w-0 truncate text-[12px] text-muted">{detail}</span> : null}
          {fin ? <span className="ml-auto shrink-0">{fin}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export const PERIODES = [
  { cle: 7, libelle: '7 j' },
  { cle: 30, libelle: '30 j' },
  { cle: 90, libelle: '90 j' },
] as const;

/**
 * LA PÉRIODE EST UNE LISTE DÉROULANTE MAISON, COMPACTE (décision du 03/11/2026) : plus une rangée de trois onglets
 * qui prenait une ligne entière. Elle se pose à droite du titre, ou sur la ligne de la recherche.
 */
export function Periode({ valeur, onChoisir }: { valeur: number; onChoisir: (p: number) => void }) {
  /* SUR TÉLÉPHONE, LA PÉRIODE QUITTE LA PAGE (03/11/2026, captures #68c3 et #b496 : un bouton « 30 j » seul sur sa
     ligne, plus sombre et plus petit que la liste des marques) : c'est la période commune, dans les trois points. */
  const telephone = useTelephone();
  if (telephone) {
    const maintenant = Date.now();
    return (
      <SelecteurPeriode
        echelles={PERIODES.map((p) => p.cle)}
        echelle={valeur}
        debut={maintenant - valeur * 86_400_000}
        fin={maintenant}
        onEchelle={onChoisir}
      />
    );
  }
  return (
    <ListeDeroulante
      variante="discret"
      repere="periode"
      titre={t('Période')}
      valeur={String(valeur)}
      options={PERIODES.map((p) => ({ valeur: String(p.cle), libelle: t(p.libelle) }))}
      onChoisir={(v) => onChoisir(Number(v))}
      className="shrink-0 bg-onglets-barre px-2 text-muted"
      data-communication-segment="periode"
    />
  );
}

/** Le propriétaire seul ouvre les autres services (Studio, Statistiques) : un accès tiers n'a que Communication. */
export function useServicesOuverts(): boolean {
  return useApp().monRole === 'admin';
}

/** L'ÉCRAN VIDE D'UN LIEU DIT QUOI FAIRE : c'est l'état réel du premier jour, il vaut un écran rempli. */
export function EcranVide({ titre, texte, children, ...reste }: { titre: string; texte: string; children?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl bg-surface px-4 py-4" data-communication-vide {...reste}>
      <p className="text-[14px] font-semibold text-text">{titre}</p>
      <p className="max-w-[60ch] text-[13px] leading-relaxed text-muted">{texte}</p>
      {/* PLUS DE BOUTONS QUI SE TASSENT (03/11/2026) : l'un sous l'autre sur téléphone, côte à côte au-delà. */}
      {children ? <div className="mt-1.5 flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:flex-wrap">{children}</div> : null}
    </div>
  );
}

/** Le fond d'un lieu : une colonne qui défile, avec ses blocs. */
export function dateCourteLocale(jour: string | null | undefined): string {
  if (!jour) return '—';
  return new Date(`${jour}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
}

export function instantCourt(instant: number | null | undefined, maintenant = Date.now()): string {
  if (!instant) return '—';
  const d = new Date(instant);
  const hier = new Date(maintenant - 86_400_000);
  if (d.toDateString() === new Date(maintenant).toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hier.toDateString()) return t('hier');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).replace('.', '');
}

export function nombreLisible(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString(undefined);
}
