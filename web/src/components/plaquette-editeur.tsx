import * as React from 'react';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Frame, ImageUp, Link2, Loader2, Pencil, Pipette, Plus, Trash2, Upload } from '@/components/ui/icones';
import {
  ancrerUnFil,
  attendreLesImages,
  cssDuLecteur,
  documentDeLaPlaquette,
  monterLeLecteur,
  ordonnerLesBlocs,
  paginerLeDocument,
  PAGES_DE_PLAQUETTE,
  recollerLeTexte,
  type Attachment,
  type BlocDePlaquette,
  type FilDeCommentaires,
  type FormatDePlaquette,
  type PlaquetteARendre,
  messageAMoi,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ZoneDefilement,
} from '@/components/ui';
import { ChoixDeCouleur } from '@/components/ui/elements-maison';
import { adresseDePiece, ImageDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/**
 * LE DOCUMENT MODIFIABLE SUR PLACE (carte « Refonte du service Charte graphique », 05/11/2026 — demande de
 * l'utilisateur : « l'édition du texte se fait directement dans le document », « ajouter, masquer, supprimer des
 * sections, avec des actions visibles au survol, toujours visibles sur téléphone »).
 *
 * LE DOCUMENT VIT DANS UNE OMBRE (`attachShadow`) : sa feuille de style ne touche rien de l'application, et celle de
 * l'application ne le touche pas. Il est rendu par `documentDeLaPlaquette` (mode édition) puis PAGINÉ par
 * `paginerLeDocument` — les mêmes feuilles que la page du client et le PDF.
 *
 * LES TEXTES se corrigent dans la page (`contenteditable="plaintext-only"`, et un collage réduit au texte brut :
 * aucun HTML n'entre). Pendant qu'on écrit, le document NE SE REDESSINE PAS (le curseur resterait en plan) : la
 * saisie remonte au parent, qui l'enregistre ; la mise en pages se refait quand on quitte le champ.
 *
 * PAR-DESSUS, UN CALQUE REACT : la barre d'actions de la section survolée (toutes les sections sur un écran tactile)
 * et les bulles des commentaires, posées au bord droit des feuilles comme chez le client.
 */

type Brouillon = PlaquetteARendre & { format: FormatDePlaquette };

interface Boite {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

const GENRES_AJOUTABLES: { genre: BlocDePlaquette['genre']; libelle: () => string }[] = [
  { genre: 'texte', libelle: () => t('Texte') },
  { genre: 'chiffres', libelle: () => t('Chiffres clés') },
  { genre: 'couleurs', libelle: () => t('Couleurs') },
  { genre: 'typographies', libelle: () => t('Typographies') },
];

function blocNeuf(genre: BlocDePlaquette['genre']): BlocDePlaquette {
  const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (genre === 'chiffres')
    return {
      id,
      genre,
      titre: t('Chiffres clés'),
      elements: [
        { valeur: '00', libelle: t('Libellé') },
        { valeur: '00', libelle: t('Libellé') },
        { valeur: '00', libelle: t('Libellé') },
      ],
    };
  if (genre === 'couleurs')
    return { id, genre, titre: t('Couleurs'), elements: [{ valeur: '#111111', libelle: t('Couleur principale') }, { valeur: '#ffffff', libelle: t('Fond des pages') }] };
  if (genre === 'typographies') return { id, genre, titre: t('Typographies'), elements: [{ valeur: 'Inter', libelle: t('Titres et texte courant') }] };
  return { id, genre: 'texte', titre: t('Nouvelle section'), texte: '' };
}

/** Le champ modifié, relu dans le document : le texte entier d'un champ coupé sur plusieurs feuilles. */
function lireLeChamp(racine: ShadowRoot, bloc: BlocDePlaquette, champ: string, index: number | null): BlocDePlaquette {
  const selecteur = `[data-champ="${champ}"][data-bloc-du-champ="${CSS.escape(bloc.id)}"]`;
  const noeuds = Array.from(racine.querySelectorAll<HTMLElement>(selecteur));
  const texte = (n: HTMLElement) => (n.innerText ?? n.textContent ?? '').replace(/ /g, ' ');
  if (champ === 'texte') {
    return { ...bloc, texte: recollerLeTexte(noeuds.map((n) => ({ para: n.dataset.para ?? '0', coupe: n.getAttribute('data-coupe'), texte: texte(n) }))) };
  }
  if ((champ === 'valeur' || champ === 'libelle') && index !== null) {
    const n = noeuds.find((x) => Number(x.dataset.index) === index);
    if (!n) return bloc;
    const elements = (bloc.elements ?? []).map((e, i) => (i === index ? { ...e, [champ]: texte(n).replace(/\s+/g, ' ').trim() } : e));
    return { ...bloc, elements };
  }
  const premier = noeuds[0];
  if (!premier) return bloc;
  const valeur = texte(premier).replace(/\s+/g, ' ').trim();
  return { ...bloc, [champ]: valeur || undefined };
}

/**
 * Les messages d'un fil tels que le lecteur commun les lit. « Moi » = le COMPTE connecté (comme une messagerie : les
 * messages d'un collègue sont à gauche, avec ceux du client) ; un message du client non lu le dit.
 */
function filPourLeLecteur(f: FilDeCommentaires) {
  const moi = client.state.monCompte;
  const qui = { equipe: true, ...(moi ? { compte: moi.id, nomAffiche: moi.nomAffiche } : {}) };
  return {
    ...f,
    messages: f.messages.map(({ compte, visiteur, ...m }) => ({ ...m, moi: messageAMoi({ ...m, compte, visiteur }, qui), nonLu: m.role === 'client' && !m.lu && !m.supprime })),
  };
}

/** Les libellés du lecteur commun, dans la langue de l'APPLICATION (c'est l'équipe qui lit). */
function libellesDeLEquipe() {
  return {
    pdf: t('Télécharger'),
    commenter: t('Commenter ici'),
    nouveau: t('Nouveau commentaire'),
    repondre: t('Répondre à votre client…'),
    envoyer: t('Envoyer'),
    prenom: '',
    prenomAide: '',
    erreur: t('Le commentaire n’a pas pu partir. Réessayez dans un instant.'),
    trop: t('Le commentaire n’a pas pu partir. Réessayez dans un instant.'),
    resoudre: t('Résoudre'),
    rouvrir: t('Rouvrir'),
    resolu: t('Résolu'),
    fermer: t('Fermer'),
    page: t('Page'),
    aide: '',
    aideTactile: '',
    pages: t('Pages'),
    client: t('Votre client'),
    equipe: t('L’équipe'),
    supprime: t('Message supprimé'),
    supprimer: t('Supprimer'),
    commentaire: t('Commentaire de'),
    zoom: t('Zoom'),
    zoomMoins: t('Réduire'),
    zoomPlus: t('Agrandir'),
    ajuster: t('Ajuster à la largeur'),
  };
}

/**
 * LES COULEURS DU LECTEUR COMMUN DANS L'APPLICATION : celles de la palette sombre neutre que pose `.apercu-sombre`
 * sur tout le volet (l'aperçu est foncé dans les douze palettes, clair compris : plus de variante claire ici). Les
 * variables traversent l'ombre des miniatures.
 */
const THEME_DU_LECTEUR = `
.lx-app{--lx-fond:hsl(var(--bg));--lx-minis:hsl(var(--bg));--lx-texte:hsl(var(--text));--lx-doux:hsl(var(--muted));--lx-fil:hsl(var(--raised));--lx-fil-texte:hsl(var(--text));--lx-fil-doux:hsl(var(--muted));--lx-champ:hsl(var(--bg));--lx-survol:hsl(var(--fond-survol));--lx-moi:hsl(var(--fond-survol));--lx-moi-texte:hsl(var(--text));--lx-autre:hsl(var(--bg));--lx-autre-texte:hsl(var(--text));--lx-plus:hsl(var(--raised));--lx-plus-texte:hsl(var(--text));--lx-courante:hsl(var(--text));--lx-danger:hsl(var(--danger));--lx-ombre:rgba(0,0,0,.45);--lx-avatar:hsl(var(--fond-survol));--lx-avatar-texte:hsl(var(--text));--lx-zoom-fond:hsl(var(--bg));--lx-zoom-texte:hsl(var(--text));--lx-zoom-survol:hsl(var(--raised))}
`;

const LARGEUR_DES_MINIATURES = 92;
/** L'espace entre deux feuilles, à l'écran (après le zoom) : la barre de la page s'y pose, sans toucher le contenu. */
const ECART_ENTRE_FEUILLES = 48;
/** La hauteur de la barre de page (boutons de 28 px et leur marge). */
const HAUTEUR_DE_BARRE = 32;
/** La feuille remplit la largeur de la zone (carte « Finitions du lecteur de charte ») : agrandie jusqu'à ce plafond. */
const PLAFOND_DU_ZOOM = 1.5;

/** Ce que la page du document demande au lecteur : aller à un commentaire (la liste des commentaires du haut). */
export interface PoigneeDuLecteur {
  allerAuFil: (id: string) => void;
}

/**
 * LE ZOOM POSÉ SUR LES FEUILLES : le zoom lui-même, et les écarts entre feuilles divisés par lui (écrits AVANT le zoom
 * de `.pages`, ils gardent ainsi leur taille à l'écran — la barre de la page tient toujours dans l'espace au-dessus).
 */
function poserLeZoom(pages: HTMLElement, zoom: number) {
  pages.style.setProperty('zoom', String(zoom));
  pages.style.setProperty('--lx-ecart', `${Math.round(ECART_ENTRE_FEUILLES / zoom)}px`);
  pages.style.setProperty('--lx-bas', `${Math.round(112 / zoom)}px`);
}

/** Ce qu'on retouche sous le pointeur : une image, une couleur, un fichier, un chiffre ou un bouton d'une section. */
interface ElementVise {
  bloc: string;
  genre: 'image' | 'couleur' | 'ressource' | 'chiffre' | 'bouton';
  index: number;
  boite: Boite;
}

export function DocumentModifiable({
  brouillon,
  langue,
  fils,
  plaquetteId,
  projectId,
  lecture,
  voirResolus,
  pieces,
  onBlocs,
  onPages,
  onEditer,
  poignee,
  sansMiniatures = false,
}: {
  brouillon: Brouillon;
  langue: string;
  fils: FilDeCommentaires[];
  plaquetteId: string;
  /** Le projet du document : « Remplacer » une image y choisit ou y envoie la nouvelle. */
  projectId: string;
  /** LA LECTURE (bouton « Éditer » éteint) : rien ne se modifie, aucune barre ; les commentaires restent. */
  lecture: boolean;
  voirResolus: boolean;
  /** Le nom et le type des pièces citées (la liste des ressources). */
  pieces?: Record<string, { nom: string; mime?: string }>;
  /** Une modification des blocs (texte, ordre, section ajoutée, masquée, supprimée, cadre) : le parent l'enregistre. */
  onBlocs: (blocs: BlocDePlaquette[]) => void;
  /** Les sections présentes sur chaque feuille, après chaque mise en pages (le choix des pages les numérote). */
  onPages?: (pages: string[][]) => void;
  /** EN LECTURE, l'icône « Éditer » paraît au coin haut droit de la feuille survolée (ordinateur) : elle ouvre l'édition. */
  onEditer?: () => void;
  /** Rempli une fois le lecteur monté : la page s'en sert pour aller à un commentaire. */
  poignee?: React.MutableRefObject<PoigneeDuLecteur | null>;
  /** LE DOCUMENT DANS LE VOLET d'une charte (à droite de son agent) : pas de bande des miniatures, la feuille prend la largeur. */
  sansMiniatures?: boolean;
}) {
  const telephone = useTelephone();
  const conteneur = React.useRef<HTMLDivElement>(null);
  const calque = React.useRef<HTMLDivElement>(null);
  const calqueDuLecteur = React.useRef<HTMLDivElement>(null);
  const hote = React.useRef<HTMLDivElement>(null);
  const ombre = React.useRef<ShadowRoot | null>(null);
  const hoteMinis = React.useRef<HTMLDivElement>(null);
  const hoteZoom = React.useRef<HTMLDivElement>(null);
  const ombreMinis = React.useRef<ShadowRoot | null>(null);
  const lecteur = React.useRef<ReturnType<typeof monterLeLecteur> | null>(null);
  const blocsRef = React.useRef(brouillon.blocs as BlocDePlaquette[]);
  blocsRef.current = brouillon.blocs as BlocDePlaquette[];
  const onBlocsRef = React.useRef(onBlocs);
  onBlocsRef.current = onBlocs;
  const onPagesRef = React.useRef(onPages);
  onPagesRef.current = onPages;
  const filsRef = React.useRef(fils);
  filsRef.current = fils;
  const piecesRef = React.useRef(pieces);
  piecesRef.current = pieces;
  const lectureRef = React.useRef(lecture);
  lectureRef.current = lecture;
  const enSaisie = React.useRef(false);
  const [largeur, setLargeur] = React.useState(0);
  const [version, setVersion] = React.useState(0);
  const [pret, setPret] = React.useState(false);
  const [feuilles, setFeuilles] = React.useState<{ boite: Boite; bloc: string | null }[]>([]);
  /* La feuille survolée (sa barre paraît) et l'élément visé (la sienne aussi). */
  const [survol, setSurvol] = React.useState<number | null>(null);
  const [element, setElement] = React.useState<ElementVise | null>(null);
  /* Le haut visible de la zone (en lecture seulement) : l'icône « Éditer » d'une feuille longue reste à l'écran. */
  const [hautVisible, setHautVisible] = React.useState(0);
  const tactile = React.useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches, []);
  const couleur = brouillon.marque.couleur;

  /* La largeur disponible : les feuilles l'occupent entière, sans la marge de la page du client. */
  React.useEffect(() => {
    const el = conteneur.current;
    if (!el) return;
    const mesurer = () => setLargeur(Math.round(el.clientWidth));
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* Le rendu attend une courte pause (une couleur glissée ne redessine pas à chaque pas), et jamais pendant la saisie. */
  const [differe, setDiffere] = React.useState(brouillon);
  React.useEffect(() => {
    const m = setTimeout(() => {
      if (!enSaisie.current) setDiffere(brouillon);
    }, 220);
    return () => clearTimeout(m);
  }, [brouillon, version]);

  const mesurer = React.useCallback(() => {
    const racine = ombre.current;
    const c = calque.current;
    if (!racine || !c) return;
    /* Les boîtes sont lues par rapport au calque, qui défile avec le document : rien à recalculer au défilement. */
    const cb = c.getBoundingClientRect();
    const boite = (n: Element): Boite => {
      const r = n.getBoundingClientRect();
      return { top: r.top - cb.top, left: r.left - cb.left, right: r.right - cb.left, bottom: r.bottom - cb.top };
    };
    const liste = feuillesDe(racine);
    const pages = liste.map((f) => {
      const ids: string[] = [];
      const propre = f.dataset.bloc;
      if (propre) ids.push(propre);
      f.querySelectorAll<HTMLElement>('[data-bloc]').forEach((n) => {
        if (!ids.includes(n.dataset.bloc!)) ids.push(n.dataset.bloc!);
      });
      return ids;
    });
    /* LA SECTION D'UNE FEUILLE : la sienne (couverture, partie, diapositive), sinon la première qu'elle porte — suite comprise. */
    setFeuilles(liste.map((f, i) => ({ boite: boite(f), bloc: pages[i]![0] ?? null })));
    onPagesRef.current?.(pages);
  }, []);

  /* L'API DES FILS DU LECTEUR COMMUN, côté équipe : le protocole de Beluga. */
  const api = React.useMemo(() => {
    const appel = (cmd: Record<string, unknown>) =>
      client
        .call<{ fil: FilDeCommentaires }>(cmd as never)
        .then((r) => ({ ok: true, fil: filPourLeLecteur(r.fil) }))
        .catch(() => ({ ok: false, statut: 0 }));
    return {
      creer: (c: { texte: string; page: number; y: number; bloc?: string }) => appel({ type: 'plaquettes.commenter', id: plaquetteId, texte: c.texte, page: c.page, y: c.y, ...(c.bloc ? { bloc: c.bloc } : {}) }),
      repondre: (fil: string, c: { texte: string }) => appel({ type: 'plaquettes.repondre', id: plaquetteId, fil, texte: c.texte }),
      resoudre: (fil: string, resolu: boolean) => appel({ type: 'plaquettes.resoudre', id: plaquetteId, fil, resolu }),
      supprimer: (fil: string, message: string) => appel({ type: 'plaquettes.supprimerMessage', id: plaquetteId, fil, message }),
      lu: (fil: string) => void client.call({ type: 'plaquettes.lues', id: plaquetteId, fil }).catch(() => undefined),
    };
  }, [plaquetteId]);

  /*
   * LE DESSIN, SANS RECHARGEMENT (carte « Finitions du lecteur de charte ») : la nouvelle version est rendue HORS
   * ÉCRAN dans l'ombre (`.tampon`), chargée, paginée, puis ÉCHANGÉE avec l'ancienne — le défilement reste où il était,
   * aucune silhouette après le premier affichage, le lecteur commun garde ses bulles (il relit seulement les feuilles).
   */
  React.useEffect(() => {
    const h = hote.current;
    if (!h || !largeur) return;
    const racine = ombre.current ?? (ombre.current = h.attachShadow({ mode: 'open' }));
    let vivant = true;
    const d = documentDeLaPlaquette(differe, {
      mode: 'document',
      langue,
      image: (id) => adresseDePiece(id),
      infoDePiece: (id) => piecesRef.current?.[id] ?? null,
      telechargement: (id) => adresseDePiece(id, true),
      edition: {
        masquee: t('Masquée'),
        titre: t('Titre'),
        texte: t('Écrire ici…'),
        horsClient: t('Pas sur la page du client'),
        horsPdf: t('Pas dans le PDF'),
        horsLesDeux: t('Ni chez le client, ni dans le PDF'),
      },
    });
    const page = PAGES_DE_PLAQUETTE[d.format];
    /* Un changement de format change la feuille de référence du zoom « Ajuster » — avant de lire ce zoom. */
    lecteur.current?.dimensions(page.largeurPx, page.hauteurPx);
    const marge = tactile || largeur < 640 ? 16 : 40;
    /* LE ZOOM CHOISI (liste, boutons, molette, pincement) est tenu par le lecteur commun : il survit au redessin. */
    const zoom = lecteur.current ? lecteur.current.zoom() : Math.min(PLAFOND_DU_ZOOM, Math.max(0.2, (largeur - marge) / page.largeurPx));
    let style = enfantDe<HTMLStyleElement>(racine, 'style[data-doc]');
    if (!style) {
      racine.innerHTML = '<style data-doc></style><div class="tampon" aria-hidden="true"></div>';
      style = enfantDe<HTMLStyleElement>(racine, 'style[data-doc]')!;
    }
    style.textContent = `${d.css}
      :host{display:block;position:relative}
      .pages{display:flex;flex-direction:column;align-items:safe center;gap:var(--lx-ecart,48px);padding:var(--lx-ecart,48px) 0 var(--lx-bas,112px)}
      .pages > .feuille{box-shadow:0 12px 34px rgba(0,0,0,.16),0 2px 6px rgba(0,0,0,.1)}
      [data-champ]{white-space:pre-wrap}
      .tampon{position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none}`;
    const tampon = enfantDe<HTMLElement>(racine, '.tampon')!;
    tampon.innerHTML = d.corps;
    const neuve = tampon.querySelector<HTMLElement>('.pages')!;
    void attendreLesImages(neuve).then(() => {
      if (!vivant) return;
      paginerLeDocument(neuve);
      poserLeZoom(neuve, zoom);
      rendreModifiable(neuve, !lectureRef.current);
      const defile = conteneur.current;
      const haut = defile?.scrollTop ?? 0;
      const vieille = enfantDe(racine, '.pages');
      if (vieille) racine.replaceChild(neuve, vieille);
      else racine.appendChild(neuve);
      tampon.textContent = '';
      if (defile) defile.scrollTop = haut;
      /* LES MINIATURES vivent dans leur propre ombre, avec la feuille de style du document. */
      let minis: HTMLElement | null = null;
      const hm = hoteMinis.current;
      if (hm) {
        const om = ombreMinis.current ?? (ombreMinis.current = hm.attachShadow({ mode: 'open' }));
        if (!om.querySelector('.lx-minis-liste')) om.innerHTML = '<style data-doc></style><div class="lx-minis-liste"></div>';
        om.querySelector('style[data-doc]')!.textContent = `${d.css}${cssDuLecteur(couleur, '#ffffff')}
          :host{display:block}
          .lx-minis-liste{display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 0 48px}`;
        minis = om.querySelector<HTMLElement>('.lx-minis-liste');
      }
      mesurer();
      setPret(true);
      setElement(null);
      const cadre = calque.current;
      const lx = calqueDuLecteur.current;
      if (!defile || !cadre || !lx) return;
      if (lecteur.current) {
        lecteur.current.rafraichir(neuve);
        return;
      }
      lecteur.current = monterLeLecteur({
        racine: neuve,
        defile,
        conteneur: cadre,
        calque: lx,
        minis,
        zoomHote: hoteZoom.current,
        surZoom: (z: number) => {
          const pg = ombre.current ? enfantDe<HTMLElement>(ombre.current, '.pages') : null;
          if (pg) poserLeZoom(pg, z);
          requestAnimationFrame(() => mesurer());
        },
        R: {
          langue,
          largeur: page.largeurPx,
          hauteur: page.hauteurPx,
          max: 2000,
          maxNom: 80,
          prenom: false,
          mini: LARGEUR_DES_MINIATURES,
          zoomAuto: true,
          margeZoom: 40,
          margePetit: 16,
          plafond: PLAFOND_DU_ZOOM,
          voirResolus,
          dedans: true,
        },
        L: libellesDeLEquipe(),
        ancrer: ancrerUnFil,
        api,
        ignorer: (n: Element) => !!n.closest?.('[data-plaquette-barre-section],[data-plaquette-barre-element],[data-plaquette-editer-page]'),
      });
      if (poignee) poignee.current = { allerAuFil: (id) => lecteur.current?.allerAuFil(id) };
      lecteur.current.maj(filsRef.current.map(filPourLeLecteur));
    });
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [differe, langue, largeur, tactile, mesurer, api, couleur]);

  React.useEffect(
    () => () => {
      lecteur.current?.detruire();
      if (poignee) poignee.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  /* Les commentaires suivent sans redessiner le document. */
  React.useEffect(() => {
    lecteur.current?.maj(fils.map(filPourLeLecteur));
  }, [fils]);
  React.useEffect(() => {
    lecteur.current?.resolus(voirResolus);
  }, [voirResolus]);
  /* LECTURE ↔ ÉDITION : sans redessiner — les champs deviennent (ou cessent d'être) modifiables. */
  React.useEffect(() => {
    const pages = ombre.current ? enfantDe<HTMLElement>(ombre.current, '.pages') : null;
    if (!pages) return;
    rendreModifiable(pages, !lecture);
    if (lecture) {
      (ombre.current?.activeElement as HTMLElement | null)?.blur?.();
      setElement(null);
    }
  }, [lecture, pret]);

  /* LA SAISIE : chaque frappe remonte au parent ; le collage n'apporte que du texte ; Entrée ne casse pas un titre. */
  React.useEffect(() => {
    const racine = ombre.current;
    if (!racine) return;
    const champDe = (e: Event) => (e.target as HTMLElement | null)?.closest?.('[data-champ]') as HTMLElement | null;
    const surSaisie = (e: Event) => {
      const n = champDe(e);
      if (!n || lectureRef.current) return;
      const id = n.dataset.blocDuChamp!;
      const bloc = blocsRef.current.find((b) => b.id === id);
      if (!bloc) return;
      const index = n.dataset.index !== undefined ? Number(n.dataset.index) : null;
      const neuf = lireLeChamp(racine, bloc, n.dataset.champ!, index);
      onBlocsRef.current(blocsRef.current.map((b) => (b.id === id ? neuf : b)));
    };
    const surCollage = (e: Event) => {
      const ce = e as ClipboardEvent;
      if (!champDe(e) || lectureRef.current) return;
      ce.preventDefault();
      const texte = ce.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, texte);
    };
    const surTouche = (e: Event) => {
      const ke = e as KeyboardEvent;
      const n = champDe(e);
      if (!n) return;
      if (ke.key === 'Enter' && n.dataset.champ !== 'texte') {
        ke.preventDefault();
        n.blur();
      }
      if (ke.key === 'Escape') n.blur();
    };
    const entree = (e: Event) => {
      if (champDe(e) && !lectureRef.current) enSaisie.current = true;
    };
    const sortie = (e: Event) => {
      if (!champDe(e) || !enSaisie.current) return;
      enSaisie.current = false;
      /* On quitte le champ : la mise en pages se refait avec le texte écrit. */
      setVersion((v) => v + 1);
    };
    /* LE SURVOL : la feuille sous le pointeur (sa barre), et l'élément retouchable sous lui (la sienne). Dans l'espace
       entre deux feuilles, rien ne change : la barre de la feuille du dessous reste là pour qu'on la rejoigne. */
    const surSurvol = (e: Event) => {
      const cible = e.target as HTMLElement | null;
      const f = cible?.closest?.('.feuille') as HTMLElement | null;
      if (f) {
        const liste = feuillesDe(racine);
        const i = liste.indexOf(f);
        if (i >= 0) setSurvol(i);
      }
      /* En lecture, seule la feuille survolée compte : son icône « Éditer ». */
      if (lectureRef.current) return;
      const n = cible?.closest?.('[data-element]') as HTMLElement | null;
      if (!n) {
        if (f) setElement(null);
        return;
      }
      const c = calque.current;
      if (!c) return;
      const cb = c.getBoundingClientRect();
      const r = n.getBoundingClientRect();
      setElement({
        bloc: n.dataset.elementBloc!,
        genre: n.dataset.element as ElementVise['genre'],
        index: Number(n.dataset.elementIndex ?? 0),
        boite: { top: r.top - cb.top, left: r.left - cb.left, right: r.right - cb.left, bottom: r.bottom - cb.top },
      });
    };
    racine.addEventListener('input', surSaisie);
    racine.addEventListener('paste', surCollage);
    racine.addEventListener('keydown', surTouche);
    racine.addEventListener('focusin', entree);
    racine.addEventListener('focusout', sortie);
    racine.addEventListener('pointerover', surSurvol);
    return () => {
      racine.removeEventListener('input', surSaisie);
      racine.removeEventListener('paste', surCollage);
      racine.removeEventListener('keydown', surTouche);
      racine.removeEventListener('focusin', entree);
      racine.removeEventListener('focusout', sortie);
      racine.removeEventListener('pointerover', surSurvol);
    };
  }, [pret]);

  /* Toute modification range les fichiers à télécharger en dernier, comme le serveur. */
  const changer = (blocs: BlocDePlaquette[]) => onBlocsRef.current(ordonnerLesBlocs(blocs));
  const deplacer = (id: string, pas: -1 | 1) => {
    const b = [...blocsRef.current];
    const i = b.findIndex((x) => x.id === id);
    const j = i + pas;
    if (i < 0 || j < 0 || j >= b.length) return;
    /* Les fichiers à télécharger restent la dernière page : rien ne passe après eux, et eux ne bougent pas. */
    if (b[i]!.genre === 'ressources' || b[j]!.genre === 'ressources') return;
    [b[i], b[j]] = [b[j]!, b[i]!];
    changer(b);
  };
  const ajouterApres = (id: string, genre: BlocDePlaquette['genre']) => {
    const b = [...blocsRef.current];
    const i = b.findIndex((x) => x.id === id);
    b.splice(i + 1, 0, blocNeuf(genre));
    changer(b);
  };
  const basculerMasque = (id: string) => changer(blocsRef.current.map((b) => (b.id === id ? { ...b, masque: !b.masque || undefined } : b)));
  const retirer = (id: string) => changer(blocsRef.current.filter((b) => b.id !== id));
  const regler = (id: string, patch: Partial<BlocDePlaquette>) => changer(blocsRef.current.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  /* Les gestes d'un ÉLÉMENT : sa pièce ou son entrée de liste, par son rang dans la section. */
  const retirerElement = (e: ElementVise) => {
    setElement(null);
    changer(
      blocsRef.current.map((b) => {
        if (b.id !== e.bloc) return b;
        if (e.genre === 'image' || e.genre === 'ressource') {
          const pieces = (b.pieces ?? []).filter((_, i) => i !== e.index);
          return { ...b, pieces: pieces.length ? pieces : undefined };
        }
        if (e.genre === 'bouton') return { ...b, bouton: undefined, lien: undefined };
        const elements = (b.elements ?? []).filter((_, i) => i !== e.index);
        return { ...b, elements: elements.length ? elements : undefined };
      }),
    );
  };
  const remplacerImage = (e: ElementVise, piece: string) =>
    changer(blocsRef.current.map((b) => (b.id === e.bloc ? { ...b, pieces: (b.pieces ?? []).map((p, i) => (i === e.index ? piece : p)) } : b)));
  const changerTeinte = (e: ElementVise, valeur: string) =>
    changer(blocsRef.current.map((b) => (b.id === e.bloc ? { ...b, elements: (b.elements ?? []).map((x, i) => (i === e.index ? { ...x, valeur } : x)) } : b)));
  const ajouterChiffre = (e: ElementVise) => {
    setElement(null);
    changer(
      blocsRef.current.map((b) => {
        if (b.id !== e.bloc) return b;
        const elements = [...(b.elements ?? [])];
        elements.splice(e.index + 1, 0, { valeur: '00', libelle: t('Libellé') });
        return { ...b, elements };
      }),
    );
  };

  /* Les feuilles à munir de leur barre : la survolée, ou toutes sur un écran tactile ; aucune en lecture. */
  const munies = lecture || !pret ? [] : tactile ? feuilles.map((_, i) => i) : survol !== null && feuilles[survol] ? [survol] : [];
  const blocVise = element ? blocsRef.current.find((b) => b.id === element.bloc) : undefined;
  const rangDe = (id: string) => blocsRef.current.findIndex((b) => b.id === id);

  return (
    <div className="lx-app flex min-h-0 flex-1" data-plaquette-lecteur-commun data-plaquette-mode={lecture ? 'lecture' : 'edition'}>
      <style>{cssDuLecteur(couleur, lisibleSur(couleur)) + THEME_DU_LECTEUR}</style>
      {/* LA BANDE DES MINIATURES, entre la liste des documents et le document (ordinateur seulement, comme chez le client). */}
      {/* Dans le volet, la bande reste MONTÉE mais cachée : le lecteur, monté une fois, la retrouve en grand. */}
      {!telephone ? (
        <ZoneDefilement classeEnveloppe={sansMiniatures ? 'hidden' : 'w-[124px] flex-none'} className="h-full min-h-0" data-plaquette-miniatures>
          <div ref={hoteMinis} />
        </ZoneDefilement>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* LE ZOOM, EN HAUT AU CENTRE DU DOCUMENT (décision de l'utilisateur) : la barre du lecteur commun se pose ici. */}
      <div ref={hoteZoom} className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 [&>*]:pointer-events-auto" data-plaquette-zoom />
      <ZoneDefilement
        ref={conteneur}
        classeEnveloppe="min-w-0"
        className="relative h-full min-h-0 min-w-0 !overflow-x-auto"
        onScroll={(e) => {
          if (lectureRef.current) setHautVisible(e.currentTarget.scrollTop);
        }}
        onPointerLeave={() => {
          if (tactile) return;
          setSurvol(null);
          setElement(null);
        }}
        data-plaquette-document-zone
        data-plaquette-pret={pret ? '1' : '0'}
      >
        <div ref={calque} className="relative">
          <div ref={hote} data-plaquette-ombre />
          {!pret ? <div className="absolute inset-x-0 top-6 mx-auto h-[60vh] w-[min(560px,80%)] animate-silhouette rounded-md bg-raised" /> : null}
          <div className="pointer-events-none absolute inset-0">
            {munies.map((i) => {
              const f = feuilles[i]!;
              const b = f.bloc ? blocsRef.current.find((x) => x.id === f.bloc) : undefined;
              if (!b) return null;
              const rang = rangDe(b.id);
              const total = blocsRef.current.length;
              const suivant = blocsRef.current[rang + 1];
              const ressources = b.genre === 'ressources';
              return (
                <BarreDePage
                  key={i}
                  page={i + 1}
                  bloc={b}
                  peutMonter={rang > 0 && !ressources}
                  peutDescendre={rang < total - 1 && !ressources && suivant?.genre !== 'ressources'}
                  peutSupprimer={total > 1}
                  style={{ top: Math.max(2, f.boite.top - (ECART_ENTRE_FEUILLES + HAUTEUR_DE_BARRE) / 2), left: f.boite.right }}
                  onSurvol={() => setSurvol(i)}
                  onMonter={() => deplacer(b.id, -1)}
                  onDescendre={() => deplacer(b.id, 1)}
                  onAjouter={(g) => ajouterApres(b.id, g)}
                  onMasquer={() => basculerMasque(b.id)}
                  onRetirer={() => retirer(b.id)}
                />
              );
            })}
            {/* LIRE → ÉDITER (décision de l'utilisateur) : en lecture, une icône seule au coin haut droit de la feuille
                survolée, dans l'espace au-dessus d'elle — là où l'édition pose la barre de la page. */}
            {lecture && pret && onEditer && !tactile && survol !== null && feuilles[survol] ? (
              <Button
                size="icon-sm"
                variant="ghost"
                className="pointer-events-auto absolute h-8 w-8 -translate-x-full rounded-lg bg-bg text-muted shadow-lg hover:bg-raised hover:text-text"
                style={{
                  /* Dans l'espace au-dessus de la feuille ; si ce haut est passé sous le bord, en haut de ce qu'on voit d'elle. */
                  top: Math.max(
                    2,
                    Math.min(Math.max(feuilles[survol]!.boite.top - (ECART_ENTRE_FEUILLES + HAUTEUR_DE_BARRE) / 2, hautVisible + 8), feuilles[survol]!.boite.bottom - HAUTEUR_DE_BARRE - 8),
                  ),
                  left: feuilles[survol]!.boite.right,
                }}
                onClick={onEditer}
                title={t('Éditer')}
                aria-label="Éditer"
                data-plaquette-editer
                data-plaquette-editer-page={survol + 1}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
            {!lecture && pret && element && blocVise ? (
              <BarreDElement
                key={`${element.bloc}:${element.genre}:${element.index}`}
                element={element}
                bloc={blocVise}
                projectId={projectId}
                style={{ top: element.boite.top + 6, left: element.boite.right - 6 }}
                onRetirer={() => retirerElement(element)}
                onRemplacer={(piece) => remplacerImage(element, piece)}
                onTeinte={(v) => changerTeinte(element, v)}
                onAjouterChiffre={() => ajouterChiffre(element)}
                onRegler={(patch) => regler(element.bloc, patch)}
              />
            ) : null}
          </div>
          {/* LE CALQUE DU LECTEUR COMMUN : le « + » qui suit le bord, les bulles, la discussion. */}
          <div ref={calqueDuLecteur} className="lx-calque" data-plaquette-calque-lecteur />
        </div>
      </ZoneDefilement>
      </div>
    </div>
  );
}

/**
 * UN ENFANT DIRECT DE L'OMBRE. `:scope > …` ne vise rien depuis une racine d'ombre (ce n'est pas un élément) : on
 * parcourt ses enfants. Le document visible est la `.pages` posée à la racine — jamais celle du tampon, rendue hors écran.
 */
function enfantDe<T extends Element = Element>(racine: ShadowRoot, selecteur: string): T | null {
  return (Array.from(racine.children).find((n) => n.matches(selecteur)) as T | undefined) ?? null;
}
function feuillesDe(racine: ShadowRoot): HTMLElement[] {
  const pages = enfantDe<HTMLElement>(racine, '.pages');
  return pages ? (Array.from(pages.children).filter((n) => n.classList.contains('feuille')) as HTMLElement[]) : [];
}

/** Les champs du document modifiables (édition) ou figés (lecture), et la classe qui retire leurs invites. */
function rendreModifiable(pages: HTMLElement, modifiable: boolean) {
  pages.classList.toggle('lecture', !modifiable);
  pages.querySelectorAll<HTMLElement>('[data-champ]').forEach((n) => {
    if (!modifiable) {
      n.contentEditable = 'false';
      return;
    }
    try {
      n.contentEditable = 'plaintext-only';
    } catch {
      n.contentEditable = 'true';
    }
    n.spellcheck = true;
  });
}

/** Blanc ou presque noir, selon ce qui se lit sur la couleur de la marque (l'initiale des bulles). */
function lisibleSur(fond: string): string {
  const n = parseInt(fond.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 ? '#111111' : '#ffffff';
}

const CLASSE_BOUTON_DE_BARRE = 'h-7 w-7 rounded-md text-muted hover:bg-raised hover:text-text';

/**
 * LA BARRE D'UNE PAGE (décision de l'utilisateur : « une section étant une page, une seule barre pour la page »),
 * posée dans l'espace AU-DESSUS de la feuille, calée sur son bord droit — jamais sur le contenu. Elle vise la section de
 * la feuille (la suite d'une section longue comprise) : monter, descendre, ajouter une page après, masquer, supprimer.
 */
function BarreDePage({
  page,
  bloc,
  peutMonter,
  peutDescendre,
  peutSupprimer,
  style,
  onSurvol,
  onMonter,
  onDescendre,
  onAjouter,
  onMasquer,
  onRetirer,
}: {
  page: number;
  bloc: BlocDePlaquette;
  peutMonter: boolean;
  peutDescendre: boolean;
  peutSupprimer: boolean;
  style: React.CSSProperties;
  onSurvol: () => void;
  onMonter: () => void;
  onDescendre: () => void;
  onAjouter: (genre: BlocDePlaquette['genre']) => void;
  onMasquer: () => void;
  onRetirer: () => void;
}) {
  const [confirmer, setConfirmer] = React.useState(false);
  return (
    <div
      className="pointer-events-auto absolute flex -translate-x-full items-center gap-0.5 rounded-lg bg-bg p-0.5 shadow-lg"
      style={style}
      onPointerEnter={onSurvol}
      data-plaquette-barre-section={bloc.id}
      data-plaquette-barre-page={page}
    >
      <Button size="icon-sm" variant="ghost" className={CLASSE_BOUTON_DE_BARRE} disabled={!peutMonter} onClick={onMonter} title={t('Monter')} aria-label="Monter" data-plaquette-monter>
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" className={CLASSE_BOUTON_DE_BARRE} disabled={!peutDescendre} onClick={onDescendre} title={t('Descendre')} aria-label="Descendre" data-plaquette-descendre>
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" className={CLASSE_BOUTON_DE_BARRE} title={t('Ajouter une page après')} aria-label="Ajouter une page après" data-plaquette-ajouter>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('Ajouter une page après')}</DropdownMenuLabel>
          {GENRES_AJOUTABLES.map((g) => (
            <DropdownMenuItem key={g.genre} onSelect={() => onAjouter(g.genre)} data-plaquette-ajouter-genre={g.genre}>
              {g.libelle()}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon-sm"
        variant="ghost"
        className={CLASSE_BOUTON_DE_BARRE}
        onClick={onMasquer}
        title={bloc.masque ? t('Afficher cette page') : t('Masquer cette page (ni le client ni le PDF ne la voient)')}
        aria-label={bloc.masque ? 'Afficher' : 'Masquer'}
        data-plaquette-masquer={bloc.masque ? 'masquee' : 'visible'}
      >
        {bloc.masque ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className={cn(CLASSE_BOUTON_DE_BARRE, 'hover:text-danger')}
        disabled={!peutSupprimer}
        onClick={() => setConfirmer(true)}
        title={t('Supprimer cette page')}
        aria-label="Supprimer"
        data-plaquette-supprimer-section
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        open={confirmer}
        title={t('Supprimer cette page ?')}
        description={t('Elle disparaît du document, de la page du client et du PDF. Pour la cacher sans la perdre, masquez-la plutôt.')}
        confirmLabel={t('Supprimer')}
        danger
        onConfirm={() => {
          setConfirmer(false);
          onRetirer();
        }}
        onClose={() => setConfirmer(false)}
      />
    </div>
  );
}

/**
 * LA BARRE D'UN ÉLÉMENT (décision de l'utilisateur : « une barre adaptée à l'élément dans la page pour le modifier »),
 * posée dans son coin haut droit au survol (au toucher sur téléphone) :
 *  - une image : son cadre, la remplacer, la retirer ;
 *  - une couleur : changer la teinte, la retirer ;
 *  - un fichier à télécharger : le retirer ;
 *  - un chiffre : le retirer, en ajouter un à côté ;
 *  - le bouton d'un appel : son lien.
 * Le texte, lui, se corrige toujours en cliquant dedans.
 */
function BarreDElement({
  element,
  bloc,
  projectId,
  style,
  onRetirer,
  onRemplacer,
  onTeinte,
  onAjouterChiffre,
  onRegler,
}: {
  element: ElementVise;
  bloc: BlocDePlaquette;
  projectId: string;
  style: React.CSSProperties;
  onRetirer: () => void;
  onRemplacer: (piece: string) => void;
  onTeinte: (valeur: string) => void;
  onAjouterChiffre: () => void;
  onRegler: (patch: Partial<BlocDePlaquette>) => void;
}) {
  const [lien, setLien] = React.useState<string | null>(null);
  const [choisir, setChoisir] = React.useState(false);
  const { genre } = element;
  const teinte = bloc.elements?.[element.index]?.valeur ?? '#000000';
  const avecCadre = genre === 'image' && bloc.genre !== 'logo';
  return (
    <div
      className="pointer-events-auto absolute flex -translate-x-full items-center gap-0.5 rounded-lg bg-bg p-0.5 shadow-lg"
      style={style}
      data-plaquette-barre-element={genre}
      data-plaquette-element-bloc={bloc.id}
      data-plaquette-element-index={element.index}
    >
      {avecCadre ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className={CLASSE_BOUTON_DE_BARRE} title={t('Cadre de l’image')} aria-label="Cadre de l’image" data-plaquette-cadre>
              <Frame className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('Cadre')}</DropdownMenuLabel>
            {(
              [
                ['navigateur', t('Navigateur (un site)')],
                ['telephone', t('Téléphone (un mobile, une application)')],
                ['aucun', t('Sans cadre')],
              ] as const
            ).map(([valeur, libelle]) => (
              <DropdownMenuItem key={valeur} onSelect={() => onRegler({ appareil: valeur })} data-plaquette-cadre-choix={valeur}>
                <span className="flex w-4 justify-center">{(bloc.appareil ?? 'aucun') === valeur ? <Check className="h-3.5 w-3.5" /> : null}</span>
                {libelle}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onRegler({ zoom: bloc.zoom ? undefined : true })} data-plaquette-zoom>
              <span className="flex w-4 justify-center">{bloc.zoom ? <Check className="h-3.5 w-3.5" /> : null}</span>
              {t('Zoom sur un détail (l’image remplit son cadre)')}
            </DropdownMenuItem>
            {bloc.genre === 'image' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t('Bord de la page')}</DropdownMenuLabel>
                {(
                  [
                    [undefined, t('Dans les marges')],
                    ['gauche', t('Touche le bord gauche')],
                    ['droite', t('Touche le bord droit')],
                  ] as const
                ).map(([valeur, libelle]) => (
                  <DropdownMenuItem key={valeur ?? 'aucun'} onSelect={() => onRegler({ aBord: valeur })} data-plaquette-bord={valeur ?? 'aucun'}>
                    <span className="flex w-4 justify-center">{bloc.aBord === valeur ? <Check className="h-3.5 w-3.5" /> : null}</span>
                    {libelle}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {genre === 'image' ? (
        <Button size="icon-sm" variant="ghost" className={CLASSE_BOUTON_DE_BARRE} onClick={() => setChoisir(true)} title={t('Remplacer l’image')} aria-label="Remplacer l’image" data-plaquette-remplacer>
          <ImageUp className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {genre === 'couleur' ? (
        <ChoixDeCouleur
          valeur={teinte}
          onApercu={onTeinte}
          onValider={onTeinte}
          aria-label="Changer la teinte"
          title={t('Changer la teinte')}
          declencheur={
            <span className={cn(CLASSE_BOUTON_DE_BARRE, 'inline-flex items-center justify-center')}>
              <Pipette className="h-3.5 w-3.5" />
            </span>
          }
          data-plaquette-teinte
        />
      ) : null}
      {genre === 'chiffre' ? (
        <Button size="icon-sm" variant="ghost" className={CLASSE_BOUTON_DE_BARRE} onClick={onAjouterChiffre} title={t('Ajouter un chiffre à côté')} aria-label="Ajouter un chiffre à côté" data-plaquette-ajouter-chiffre>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {genre === 'bouton' ? (
        <Button size="icon-sm" variant="ghost" className={CLASSE_BOUTON_DE_BARRE} title={t('Lien du bouton')} aria-label="Lien du bouton" onClick={() => setLien(bloc.lien ?? '')} data-plaquette-lien-bouton>
          <Link2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="ghost"
        className={cn(CLASSE_BOUTON_DE_BARRE, 'hover:text-danger')}
        onClick={onRetirer}
        title={genre === 'image' ? t('Retirer l’image') : genre === 'couleur' ? t('Retirer la couleur') : genre === 'ressource' ? t('Retirer le fichier') : genre === 'chiffre' ? t('Retirer le chiffre') : t('Retirer le bouton')}
        aria-label="Retirer"
        data-plaquette-retirer-element
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <ChoixDUneImage ouvert={choisir} projectId={projectId} onFermer={() => setChoisir(false)} onChoisi={(piece) => onRemplacer(piece)} />
      <Dialog open={lien !== null} onOpenChange={(o) => !o && setLien(null)}>
        <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]">
          <DialogHeader>
            <DialogTitle>{t('Lien du bouton')}</DialogTitle>
          </DialogHeader>
          <div className="px-5">
            <Input value={lien ?? ''} onChange={(e) => setLien(e.target.value)} placeholder="https://… / mailto:…" autoFocus data-plaquette-lien-champ />
            <p className="mt-2 text-[12.5px] text-muted">{t('Une adresse web (https://…) ou une adresse e-mail (mailto:…).')}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setLien(null)}>
              {t('Annuler')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onRegler({ lien: (lien ?? '').trim() || undefined });
                setLien(null);
              }}
              data-plaquette-lien-valider
            >
              {t('Enregistrer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * « REMPLACER L'IMAGE » : les images déjà dans le projet du document, ou une nouvelle envoyée depuis l'appareil (elle
 * entre dans le projet comme toute pièce jointe). Une plaquette ne cite que des pièces de son projet.
 */
function ChoixDUneImage({ ouvert, projectId, onFermer, onChoisi }: { ouvert: boolean; projectId: string; onFermer: () => void; onChoisi: (piece: string) => void }) {
  const [images, setImages] = React.useState<Attachment[] | null>(null);
  const [envoi, setEnvoi] = React.useState(false);
  const champ = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!ouvert) return;
    let vivant = true;
    setImages(null);
    client
      .call<{ items: Attachment[] }>({ type: 'attachments.list', projectId })
      .then((r) => vivant && setImages((r.items ?? []).filter((a) => a.mime?.startsWith('image/')).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))))
      .catch(() => vivant && setImages([]));
    return () => {
      vivant = false;
    };
  }, [ouvert, projectId]);
  const choisir = (id: string) => {
    onChoisi(id);
    onFermer();
  };
  const envoyer = async (fichier: File) => {
    setEnvoi(true);
    try {
      const reponse = await fetch(`/api/upload?project=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        headers: { 'content-type': fichier.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(fichier.name) },
        body: fichier,
      });
      if (!reponse.ok) throw new Error(String(reponse.status));
      const data = (await reponse.json()) as { attachment?: Attachment };
      if (data.attachment?.id) choisir(data.attachment.id);
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="sm:w-[min(620px,100%)]" data-plaquette-choix-image>
        <DialogHeader>
          <DialogTitle>{t('Remplacer l’image')}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3">
          <Button variant="ghost" size="sm" className="self-start bg-raised" disabled={envoi} onClick={() => champ.current?.click()} data-plaquette-envoyer-image>
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {envoi ? t('Envoi…') : t('Envoyer une image depuis l’appareil')}
          </Button>
          <input
            ref={champ}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void envoyer(f);
            }}
          />
          <div>
            {images === null ? (
              <div className="grid grid-cols-3 gap-2 pb-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="aspect-[4/3] animate-silhouette rounded-md bg-raised" />
                ))}
              </div>
            ) : images.length ? (
              <div className="grid grid-cols-3 gap-2 pb-4 sm:grid-cols-4">
                {images.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => choisir(a.id)}
                    className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-raised p-1.5 transition-colors hover:bg-fond-survol"
                    title={a.name}
                    data-plaquette-image-choix={a.id}
                  >
                    <ImageDePiece id={a.id} alt={a.name} className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="pb-4 text-[13px] text-muted">{t('Aucune image dans ce projet pour l’instant : envoyez-en une depuis l’appareil.')}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
