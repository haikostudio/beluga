/**
 * LA HAUTEUR DE L'APPLICATION INSTALLÉE SUR LE TÉLÉPHONE.
 *
 * Installée, l'application pose sa hauteur à la main (`--hauteur-app`) : au
 * démarrage à froid, `innerHeight` sous-estime l'écran de quelques dizaines de
 * pixels, et le manque se reportait en BANDE VIDE en bas (recette ProjetE et
 * ProjetA, commits da1c2b87 / a9359cb7). On prenait donc la hauteur de l'écran
 * physique. Mais cette mesure peut aussi voir TROP GRAND, et alors le bas de
 * l'interface sort de l'écran — boutons et pied invisibles, rien ne défile
 * (`overflow: hidden`). Deux cas la prennent en défaut :
 *
 *  - LE PAYSAGE : iOS garde `screen.width` et `screen.height` dans l'ordre du
 *    portrait. Tourné, un iPhone Pro Max annonçait 932 pour 430 réellement ;
 *  - UNE FENÊTRE QUI N'EST PAS L'ÉCRAN ENTIER : si le système ne laisse pas
 *    l'application sous la barre d'état et la barre d'accueil, la fenêtre est
 *    plus basse que l'écran de tout ce que ces barres prennent.
 *
 * Une page trop haute coupe le bas (grave) ; une page trop basse laisse une
 * bande vide (disgracieux) : dans le doute, on prend la fenêtre.
 *
 * Règle pure, testable sans navigateur. Rend `null` quand l'application n'est
 * pas installée : la hauteur dynamique du navigateur suffit alors.
 */
export interface MesuresDeLApplication {
  installee: boolean;
  /** `screen.width` / `screen.height`, tels que le système les annonce. */
  ecranLargeur: number;
  ecranHauteur: number;
  /** `window.innerWidth` / `window.innerHeight`. */
  fenetreLargeur: number;
  fenetreHauteur: number;
  /** Les zones sûres résolues en pixels (barre d'état, barre d'accueil). */
  zoneSureHaut: number;
  zoneSureBas: number;
}

/** Ce qu'une mesure peut se tromper sans que la différence soit « une barre du système ». */
const TOLERANCE_PX = 2;

export function hauteurDeLApplication(m: MesuresDeLApplication): number | null {
  if (!m.installee) return null;
  const fenetre = Math.round(m.fenetreHauteur);
  if (!(fenetre > 0)) return null;

  /* L'ORIENTATION SE LIT SUR LA FENÊTRE ; l'écran, lui, donne le grand et le
     petit côté, dans le bon ordre pour cette orientation. */
  const paysage = m.fenetreLargeur > m.fenetreHauteur;
  const cotes = [m.ecranLargeur, m.ecranHauteur].filter((v) => v > 0);
  if (cotes.length < 2) return fenetre;
  const ecran = Math.round(paysage ? Math.min(...cotes) : Math.max(...cotes));

  const manque = ecran - fenetre;
  /* La fenêtre est au moins aussi haute que l'écran annoncé : rien à rattraper. */
  if (manque <= TOLERANCE_PX) return Math.max(fenetre, ecran);

  /* La fenêtre est plus BASSE que l'écran. Deux explications :
     — le démarrage à froid : l'application est bien sous les barres du système
       (les zones sûres existent) et le manque ne dépasse pas ce qu'elles
       prennent → on prend l'écran, c'est la recette de la bande vide ;
     — une fenêtre réellement plus petite (barres non traversées, mode
       fenêtré) → on prend la fenêtre, sinon le bas sort de l'écran. */
  const barres = Math.max(0, m.zoneSureHaut) + Math.max(0, m.zoneSureBas);
  if (barres > 0 && manque <= barres + TOLERANCE_PX) return ecran;
  return fenetre;
}
