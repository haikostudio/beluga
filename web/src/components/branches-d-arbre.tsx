import * as React from 'react';

/**
 * LES BRANCHES D'ARBORESCENCE DE LA COLONNE DE GAUCHE (demande du 23/11/2026, tracé A, maquette #250b) :
 * un trait vertical en TIRETS descend du milieu bas de l'icône du parent (dossier, projet réuni, projet
 * dont les tâches sont dépliées), un tiret horizontal part vers l'icône de chaque enfant et s'arrête
 * 2 px avant elle, à mi-hauteur ; chez le dernier enfant, le vertical tourne en coude arrondi.
 * Remplace la demande du 31/10/2026 (« plus aucun trait »).
 *
 * LA GÉOMÉTRIE SE MESURE, ELLE NE SE DEVINE PAS : les lignes n'ont pas la même hauteur sur téléphone
 * (43 px) et sur ordinateur (36 px), une tâche a ses filles, une pile d'icônes change de largeur. Le tracé
 * relit donc la position RÉELLE des icônes marquées `data-icone-de-branche` — celle du parent, et la
 * PREMIÈRE de chaque enfant direct du conteneur — et se redessine quand le conteneur change de taille ou
 * de contenu. Un enfant sans icône (« Voir plus ») n'a pas de branche.
 *
 * Posé DANS le conteneur des enfants (qui doit être `relative`) : un SVG absolu, sans pointeur, qui
 * déborde vers le haut jusqu'au parent. Il ne change ni la hauteur des lignes (MEM-2899) ni ce qu'on y
 * clique ou glisse. Couleur `--faint` atténuée : un trait qui porte une information suit `--faint`.
 */

export const ATTRIBUT_ICONE_DE_BRANCHE = 'data-icone-de-branche';

/** Air laissé sous l'icône du parent, et avant l'icône d'un enfant. */
const AIR_SOUS_LE_PARENT = 2;
const AIR_AVANT_L_ENFANT = 2;
const RAYON_DU_COUDE = 5;

/**
 * Règle PURE du tracé : `axe` = x du milieu de l'icône parente, `haut` = y de son bas, `enfants` = pour chaque
 * enfant, le y du milieu de son icône et le x de son bord gauche, tous relatifs au conteneur. Les x sont posés
 * sur un demi-pixel pour un trait net d'un pixel.
 */
export function cheminDesBranches(axe: number, haut: number, enfants: ReadonlyArray<{ y: number; x: number }>): string {
  if (!enfants.length) return '';
  const x0 = Math.round(axe) + 0.5;
  const parts: string[] = [];
  const dernier = enfants[enfants.length - 1]!;
  const yDernier = Math.round(dernier.y) + 0.5;
  const rayon = Math.max(0, Math.min(RAYON_DU_COUDE, yDernier - haut, dernier.x - AIR_AVANT_L_ENFANT - x0));
  parts.push(`M${x0} ${Math.round(haut + AIR_SOUS_LE_PARENT)}V${yDernier - rayon}`);
  parts.push(`Q${x0} ${yDernier} ${x0 + rayon} ${yDernier}H${Math.round(dernier.x - AIR_AVANT_L_ENFANT)}`);
  for (const enfant of enfants.slice(0, -1)) {
    const y = Math.round(enfant.y) + 0.5;
    const fin = Math.round(enfant.x - AIR_AVANT_L_ENFANT);
    if (fin > x0) parts.push(`M${x0} ${y}H${fin}`);
  }
  return parts.join('');
}

/**
 * L'icône d'un enfant : celle qu'il marque, sinon celle d'une ligne d'agent (tâche, mise en ligne), sinon son
 * premier pictogramme (ligne d'un chef de communication). Une fille rangée sous sa mère (`data-filles-de-la-mere`)
 * n'est pas un enfant du projet : elle n'a pas de branche.
 */
function iconeDeLEnfant(enfant: Element): Element | null {
  return (
    enfant.querySelector(`[${ATTRIBUT_ICONE_DE_BRANCHE}]`) ??
    enfant.querySelector('[data-icone-agent-projet]') ??
    enfant.querySelector('svg')
  );
}

export function BranchesDArbre({
  trouverLeParent,
  actif = true,
}: {
  /** L'icône du parent, cherchée depuis le conteneur des enfants (là où le SVG est posé). */
  trouverLeParent: (conteneur: HTMLElement) => Element | null | undefined;
  actif?: boolean;
}) {
  const ref = React.useRef<SVGSVGElement>(null);
  const [trace, setTrace] = React.useState('');
  const trouver = React.useRef(trouverLeParent);
  trouver.current = trouverLeParent;

  React.useLayoutEffect(() => {
    const svg = ref.current;
    const conteneur = svg?.parentElement;
    if (!actif || !svg || !conteneur) return;
    let image = 0;
    const mesurer = () => {
      image = 0;
      const parent = trouver.current(conteneur);
      if (!parent) return setTrace('');
      const boite = conteneur.getBoundingClientRect();
      const iconeParent = parent.getBoundingClientRect();
      const enfants: Array<{ y: number; x: number }> = [];
      for (const enfant of Array.from(conteneur.children)) {
        if (enfant === svg || enfant.matches('[data-filles-de-la-mere], [data-taches-du-projet]')) continue;
        const icone = iconeDeLEnfant(enfant);
        if (!icone) continue;
        const r = icone.getBoundingClientRect();
        if (!r.width) continue;
        enfants.push({ y: r.top + r.height / 2 - boite.top, x: r.left - boite.left });
      }
      const axe = iconeParent.left + iconeParent.width / 2 - boite.left;
      const haut = iconeParent.bottom - boite.top;
      setTrace(cheminDesBranches(axe, haut, enfants));
    };
    const demander = () => {
      if (!image) image = requestAnimationFrame(mesurer);
    };
    mesurer();
    const taille = new ResizeObserver(demander);
    taille.observe(conteneur);
    const contenu = new MutationObserver(demander);
    contenu.observe(conteneur, { childList: true, subtree: true });
    window.addEventListener('resize', demander);
    return () => {
      if (image) cancelAnimationFrame(image);
      taille.disconnect();
      contenu.disconnect();
      window.removeEventListener('resize', demander);
    };
  }, [actif]);

  if (!actif) return null;
  return (
    <svg
      ref={ref}
      aria-hidden
      data-branches-d-arbre={trace ? 'trace' : 'vide'}
      className="pointer-events-none absolute left-0 top-0 z-[1] overflow-visible text-faint opacity-60"
      width={1}
      height={1}
    >
      {trace ? (
        <path d={trace} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 2" strokeLinecap="butt" />
      ) : null}
    </svg>
  );
}
