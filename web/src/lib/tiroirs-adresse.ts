import React from 'react';
import type { EcranNavigateur } from '@beluga/shared';

/**
 * LES TIROIRS OUVERTS, TENUS EN PHASE AVEC L'ADRESSE.
 *
 * Chaque tiroir qui mérite une adresse appelle `useTiroirAdresse(nom, ouvert,
 * setOuvert)`. Le crochet fait circuler l'information dans les deux sens, sur
 * le modèle de `useElementAdresse` :
 *
 *  — ce qui est OUVERT monte dans la pile ; `app.tsx` (le seul écrivain de
 *    l'adresse) la pose dans le fragment : un tiroir = une entrée d'historique ;
 *  — ce que l'adresse DÉSIGNE (lien collé, rechargement, Précédent/Suivant)
 *    descend : le tiroir s'ouvre une fois ses données arrivées (`pret`), et se
 *    referme quand l'adresse ne le désigne plus.
 *
 * Deux règles empêchent les boucles (même leçon que MEM-3280) :
 *  — la descente ne vient QUE de `appliquer`, appelé par la lecture de
 *    l'adresse ; un tiroir ouvert au clic ne se rouvre donc jamais après sa
 *    fermeture ;
 *  — un tiroir désigné mais pas encore monté reste « en attente » dans la pile
 *    écrite : sans cela la première réécriture de l'adresse effacerait le lien
 *    collé avant que le tiroir n'ait pu s'ouvrir. L'attente tombe dès que le
 *    tiroir s'ouvre, ou dès que l'écran change.
 */

type Instantane = {
  /** Incrémenté à chaque lecture de l'adresse. */
  version: number;
  /** Les tiroirs désignés par la dernière adresse lue. */
  voulus: string[];
};

let instantane: Instantane = { version: 0, voulus: [] };
/** Les tiroirs ouverts à l'écran, dans l'ordre d'ouverture. */
let ouverts: string[] = [];
/** Les tiroirs désignés par l'adresse et pas encore ouverts. */
let enAttente: string[] = [];
/** L'écran sous lequel l'attente a été posée. */
let ecranDAttente: EcranNavigateur | null = null;
/** La pile telle que l'adresse l'écrit — recalculée à chaque changement. */
let pile: string[] = [];
const abonnes = new Set<() => void>();

function recalculer(): void {
  /* L'ordre voulu par l'adresse prime : un tiroir qui s'ouvre plus tôt que son
     parent ne doit pas passer devant lui. Les autres suivent, dans l'ordre où
     ils se sont ouverts. */
  const tous = [...new Set([...ouverts, ...enAttente])];
  const rang = (nom: string) => {
    const i = instantane.voulus.indexOf(nom);
    return i >= 0 ? i : 1000 + tous.indexOf(nom);
  };
  const suivante = [...tous].sort((a, b) => rang(a) - rang(b));
  if (suivante.length === pile.length && suivante.every((nom, i) => nom === pile[i])) return;
  pile = suivante;
  abonnes.forEach((fn) => fn());
}

function notifier(): void {
  abonnes.forEach((fn) => fn());
}

function abonner(fn: () => void): () => void {
  abonnes.add(fn);
  return () => {
    abonnes.delete(fn);
  };
}

/** L'adresse vient d'être lue : elle désigne ces tiroirs, sous cet écran. */
export function appliquerTiroirs(ecran: EcranNavigateur): void {
  const voulus = ecran.tiroirs ?? [];
  /* Ce qui est ouvert et que l'adresse ne désigne plus sort tout de suite de la
     pile : la réécriture de l'adresse ne doit pas le remettre. Le tiroir lui-même
     se referme quand il voit la nouvelle version. */
  ouverts = ouverts.filter((nom) => voulus.includes(nom));
  enAttente = voulus.filter((nom) => !ouverts.includes(nom));
  ecranDAttente = { ...ecran, tiroirs: undefined };
  instantane = { version: instantane.version + 1, voulus };
  pile = [];
  recalculer();
  notifier();
}

/** L'écran sous lequel l'attente a été posée a changé : plus rien à attendre. */
export function oublierLAttenteSiEcranChange(
  ecran: EcranNavigateur,
  memeEcran: (a: EcranNavigateur, b: EcranNavigateur) => boolean,
): void {
  if (!enAttente.length || !ecranDAttente) return;
  if (memeEcran(ecranDAttente, { ...ecran, tiroirs: undefined })) return;
  enAttente = [];
  ecranDAttente = null;
  recalculer();
}

/**
 * La pile des tiroirs que l'adresse doit écrire, du plus bas au plus haut.
 *
 * Elle passe par un état ORDINAIRE et non par `useSyncExternalStore` : celui-ci
 * rend aussitôt, avant les autres états posés dans le même geste — l'adresse
 * lue posait la pile PUIS l'écran, et l'écrivain, qui tombait entre les deux,
 * réécrivait la pile sous l'ancien écran. Posé comme les autres états, il
 * arrive avec eux.
 */
export function usePileDeTiroirs(): string[] {
  const [valeur, setValeur] = React.useState(pile);
  React.useEffect(() => {
    setValeur(pile);
    return abonner(() => setValeur(pile));
  }, []);
  return valeur;
}

function usePremierInstantane(): Instantane {
  return React.useSyncExternalStore(abonner, () => instantane, () => instantane);
}

/**
 * Branche un tiroir sur l'adresse. `nom` : un mot court, unique dans
 * l'application (« acces-clients »). Le plus souvent, on ne l'appelle pas
 * soi-même : on donne `adresse="acces-clients"` au `Drawer`, qui l'appelle. `pret` : les données dont le tiroir a
 * besoin sont-elles arrivées ? Avant, une adresse collée n'ouvre rien.
 */
export function useTiroirAdresse(
  /** Absent : le tiroir n'a pas d'adresse, le crochet ne fait rien. */
  nomDonne: string | null | undefined,
  ouvert: boolean,
  setOuvert: (ouvert: boolean) => void,
  options: { pret?: boolean } = {},
): void {
  const { pret = true } = options;
  const vu = usePremierInstantane();
  const nom = nomDonne ?? '';

  const ouvertRef = React.useRef(ouvert);
  ouvertRef.current = ouvert;
  const setRef = React.useRef(setOuvert);
  setRef.current = setOuvert;

  /* 1. CE QUI EST OUVERT MONTE DANS LA PILE. */
  React.useEffect(() => {
    if (!nom) return;
    if (ouvert) {
      enAttente = enAttente.filter((n) => n !== nom);
      if (!ouverts.includes(nom)) ouverts = [...ouverts, nom];
    } else {
      ouverts = ouverts.filter((n) => n !== nom);
    }
    recalculer();
  }, [ouvert, nom]);
  React.useEffect(
    () => () => {
      if (!nom) return;
      ouverts = ouverts.filter((n) => n !== nom);
      recalculer();
    },
    [nom],
  );

  /* 2. L'ADRESSE DÉSIGNE CE TIROIR : il s'ouvre, une fois ses données là. */
  React.useEffect(() => {
    if (!nom || !pret || ouvertRef.current) return;
    if (enAttente.includes(nom)) setRef.current(true);
  }, [vu.version, pret, nom]);

  /* 3. L'ADRESSE NE LE DÉSIGNE PLUS : il se referme. La version vue au montage
        est ignorée, sinon un tiroir monté APRÈS une lecture d'adresse se
        fermerait avant d'avoir servi. */
  const versionAuMontage = React.useRef(vu.version);
  React.useEffect(() => {
    if (vu.version === versionAuMontage.current) return;
    versionAuMontage.current = vu.version;
    if (!nom) return;
    if (ouvertRef.current && !vu.voulus.includes(nom)) setRef.current(false);
  }, [vu.version, vu.voulus, nom]);
}
