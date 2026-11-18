/**
 * L'OUTIL DE CAPTURES D'ÉCRAN — règles pures (carte « Captures d'écran et plaquette client », 05/11/2026).
 *
 * Une RECETTE dit ce qu'on capture : les adresses, les appareils (ordinateur, téléphone), les thèmes (clair, sombre),
 * la page entière ou le seul premier écran, une connexion facultative (un accès du COFFRE, désigné par son nom ou son
 * identifiant — jamais un mot de passe écrit dans la recette), et une vidéo de parcours facultative.
 *
 * RIEN NE SE CAPTURE AVANT LE CLIC (décision de l'utilisateur) : l'agent PROPOSE la recette, le démon pose l'encadré
 * « Capturer », et seule une recette dont l'encadré a reçu la réponse « Capturer » peut être exécutée.
 */

export const APPAREILS_DE_CAPTURE = ['ordinateur', 'telephone'] as const;
export type AppareilDeCapture = (typeof APPAREILS_DE_CAPTURE)[number];
export const THEMES_DE_CAPTURE = ['clair', 'sombre'] as const;
export type ThemeDeCapture = (typeof THEMES_DE_CAPTURE)[number];

/** Les fenêtres réelles (compétence « captures réelles d'une app pour sa vitrine ») : 1440×900 en densité 2, téléphone 390×844 en densité 3. */
export const FENETRES_DE_CAPTURE: Record<AppareilDeCapture, { largeur: number; hauteur: number; densite: number; mobile: boolean }> = {
  ordinateur: { largeur: 1440, hauteur: 900, densite: 2, mobile: false },
  telephone: { largeur: 390, hauteur: 844, densite: 3, mobile: true },
};

export interface CibleDeCapture {
  url: string;
  /** Le nom de la page dans les fichiers (« accueil », « tableau de bord »). */
  nom: string;
}

export interface ConnexionDeCapture {
  /** L'accès du coffre-fort (nom ou identifiant de la fiche) : les valeurs sont lues au moment de capturer, jamais écrites ici. */
  acces: string;
  /** La page de connexion ; à défaut, la première adresse. */
  url?: string;
  /** Sélecteurs facultatifs ; à défaut, le premier champ texte/courriel et le premier champ mot de passe. */
  champIdentifiant?: string;
  champMotDePasse?: string;
  bouton?: string;
}

export interface RecetteDeCapture {
  cibles: CibleDeCapture[];
  appareils: AppareilDeCapture[];
  themes: ThemeDeCapture[];
  /** Toute la hauteur de la page (défaut), ou le seul premier écran. */
  pleinePage: boolean;
  connexion?: ConnexionDeCapture;
  /** Une vidéo de parcours : chaque page ouverte puis déroulée lentement. */
  video?: { appareil: AppareilDeCapture; secondesParPage: number };
  /** Sélecteurs CSS à retirer avant la prise, EN PLUS du nettoyage automatique (cookies, fenêtres, bulles) : badge, élément propre au site. */
  masquer: string[];
  /** Pause après chargement (ms). */
  attente: number;
  /** Montrer le bandeau de cookies, les fenêtres et les bulles tels quels (audit RGPD) ; par défaut ils sont acceptés puis retirés. */
  garderLesSurcouches?: boolean;
  /** La langue imposée par cookie et par l'entête Accept-Language (« fr », « en »…). */
  langue?: string;
}

export const PLAFOND_DE_CAPTURES = 40;
export const PLAFOND_DE_CIBLES = 20;

export type LectureDeRecette = { ok: true; recette: RecetteDeCapture; total: number } | { ok: false; raison: string };

function nomDePage(url: URL, i: number): string {
  const morceaux = url.pathname.split('/').filter(Boolean);
  return morceaux.length ? morceaux.join('-') : i === 0 ? 'accueil' : `page-${i + 1}`;
}

/** Un nom de fichier sûr, sans accents ni signes : « Tableau de bord » → « tableau-de-bord ». */
export function nomDeFichierSur(nom: string): string {
  return (
    nom
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}

export function lireLaRecette(brut: unknown): LectureDeRecette {
  const o = (brut ?? {}) as Record<string, unknown>;
  const cibles: CibleDeCapture[] = [];
  const brutes = Array.isArray(o.cibles) ? o.cibles : Array.isArray(o.urls) ? o.urls : [];
  for (const [i, c] of brutes.entries()) {
    const x = typeof c === 'string' ? { url: c } : ((c ?? {}) as Record<string, unknown>);
    let url: URL;
    try {
      url = new URL(String(x.url ?? ''));
    } catch {
      return { ok: false, raison: `Adresse ${i + 1} illisible : « ${String(x.url ?? '')} ».` };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, raison: `Adresse ${i + 1} : seules les adresses http(s) se capturent.` };
    const nom = typeof x.nom === 'string' && x.nom.trim() ? x.nom.trim().slice(0, 60) : nomDePage(url, i);
    cibles.push({ url: url.toString(), nom });
  }
  if (!cibles.length) return { ok: false, raison: 'La recette a au moins une adresse (« cibles »).' };
  if (cibles.length > PLAFOND_DE_CIBLES) return { ok: false, raison: `${PLAFOND_DE_CIBLES} adresses au plus par recette.` };
  const appareils = (Array.isArray(o.appareils) ? o.appareils : ['ordinateur']).filter((a): a is AppareilDeCapture =>
    (APPAREILS_DE_CAPTURE as readonly unknown[]).includes(a),
  );
  const themes = (Array.isArray(o.themes) ? o.themes : ['clair']).filter((t): t is ThemeDeCapture => (THEMES_DE_CAPTURE as readonly unknown[]).includes(t));
  if (!appareils.length) return { ok: false, raison: `Appareils possibles : ${APPAREILS_DE_CAPTURE.join(', ')}.` };
  if (!themes.length) return { ok: false, raison: `Thèmes possibles : ${THEMES_DE_CAPTURE.join(', ')}.` };
  const total = cibles.length * new Set(appareils).size * new Set(themes).size;
  if (total > PLAFOND_DE_CAPTURES) return { ok: false, raison: `${total} captures demandées : ${PLAFOND_DE_CAPTURES} au plus par recette. Découpe-la.` };
  const recette: RecetteDeCapture = {
    cibles,
    appareils: [...new Set(appareils)],
    themes: [...new Set(themes)],
    pleinePage: o.pleinePage !== false,
    masquer: (Array.isArray(o.masquer) ? o.masquer : typeof o.masquer === 'string' ? o.masquer.split(',') : [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 20),
    attente: Math.min(10000, Math.max(0, Number(o.attente ?? 1200) || 0)),
  };
  if (o.garderLesSurcouches === true) recette.garderLesSurcouches = true;
  if (typeof o.langue === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(o.langue)) recette.langue = o.langue;
  if (o.connexion && typeof o.connexion === 'object') {
    const c = o.connexion as Record<string, unknown>;
    const acces = typeof c.acces === 'string' ? c.acces.trim() : '';
    if (!acces) return { ok: false, raison: 'La connexion désigne un accès du coffre-fort (« acces » : son nom ou son identifiant).' };
    const connexion: ConnexionDeCapture = { acces: acces.slice(0, 200) };
    if (typeof c.url === 'string') {
      try {
        const u = new URL(c.url);
        if (u.protocol === 'https:' || u.protocol === 'http:') connexion.url = u.toString();
      } catch {
        /* adresse de connexion illisible : la première adresse servira */
      }
    }
    for (const k of ['champIdentifiant', 'champMotDePasse', 'bouton'] as const) {
      if (typeof c[k] === 'string' && (c[k] as string).trim()) connexion[k] = (c[k] as string).trim().slice(0, 200);
    }
    recette.connexion = connexion;
  }
  if (o.video && typeof o.video === 'object') {
    const v = o.video as Record<string, unknown>;
    const appareil = (APPAREILS_DE_CAPTURE as readonly unknown[]).includes(v.appareil) ? (v.appareil as AppareilDeCapture) : recette.appareils[0]!;
    recette.video = { appareil, secondesParPage: Math.min(20, Math.max(2, Number(v.secondesParPage ?? 5) || 5)) };
  }
  return { ok: true, recette, total };
}

/** Le nom d'une capture : `<page>-<appareil>-<thème>.webp`. */
export function nomDeCapture(cible: CibleDeCapture, appareil: AppareilDeCapture, theme: ThemeDeCapture): string {
  return `${nomDeFichierSur(cible.nom)}-${appareil}-${theme}.webp`;
}

/** Le texte de l'encadré « Capturer » : la liste prévue, en mots courants. */
export function descriptionDeLaProposition(recette: RecetteDeCapture, total: number): string {
  const lignes = recette.cibles.map((c) => `• ${c.nom} — ${c.url}`);
  const appareils = recette.appareils.map((a) => (a === 'ordinateur' ? 'ordinateur' : 'téléphone')).join(' et ');
  const themes = recette.themes.map((t) => (t === 'clair' ? 'clair' : 'sombre')).join(' et ');
  const details = [
    `${total} image${total > 1 ? 's' : ''} : ${appareils}, thème ${themes}, ${recette.pleinePage ? 'page entière' : 'premier écran'}.`,
    recette.connexion ? `Connexion avec l'accès « ${recette.connexion.acces} » du coffre-fort (compte de démonstration).` : '',
    recette.video ? `Plus une vidéo de parcours (${recette.video.appareil === 'ordinateur' ? 'ordinateur' : 'téléphone'}, ${recette.video.secondesParPage} s par page).` : '',
  ].filter(Boolean);
  return [...lignes, '', ...details].join('\n').slice(0, 1200);
}

/** Les trois réponses de l'encadré. La première EST le clic qui autorise la capture. */
export const REPONSE_CAPTURER = 'Capturer';
export const REPONSE_MODIFIER_LA_LISTE = 'Modifier la liste';
export const REPONSE_PAS_MAINTENANT = 'Pas maintenant';

/** La réponse donnée vaut-elle l'accord de capturer ? (libellé exact, éventuellement suivi d'un complément libre). */
export function reponseAutoriseLaCapture(reponse: string | undefined | null): boolean {
  if (!reponse) return false;
  return reponse.trim().split('\n')[0]!.trim().toLowerCase().startsWith(REPONSE_CAPTURER.toLowerCase());
}

/* ------------------------------------------------------------------ */
/* La commande « /captures »                                           */
/* ------------------------------------------------------------------ */

/* La commande et sa consigne vit avec celles des autres commandes de Beluga : `shared/src/commandes-de-beluga.ts`. */
