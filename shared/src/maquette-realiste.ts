/**
 * LES MAQUETTES DES AGENTS SONT RÉALISTES (décision de l'utilisateur du 17/11/2026, maquette #e1f4 jugée « beaucoup
 * trop brouillon » : toute l'application rapetissée dans 960×640, textes illisibles, couleurs approchées).
 *
 * Deux moitiés :
 *  - la RÈGLE dite à tout agent qui dispose d'« exemple_de_choix » (sa description, la consigne du cadrage) ;
 *  - ce que l'OUTIL fait de lui-même : il pose en tête de chaque page la vraie police de l'interface et ses jetons de
 *    couleur (`hsl(var(--text))`…), lus dans la feuille de style du produit, pour qu'une maquette ne parte plus d'une
 *    palette devinée ; et il accepte la taille réelle de la zone montrée (`largeur` / `hauteur` d'une piste).
 *
 * Règles pures, sans disque : le serveur lit les fichiers et les passe ici.
 */

export const REGLE_DE_LA_MAQUETTE_REALISTE =
  "MAQUETTE RÉALISTE : pars de l'écran ACTUEL (capture de la page réelle, classes réelles des composants) ; ne montre que la ZONE qui change, à sa TAILLE RÉELLE (« largeur » / « hauteur » de la piste, mêmes tailles de texte que le produit), jamais l'application entière rapetissée ; vrais contenus du projet, jamais de faux texte ni de blocs gris. Dans Beluga, la page reçoit d'office la vraie police et les jetons du thème : écris « hsl(var(--text)) », « hsl(var(--raised)) »… Relis l'image rendue et refais-la si un texte est illisible ou si un élément n'existe pas dans le produit.";

/** Bornes de la taille d'une page de maquette, en pixels CSS (photographiée en double densité). */
export const TAILLE_DE_MAQUETTE = {
  largeur: { min: 240, max: 1600, defaut: 960 },
  hauteur: { min: 120, max: 1400, defaut: 640 },
} as const;

/** La taille demandée par une piste, bornée ; à défaut, 960×640. */
export function tailleDeLaMaquette(largeur: unknown, hauteur: unknown): { largeur: number; hauteur: number } {
  const borne = (valeur: unknown, b: { min: number; max: number; defaut: number }) => {
    const n = typeof valeur === 'number' ? valeur : typeof valeur === 'string' ? Number(valeur) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(Math.min(b.max, Math.max(b.min, n))) : b.defaut;
  };
  return { largeur: borne(largeur, TAILLE_DE_MAQUETTE.largeur), hauteur: borne(hauteur, TAILLE_DE_MAQUETTE.hauteur) };
}

export type ThemeDeMaquette = 'sombre' | 'clair';

/**
 * LES JETONS DE COULEUR D'UN THÈME, lus dans la feuille de style du produit : le bloc `:root {` (sombre, le défaut)
 * puis, pour le clair, `html:not(.dark) {` par-dessus. Seules les déclarations `--nom: valeur;` sur une ligne sont
 * gardées, sans renvoi `var(…)` (une maquette n'a pas les autres jetons).
 */
export function jetonsDuTheme(css: string, theme: ThemeDeMaquette): Record<string, string> {
  const jetons: Record<string, string> = {};
  const lireLeBloc = (ouverture: string) => {
    const debut = css.indexOf(ouverture);
    if (debut < 0) return;
    let profondeur = 0;
    let fin = debut + ouverture.length;
    for (let i = debut + ouverture.length - 1; i < css.length; i += 1) {
      if (css[i] === '{') profondeur += 1;
      else if (css[i] === '}') {
        profondeur -= 1;
        if (profondeur === 0) {
          fin = i;
          break;
        }
      }
    }
    const bloc = css.slice(debut + ouverture.length, fin).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of bloc.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
      const valeur = m[2]!.trim();
      if (!valeur.includes('var(')) jetons[m[1]!] = valeur;
    }
  };
  lireLeBloc(':root {');
  if (theme === 'clair') lireLeBloc('html:not(.dark) {');
  return jetons;
}

/**
 * L'EN-TÊTE POSÉ D'OFFICE DANS UNE PAGE DE MAQUETTE : la police (en données incluses — la page n'a droit à aucune
 * ressource du dehors), les jetons du thème et le fond de page du produit. La page de l'agent passe APRÈS : ce
 * qu'elle écrit l'emporte.
 */
export function enteteDeMaquette(opts: { jetons: Record<string, string>; polices: readonly string[] }): string {
  const faces = opts.polices
    .map((donnees) => `@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;src:url(${donnees}) format('woff2');}`)
    .join('');
  const variables = Object.entries(opts.jetons)
    .map(([nom, valeur]) => `${nom}:${valeur};`)
    .join('');
  return `<style data-style-du-produit>${faces}:root{${variables}}html,body{margin:0;background:hsl(var(--bg));color:hsl(var(--text));font-family:'Inter Variable',Inter,system-ui,sans-serif;font-size:14.5px;-webkit-font-smoothing:antialiased;}</style>`;
}

/** La page de l'agent, l'en-tête du produit posé en tête de son `<head>` (ou en tête de page s'il n'y en a pas). */
export function avecLeStyleDuProduit(html: string, entete: string): string {
  const tete = /<head[^>]*>/i.exec(html);
  if (tete) return html.slice(0, tete.index + tete[0].length) + entete + html.slice(tete.index + tete[0].length);
  const racine = /<html[^>]*>/i.exec(html);
  if (racine) return html.slice(0, racine.index + racine[0].length) + `<head>${entete}</head>` + html.slice(racine.index + racine[0].length);
  return `<!doctype html><html><head><meta charset="utf-8">${entete}</head><body>${html}</body></html>`;
}
