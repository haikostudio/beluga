/*
 * LES GESTES DE JARVIS, CÔTÉ NAVIGATEUR (carte « Relier Beluga Pass dans les réglages », 16/11/2026).
 *
 * Le démon (`server/src/gestes-de-jarvis.ts`) envoie à CET onglet — celui qui tient la conversation vocale, reconnu
 * par `ID_DE_L_ONGLET`, passé à `voix.direct.demarrer` — un geste à la fois (`jarvis.geste`). Ce module le joue COMME
 * L'UTILISATEUR : il trouve la cible (un repère `[data-…]` ou un texte visible), y conduit le curseur de Jarvis
 * (`CurseurDeJarvis`), l'entoure, puis clique, tape ou ouvre l'adresse — par les mêmes événements que la souris et le
 * clavier, sans contourner aucune garde de l'interface. Puis il accuse le geste (`jarvis.geste.fait`).
 *
 * L'UTILISATEUR GARDE LA MAIN : pendant une action, un geste RÉEL de sa part (`isTrusted`, hors du module de voix :
 * souris qui bouge vraiment, appui, touche, molette, doigt) l'arrête aussitôt (`jarvis.action.arreter`). Les
 * événements que Jarvis fabrique ne sont jamais `isTrusted` : ils ne l'arrêtent pas.
 */
import { client } from './client';
import { t } from './langue';

/** L'identifiant de cet onglet, le temps de sa vie : c'est à lui seul que le démon envoie les gestes. */
export const ID_DE_L_ONGLET = `onglet-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** L'événement de fenêtre par lequel le client relaie `jarvis.geste` et `voix.direct.action` (même canal que le direct). */
const EVENEMENT = 'beluga:voix-directe';

/* ------------------------------------------------------------------ */
/* L'état du curseur, lu par `CurseurDeJarvis`                          */
/* ------------------------------------------------------------------ */

export interface EtatDuCurseur {
  visible: boolean;
  x: number;
  y: number;
  /** Augmente à chaque clic : le cercle de clic se rejoue. */
  clics: number;
  /**
   * La boîte de l'élément visé, en coordonnées d'écran : JAMAIS dessinée pendant la visée (plus de cadre, décision du
   * 17/11/2026) ; c'est sur elle que s'allume l'ÉCLAIR au moment du clic.
   */
  contour: { x: number; y: number; l: number; h: number } | null;
  /** Ce que Jarvis fait en ce moment, à la première personne (« J’ouvre les tableaux de bord ») : écrit à son nom. */
  libelle: string;
}

let etat: EtatDuCurseur = { visible: false, x: -40, y: -40, clics: 0, contour: null, libelle: '' };
const abonnes = new Set<() => void>();
function poser(suite: Partial<EtatDuCurseur>): void {
  etat = { ...etat, ...suite };
  for (const f of abonnes) f();
}
export function abonnerAuCurseur(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}
export function lireLeCurseur(): EtatDuCurseur {
  return etat;
}

/**
 * La durée du trajet du curseur ; nulle quand le système demande moins d'animations. PLUS RAPIDE (carte « Jarvis :
 * volet, voix et rapidité », 16/11/2026 : « la manipulation de Beluga est extrêmement lente ») : 480 → 280 ms, et les
 * pauses après chaque geste divisées par deux ou trois — la page suivante est de toute façon ATTENDUE par le geste
 * d'après (`attendreLaCible`), plus par une pause fixe.
 */
export function dureeDuTrajet(): number {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 280;
}

/** Les pauses après chaque geste, en ms (le temps qu'un écran réagisse, sans plus). */
export const PAUSES_DES_GESTES = { ouvrir: 220, cliquer: 140, saisir: 60, touche: 120, sondage: 50, apresTrajet: 30, lettre: 12 } as const;

/* ------------------------------------------------------------------ */
/* Trouver la cible                                                     */
/* ------------------------------------------------------------------ */

const ACTIONNABLES =
  'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="checkbox"], [role="link"], [role="combobox"], [contenteditable="true"]';
/* Le volet de l'assistant (`data-volet-de-jarvis`) en est aussi : Jarvis n'y joue rien, et un appui dedans ne l'arrête pas. */
const HORS_DE_PORTEE = '[data-module-voix], [data-volet-de-jarvis], [data-bulle-vocale], [data-curseur-jarvis]';

function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[«»"'’]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  return !el.closest(HORS_DE_PORTEE) && !el.closest('[aria-hidden="true"]');
}

function libelleDe(el: Element): string {
  const h = el as HTMLElement;
  return (
    el.getAttribute('aria-label') ||
    (h.innerText ?? el.textContent ?? '').trim() ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    (el as HTMLInputElement).value ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** La couche du dessus : une fenêtre ou un menu ouverts se fouillent d'abord. */
function couches(): ParentNode[] {
  const ouvertes = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]')].filter(visible);
  return [...ouvertes.reverse(), document];
}

/** Le premier repère `data-…` parlant d'un élément, pour le nommer dans « lire ». */
function repereDe(el: Element): string | null {
  for (const attr of [...el.attributes]) {
    const n = attr.name;
    if (!n.startsWith('data-') || /^data-(state|radix|orientation|side|align|disabled|highlighted|slot|focus|testid)/.test(n)) continue;
    return attr.value && attr.value.length < 40 ? `[${n}="${attr.value}"]` : `[${n}]`;
  }
  return null;
}

/** Les balises qu'un plan nomme parfois en tête de sa cible (« textarea « Expliquez… » »). */
const BALISE_DE_TETE = /^(textarea|input|button|select|a|div|span|champ|zone de texte|bouton)\b\s*/i;
/** Ce qui ressemble à un sélecteur CSS : une balise seule, un repère, une classe, un identifiant, ou une combinaison. */
const RESSEMBLE_A_UN_SELECTEUR = /^(?:textarea|input|select)(?:\[[^\]]*\]|[.#][\w-]+)*(?:\s*[>+~ ]\s*[\w[\].#="'-]+)*$/i;

function parSelecteur(brute: string): HTMLElement | null {
  try {
    for (const couche of couches()) {
      const el = [...couche.querySelectorAll(brute)].find(visible);
      if (el) return el as HTMLElement;
    }
  } catch {
    /* sélecteur illisible : on cherche comme un texte */
  }
  return null;
}

/**
 * Trouve ce que vise un geste : un sélecteur (« [data-…] », « .classe », « textarea », « textarea[placeholder…] ») ou un
 * texte visible (libellé, aria-label, placeholder). Une cible mixte « textarea « Expliquez… » » (capture du 17/11/2026,
 * « Je ne trouve pas textarea… ») se lit comme le texte qui suit la balise, cherché parmi les champs de cette balise.
 */
export function trouverLaCible(cible: string): HTMLElement | null {
  const brute = cible.trim();
  if (!brute) return null;
  if (/^[[.#]/.test(brute) || /\[[a-z-]+/.test(brute) || RESSEMBLE_A_UN_SELECTEUR.test(brute)) {
    const el = parSelecteur(brute);
    if (el) return el;
  }
  const tete = BALISE_DE_TETE.exec(brute);
  if (tete && tete[0].length < brute.length) {
    const reste = brute.slice(tete[0].length).replace(/^[«"'“\s]+|[»"'”\s]+$/g, '').trim();
    const balise = tete[1].toLowerCase();
    const champs = balise === 'textarea' || balise === 'input' || /champ|zone/.test(balise) ? 'textarea, input, [contenteditable="true"]' : balise === 'bouton' ? 'button, [role="button"]' : balise;
    const voulu = normaliser(reste.replace(/[…]+$|\.{3}$/, ''));
    if (voulu) {
      for (const couche of couches()) {
        const trouve = [...couche.querySelectorAll(champs)].filter(visible).find((el) => {
          const lu = normaliser(`${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${libelleDe(el)}`);
          return lu.includes(voulu) || voulu.includes(normaliser(el.getAttribute('placeholder') ?? '\u0000'));
        });
        if (trouve) return trouve as HTMLElement;
      }
    }
    const parTexte = trouverLaCible(reste);
    if (parTexte) return parTexte;
  }
  const voulu = normaliser(brute);
  for (const couche of couches()) {
    const candidats = [...couche.querySelectorAll(ACTIONNABLES)].filter(visible);
    const notes = candidats
      .map((el) => {
        const lu = normaliser(libelleDe(el));
        const note = lu === voulu ? 3 : lu.startsWith(voulu) ? 2 : lu.includes(voulu) ? 1 : 0;
        return { el, note, longueur: lu.length };
      })
      .filter((n) => n.note > 0)
      .sort((a, b) => b.note - a.note || a.longueur - b.longueur);
    if (notes[0]) return notes[0].el as HTMLElement;
  }
  return null;
}

/** CE QUI EST À L'ÉCRAN, pour l'agent qui ne le voit pas : l'adresse, puis chaque élément cliquable visible. */
export function lireLEcran(): string {
  const lignes: string[] = [`Adresse : ${window.location.hash || '#'}`];
  const titre = document.querySelector('[data-titre-de-page], h1, h2');
  if (titre) lignes.push(`Titre : ${libelleDe(titre)}`);
  const vus = new Set<Element>();
  for (const couche of couches()) {
    const elements = [...couche.querySelectorAll(ACTIONNABLES)].filter((el) => !vus.has(el) && visible(el));
    if (couche !== document && elements.length) lignes.push(`— Dans la fenêtre ou le menu ouvert :`);
    for (const el of elements.slice(0, 120)) {
      vus.add(el);
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const libelle = libelleDe(el);
      const repere = repereDe(el);
      if (!libelle && !repere) continue;
      lignes.push(`- ${role} « ${libelle} »${repere ? ` ${repere}` : ''}`);
    }
  }
  return lignes.join('\n').slice(0, 38_000);
}

/* ------------------------------------------------------------------ */
/* Jouer un geste                                                       */
/* ------------------------------------------------------------------ */

class Arrete extends Error {}
let interrompu = false;

const attendre = (ms: number) =>
  new Promise<void>((fini, rate) => {
    const debut = Date.now();
    const tic = () => {
      if (interrompu) return rate(new Arrete());
      if (Date.now() - debut >= ms) return fini();
      window.setTimeout(tic, Math.min(50, ms));
    };
    tic();
  });

async function attendreLaCible(cible: string, delai = 4_000): Promise<HTMLElement> {
  const debut = Date.now();
  for (;;) {
    const el = trouverLaCible(cible);
    if (el) return el;
    if (Date.now() - debut > delai) throw new Error(`Je ne trouve pas « ${cible} » à l’écran.`);
    await attendre(PAUSES_DES_GESTES.sondage);
  }
}

/** Conduit le curseur jusqu'à l'élément, l'entoure, et rend le point visé. */
async function allerA(el: HTMLElement): Promise<{ x: number; y: number }> {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await attendre(60);
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + Math.min(r.width / 2, 24 + r.width / 4));
  const y = Math.round(r.top + r.height / 2);
  if (!etat.visible) poser({ visible: true, x: Math.max(0, x - 140), y: Math.max(0, y - 90) });
  await attendre(20);
  poser({ x, y, contour: { x: r.left - 3, y: r.top - 3, l: r.width + 6, h: r.height + 6 } });
  await attendre(dureeDuTrajet() + PAUSES_DES_GESTES.apresTrajet);
  return { x, y };
}

const DECLENCHE_AU_POINTEUR = '[aria-haspopup], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="tab"], [role="combobox"]';

function cliquerComme(el: HTMLElement, x: number, y: number): void {
  const commun = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
  if (el.matches(DECLENCHE_AU_POINTEUR) || el.closest(DECLENCHE_AU_POINTEUR)) {
    // Les menus et onglets de l'interface s'ouvrent à l'APPUI, pas au clic : on joue la séquence entière.
    const pointeur = { ...commun, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...pointeur, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...commun, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...pointeur, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...commun, buttons: 0 }));
  }
  el.focus?.({ preventScroll: true });
  el.click();
}

/**
 * LE VRAI CHAMP D'UN ÉLÉMENT VISÉ : l'élément lui-même s'il se tape, sinon le premier champ qu'il contient (un bloc, le
 * calque des tags posé sur le champ d'écriture, une étiquette…), sinon le champ du même bloc parent. Sans ça, le
 * réglage natif d'un `<input>` appelé sur un `<div>` levait « Illegal invocation » (capture du 17/11/2026).
 */
function champTapable(el: HTMLElement): HTMLElement | null {
  const tapable = (x: Element | null | undefined): boolean =>
    !!x && (x instanceof HTMLTextAreaElement || x instanceof HTMLInputElement || (x as HTMLElement).isContentEditable);
  const CHAMPS = 'textarea, input:not([type="hidden"]), [contenteditable="true"]';
  if (tapable(el)) return el;
  const dedans = el.querySelector<HTMLElement>(CHAMPS);
  if (tapable(dedans)) return dedans;
  const controle = el instanceof HTMLLabelElement ? (el.control as HTMLElement | null) : null;
  if (tapable(controle)) return controle;
  for (let parent = el.parentElement, n = 0; parent && n < 4; parent = parent.parentElement, n += 1) {
    const voisin = parent.querySelector<HTMLElement>(CHAMPS);
    if (tapable(voisin)) return voisin;
  }
  return null;
}

/** Tape un texte dans un champ que React tient : le réglage natif de la valeur, puis l'événement « input ». */
async function taper(cible: HTMLElement, texte: string): Promise<void> {
  const el = champTapable(cible);
  if (!el) throw new Error(t('Ce que je vise n’est pas un champ où écrire.'));
  el.focus({ preventScroll: true });
  if (el.isContentEditable) {
    document.execCommand('selectAll');
    document.execCommand('insertText', false, texte);
    return;
  }
  const champ = el as HTMLInputElement | HTMLTextAreaElement;
  const proto = champ instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const regler = champ instanceof HTMLTextAreaElement || champ instanceof HTMLInputElement ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : undefined;
  const ecrire = (v: string) => {
    if (regler) regler.call(champ, v);
    else champ.value = v;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // Lettre par lettre, mais vite : une vingtaine d'étapes au plus, quelle que soit la longueur.
  const pas = Math.max(1, Math.ceil(texte.length / 24));
  for (let i = pas; i < texte.length; i += pas) {
    ecrire(texte.slice(0, i));
    await attendre(dureeDuTrajet() ? PAUSES_DES_GESTES.lettre : 0);
  }
  ecrire(texte);
  champ.dispatchEvent(new Event('change', { bubbles: true }));
}

function appuyer(touche: string): void {
  const cible = (document.activeElement as HTMLElement | null) ?? document.body;
  const init = { key: touche, code: touche === ' ' ? 'Space' : touche, bubbles: true, cancelable: true, composed: true };
  const garde = cible.dispatchEvent(new KeyboardEvent('keydown', init));
  cible.dispatchEvent(new KeyboardEvent('keyup', init));
  // « Entrée » dans un champ de formulaire soumet le formulaire, comme le clavier le ferait.
  if (garde && touche === 'Enter' && cible instanceof HTMLInputElement && cible.form) cible.form.requestSubmit();
}

interface Geste {
  action: 'ouvrir' | 'cliquer' | 'saisir' | 'touche' | 'attendre' | 'lire';
  cible?: string;
  texte?: string;
  libelle: string;
}

async function jouer(geste: Geste): Promise<{ ok: boolean; erreur?: string; rendu?: string }> {
  if (geste.action !== 'lire' && geste.libelle) poser({ libelle: geste.libelle });
  switch (geste.action) {
    case 'lire':
      return { ok: true, rendu: lireLEcran() };
    case 'ouvrir': {
      const adresse = geste.cible ?? '';
      if (!adresse.startsWith('#')) return { ok: false, erreur: 'Jarvis n’ouvre que des adresses de Beluga (« #… »).' };
      if (!etat.visible) poser({ visible: true, x: Math.round(window.innerWidth / 2), y: 72 });
      poser({ contour: null, clics: etat.clics + 1 });
      window.location.hash = adresse;
      await attendre(PAUSES_DES_GESTES.ouvrir);
      return { ok: true };
    }
    case 'cliquer': {
      const el = await attendreLaCible(geste.cible ?? '');
      const { x, y } = await allerA(el);
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, erreur: `Je ne peux pas cliquer « ${libelleDe(el) || geste.cible} » : il est grisé pour l’instant.` };
      poser({ clics: etat.clics + 1 });
      cliquerComme(el, x, y);
      await attendre(PAUSES_DES_GESTES.cliquer);
      return { ok: true };
    }
    case 'saisir': {
      const el = await attendreLaCible(geste.cible ?? '');
      await allerA(el);
      poser({ clics: etat.clics + 1 });
      await taper(el, geste.texte ?? '');
      await attendre(PAUSES_DES_GESTES.saisir);
      return { ok: true };
    }
    case 'touche':
      appuyer(geste.cible ?? 'Enter');
      await attendre(PAUSES_DES_GESTES.touche);
      return { ok: true };
    case 'attendre':
      await attendreLaCible(geste.cible ?? '', 6_000);
      return { ok: true };
    default:
      return { ok: false, erreur: 'Geste inconnu.' };
  }
}

/* ------------------------------------------------------------------ */
/* L'écoute : gestes du démon                                           */
/* ------------------------------------------------------------------ */

/*
 * PLUS DE REPRISE DE MAIN À LA SOURIS (décision de l'utilisateur, 17/11/2026 : « je veux que tu stoppes le fait qu'il
 * n'agisse plus si je bouge mon curseur ») : bouger la souris, cliquer, taper ou faire défiler ne coupe plus Jarvis.
 * Une action ne s'arrête plus que sur demande — le bouton Arrêter de sa bulle, ou la parole (le démon envoie alors
 * l'action « arretee », qui pose `interrompu`).
 */
let actionEnCours: string | null = null;
let cacher: number | null = null;

/** Arrêter l'action en cours de CET onglet, sur demande explicite (bouton ou parole) — jamais sur un geste de souris. */
export function arreterLActionDeJarvis(): void {
  const id = actionEnCours;
  if (!id) return;
  actionEnCours = null;
  interrompu = true;
  void client.call({ type: 'jarvis.action.arreter', id }).catch(() => undefined);
}

let branche = false;

/** Branche l'écoute une fois pour la page (appelé par le module de voix). */
export function brancherLesGestesDeJarvis(): void {
  if (branche || typeof window === 'undefined') return;
  branche = true;
  // Un arrêt demandé d'ailleurs (un contrôle, un autre composant) passe par le même chemin que le bouton Arrêter.
  window.addEventListener('beluga:arreter-action-jarvis', arreterLActionDeJarvis);

  window.addEventListener(EVENEMENT, (e) => {
    const ev = (e as CustomEvent).detail;
    if (ev?.type === 'voix.direct.action' && ev.client === ID_DE_L_ONGLET) {
      if (ev.statut === 'en-cours' && actionEnCours !== ev.id) interrompu = false;
      if (ev.statut === 'arretee' || ev.statut === 'annulee') interrompu = true;
      actionEnCours = ev.statut === 'en-cours' ? ev.id : null;
      if (cacher) window.clearTimeout(cacher);
      if (ev.statut !== 'en-cours') cacher = window.setTimeout(() => poser({ visible: false, contour: null, libelle: '' }), ev.statut === 'finie' ? 1_200 : 300);
      return;
    }
    if (ev?.type !== 'jarvis.geste' || ev.client !== ID_DE_L_ONGLET) return;
    if (ev.geste?.action !== 'lire') {
      actionEnCours = ev.actionId;
      if (cacher) window.clearTimeout(cacher);
    }
    void (async () => {
      let accuse: { ok: boolean; erreur?: string; arrete?: boolean; rendu?: string };
      try {
        accuse = interrompu && ev.geste?.action !== 'lire' ? { ok: false, arrete: true } : await jouer(ev.geste);
      } catch (err) {
        accuse = err instanceof Arrete ? { ok: false, arrete: true } : { ok: false, erreur: (err as Error)?.message ?? String(err) };
      }
      await client.call({ type: 'jarvis.geste.fait', id: ev.id, ...accuse }).catch(() => undefined);
    })();
  });
}
