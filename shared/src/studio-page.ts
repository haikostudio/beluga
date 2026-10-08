/**
 * TRADUIRE UNE COMPOSITION DU STUDIO EN PAGE HYPERFRAMES.
 *
 * C'est la SEULE traduction : l'aperçu (cadre isolé de l'écran) et l'export
 * (`hyperframes render` sur le serveur) lisent la même page. Seuls changent les
 * adresses des fichiers (relatives dans le dossier de rendu, signées pour
 * l'aperçu) et le petit moteur de lecture ajouté à l'aperçu.
 *
 * Forme attendue par HyperFrames (0.8.134) : une racine `data-composition-id`
 * avec `data-width/height`, des éléments `class="clip"` portant `data-start`,
 * `data-duration`, `data-track-index`, une chronologie GSAP EN PAUSE posée sur
 * `window.__timelines[<id>]`. Les sons sont des `<audio class="clip">`.
 *
 * LE TROISIÈME VERROU : la page porte une politique de contenu qui coupe tout
 * appel réseau (`connect-src 'none'`) et ne charge que ses propres fichiers.
 */
import {
  type Composition,
  type FormatStudio,
  type KitDeMarque,
  type Retouche,
  type Segment,
  type SegmentDessin,
  type SegmentSousTitres,
  type GenreMedia,
  DUREE_TRANSITION_STUDIO,
  FORMATS_STUDIO,
  debutMediaDe,
  dureeExportee,
  groupesDeSousTitres,
  vitesseDe,
} from './studio.js';
import { cantonnerCss, porteeDuSegment } from './studio-dessin.js';
import { MARGE_SECURITE_STUDIO } from './studio-ancres.js';

/** L'identifiant de composition attendu par HyperFrames. */
export const ID_COMPOSITION_STUDIO = 'main';

/**
 * LES POLICES EMBARQUÉES (licence SIL OFL, fichiers dans `outils/studio-polices`).
 * Un dessin ne s'appuie que sur elles : celles du poste différeraient entre
 * l'aperçu et l'export.
 */
export const POLICES_STUDIO: readonly { famille: string; fichier: string; genre: string }[] = [
  { famille: 'Inter', fichier: 'inter.woff2', genre: 'sans' },
  { famille: 'Montserrat', fichier: 'montserrat.woff2', genre: 'sans' },
  { famille: 'Space Grotesk', fichier: 'space-grotesk.woff2', genre: 'sans' },
  { famille: 'Playfair Display', fichier: 'playfair-display.woff2', genre: 'serif' },
  { famille: 'Bebas Neue', fichier: 'bebas-neue.woff2', genre: 'titre' },
  { famille: 'Caveat', fichier: 'caveat.woff2', genre: 'manuscrite' },
  { famille: 'JetBrains Mono', fichier: 'jetbrains-mono.woff2', genre: 'mono' },
];

export interface MediaPourLaPage {
  url: string;
  genre: GenreMedia;
}

export interface OptionsDeTraduction {
  format: FormatStudio;
  kit?: KitDeMarque;
  /** mediaId → adresse du fichier, telle que la page la lira. */
  medias: Record<string, MediaPourLaPage>;
  /** L'adresse de GSAP (« gsap.min.js » dans le dossier de rendu). */
  gsap: string;
  /** L'adresse du dossier des polices (« polices/ » dans le dossier de rendu). */
  polices: string;
  mode: 'apercu' | 'rendu';
  /**
   * Aperçu : les sources permises en plus (l'origine de l'application, chemins
   * des fichiers du studio). Le cadre a une origine opaque : `'self'` n'y vaut rien.
   */
  sourcesApercu?: { scripts: string; medias: string; polices: string };
  /** Aperçu : le moteur de lecture, ajouté après la chronologie. */
  moteurApercu?: string;
}

function echapperHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Un JSON posé dans une balise <script> ne doit jamais pouvoir la refermer. */
function jsonDansScript(valeur: unknown): string {
  return JSON.stringify(valeur).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function chiffre(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * LES RETOUCHES QUI VALENT POUR UN FORMAT : celles de base, puis celles du
 * format qui les surchargent.
 *
 * DANS UN AUTRE FORMAT que celui de la composition, un décalage de base suit le
 * cadre : en PROPORTION sur un axe libre (x × largeur'/largeur), tel quel sur
 * un axe ANCRÉ — la page recale alors la pièce sur son repère (`recalerAncres`
 * dans la chronologie). Une position posée DANS ce format l'emporte toujours,
 * et un axe qu'elle place sans ancre y devient libre. Le format de base, lui,
 * ne bouge jamais d'un pixel.
 */
export function retouchesDuFormat(segment: Segment, format: FormatStudio, formatDeBase: FormatStudio): Record<string, Retouche> {
  const base = segment.retouches ?? {};
  if (format === formatDeBase) return base;
  const avant = FORMATS_STUDIO[formatDeBase];
  const apres = FORMATS_STUDIO[format];
  const propres = segment.surcharges?.[format]?.retouches ?? {};
  const sortie: Record<string, Retouche> = {};
  for (const [cle, r] of Object.entries(base)) {
    const c: Retouche = { ...r };
    if (r.x && !r.ancre?.h) c.x = Math.round((r.x * apres.largeur) / avant.largeur);
    if (r.y && !r.ancre?.v) c.y = Math.round((r.y * apres.hauteur) / avant.hauteur);
    // LA TAILLE DU CADRE suit le cadre de la vidéo, comme un décalage libre ; la police ne bouge pas.
    if (r.largeur) c.largeur = Math.max(4, Math.round((r.largeur * apres.largeur) / avant.largeur));
    if (r.hauteur) c.hauteur = Math.max(4, Math.round((r.hauteur * apres.hauteur) / avant.hauteur));
    sortie[cle] = c;
  }
  for (const [cle, r] of Object.entries(propres)) {
    const fusion: Retouche = { ...(sortie[cle] ?? {}), ...r };
    if (!r.ancre && fusion.ancre) {
      // Un axe placé à la main dans CE format, sans ancre, n'est plus collé au repère de base.
      const ancre = { ...fusion.ancre };
      if (r.x !== undefined) delete ancre.h;
      if (r.y !== undefined) delete ancre.v;
      if (ancre.h || ancre.v) fusion.ancre = ancre;
      else delete fusion.ancre;
    }
    sortie[cle] = fusion;
  }
  return sortie;
}

const ALIGNEMENTS_CSS: Record<string, string> = { gauche: 'left', centre: 'center', droite: 'right', justifie: 'justify' };

function regleDeRetouche(portee: string, elementId: string, r: Retouche): string {
  const decl: string[] = [];
  /* LA RETOUCHE SE COMPOSE AVEC LE MOUVEMENT, ELLE NE S'Y ADDITIONNE PAS DEUX FOIS.
     Quand GSAP lit une pièce pour la première fois, il ABSORBE les propriétés
     `translate`, `rotate` et `scale` qu'il trouve dans sa propre `transform`
     (puis les remet à `none` en ligne) : une retouche déjà active serait
     comptée deux fois. Les règles ne valent donc qu'une fois la chronologie
     construite (`#root.studio-retouches`, posé par `CHRONOLOGIE` APRÈS avoir
     fait lire chaque pièce à GSAP) ; `!important` les garde devant un `none`
     posé en ligne par la suite. */
  if (r.x || r.y) decl.push(`translate:${chiffre(r.x ?? 0)}px ${chiffre(r.y ?? 0)}px !important`);
  if (r.rotation) decl.push(`rotate:${chiffre(r.rotation)}deg !important`);
  if (r.echelle !== undefined && r.echelle !== 1) decl.push(`scale:${chiffre(r.echelle)} !important`);
  if (r.opacite !== undefined && r.opacite < 1) decl.push(`filter:opacity(${chiffre(r.opacite)})`);
  if (r.couleur) decl.push(`color:${r.couleur} !important`, `fill:${r.couleur} !important`);
  if (r.fond) decl.push(`background-color:${r.fond} !important`);
  /* LE CADRE D'UN TEXTE : sa largeur (et sa hauteur) changent, la police reste la même et le
     texte se réenroule dedans. Les plafonds posés par le dessin (`max-width`) ne le brident plus. */
  if (r.largeur) decl.push(`width:${chiffre(r.largeur)}px !important`, 'max-width:none !important', 'box-sizing:border-box !important');
  if (r.hauteur) decl.push(`height:${chiffre(r.hauteur)}px !important`, 'max-height:none !important');
  // UNE IMAGE DONT LE CADRE CHANGE s'y RECADRE (elle remplit le cadre), elle ne se déforme jamais. Sans effet hors image.
  if (r.largeur || r.hauteur) decl.push('object-fit:cover !important');
  if (r.alignement && ALIGNEMENTS_CSS[r.alignement]) decl.push(`text-align:${ALIGNEMENTS_CSS[r.alignement]} !important`);
  /* LE CONTOUR est un trait INTÉRIEUR (outline ramené dedans) : il ne change ni la taille ni la place de la
     pièce, suit son arrondi, et vaut aussi sur une image. Mêmes déclarations dans le moteur d'aperçu (`peindre`). */
  if (r.epaisseurContour !== undefined || r.contour) {
    const ep = r.epaisseurContour ?? 0;
    decl.push(ep > 0 ? `outline:${chiffre(ep)}px solid ${r.contour ?? 'currentColor'} !important` : 'outline:none !important', `outline-offset:${chiffre(-ep)}px !important`);
  }
  if (r.arrondi !== undefined) decl.push(`border-radius:${chiffre(r.arrondi)}px !important`);
  if (r.taillePolice) decl.push(`font-size:${chiffre(r.taillePolice)}px !important`);
  // Les retours à la ligne écrits à la main se voient, à l'aperçu comme à l'export.
  if (typeof r.texte === 'string' && r.texte.includes('\n')) decl.push('white-space:pre-wrap !important');
  // UN CALQUE MASQUÉ garde sa place (les voisins ne bougent pas) mais ne se voit plus, ni dans l'aperçu ni dans l'export.
  if (r.masquee) decl.push('visibility:hidden !important', 'opacity:0 !important');
  if (!decl.length) return '';
  const cible = `[data-studio-id="${elementId}"]`;
  // Actives seulement une fois la chronologie construite (classe posée par `CHRONOLOGIE`).
  return `#root.studio-retouches ${portee} ${cible},#root.studio-retouches ${portee}${cible}{${decl.join(';')}}`;
}

/**
 * LA VITESSE ET LES FONDUS D'UN SON OU D'UNE VIDÉO, lus par HyperFrames au rendu
 * (`data-playback-rate`, `data-fade-in`, `data-fade-out`) ET par le moteur de
 * l'aperçu : une seule écriture pour les deux.
 */
function vitesseEtFondus(segment: Segment): string {
  const vitesse = vitesseDe(segment);
  const fondus = segment.genre === 'audio' || segment.genre === 'video' ? segment : null;
  return (
    (vitesse !== 1 ? ` data-playback-rate="${chiffre(vitesse)}"` : '') +
    (fondus?.fonduEntree ? ` data-fade-in="${chiffre(fondus.fonduEntree)}"` : '') +
    (fondus?.fonduSortie ? ` data-fade-out="${chiffre(fondus.fonduSortie)}"` : '')
  );
}

/** Remplace les `studio-media:<id>` d'un fragment par l'adresse du fichier. */
function brancherMedias(html: string, medias: Record<string, MediaPourLaPage>): string {
  return html.replace(/studio-media:([a-zA-Z][\w-]{0,63})/g, (_, id: string) => medias[id]?.url ?? '');
}

function policeDeFamille(famille: string | undefined, repli: string): string {
  if (!famille) return repli;
  const connue = POLICES_STUDIO.find((p) => p.famille.toLowerCase() === famille.toLowerCase());
  return connue ? `'${connue.famille}', ${repli}` : repli;
}

export interface DonneesDeLaPage {
  duree: number;
  largeur: number;
  hauteur: number;
  segments: {
    id: string;
    genre: string;
    debut: number;
    duree: number;
    entree: string;
    sortie: string;
    /** Dessin : valeurs et types des paramètres. */
    parametres?: { id: string; type: string; valeur: unknown; unite?: string }[];
    /** Les textes retouchés à la main, posés avant la chronologie. */
    textes?: Record<string, string>;
    /** Sous-titres : groupes et mots. */
    groupes?: { debut: number; fin: number; mots: { debut: number; fin: number }[] }[];
    accent?: string;
    couleur?: string;
  }[];
  /** L'aperçu sait où en sont les retouches pour poursuivre un geste. */
  retouches: Record<string, Record<string, Retouche>>;
  /** Le plan des pièces (panneau « Calques ») : segment → pièce → plan, appliqué en réordonnant les sœurs. */
  plans: Record<string, Record<string, number>>;
  /** Les pièces ANCRÉES à un repère, recalées par la page une fois mesurées (aperçu ET export). */
  ancres: { seg: string; el: string; h?: string; v?: string; t: number }[];
  /** La marge de sécurité, en part de la dimension (`MARGE_SECURITE_STUDIO`). */
  marge: number;
  medias: Record<string, string>;
}

/**
 * LA PAGE ENTIÈRE. Les pistes sont posées du fond vers l'avant : la première
 * piste de la ligne de temps recouvre les autres.
 */
export function traduireEnPage(composition: Composition, options: OptionsDeTraduction): string {
  const { largeur, hauteur } = FORMATS_STUDIO[options.format];
  // LE MARQUEUR BLEU COUPE : la page dure la durée voulue, ce qui commence après n'existe pas.
  const duree = dureeExportee(composition);
  const kit = options.kit ?? {};
  const pistes = composition.pistes;
  const corps: string[] = [];
  const styles: string[] = [];
  const animations: string[] = [];
  const donnees: DonneesDeLaPage = { duree, largeur, hauteur, segments: [], retouches: {}, plans: {}, ancres: [], marge: MARGE_SECURITE_STUDIO, medias: {} };
  for (const [id, m] of Object.entries(options.medias)) donnees.medias[id] = m.url;

  pistes.forEach((piste, rang) => {
    const z = (pistes.length - rang) * 10;
    if (piste.masquee && piste.genre !== 'son') return;
    if (piste.muette && piste.genre === 'son') return;
    for (const segment of piste.segments) {
      if (segment.debut >= duree - 0.001) continue;
      const portee = porteeDuSegment(segment.id);
      // Un segment qui déborde du marqueur est coupé net ; ses animations gardent leurs temps (la sortie n'est jamais vue).
      const visible = Math.min(segment.duree, duree - segment.debut);
      const temps = `data-start="${chiffre(segment.debut)}" data-duration="${chiffre(visible)}" data-track-index="${rang}"`;
      const retouches = retouchesDuFormat(segment, options.format, composition.format);
      donnees.retouches[segment.id] = retouches;
      const plans: Record<string, number> = {};
      for (const [elementId, r] of Object.entries(retouches)) if (r.plan) plans[elementId] = r.plan;
      if (Object.keys(plans).length) donnees.plans[segment.id] = plans;
      for (const [elementId, r] of Object.entries(retouches)) {
        if (!r.ancre || (!r.ancre.h && !r.ancre.v)) continue;
        const instant = segment.debut + Math.min(Math.max(0, r.ancre.t ?? 0), Math.max(0, visible - 0.01));
        donnees.ancres.push({ seg: segment.id, el: elementId, ...(r.ancre.h ? { h: r.ancre.h } : {}), ...(r.ancre.v ? { v: r.ancre.v } : {}), t: Math.round(instant * 1000) / 1000 });
      }
      for (const [elementId, r] of Object.entries(retouches)) {
        const regle = regleDeRetouche(portee, elementId, r);
        if (regle) styles.push(regle);
      }
      const textes: Record<string, string> = {};
      for (const [elementId, r] of Object.entries(retouches)) if (typeof r.texte === 'string') textes[elementId] = r.texte;
      const commun = {
        id: segment.id,
        genre: segment.genre,
        debut: segment.debut,
        duree: segment.duree,
        entree: segment.entree ?? 'aucune',
        sortie: segment.sortie ?? 'aucune',
        ...(Object.keys(textes).length ? { textes } : {}),
      };

      switch (segment.genre) {
        case 'dessin': {
          const d = segment as SegmentDessin;
          const variables = d.parametres
            .filter((p) => p.type === 'couleur' || p.type === 'nombre' || p.type === 'bascule')
            .map((p) => {
              const v = d.valeurs[p.id] ?? p.defaut;
              const valeur = p.type === 'nombre' ? `${chiffre(Number(v))}${p.unite ?? ''}` : p.type === 'bascule' ? (v ? '1' : '0') : String(v);
              return `--p-${p.id}:${valeur.replace(/[;{}<>"]/g, '')}`;
            });
          corps.push(
            `<div class="clip studio-seg" id="seg-${d.id}" data-seg="${d.id}" ${temps} style="z-index:${z};${variables.join(';')}">${brancherMedias(d.gabarit.html, options.medias)}</div>`,
          );
          if (d.gabarit.css.trim()) styles.push(cantonnerCss(brancherMedias(d.gabarit.css, options.medias), portee));
          if (d.gabarit.animation.trim()) {
            animations.push(
              `<script data-anim="${d.id}">window.__studioAnim=window.__studioAnim||{};window.__studioAnim[${JSON.stringify(d.id)}]=function(tl,el,p,studio){\n${d.gabarit.animation}\n};</script>`,
            );
          }
          donnees.segments.push({
            ...commun,
            parametres: d.parametres.map((p) => ({ id: p.id, type: p.type, valeur: d.valeurs[p.id] ?? p.defaut, ...(p.unite ? { unite: p.unite } : {}) })),
          });
          break;
        }
        case 'texte': {
          const police = policeDeFamille(segment.police, 'var(--marque-police-titre)');
          corps.push(
            `<div class="clip studio-seg" id="seg-${segment.id}" data-seg="${segment.id}" ${temps} style="z-index:${z}">` +
              `<div data-studio-id="texte" class="studio-texte" style="left:${chiffre(segment.position.x)}%;top:${chiffre(segment.position.y)}%;font-size:${chiffre(segment.taille)}px;color:${segment.couleur};font-weight:${segment.gras ? 800 : 500};font-family:${police}">${echapperHtml(segment.texte)}</div></div>`,
          );
          donnees.segments.push(commun);
          break;
        }
        case 'image': {
          const m = options.medias[segment.mediaId];
          corps.push(
            `<div class="clip studio-seg" id="seg-${segment.id}" data-seg="${segment.id}" ${temps} style="z-index:${z}">` +
              (m ? `<img data-studio-id="image" class="studio-media" alt="" src="${echapperHtml(m.url)}" style="object-fit:${segment.ajustement === 'contenir' ? 'contain' : 'cover'}">` : '') +
              `</div>`,
          );
          donnees.segments.push(commun);
          break;
        }
        case 'video': {
          const m = options.medias[segment.mediaId];
          if (!m) break;
          corps.push(
            `<video class="clip studio-seg studio-media" id="seg-${segment.id}" data-seg="${segment.id}" data-studio-id="video" ${temps} data-media-start="${chiffre(segment.debutMedia)}"${vitesseEtFondus(segment)} ` +
              (segment.volume > 0 ? `data-volume="${chiffre(segment.volume)}" data-has-audio="true"` : 'muted') +
              ` playsinline preload="auto" src="${echapperHtml(m.url)}" style="z-index:${z};object-fit:${segment.ajustement === 'contenir' ? 'contain' : 'cover'}"></video>`,
          );
          donnees.segments.push(commun);
          break;
        }
        case 'audio':
        case 'voix': {
          const mediaId = segment.mediaId;
          const m = mediaId ? options.medias[mediaId] : undefined;
          if (!m) break;
          const debutMedia = debutMediaDe(segment);
          // Une voix s'arrête où s'arrête son son (passage et vitesse compris), même si son bloc garde un souffle.
          const restant = segment.genre === 'voix' && segment.dureeAudio ? Math.max(0, segment.dureeAudio - debutMedia) / vitesseDe(segment) : Infinity;
          const dureeSon = Math.min(segment.duree, restant, visible);
          corps.push(
            `<audio class="clip" id="seg-${segment.id}" data-seg="${segment.id}" data-start="${chiffre(segment.debut)}" data-duration="${chiffre(dureeSon)}" data-track-index="${rang}" data-media-start="${chiffre(debutMedia)}" data-volume="${chiffre(segment.volume)}"${vitesseEtFondus(segment)} preload="auto" src="${echapperHtml(m.url)}"></audio>`,
          );
          donnees.segments.push({ ...commun, duree: dureeSon });
          break;
        }
        case 'sous-titres': {
          const s = segment as SegmentSousTitres;
          const groupes = groupesDeSousTitres(s.mots, s.motsParGroupe);
          const blocs = groupes
            .map(
              (g, k) =>
                `<div class="studio-st-groupe" data-groupe="${k}">${g.mots.map((m, q) => `<span class="studio-st-mot" data-mot="${q}">${echapperHtml(m.texte)}</span>`).join(' ')}</div>`,
            )
            .join('');
          const haut = s.style.position === 'haut' ? '14%' : s.style.position === 'milieu' ? '50%' : '78%';
          corps.push(
            `<div class="clip studio-seg studio-st studio-st-${s.style.fond}" id="seg-${s.id}" data-seg="${s.id}" ${temps} style="z-index:${z + 5};--st-haut:${haut};--st-taille:${chiffre(s.style.taille)}px;--st-couleur:${s.style.couleur};--st-accent:${s.style.accent}"><div data-studio-id="sous-titres" class="studio-st-cadre">${blocs}</div></div>`,
          );
          donnees.segments.push({
            ...commun,
            groupes: groupes.map((g) => ({ debut: g.debut, fin: g.fin, mots: g.mots.map((m) => ({ debut: m.debut, fin: m.fin })) })),
            accent: s.style.accent,
            couleur: s.style.couleur,
          });
          break;
        }
      }
    }
  });

  const polices = POLICES_STUDIO.map(
    (p) => `@font-face{font-family:'${p.famille}';src:url('${options.polices}${p.fichier}') format('woff2');font-weight:100 900;font-style:normal;font-display:block}`,
  ).join('\n');

  const csp =
    options.mode === 'rendu'
      ? "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
      : `default-src 'none'; script-src 'unsafe-inline' ${options.sourcesApercu?.scripts ?? ''}; style-src 'unsafe-inline'; img-src data: blob: ${options.sourcesApercu?.medias ?? ''}; media-src data: blob: ${options.sourcesApercu?.medias ?? ''}; font-src data: ${options.sourcesApercu?.polices ?? ''}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;

  const variablesDeMarque = [
    `--marque-primaire:${kit.primaire ?? '#5b8cff'}`,
    `--marque-secondaire:${kit.secondaire ?? '#20c997'}`,
    `--marque-accent:${kit.accent ?? '#ffd23f'}`,
    `--marque-fond:${kit.fond ?? composition.fond}`,
    `--marque-texte:${kit.texte ?? '#ffffff'}`,
    `--marque-police-titre:${policeDeFamille(kit.policeTitre, "'Montserrat', sans-serif")}`,
    `--marque-police-texte:${policeDeFamille(kit.policeTexte, "'Inter', sans-serif")}`,
  ]
    .map((v) => v.replace(/[;{}<>"]/g, ''))
    .join(';');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=${largeur}, height=${hauteur}" />
<script src="${echapperHtml(options.gsap)}"></script>
<style>
${polices}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${largeur}px;height:${hauteur}px;overflow:hidden;background:${composition.fond}}
#root{position:relative;width:${largeur}px;height:${hauteur}px;overflow:hidden;background:${composition.fond};${variablesDeMarque};font-family:var(--marque-police-texte);color:var(--marque-texte)}
.studio-seg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;container-type:size;pointer-events:none}
.studio-seg [data-studio-id],.studio-seg[data-studio-id],.studio-st-groupe{pointer-events:auto}
.studio-media{position:absolute;left:0;top:0;width:100%;height:100%}
.studio-texte{position:absolute;transform:translate(-50%,-50%);text-align:center;line-height:1.1;max-width:90%;white-space:pre-wrap}
.studio-st-cadre{position:absolute;left:5%;right:5%;top:var(--st-haut);transform:translateY(-50%);height:0}
.studio-st-groupe{position:absolute;left:0;right:0;top:0;transform:translateY(-50%);text-align:center;font-family:var(--marque-police-titre);font-weight:800;font-size:var(--st-taille);line-height:1.1;color:var(--st-couleur);visibility:hidden;opacity:0}
.studio-st-ombre .studio-st-groupe{text-shadow:0 4px 18px rgba(0,0,0,.55),0 2px 4px rgba(0,0,0,.6)}
.studio-st-bande .studio-st-groupe span{background:rgba(0,0,0,.62);padding:.05em .2em;border-radius:.15em}
${styles.join('\n')}
</style>
</head>
<body>
<div id="root" data-composition-id="${ID_COMPOSITION_STUDIO}" data-start="0" data-duration="${chiffre(duree)}" data-width="${largeur}" data-height="${hauteur}">
${[...corps].reverse().join('\n')}
</div>
<script id="studio-donnees" type="application/json">${jsonDansScript(donnees)}</script>
${animations.join('\n')}
<script>${CHRONOLOGIE}</script>
${options.mode === 'apercu' && options.moteurApercu ? `<script>${options.moteurApercu}</script>` : ''}
</body>
</html>`;
}

/**
 * LA CHRONOLOGIE COMMUNE, jouée dans la page. Paramètres et textes retouchés
 * d'abord, puis chaque segment : sa recette d'entrée et de sortie, l'animation
 * du dessin (dans un filet : une erreur n'éteint jamais les autres segments),
 * les sous-titres mot à mot. Tout est posé sur UNE chronologie en pause, que
 * HyperFrames (ou le moteur de l'aperçu) déplace à la seconde près.
 */
const CHRONOLOGIE = `(function(){
var D=JSON.parse(document.getElementById('studio-donnees').textContent);
window.__studioErreurs=[];
function erreur(m){window.__studioErreurs.push(m);try{console.error('[studio] '+m);}catch(x){}}
var T=${DUREE_TRANSITION_STUDIO};
var tl=gsap.timeline({paused:true});
function q(seg,sel){return Array.prototype.slice.call(seg.querySelectorAll(sel));}
/* GSAP lit chaque pièce AVANT que les retouches ne s'appliquent : il garde cette lecture en cache. */
Array.prototype.forEach.call(document.querySelectorAll('#root [data-studio-id],#root [data-seg]'),function(n){try{gsap.getProperty(n,'x');}catch(e){}});
var RECETTES={
 'fondu':[{opacity:0},{opacity:1}],
 'glisse-haut':[{yPercent:14,opacity:0,filter:'blur(10px)'},{yPercent:0,opacity:1,filter:'blur(0px)'}],
 'glisse-bas':[{yPercent:-14,opacity:0,filter:'blur(10px)'},{yPercent:0,opacity:1,filter:'blur(0px)'}],
 'glisse-gauche':[{xPercent:14,opacity:0,filter:'blur(10px)'},{xPercent:0,opacity:1,filter:'blur(0px)'}],
 'glisse-droite':[{xPercent:-14,opacity:0,filter:'blur(10px)'},{xPercent:0,opacity:1,filter:'blur(0px)'}],
 'zoom':[{scale:0.86,opacity:0},{scale:1,opacity:1}],
 'flou':[{filter:'blur(24px)',opacity:0},{filter:'blur(0px)',opacity:1}]
};
function copie(o){var r={};for(var k in o)r[k]=o[k];return r;}
/* LE PLAN DES CALQUES : les pièces sœurs sont réordonnées (stable) avant que GSAP ne les lise.
   L'ordre du document est l'ordre de peinture, en HTML comme en SVG. Un parent qui mêle du texte
   à ses pièces n'est pas touché : on ne casse pas une phrase. */
Object.keys(D.plans||{}).forEach(function(segId){
 var seg=document.getElementById('seg-'+segId);if(!seg)return;var P=D.plans[segId];var parents=[];
 Object.keys(P).forEach(function(id){q(seg,'[data-studio-id="'+id+'"]').forEach(function(n){if(n.parentNode&&parents.indexOf(n.parentNode)<0)parents.push(n.parentNode);});});
 parents.forEach(function(par){
  var texte=Array.prototype.some.call(par.childNodes,function(n){return n.nodeType===3&&n.textContent.trim();});
  if(texte)return;
  var enfants=Array.prototype.slice.call(par.children).map(function(n,i){var id=n.getAttribute('data-studio-id');return {n:n,i:i,p:(id&&P[id])||0};});
  enfants.sort(function(a,b){return a.p-b.p||a.i-b.i;}).forEach(function(c){par.appendChild(c.n);});
 });
});
D.segments.forEach(function(s){
 var el=document.getElementById('seg-'+s.id);
 if(!el)return;
 try{
  (s.parametres||[]).forEach(function(p){
   q(el,'[data-param="'+p.id+'"]').forEach(function(n){if(p.type!=='media')n.textContent=String(p.valeur);});
   q(el,'[data-param-show="'+p.id+'"]').forEach(function(n){n.style.display=p.valeur?'':'none';});
   q(el,'[data-param-src="'+p.id+'"]').forEach(function(n){var u=D.medias[String(p.valeur)];if(u)n.setAttribute(n.tagName.toLowerCase()==='image'?'href':'src',u);});
  });
  var textes=s.textes||{};
  Object.keys(textes).forEach(function(id){q(el,'[data-studio-id="'+id+'"]').forEach(function(n){n.textContent=textes[id];});});
 }catch(e){erreur(s.id+' : '+e.message);}
 var dans=RECETTES[s.entree], hors=RECETTES[s.sortie];
 if(dans&&s.duree>T){var a=copie(dans[1]);a.duration=T;a.ease='power3.out';tl.fromTo(el,copie(dans[0]),a,s.debut);}
 if(hors&&s.duree>2*T){var b=copie(hors[0]);b.duration=T;b.ease='power3.in';b.immediateRender=false;tl.fromTo(el,copie(hors[1]),b,s.debut+s.duree-T);}
 if(s.genre==='dessin'&&window.__studioAnim&&window.__studioAnim[s.id]){
  var p={};(s.parametres||[]).forEach(function(x){p[x.id]=x.valeur;});
  var local=gsap.timeline();
  try{window.__studioAnim[s.id](local,el,p,{largeur:D.largeur,hauteur:D.hauteur,duree:s.duree,q:function(sel){return q(el,sel);}});tl.add(local,s.debut);}
  catch(e){erreur(s.id+' : '+e.message);}
 }else if(s.genre==='dessin'&&document.querySelector('script[data-anim="'+s.id+'"]')){erreur(s.id+' : animation illisible');}
 if(s.genre==='sous-titres'){
  q(el,'.studio-st-groupe').forEach(function(g,k){
   var G=s.groupes[k];if(!G)return;
   tl.set(g,{visibility:'visible',opacity:1},G.debut);
   tl.fromTo(g,{scale:0.92},{scale:1,duration:0.12,ease:'power2.out',immediateRender:false},G.debut);
   tl.set(g,{visibility:'hidden',opacity:0},G.fin);
   q(g,'.studio-st-mot').forEach(function(m,i){var M=G.mots[i];if(!M)return;tl.set(m,{color:s.accent},M.debut);tl.set(m,{color:s.couleur},Math.max(M.fin,M.debut+0.05));});
  });
 }
});
document.getElementById('root').classList.add('studio-retouches');
/* LES PIÈCES ANCRÉES À UN REPÈRE (bord, marge de sécurité, centre) : mesurées à l'instant où elles
   ont été posées, puis décalées pour que leur bord retombe sur le repère dans CE cadre. Même géométrie
   que \`ligneDAncre\` (studio-ancres.ts). Rejoué une fois les polices chargées : un texte n'a sa vraie
   largeur qu'à ce moment-là. */
function ligne(a,d){
 if(a==='gauche'||a==='haut')return {p:0,b:0};
 if(a==='marge-gauche'||a==='marge-haut')return {p:Math.round(d*D.marge),b:0};
 if(a==='centre')return {p:d/2,b:1};
 if(a==='marge-droite'||a==='marge-bas')return {p:Math.round(d*(1-D.marge)),b:2};
 return {p:d,b:2};
}
function recalerAncres(){
 if(!D.ancres||!D.ancres.length)return;
 var avant=tl.totalTime();
 D.ancres.forEach(function(a){
  try{
   var seg=document.getElementById('seg-'+a.seg);if(!seg)return;
   var n=seg.matches('[data-studio-id="'+a.el+'"]')?seg:seg.querySelector('[data-studio-id="'+a.el+'"]');if(!n)return;
   tl.totalTime(a.t,false);
   var b=n.getBoundingClientRect();if(!b.width&&!b.height)return;
   var R=(D.retouches[a.seg]=D.retouches[a.seg]||{});var r=(R[a.el]=R[a.el]||{});var x=r.x||0,y=r.y||0;
   if(a.h){var L=ligne(a.h,D.largeur);x=Math.round(x+L.p-(L.b===0?b.left:L.b===1?b.left+b.width/2:b.right));}
   if(a.v){var V=ligne(a.v,D.hauteur);y=Math.round(y+V.p-(V.b===0?b.top:V.b===1?b.top+b.height/2:b.bottom));}
   r.x=x;r.y=y;n.style.setProperty('translate',x+'px '+y+'px','important');
  }catch(e){erreur(a.seg+' : '+e.message);}
 });
 tl.totalTime(avant,false);
}
recalerAncres();
if(D.ancres&&D.ancres.length){
 var apres=function(){recalerAncres();if(window.__studioApresRecalage)window.__studioApresRecalage();};
 if(document.fonts&&document.fonts.ready)document.fonts.ready.then(apres);
 window.addEventListener('load',apres);
}
window.__timelines=window.__timelines||{};
window.__timelines[${JSON.stringify(ID_COMPOSITION_STUDIO)}]=tl;
window.__studioDonnees=D;
tl.seek(0);
})();`;

/**
 * LE MOTEUR DE L'APERÇU — joué SEULEMENT dans le cadre isolé de l'écran.
 *
 * Il remplace le moteur d'HyperFrames : visibilité des segments selon le temps,
 * lecture des sons, chronologie déplacée. Il porte aussi les GESTES à la main :
 * cliquer une pièce la sélectionne, la tirer la déplace, ses poignées
 * l'agrandissent ou la tournent, un double-clic édite son texte. Chaque geste
 * terminé part au parent en message (`postMessage`) : c'est le parent qui en
 * fait une RETOUCHE, jamais le cadre.
 */
export const MOTEUR_APERCU_STUDIO = `(function(){
var D=window.__studioDonnees, tl=window.__timelines&&window.__timelines.main;
if(!D||!tl){parent.postMessage({studio:1,type:'erreurs',liste:['la chronologie ne s’est pas construite']},'*');return;}
var t=0, lecture=false, base=0, origine=0, muet=false, rafId=0;
var clips=Array.prototype.slice.call(document.querySelectorAll('#root [data-start]'));
function dire(m){m.studio=1;parent.postMessage(m,'*');}
function nb(c,a){return parseFloat(c.getAttribute(a))||0;}
/* UN PASSAGE : où un média joue dans la composition, et d'où il part dans son fichier. LA VITESSE ET LES FONDUS sont lus
   sur les MÊMES attributs que le rendu : temps du fichier = (t - début) × vitesse + départ. */
function passage(c){var d=nb(c,'data-start');return {c:c,d:d,f:d+nb(c,'data-duration'),v:nb(c,'data-playback-rate')||1,ms:nb(c,'data-media-start'),fi:nb(c,'data-fade-in'),fo:nb(c,'data-fade-out'),vol:parseFloat(c.getAttribute('data-volume')||'1'),muet:c.hasAttribute('muted')};}
/* UN LECTEUR PAR FICHIER, PAS PAR PASSAGE. La voix finale est UNE prise découpée en phrases (six blocs, un fichier) :
   avec un lecteur par bloc, l'iPhone et l'iPad refusaient tout son lancé par la boucle d'images, hors du geste — seule
   la phrase lancée juste après l'appui s'entendait. Les sons d'un même fichier qui ne se chevauchent pas partagent donc
   UN élément, débloqué une fois (voir debloquer) puis promené de passage en passage ; deux passages qui se chevauchent
   (une musique posée deux fois) gardent chacun le leur. Les autres balises perdent leur source : la page de RENDU, elle,
   garde ses balises par segment (HyperFrames les lit telles quelles). */
var lecteurs=[], sons=window.__studioSons={lectures:0,refus:0,sauts:0,sautsRates:0};
(function(){
 var parFichier={};
 clips.forEach(function(c){if(c.tagName!=='AUDIO')return;var s=c.getAttribute('src')||'';(parFichier[s]=parFichier[s]||[]).push(passage(c));});
 Object.keys(parFichier).forEach(function(s){
  var deCeFichier=[];
  parFichier[s].sort(function(a,b){return a.d-b.d;}).forEach(function(p){
   for(var i=0;i<deCeFichier.length;i++){var q=deCeFichier[i].passages;if(q[q.length-1].f<=p.d+0.001){q.push(p);return;}}
   deCeFichier.push({el:p.c,passages:[p]});
  });
  lecteurs=lecteurs.concat(deCeFichier);
 });
 lecteurs.forEach(function(L){L.el.setAttribute('data-lecteur',String(L.passages.length));L.passages.forEach(function(p){if(p.c!==L.el){p.c.removeAttribute('src');p.c.preload='none';}});});
})();
function lancer(el){sons.lectures++;var pr=el.play();if(pr&&pr.catch)pr.catch(function(err){if(!err||err.name!=='AbortError')sons.refus++;});}
/* UN SAUT N'EST CRU QUE CONFIRMÉ. L'iPhone ignore un saut demandé avant que le fichier ne soit lu (il ne charge rien
   avant un premier play(), preload ignoré), et un saut chassé par un autre pendant le défilement peut être perdu, alors
   que currentTime relu rend la valeur DEMANDÉE : le son repartait du début ou d'ailleurs, sans que rien ne le voie. Donc :
   aucun saut avant les métadonnées (il est posé à leur arrivée), aucun saut empilé sur un saut en cours (le dernier voulu
   part à son « seeked »), et un lecteur ne joue qu'une fois son saut CONFIRMÉ par « seeked ». Un saut posé pendant la
   lecture vise un peu plus loin, de la durée du saut précédent : sinon l'iPhone, lent à sauter, courait après le temps. */
function borne(el,x){var d=el.duration;return isFinite(d)&&d>0?Math.max(0,Math.min(x,d-0.05)):Math.max(0,x);}
function sauter(el,cible,enLecture){
 el.__voulu=cible;
 if(el.readyState<1||el.seeking)return;
 var x=borne(el,cible+(enLecture?(el.__latence||0)*(el.playbackRate||1):0));
 el.__pose=x;el.__sur=false;el.__depuis=performance.now();el.__enLecture=!!enLecture;sons.sauts++;
 try{el.currentTime=x;}catch(e){}
}
function suivre(el){
 if(el.__suivi)return;el.__suivi=1;
 el.addEventListener('seeked',function(){
  if(el.__enLecture)el.__latence=Math.min(1,(performance.now()-(el.__depuis||performance.now()))/1000);
  var rate=typeof el.__pose==='number'&&Math.abs(el.currentTime-el.__pose)>0.15;
  if(rate){sons.sautsRates++;el.__rates=(el.__rates||0)+1;}else el.__rates=0;
  /* Un saut qui retombe ailleurs est redemandé, trois fois au plus : au-delà, on garde où il est (pas de tempête de sauts). */
  el.__sur=!rate||el.__rates>3;
  if(!lecture)visibilite();
 });
 ['loadedmetadata','canplay'].forEach(function(n){el.addEventListener(n,function(){if(!lecture)visibilite();});});
 ['emptied','loadstart'].forEach(function(n){el.addEventListener(n,function(){el.__sur=false;});});
}
function piloter(el,p,dedans){
 suivre(el);
 var loc=t-p.d,k=1;
 if(p.fi>0&&loc<p.fi)k=Math.max(0,loc/p.fi);if(p.fo>0&&p.f-t<p.fo)k=Math.min(k,Math.max(0,(p.f-t)/p.fo));
 /* Hors de son passage, le lecteur attend sur le DÉPART du suivant : le saut est fait avant qu'il doive sonner. */
 var cible=dedans?loc*p.v+p.ms:p.ms;
 if(dedans&&lecture){
  var juste=el.__sur&&Math.abs(el.currentTime-borne(el,cible))<=0.25*p.v;
  if(!juste)sauter(el,cible,true);
  /* Tant que son saut n'est pas confirmé, le lecteur se tait : mieux vaut un blanc qu'une phrase d'ailleurs. */
  el.muted=muet||p.muet||!el.__sur;if(el.playbackRate!==p.v)el.playbackRate=p.v;el.volume=Math.max(0,Math.min(1,p.vol*k));
  /* Pas encore de métadonnées : play() lance le chargement (l'élément a été débloqué dans le geste). */
  if(el.paused&&(el.readyState<1||juste))lancer(el);
 }
 else{if(!el.paused)el.pause();if(!el.__sur||Math.abs(el.currentTime-borne(el,cible))>0.04)sauter(el,cible,false);}
}
function piloterLecteur(L){
 var actif=null,suivant=null;
 for(var i=0;i<L.passages.length;i++){var p=L.passages[i];if(t>=p.d&&t<p.f){actif=p;break;}if(!suivant&&p.d>t)suivant=p;}
 if(actif)piloter(L.el,actif,true);else if(suivant)piloter(L.el,suivant,false);else if(!L.el.paused)L.el.pause();
}
/* LE DÉBLOCAGE, DANS LE GESTE : l'appui sur « Lire » arrive ici par message, et Safari fait suivre le geste avec lui
   (une seconde environ). Chaque lecteur, et chaque vidéo qui a du son, y est lancé puis arrêté aussitôt : sans un
   bruit, l'élément est désormais autorisé à sonner, même lancé plus tard par la boucle d'images. Un appui DANS
   l'aperçu (un vrai geste du cadre) fait de même. */
function lecteursEtVideos(){return lecteurs.map(function(L){return L.el;}).concat(clips.filter(function(c){return c.tagName==='VIDEO';}));}
function debloquer(){
 lecteurs.map(function(L){return L.el;}).concat(clips.filter(function(c){return c.tagName==='VIDEO'&&c.hasAttribute('data-has-audio');})).forEach(function(el){
  if(!el.paused)return;var m=el.muted;el.muted=false;var pr;try{pr=el.play();el.pause();}catch(e){}el.muted=m;if(pr&&pr.catch)pr.catch(function(){});
 });
}
function visibilite(){
 clips.forEach(function(c){
  if(c.tagName==='AUDIO')return;
  var p=passage(c),dedans=t>=p.d&&t<p.f;
  c.style.visibility=dedans?'visible':'hidden';
  if(c.tagName==='VIDEO'&&(dedans||!c.paused))piloter(c,p,dedans);
 });
 lecteurs.forEach(piloterLecteur);
}
function aller(x){t=Math.max(0,Math.min(D.duree,x));tl.totalTime(t,false);visibilite();placer();}
function boucle(ts){
 if(!lecture)return;
 var x=base+(ts-origine)/1000;
 if(x>=D.duree){aller(D.duree);lecture=false;visibilite();placer();dire({type:'fin',t:D.duree});return;}
 aller(x);dire({type:'temps',t:t});rafId=requestAnimationFrame(boucle);
}
window.addEventListener('message',function(e){
 if(e.source!==parent)return;var m=e.data||{};
 if(m.type==='aller'){lecture=false;cancelAnimationFrame(rafId);aller(+m.t||0);visibilite();}
 else if(m.type==='lire'){cancelAnimationFrame(rafId);var x=Math.max(0,Math.min(D.duree,typeof m.t==='number'?m.t:t));lecture=true;base=x>=D.duree-0.05?0:x;origine=performance.now();debloquer();lecteursEtVideos().forEach(function(el){el.__sur=false;});aller(base);rafId=requestAnimationFrame(boucle);}
 else if(m.type==='pause'){lecture=false;cancelAnimationFrame(rafId);visibilite();placer();dire({type:'temps',t:t});}
 else if(m.type==='muet'){muet=!!m.muet;debloquer();visibilite();}
 else if(m.type==='selectionner'){choisir(m.segmentId?trouver(m.segmentId,m.elementId):null,true);}
});
/* ---- Sélection et gestes ----
   LE CADRE ET SES POIGNÉES SONT DESSINÉS PAR LA PAGE PARENTE, à la taille de l'écran :
   dessinés ici, ils seraient réduits avec l'aperçu (34 px → une dizaine). Le cadre
   d'aperçu ne fait que DIRE où est la pièce choisie (message « boite », en pixels
   de la composition) et appliquer les gestes reçus (« retouche-en-direct »).
   Tirer la pièce elle-même la déplace toujours d'ici. */
var choix=null, derniereBoite='';
function trouver(segId,elId){var s=document.querySelector('[data-seg="'+segId+'"]');if(!s)return null;if(!elId)return {seg:s,el:s,segId:segId,elId:null};var e=s.matches('[data-studio-id="'+elId+'"]')?s:s.querySelector('[data-studio-id="'+elId+'"]');return e?{seg:s,el:e,segId:segId,elId:elId}:null;}
function retouche(c){var r=(D.retouches[c.segId]||{})[c.elId]||{};return {x:r.x||0,y:r.y||0,echelle:r.echelle||1,rotation:r.rotation||0};}
function feuille(n){return !!n&&n.children.length===0&&!!(n.textContent||'').trim();}
/* UN TEXTE COMPOSÉ : une phrase découpée mot par mot (\`<p><span class=mot>…\`) pour son animation. Ce n'est
   pas une feuille, mais c'est un texte : ses coins règlent son CADRE, jamais la taille de ses lettres. Il ne
   s'écrit pas sur place (l'écriture remplacerait les mots animés par un seul texte). */
var EN_LIGNE=/^(span|b|i|em|strong|u|s|small|sup|sub|mark|a|code|br)$/i;
function texteCompose(n){
 if(!n||!n.children||!n.children.length||!(n.textContent||'').trim()||n.querySelector('[data-studio-id]'))return false;
 if(/^(img|image|video|svg)$/i.test(n.tagName)||n.namespaceURI==='http://www.w3.org/2000/svg')return false;
 var d=n.querySelectorAll('*');for(var i=0;i<d.length;i++)if(!EN_LIGNE.test(d[i].tagName))return false;
 return true;
}
function texte(n){return feuille(n)||texteCompose(n);}
/* CE QU'EST LA PIÈCE, pour que l'inspecteur ne propose que ses vrais réglages : un texte, une image, une forme SVG, un groupe de pièces, une forme. */
function nature(n){if(texte(n))return 'texte';if(/^(img|image|video)$/i.test(n.tagName))return 'image';if(n.querySelector('[data-studio-id]'))return 'groupe';if(n.namespaceURI==='http://www.w3.org/2000/svg')return 'svg';return 'forme';}
/* SES STYLES CALCULÉS, lus à l'instant de la tête (après GSAP et les retouches) : l'inspecteur part de la vraie couleur, pas d'un blanc par défaut. */
function styles(n){try{var c=getComputedStyle(n),b=n.getBoundingClientRect();return {couleur:c.color,fond:c.backgroundColor,remplissage:c.fill,taillePolice:parseFloat(c.fontSize)||0,largeur:n.offsetWidth||Math.round(b.width)||0,hauteur:n.offsetHeight||Math.round(b.height)||0,alignement:c.textAlign,contour:c.outlineStyle!=='none'&&parseFloat(c.outlineWidth)?c.outlineColor:c.borderTopColor,epaisseurContour:c.outlineStyle!=='none'&&parseFloat(c.outlineWidth)?parseFloat(c.outlineWidth):(c.borderTopStyle!=='none'?parseFloat(c.borderTopWidth)||0:0),arrondi:parseFloat(c.borderTopLeftRadius)||0};}catch(e){return null;}}
function placer(){
 var m={type:'boite',segmentId:null};
 if(choix&&choix.el.isConnected&&choix.seg.style.visibility!=='hidden'){
  var b=choix.el.getBoundingClientRect();
  if(b.width||b.height){var n=choix.el,src=n.getAttribute('data-param-src');m={type:'boite',segmentId:choix.segId,elementId:choix.elId,x:Math.round(b.left),y:Math.round(b.top),l:Math.round(b.width),h:Math.round(b.height),texte:!!choix.elId&&texte(n),ecrivable:!!choix.elId&&feuille(n),image:/^(img|image)$/i.test(n.tagName)?(src?'parametre':'fichier'):null,parametre:src||null,nature:nature(n),styles:styles(n),contenu:texte(n)?n.textContent:null};}
 }
 if(lecture)return;
 var cle=JSON.stringify(m);if(cle===derniereBoite)return;derniereBoite=cle;dire(m);
}
function choisir(c,taire){choix=c;derniereBoite='';placer();if(!taire)dire({type:'selection',segmentId:c?c.segId:null,elementId:c?c.elId:null});}
var geste=null;
/* LE DÉPLACEMENT : la pièce suit la main, mais c'est la PAGE PARENTE qui décide où elle se pose
   (repères aimantés, dessinés à la taille de l'écran) : le cadre lui dit où la main l'amène
   (« deplacement »), elle répond par la position retenue (« retouche-en-direct »). Le pointeur est
   CAPTURÉ : la pièce suit encore quand la main sort de l'aperçu, et le relâcher n'est jamais perdu. */
/* QUELLE PIÈCE EST SOUS LA MAIN : la plus en avant, SAUF un conteneur plein cadre (la racine d'une scène
   dessinée, \`inset:0\`, qui porte d'autres pièces) : il recouvrait tout ce qui est dessous — la vidéo
   d'une piste inférieure, les pièces d'un autre segment — et c'est lui qu'on tirait, d'un bloc. On prend
   la première pièce qui n'en est pas un ; il reste choisissable par « Calques », ou là où rien d'autre n'est. */
function pleinCadre(n){var b=n.getBoundingClientRect();return b.width>=D.largeur*0.95&&b.height>=D.hauteur*0.95&&!!n.querySelector('[data-studio-id]');}
function sousLaMain(e){
 var liste=document.elementsFromPoint?document.elementsFromPoint(e.clientX,e.clientY):[e.target],vus=[],premier=null;
 for(var i=0;i<liste.length;i++){
  var el=liste[i];if(!el||!el.closest)continue;
  var n=el.closest('[data-studio-id]'),s=el.closest('[data-seg]');if(!s)continue;
  if(n&&!s.contains(n))n=null;
  var cle=n||s;if(vus.indexOf(cle)>=0)continue;vus.push(cle);
  if(!premier)premier={n:n,s:s};
  if(n&&!pleinCadre(n))return {n:n,s:s};
 }
 return premier||{n:null,s:null};
}
document.addEventListener('pointerdown',function(e){
 debloquer();
 var sous=sousLaMain(e),n=sous.n,s=sous.s;
 if(!s){choisir(null);return;}
 var c={seg:s,el:n&&s.contains(n)?n:s,segId:s.getAttribute('data-seg'),elId:n&&s.contains(n)?n.getAttribute('data-studio-id'):null};
 /* Même élément mais choisi comme SEGMENT (une vidéo est à la fois son segment et sa pièce, choisie depuis la
    ligne de temps) : on le rechoisit comme PIÈCE, sinon le déplacement partait sans nom de pièce et se perdait. */
 if(!choix||choix.el!==c.el||choix.elId!==c.elId)choisir(c);
 if(c.elId&&!c.el.isContentEditable&&e.button===0){
  e.preventDefault();var b=c.el.getBoundingClientRect();
  geste={mode:'deplacer',x0:e.clientX,y0:e.clientY,r:retouche(c),b0:{x:b.left,y:b.top,l:b.width,h:b.height}};
  try{c.el.setPointerCapture(e.pointerId);}catch(x){}
 }
},true);
document.addEventListener('pointermove',function(e){
 if(!geste||!choix)return;e.preventDefault();
 var r=geste.r;if(Math.abs(e.clientX-geste.x0)+Math.abs(e.clientY-geste.y0)<2&&!geste.parti)return;geste.parti=true;
 geste.brut={x:Math.round(r.x+e.clientX-geste.x0),y:Math.round(r.y+e.clientY-geste.y0)};
 dire({type:'deplacement',segmentId:choix.segId,elementId:choix.elId,x:geste.brut.x,y:geste.brut.y,x0:r.x,y0:r.y,boite:geste.b0,libre:!!(e.altKey||e.ctrlKey||e.metaKey)});
},{passive:false});
/* Relâchée avant la réponse de la page : la position brute part quand même, la page y repose son aimant. */
function finir(){var fin=geste&&(geste.fin||geste.brut);if(fin&&choix){dire({type:'retouche',segmentId:choix.segId,elementId:choix.elId,retouche:fin});memoriser(fin);}geste=null;}
function memoriser(fin){var r=(D.retouches[choix.segId]=D.retouches[choix.segId]||{});var a=r[choix.elId]=r[choix.elId]||{};for(var k in fin)a[k]=fin[k];}
document.addEventListener('pointerup',finir);document.addEventListener('pointercancel',finir);
/* UNE COULEUR, UN ALIGNEMENT, UN CONTOUR RÉGLÉS DANS L'INSPECTEUR : vus PENDANT le choix, avant que la retouche
   parte. Les MÊMES déclarations que \`regleDeRetouche\` (l'export) : ce que l'aperçu montre est ce qui sera rendu. */
var ALIGNER={gauche:'left',centre:'center',droite:'right',justifie:'justify'};
function peindre(el,r){var st=el.style;
 if(r.couleur){st.setProperty('color',r.couleur,'important');st.setProperty('fill',r.couleur,'important');}
 if(r.fond)st.setProperty('background-color',r.fond,'important');
 if(r.alignement&&ALIGNER[r.alignement])st.setProperty('text-align',ALIGNER[r.alignement],'important');
 if(typeof r.epaisseurContour==='number'||r.contour){var ep=typeof r.epaisseurContour==='number'?r.epaisseurContour:(parseFloat(getComputedStyle(el).outlineWidth)||0);
  st.setProperty('outline',ep>0?ep+'px solid '+(r.contour||getComputedStyle(el).outlineColor):'none','important');st.setProperty('outline-offset',(-ep)+'px','important');}
 if(typeof r.arrondi==='number')st.setProperty('border-radius',r.arrondi+'px','important');
}
/* UN GESTE TIRÉ PAR LA PAGE PARENTE (coin, bord, rotation) : posé comme le déplacement, en !important, puis le cadre se replace. */
function enDirect(r,cible){
 if(cible){peindre(cible,r);placer();return;}
 if(!choix||!choix.elId)return;peindre(choix.el,r);if(r.echelle!==undefined)choix.el.style.setProperty('scale',String(r.echelle),'important');
 /* LE CADRE tiré par un coin ou un bord : sa taille change, sa police jamais ; une image s'y RECADRE (cover), sans se déformer. */
 if(typeof r.largeur==='number'){choix.el.style.setProperty('width',r.largeur+'px','important');choix.el.style.setProperty('max-width','none','important');choix.el.style.setProperty('box-sizing','border-box','important');choix.el.style.setProperty('object-fit','cover','important');}
 if(typeof r.hauteur==='number'){choix.el.style.setProperty('height',r.hauteur+'px','important');choix.el.style.setProperty('max-height','none','important');choix.el.style.setProperty('object-fit','cover','important');}if(r.rotation!==undefined)choix.el.style.setProperty('rotate',r.rotation+'deg','important');
 if(typeof r.x==='number'&&typeof r.y==='number'){choix.el.style.setProperty('translate',r.x+'px '+r.y+'px','important');if(geste&&geste.mode==='deplacer')geste.fin={x:r.x,y:r.y};else memoriser({x:r.x,y:r.y});}
 placer();}
/* ÉCRIRE SUR PLACE : Entrée va à la ligne (un vrai « \\n », gardé dans la retouche et rendu à l'export),
   Ctrl/Cmd+Entrée ou un clic ailleurs retiennent le texte, Échap le remet comme avant. */
function editer(n,s){
 if(!n||!s||!feuille(n)||n.isContentEditable)return;
 var avant=n.textContent,blanc=n.style.whiteSpace;n.contentEditable='true';n.style.whiteSpace='pre-wrap';n.focus();
 var r=document.createRange();r.selectNodeContents(n);var sel=getSelection();sel.removeAllRanges();sel.addRange(r);
 function sortir(){n.removeEventListener('blur',sortir);n.removeEventListener('keydown',touche);n.contentEditable='false';n.style.whiteSpace=blanc;
  var texte=(n.textContent||'').replace(/\\n+$/,'');if(texte!==n.textContent)n.textContent=texte;
  if(texte!==avant)dire({type:'texte',segmentId:s.getAttribute('data-seg'),elementId:n.getAttribute('data-studio-id'),texte:texte});}
 function aLaLigne(){var sl=getSelection();if(!sl||!sl.rangeCount)return;var rg=sl.getRangeAt(0);rg.deleteContents();var tn=document.createTextNode('\\n');rg.insertNode(tn);
  /* Un retour en toute fin ne se voit qu'avec un second « \\n » derrière lui (retiré à la sortie). */
  if(!tn.nextSibling||!(tn.nextSibling.textContent||'').length)tn.parentNode.insertBefore(document.createTextNode('\\n'),tn.nextSibling);
  rg.setStartAfter(tn);rg.collapse(true);sl.removeAllRanges();sl.addRange(rg);}
 function touche(k){
  if(k.key==='Enter'&&(k.ctrlKey||k.metaKey)){k.preventDefault();n.blur();return;}
  if(k.key==='Enter'){k.preventDefault();aLaLigne();return;}
  if(k.key==='Escape'){k.preventDefault();k.stopPropagation();n.textContent=avant;n.blur();}
 }
 n.addEventListener('blur',sortir);
 n.addEventListener('keydown',touche);
}
/* LE DOUBLE-CLIC : un texte simple s'écrit sur place ; toute autre pièce (logo, groupe, image, phrase animée)
   demande à la page d'ouvrir la FENÊTRE D'ÉDITION, comme le double-clic d'un bloc de la ligne de temps. La page
   qui n'a pas de fenêtre à ouvrir (l'aperçu de la fenêtre elle-même) ignore la demande. */
document.addEventListener('dblclick',function(e){
 var sous=sousLaMain(e),n=sous.n,s=sous.s;if(!s)return;
 if(n&&s.contains(n)&&feuille(n)){editer(n,s);return;}
 if(n&&n.isContentEditable)return;
 dire({type:'ouvrir-editeur',segmentId:s.getAttribute('data-seg'),elementId:n&&s.contains(n)?n.getAttribute('data-studio-id'):null});
});
/* Échap pressée ici (le cadre a le focus) remonte à la page : la fenêtre qui porte l'aperçu se ferme. Un texte en cours d'écriture la garde pour lui. */
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!(e.target&&e.target.isContentEditable))dire({type:'echap'});});
/* LES FLÈCHES, quand une pièce est choisie et que le cadre a le focus : un pixel (dix avec Maj), décidé par la page parente. */
var FLECHES={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
document.addEventListener('keydown',function(e){var f=FLECHES[e.key];if(!f||!choix||!choix.elId||(e.target&&e.target.isContentEditable))return;e.preventDefault();var k=e.shiftKey?10:1;dire({type:'fleche',dx:f[0]*k,dy:f[1]*k});});
window.__studioApresRecalage=function(){tl.totalTime(t,false);visibilite();derniereBoite='';placer();};
window.addEventListener('message',function(e){
 if(e.source!==parent)return;var m=e.data||{};
 if(m.type==='retouche-en-direct'&&m.retouche){var vise=m.segmentId?trouver(m.segmentId,m.elementId||null):null;if(m.segmentId&&!vise)return;enDirect(m.retouche,vise?vise.el:null);}
 /* UN PARAMÈTRE DE DESSIN réglé dans l'inspecteur (couleur…) : sa variable \`--p-<id>\` change tout de suite sur la scène. */
 else if(m.type==='variable-en-direct'&&m.segmentId&&/^[a-zA-Z][\\w-]{0,63}$/.test(m.nom||'')){var sc=document.getElementById('seg-'+m.segmentId);if(sc){sc.style.setProperty('--p-'+m.nom,String(m.valeur).replace(/[;{}<>"]/g,''));placer();}}
 else if(m.type==='editer-texte'&&choix&&choix.elId)editer(choix.el,choix.seg);
});
document.documentElement.style.touchAction='none';
document.body.style.touchAction='none';
aller(0);
dire({type:'pret',duree:D.duree,erreurs:window.__studioErreurs||[]});
})();`;
