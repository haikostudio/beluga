import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Check, FileText, GripVertical, Loader2, Paperclip, Pencil, Route, Square, Trash2, X } from 'lucide-react';
import {
  Agent,
  Attachment,
  EngineInfo,
  QueuedPrompt,
  TYPE_JOINTES_COLLABLES,
  ajouterJointesCollees,
  ancreDuTexte,
  accrocheAuMot,
  emballerJointes,
  relireJointes,
  boutonsBarreEcriture,
  commandeDuMessage,
  commandesDuMoteur,
  deplacerAncre,
  deplacerDansLaListe,
  filtrerCommandes,
  insereCommande,
  slashEnCours,
  deplacerJointe,
  effacementDeTag,
  indexDeLAncre,
  insereAncre,
  jointesApresFrappe,
  jointesDesTags,
  masquesDuTexte,
  nomDuTag,
  retireAncre,
  retireOccurrence,
  sansMasque,
  tagsEnEspacesOrdinaires,
  tagsMasques,
  texteApresInsertion,
  TEXTE_BARRE_EN_ATTENTE,
} from '@haikodev/shared';
import { useArretAgent } from '@/components/arret-agent';
import { AttachmentPreview } from '@/components/attachment-preview';
import { Button, Textarea, Tooltip } from '@/components/ui';
import { MicButton, RecorderErrorBar, RecordingBar, useRecorder } from '@/components/recorder';
import { MenuSlash, PastilleCommande } from '@/components/menu-slash';
import { RunChoix, nomCourtMoteur, resoudreRun, RunSelectors } from '@/components/run-selectors';
import { indexAuPoint, montreLeMorceau, pointDeLIndex, reglagesDuChamp } from '@/lib/miroir-texte';
import { usePref } from '@/lib/prefs';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

export interface ComposerProps {
  agent: Agent | null;
  engines: EngineInfo[];
  queue: QueuedPrompt[];
  busy: boolean;
  picked: string[];
  onRemovePicked: (text: string) => void;
  onClearPicked: () => void;
  /**
   * UN TEXTE DÉPOSÉ DEPUIS LE FIL, jamais envoyé : le refus d'un plan et ses
   * suggestions d'optimisation (`shared/src/suggestions-de-plan.ts`). Il
   * s'ajoute à ce qui est déjà écrit, il ne l'écrase pas. Le `nonce` distingue
   * deux clics sur la MÊME pastille — sans lui, le second ne ferait rien.
   */
  aEcrire?: { texte: string; nonce: number } | null;
  projectId: string;
  /** Depuis une carte, l'envoi peut devenir une proposition de tâche (§15). */
  onProposeTask?: (text: string) => void;
  /** Dans le tiroir d'une carte : des boutons suivent en dessous, la barre ne
   *  touche donc pas le bas de l'écran et ne réserve pas le creux du téléphone. */
  dansTiroir?: boolean;
  /** Depuis le tiroir d'une carte : l'arrêt ne vaut que pour SA tâche. */
  cardId?: string;
  /** Seule la conversation permanente du chef d'orchestre vit sur fond noir
   *  (pas dans un tiroir) ; partout ailleurs (tiroir de carte, pile des
   *  agents) le fond entourant est gris cendré, la barre doit le reprendre. */
  fondNoir?: boolean;
  /**
   * Le témoin « travail en cours », rendu ICI plutôt qu'à côté : dans ce
   * même conteneur (même repli latéral que la zone de saisie), il en épouse
   * exactement la largeur, et rien ne peut plus s'intercaler entre lui et
   * elle — la file d'attente, les pièces jointes et le reste restent tous
   * au-dessus, comme le fil des messages déjà envoyés.
   */
  barreTravail?: React.ReactNode;
}

const MARQUE_FICHIER = /\[fichier:\s*([^\]\n]+)\]/g;
/** Au doigt, chaque lettre est visée dans un carré plus large qu'à la souris. */
const MARGE_DOIGT = 24;

export function Composer({
  agent,
  engines,
  queue,
  busy,
  picked,
  onRemovePicked,
  onClearPicked,
  aEcrire,
  projectId,
  onProposeTask,
  dansTiroir,
  cardId,
  fondNoir,
  barreTravail,
}: ComposerProps) {
  const state = useApp();
  const [text, setText] = React.useState('');
  /*
   * CE QUE LE CHAMP AFFICHE : le même texte, tags MASQUÉS (`tagsMasques`,
   * shared/src/ancres.ts). L'enrobage « [fichier: » et « ] » y est remplacé,
   * caractère pour caractère, par des signes invisibles qui réservent juste la
   * place du dessin : le tag occupe alors la LARGEUR DE SA PASTILLE, plus celle
   * de sa syntaxe. Un texte collé, un brouillon rechargé ou une phrase dictée
   * passent tous par ici. La longueur ne change pas d'un caractère, donc rien
   * ne bouge : ni le curseur, ni les index des ancres, ni les positions de
   * sélection — l'état du composeur (`text`) et ce que le champ montre se
   * lisent aux mêmes numéros. Le CALQUE lit la MÊME chaîne que le champ — deux
   * chaînes différentes, et les tags dessinés tomberaient à côté.
   */
  const texteDuChamp = React.useMemo(() => tagsMasques(text), [text]);
  /** Message en attente en cours de modification, et le texte mis de côté. */
  const [edition, setEdition] = React.useState<{ id: string; texteMisDeCote: string } | null>(null);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  /** La pièce jointe regardée en grand, avant même l'envoi du message. */
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [scrollTexte, setScrollTexte] = React.useState(0);
  /** L'étiquette en train d'être glissée, pour reposer les autres et l'estomper. */
  const [glissee, setGlissee] = React.useState<number | null>(null);
  /** Le drapeau du texte qu'on est en train de glisser, pour le suivre du doigt. */
  const [drapeauGlisse, setDrapeauGlisse] = React.useState<{
    nom: string;
    x: number;
    y: number;
    trait: { x: number; y: number; hauteur: number } | null;
  } | null>(null);
  const origineDrapeau = React.useRef<{
    nom: string;
    occurrence: number;
    x: number;
    y: number;
  } | null>(null);
  const drapeauABouge = React.useRef(false);
  const viseDrapeau = React.useRef<number | null>(null);
  const glisseRaf = React.useRef(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  /**
   * Où l'ancre du prochain fichier doit s'écrire : le curseur posé dans le
   * texte, ou l'endroit visé par un fichier lâché sur les mots. Rien de posé
   * (collage, dépôt à côté du texte) → l'ancre va à la fin.
   */
  const curseur = React.useRef<number | null>(null);
  /**
   * LA POSITION CALCULÉE NE SUFFIT PAS : IL FAUT LA REPOSER SUR LE VRAI CHAMP.
   * Écrire un tag au milieu du texte allonge la phrase, mais le champ garde le
   * curseur au même NUMÉRO de caractère — donc plusieurs lettres trop tôt, et
   * la frappe suivante s'insérait au milieu des mots déjà écrits. Ce repère
   * porte l'endroit voulu jusqu'après le rendu, où il est appliqué.
   */
  const curseurAPoser = React.useRef<number | null>(null);

  /**
   * Reposer le curseur APRÈS que le nouveau texte est peint : le faire avant
   * viserait encore l'ancienne phrase. Aucun effet tant que rien n'est demandé
   * — survoler une vignette ou taper au clavier ne vole jamais le curseur.
   */
  React.useLayoutEffect(() => {
    const vise = curseurAPoser.current;
    if (vise === null) return;
    curseurAPoser.current = null;
    const zone = textareaRef.current;
    if (!zone) return;
    const position = Math.max(0, Math.min(vise, zone.value.length));
    zone.focus();
    zone.setSelectionRange(position, position);
  }, [text]);

  const retientCurseur = () => {
    const node = textareaRef.current;
    if (!node) return;
    const simple = node.selectionStart === node.selectionEnd ? node.selectionStart : null;
    curseur.current = simple;
    // Le menu des commandes « / » suit la place du curseur : elle doit donc
    // vivre en ÉTAT, pas seulement en référence, sinon rien ne se réaffiche.
    setPointeur(simple);
  };

  /**
   * Toute frappe passe par ici : une ancre effacée à la main retire aussitôt
   * sa pièce jointe, sinon le texte et la liste se contrediraient.
   */
  const majTexte = (suite: string) => {
    if (attachments.length) setAttachments((liste) => jointesApresFrappe(liste, text, suite));
    setText(suite);
  };

  /** Écrire l'ancre d'un fichier là où le curseur était posé. */
  const poseAncre = (nom: string) => {
    setText((avant) => {
      const suite = insereAncre(avant, nom, curseur.current);
      curseur.current = suite.curseur;
      curseurAPoser.current = suite.curseur;
      return suite.texte;
    });
  };

  /**
   * Survoler une vignette montre le passage auquel le fichier se rapporte :
   * le texte défile jusqu'à son ancre. Rien n'est modifié, et le curseur
   * n'est pas volé — on ne fait que regarder.
   */
  const montreAncre = (item: Attachment) => {
    const zone = textareaRef.current;
    if (!zone) return;
    // Par le MOTIF du tag, jamais par son texte exact : un brouillon d'avant
    // l'espace insécable porte des espaces ordinaires et désigne le même
    // fichier.
    const tag = ancreDuTexte(text, item.name, 0);
    if (!tag) return;
    montreLeMorceau(zone, tag.debut, tag.fin);
  };

  /** Retirer un fichier retire aussi son ancre du texte. */
  const retirerJointe = (item: Attachment) => {
    setAttachments((liste) => liste.filter((a) => a.id !== item.id));
    setText((avant) => retireAncre(avant, item.name));
    curseur.current = null;
  };

  /** Retirer le drapeau précis qui a été cliqué, sans toucher aux autres mots. */
  const retirerDrapeau = (nom: string, occurrence: number) => {
    setText((avant) => {
      const suite = retireOccurrence(avant, nom, occurrence);
      setAttachments((liste) => jointesApresFrappe(liste, avant, suite));
      // Le tag retiré laisse un trou : le curseur se pose LÀ, jamais plus loin
      // dans la phrase — sinon la frappe repartait au milieu des mots.
      const place = indexDeLAncre(avant, nom, occurrence);
      curseur.current = place === -1 ? null : place;
      curseurAPoser.current = curseur.current;
      return suite;
    });
    textareaRef.current?.focus();
  };

  /**
   * Un clic retire le drapeau. Un glissement le repose ailleurs dans la
   * phrase, sans toucher aux aperçus au-dessus. Le seuil évite qu'un
   * tremblement du doigt soit pris pour un déplacement.
   */
  const poserDrapeau = (event: React.PointerEvent<HTMLElement>, nom: string, occurrence: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origineDrapeau.current = { nom, occurrence, x: event.clientX, y: event.clientY };
    drapeauABouge.current = false;
    viseDrapeau.current = null;
  };

  const viserDrapeau = (zone: HTMLTextAreaElement, x: number, y: number, pointerType: string) => {
    const brut = indexAuPoint(zone, x, y, pointerType === 'touch' ? MARGE_DOIGT : 0);
    if (brut === null) return null;
    // Sur le texte RÉEL, jamais sur ce que le champ affiche : les tags y sont
    // masqués et ne se reconnaîtraient plus. Les deux se lisent aux mêmes
    // index, la position visée reste donc la bonne.
    return accrocheAuMot(text, brut);
  };

  const suivreDrapeau = (event: React.PointerEvent<HTMLElement>) => {
    const origine = origineDrapeau.current;
    if (!origine) return;
    const dx = event.clientX - origine.x;
    const dy = event.clientY - origine.y;
    if (!drapeauABouge.current) {
      if (dx * dx + dy * dy < 36) return;
      drapeauABouge.current = true;
    }
    const x = event.clientX;
    const y = event.clientY;
    const pointerType = event.pointerType;
    if (glisseRaf.current) cancelAnimationFrame(glisseRaf.current);
    glisseRaf.current = requestAnimationFrame(() => {
      const zone = textareaRef.current;
      const vise = zone ? viserDrapeau(zone, x, y, pointerType) : null;
      viseDrapeau.current = vise;
      const trait = zone && vise !== null ? pointDeLIndex(zone, vise) : null;
      setDrapeauGlisse({ nom: origine.nom, x, y, trait });
    });
  };

  const lacherDrapeau = (event: React.PointerEvent<HTMLElement>) => {
    if (glisseRaf.current) cancelAnimationFrame(glisseRaf.current);
    glisseRaf.current = 0;
    const origine = origineDrapeau.current;
    origineDrapeau.current = null;
    const aBouge = drapeauABouge.current;
    drapeauABouge.current = false;
    setDrapeauGlisse(null);
    if (!origine) return;
    if (!aBouge) {
      viseDrapeau.current = null;
      retirerDrapeau(origine.nom, origine.occurrence);
      return;
    }
    const zone = textareaRef.current;
    if (!zone) return;
    const vise = viseDrapeau.current ?? viserDrapeau(zone, event.clientX, event.clientY, event.pointerType);
    viseDrapeau.current = null;
    if (vise === null) return;
    setText((avant) => {
      const suite = deplacerAncre(avant, origine.nom, origine.occurrence, vise);
      curseur.current = suite.curseur;
      curseurAPoser.current = suite.curseur;
      return suite.texte;
    });
    zone.focus();
  };

  const annulerDrapeau = () => {
    if (glisseRaf.current) cancelAnimationFrame(glisseRaf.current);
    glisseRaf.current = 0;
    origineDrapeau.current = null;
    drapeauABouge.current = false;
    viseDrapeau.current = null;
    setDrapeauGlisse(null);
  };

  const gestesDrapeau = React.useRef({ poserDrapeau, suivreDrapeau, lacherDrapeau, annulerDrapeau, retirerDrapeau });
  gestesDrapeau.current = { poserDrapeau, suivreDrapeau, lacherDrapeau, annulerDrapeau, retirerDrapeau };

  /*
   * L'overlay (drapeaux fichier) ne se pose QUE s'il y a vraiment un tag :
   * sinon il se posait sur tout texte non vide, rendant le vrai champ
   * transparent et sa sélection à la souris invisible — noyée sous le calque.
   */
  const aDesDrapeaux = React.useMemo(() => {
    MARQUE_FICHIER.lastIndex = 0;
    return MARQUE_FICHIER.test(text);
  }, [text]);

  /*
   * LE CALQUE SE CALE SUR LE CHAMP, IL NE LE DEVINE PAS. Ses styles sont
   * RECOPIÉS du champ (police, hauteur de ligne, marges intérieures) au lieu
   * d'être redits en classes : un seul réglage qui diffère — la hauteur de
   * ligne, par exemple — et les lignes du calque tombent à côté des vraies,
   * d'où le texte décalé, la ligne vide en trop et le curseur ailleurs qu'où
   * il paraît. La FENÊTRE, elle, dit la part visible du champ : le calque ne
   * couvre que celle-là, jamais la rangée de boutons qui suit le champ.
   */
  const [calage, setCalage] = React.useState<{
    style: React.CSSProperties;
    fenetre: { top: number; left: number; width: number; height: number };
  }>({ style: {}, fenetre: { top: 0, left: 0, width: 0, height: 0 } });
  React.useLayoutEffect(() => {
    const zone = textareaRef.current;
    if (!zone || !aDesDrapeaux) return;
    const mesurer = () => {
      const releve = reglagesDuChamp(zone);
      setCalage((avant) => {
        const memeFenetre = (Object.keys(releve.fenetre) as (keyof typeof releve.fenetre)[]).every(
          (cle) => avant.fenetre[cle] === releve.fenetre[cle],
        );
        const memeStyle = Object.keys(releve.style).every(
          (cle) => (avant.style as Record<string, string>)[cle] === releve.style[cle],
        );
        return memeFenetre && memeStyle ? avant : { style: releve.style as React.CSSProperties, fenetre: releve.fenetre };
      });
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(zone);
    return () => observateur.disconnect();
  }, [aDesDrapeaux, text]);

  const texteAvecDrapeaux = React.useMemo(() => {
    if (!aDesDrapeaux) return [];
    const morceaux: React.ReactNode[] = [];
    const vus: Record<string, number> = {};
    let fin = 0;
    for (const tag of masquesDuTexte(texteDuChamp)) {
      if (tag.debut > fin)
        morceaux.push(<React.Fragment key={`texte-${fin}`}>{texteDuChamp.slice(fin, tag.debut)}</React.Fragment>);
      const nom = tag.nom;
      const position = vus[nom] ?? 0;
      vus[nom] = position + 1;
      const brut = tag.brut;
      morceaux.push(
        <span
          key={`fichier-${tag.debut}`}
          role="button"
          data-prompt-file-flag
          title={t('Glisser pour déplacer, cliquer pour retirer')}
          onPointerDown={(event) => gestesDrapeau.current.poserDrapeau(event, nom, position)}
          onPointerMove={(event) => gestesDrapeau.current.suivreDrapeau(event)}
          onPointerUp={(event) => gestesDrapeau.current.lacherDrapeau(event)}
          onPointerCancel={() => gestesDrapeau.current.annulerDrapeau()}
          className="group pointer-events-auto relative cursor-grab touch-none align-baseline text-accent active:cursor-grabbing"
        >
          {/* LE TEXTE MASQUÉ GARDE SA PLACE, IL NE SE VOIT PLUS. La largeur du
              tag reste EXACTEMENT celle des caractères réellement écrits dans
              le champ — c'est elle qui décide des retours à la ligne et de
              l'endroit du curseur, qu'aucun habillage ne doit déplacer. Ces
              caractères-là sont désormais ceux du MASQUE (`tagsMasques`) : le
              nom du fichier, plus la place du trombone et de la croix. Le tag
              fait donc la largeur d'un mot, et non celle de sa syntaxe. Ils
              sont seulement rendus invisibles ; la pastille est dessinée
              par-dessus, HORS FLUX, donc elle ne prend aucune place. Le texte
              masqué réapparaît si le tag venait à être coupé en fin de ligne
              (`data-tag="coupe"`), cas où un dessin posé par-dessus tomberait
              à côté — le nom du fichier y reste lisible. */}
          <span className="invisible rounded-[3px] group-data-[tag=coupe]:visible group-data-[tag=coupe]:bg-accent/20 group-data-[tag=coupe]:ring-1 group-data-[tag=coupe]:ring-inset group-data-[tag=coupe]:ring-accent/40 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
            {brut}
          </span>
          {/* LA PASTILLE DESSINÉE : trombone, nom, croix. Elle est CENTRÉE
              dans la largeur du texte masqué, calculé pour rester un peu plus
              large qu'elle : le nom occupe une pleine largeur de caractère
              dans le champ contre 0,82 em dans la pastille, et trois cadratins
              couvrent le trombone, la croix et les marges. La croix ne touche
              donc jamais le mot qui suit, même quand aucun espace ne sépare le
              tag du texte. Sa hauteur ne DÉPASSE PAS celle des caractères
              recouverts : plus haute, elle mordrait sur la ligne voisine et
              volerait le clic qui vise le champ.

              SON TEXTE EST PLUS PETIT QUE CELUI DU CHAMP (0,82 em) : à taille
              égale, le nom remplissait la pastille bord à bord, sans un pixel
              d'air, et pesait autant qu'une phrase écrite. Le reste des
              mesures est donné en em DE LA PASTILLE, donc réduit d'autant :
              c'est ce qui dégage la marge intérieure et l'écart avec le texte
              voisin, sans jamais élargir le dessin au-delà des caractères
              recouverts. La hauteur, elle, reste sous celle des caractères
              recouverts (1,35 × 0,82 ≈ 1,1 em du champ).

              LE DÉCALAGE VERTICAL DE 0,24 em (`translate-y-[calc(-50%+0.24em)]`,
              au lieu d'un simple -50 %) N'EST PAS COSMÉTIQUE : le texte masqué
              qui sert de repère de centrage occupe seulement sa propre boîte de
              caractères (~1,1 em), collée au HAUT de la ligne, alors que la
              ligne elle-même est plus haute (interligne 1,5 hérité de la page).
              Centrer la pastille sur -50 % pur la collait donc au ras du haut de
              la ligne, avec tout l'espace en trop RENVOYÉ EN DESSOUS. Ce
              correctif la recentre sur la ligne réelle plutôt que sur le texte
              masqué. */}
          <span
            data-prompt-file-pastille
            className="absolute left-1/2 top-1/2 inline-flex h-[1.35em] max-w-full -translate-x-1/2 translate-y-[calc(-50%+0.24em)] items-center gap-[0.35em] overflow-hidden whitespace-nowrap rounded-[0.5em] bg-accent/20 px-[0.55em] text-[0.82em] font-medium leading-none ring-1 ring-inset ring-accent/40 group-hover:bg-accent/30 group-data-[tag=coupe]:hidden"
          >
            <Paperclip aria-hidden="true" className="h-[0.95em] w-[0.95em] shrink-0" />
            <span className="truncate">{nom}</span>
            <span
              role="button"
              data-prompt-file-close
              title={t('Retirer ce fichier')}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                gestesDrapeau.current.retirerDrapeau(nom, position);
              }}
              className="shrink-0 cursor-pointer opacity-70 transition-opacity hover:text-danger hover:opacity-100"
            >
              <X aria-hidden="true" className="h-[0.95em] w-[0.95em]" />
            </span>
          </span>
        </span>,
      );
      fin = tag.fin;
    }
    if (fin < texteDuChamp.length)
      morceaux.push(<React.Fragment key={`texte-${fin}`}>{texteDuChamp.slice(fin)}</React.Fragment>);
    return morceaux;
  }, [texteDuChamp]);

  /*
   * UN TAG COUPÉ EN FIN DE LIGNE REVIENT AU TEXTE BRUT. La pastille est
   * dessinée par-dessus le tag, hors flux : elle suppose donc que le tag tient
   * sur UNE seule ligne. Quand le champ est étroit, le texte peut se couper à
   * l'espace de « [fichier: nom] » — le tag occupe alors deux rectangles et un
   * dessin posé par-dessus tomberait à cheval entre les deux. On le repère
   * après le rendu (`getClientRects`) et on rend la main au texte brut, coloré
   * comme avant. La mise en page du champ, elle, n'est jamais touchée : rien
   * ici ne change la largeur d'un caractère.
   */
  const calqueRef = React.useRef<HTMLDivElement | null>(null);
  const texteCalqueRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const calque = texteCalqueRef.current;
    if (!calque || !aDesDrapeaux) return;
    const marquer = () => {
      for (const drapeau of Array.from(calque.querySelectorAll<HTMLElement>('[data-prompt-file-flag]'))) {
        if (drapeau.getClientRects().length > 1) drapeau.dataset.tag = 'coupe';
        else delete drapeau.dataset.tag;
      }
    };
    marquer();
    const observateur = new ResizeObserver(marquer);
    observateur.observe(calque);
    return () => observateur.disconnect();
  }, [aDesDrapeaux, texteAvecDrapeaux, calage]);

  // La dictée dépose son texte à la suite de ce qui est déjà écrit.
  const recorder = useRecorder((dicte) => setText((current) => (current ? `${current} ${dicte}` : dicte)));

  /*
   * UN TEXTE DÉPOSÉ DEPUIS LE FIL (refus d'un plan, suggestion d'optimisation)
   * s'écrit ICI et s'arrête là : aucun envoi, aucun tour lancé. Il s'AJOUTE à
   * ce qui était en train d'être écrit — on ne perd pas une phrase en cours
   * pour un clic — et le champ prend le curseur, à la fin du texte, pour que la
   * frappe reprenne au bon endroit.
   */
  const dernierDepot = React.useRef<number>(0);
  React.useEffect(() => {
    if (!aEcrire || aEcrire.nonce === dernierDepot.current) return;
    dernierDepot.current = aEcrire.nonce;
    setText((avant) => texteApresInsertion(avant, aEcrire.texte));
    const zone = textareaRef.current;
    if (!zone) return;
    window.requestAnimationFrame(() => {
      zone.focus();
      zone.setSelectionRange(zone.value.length, zone.value.length);
      zone.scrollTop = zone.scrollHeight;
    });
  }, [aEcrire]);

  /*
   * Brouillon conservé par conversation, côté serveur : on le retrouve depuis
   * n'importe quel écran. Ce qui est écrit ne s'efface QUE sur un geste de
   * l'utilisateur (envoi ou effacement) : ni un agent qui disparaît un instant,
   * ni une reconnexion, ni un changement d'onglet n'y touchent.
   */
  const agentId = agent?.id;
  const cleBrouillon = agentId ? `draft.${agentId}` : 'draft.aucun';
  const [draft] = usePref<string>(cleBrouillon, '');
  const chargePour = React.useRef<string | undefined>(undefined);
  const premierPassage = React.useRef(true);
  /** Le dernier texte parti : il ne doit JAMAIS revenir tout seul dans le champ. */
  const dejaEnvoye = React.useRef<string | null>(null);
  /**
   * Le dernier brouillon reçu du serveur (ce que CE champ reflète tant que
   * la personne n'a rien tapé de différent). Sert à distinguer, quand le
   * brouillon change à distance, « je n'ai pas touché au champ, je peux le
   * suivre » de « j'ai écrit autre chose, on ne touche à rien » — y compris
   * quand il redevient vide parce qu'un AUTRE écran vient d'envoyer.
   */
  const dernierBrouillonDistant = React.useRef<string>('');

  React.useEffect(() => {
    // Agent absent l'espace d'un instant : on ne touche surtout à rien.
    if (!agentId) return;

    if (chargePour.current !== agentId) {
      // Vraie ouverture d'une autre conversation : on affiche SON brouillon.
      chargePour.current = agentId;
      premierPassage.current = true;
      dernierBrouillonDistant.current = draft;
      dejaEnvoye.current = null;
      setText(draft);
      return;
    }

    if (draft === dernierBrouillonDistant.current) return;
    const brouillonPrecedent = dernierBrouillonDistant.current;
    dernierBrouillonDistant.current = draft;
    // L'écho tardif de notre propre envoi : déjà traité localement.
    if (draft === dejaEnvoye.current) return;
    // Le champ ne suit QUE s'il reflétait encore l'ancien brouillon : une
    // personne qui a déjà écrit autre chose n'est jamais recouverte — mais un
    // envoi fait ailleurs (le brouillon redevient vide) vide bien SON champ.
    setText((current) => (current === brouillonPrecedent ? draft : current));
  }, [agentId, draft]);

  React.useEffect(() => {
    if (!agentId || chargePour.current !== agentId) return;
    // Le premier passage est l'affichage du brouillon, pas une saisie.
    if (premierPassage.current) {
      premierPassage.current = false;
      return;
    }
    // Pendant la modification d'un message en attente, le brouillon garde ce
    // qui a été mis de côté : il ne prend pas la place du texte modifié.
    if (edition) return;
    // Dès que la personne écrit à nouveau, l'ancien envoi cesse d'être une
    // référence : c'est un texte neuf.
    if (text) dejaEnvoye.current = null;
    /*
     * LA FRAPPE NE TRAVERSE PLUS LE MAGASIN GÉNÉRAL À CHAQUE TOUCHE.
     *
     * `setPrefLocally` écrit dans l'état PARTAGÉ de l'application : chaque
     * lettre tapée refaisait donc l'affichage de TOUTE l'application — le
     * tableau et ses cartes, la colonne de gauche, la conversation. C'est ce qui
     * faisait apparaître la frappe au ralenti. Le champ, lui, n'a jamais eu
     * besoin de ce détour : il tient déjà son propre texte.
     *
     * Le brouillon reste retenu — c'est la même temporisation de 600 ms qui
     * pose la copie locale ET l'envoi au serveur, une fois la frappe reposée.
     */
    const timer = window.setTimeout(() => {
      client.setPrefLocally(cleBrouillon, text);
      client.send({ type: 'prefs.set', key: cleBrouillon, value: text });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [text, agentId, cleBrouillon]);

  /*
   * LES FICHIERS JOINTS SUIVENT LA MÊME CONVERSATION QUE LE BROUILLON, PAS
   * L'APPLICATION. Sans ceci, `attachments` restait un état local de ce
   * composant : changer de projet ou d'agent gardait les pièces jointes
   * préparées pour l'agent précédent, avec le risque de les envoyer au
   * mauvais destinataire. Même mécanique que le brouillon — retenu côté
   * serveur, par conversation — pour qu'on les retrouve depuis n'importe
   * quel écran, et jamais depuis une autre.
   */
  const cleJointes = agentId ? `draftAttachments.${agentId}` : 'draftAttachments.aucun';
  const [jointesEnregistrees, setJointesEnregistrees] = usePref<Attachment[]>(cleJointes, []);
  const jointesChargeesPour = React.useRef<string | undefined>(undefined);
  const jointesIgnorerProchaineSauvegarde = React.useRef(true);
  /**
   * Les dernières pièces jointes reçues du serveur — même logique que
   * `dernierBrouillonDistant` : on ne suit un changement à distance que si
   * rien n'a divergé localement depuis, et ça vaut AUSSI quand la liste
   * redevient vide parce qu'un autre écran vient d'envoyer.
   */
  const dernieresJointesDistantes = React.useRef<Attachment[]>([]);
  const memeJointes = (a: Attachment[], b: Attachment[]) =>
    a.length === b.length && a.every((jointe, index) => jointe.id === b[index]?.id);

  React.useEffect(() => {
    if (!agentId) return;

    if (jointesChargeesPour.current !== agentId) {
      // Vraie ouverture d'une autre conversation : on affiche SES pièces jointes.
      jointesChargeesPour.current = agentId;
      dernieresJointesDistantes.current = jointesEnregistrees;
      jointesIgnorerProchaineSauvegarde.current = true;
      setAttachments(jointesEnregistrees);
      return;
    }

    if (memeJointes(jointesEnregistrees, dernieresJointesDistantes.current)) return;
    const jointesPrecedentes = dernieresJointesDistantes.current;
    dernieresJointesDistantes.current = jointesEnregistrees;
    jointesIgnorerProchaineSauvegarde.current = true;
    setAttachments((current) => (memeJointes(current, jointesPrecedentes) ? jointesEnregistrees : current));
  }, [agentId, jointesEnregistrees]);

  React.useEffect(() => {
    if (!agentId || jointesChargeesPour.current !== agentId) return;
    // Le premier passage est l'affichage des pièces déjà retenues, pas un ajout.
    if (jointesIgnorerProchaineSauvegarde.current) {
      jointesIgnorerProchaineSauvegarde.current = false;
      return;
    }
    const timer = window.setTimeout(() => setJointesEnregistrees(attachments), 600);
    return () => window.clearTimeout(timer);
  }, [attachments, agentId]);

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }, [text]);

  const modePlan = agent?.run?.mode === 'plan';

  /* ------------------------------------------------------------------ */
  /* LES COMMANDES « / » DU MOTEUR SÉLECTIONNÉ                            */
  /* ------------------------------------------------------------------ */

  /*
   * Le menu s'ouvre sur ce que la personne TAPE : il faut donc suivre la place
   * du curseur en état, pas seulement en référence — une référence ne fait
   * rien réafficher. `null` = pas de curseur simple (sélection, champ quitté),
   * et le menu reste alors fermé.
   */
  const [pointeur, setPointeur] = React.useState<number | null>(null);
  const [slashVise, setSlashVise] = React.useState(0);
  /* Échappement : le menu se ferme pour CE mot-là, et rouvre au suivant. */
  const [slashFerme, setSlashFerme] = React.useState<string | null>(null);

  const moteurChoisi = resoudreRun(engines, agent?.run).engine;
  const zoneSlash = pointeur === null ? null : slashEnCours(text, pointeur);
  const relevees = moteurChoisi ? state.slash[projectId]?.[moteurChoisi.id] : undefined;
  const commandesDuChamp = React.useMemo(
    () => commandesDuMoteur(moteurChoisi?.id, relevees),
    [moteurChoisi?.id, relevees],
  );
  const commandesVisibles = React.useMemo(
    () => (zoneSlash ? filtrerCommandes(commandesDuChamp, zoneSlash.mot) : []),
    [commandesDuChamp, zoneSlash?.mot],
  );
  const slashOuvert = !!zoneSlash && slashFerme !== zoneSlash.mot;

  /* Le relevé du disque ne se demande qu'à la première ouverture du menu :
     tant que personne ne tape « / », rien ne voyage. */
  React.useEffect(() => {
    if (!slashOuvert || !projectId) return;
    if (state.slash[projectId]) return;
    client.send({ type: 'slash.list', projectId });
  }, [slashOuvert, projectId, state.slash]);

  /* La ligne visée repart du haut dès que la liste change. */
  React.useEffect(() => setSlashVise(0), [zoneSlash?.mot, moteurChoisi?.id]);

  /** Écrire la commande choisie à la place du « /mot » en train d'être tapé. */
  const choisirCommande = (nom: string) => {
    if (!zoneSlash) return;
    const suite = insereCommande(text, zoneSlash, nom);
    majTexte(suite.texte);
    curseur.current = suite.curseur;
    curseurAPoser.current = suite.curseur;
    setPointeur(suite.curseur);
    setSlashFerme(null);
  };

  /** La commande que le message porte déjà, telle qu'elle partira au moteur. */
  const commandeEcrite = commandeDuMessage(text);

  // Le serveur tranche : il réinitialise les choix d'après et vérifie que la
  // combinaison existe vraiment (PLAN §14).
  const updateRun = async (patch: RunChoix) => {
    if (!agent) return;
    try {
      await client.call({ type: 'agent.config', agentId: agent.id, run: patch });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réglage impossible'));
    }
  };

  /**
   * Joindre des fichiers. Chaque nouveau fichier écrit son ancre dans le
   * texte : à l'endroit du curseur s'il y en avait un, à la fin sinon.
   */
  const upload = async (files: FileList | File[], aLaFin = false) => {
    if (aLaFin) curseur.current = null;
    const dejaVues = new Set(attachments.map((a) => a.id));
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const response = await fetch(
          `/api/upload?project=${encodeURIComponent(projectId)}${agent ? `&agent=${agent.id}` : ''}${
            agent?.cardId ? `&card=${agent.cardId}` : ''
          }`,
          {
            method: 'POST',
            headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
            body: file,
          },
        );
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        // Le même fichier renvoyé deux fois ne s'ajoute — et ne s'ancre — qu'une fois.
        if (!jointe || dejaVues.has(jointe.id)) continue;
        dejaVues.add(jointe.id);
        setAttachments((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
        poseAncre(jointe.name);
      }
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
    } finally {
      setUploading(false);
    }
  };

  /*
   * Modifier un message en attente : il s'ouvre ICI, dans la barre d'écriture.
   * Ce qui était déjà écrit est mis de côté et revient intact une fois la
   * modification envoyée (ou annulée) — on ne perd jamais un début de phrase.
   */
  const ouvrirEnEdition = (item: QueuedPrompt) => {
    setEdition((courante) => ({ id: item.id, texteMisDeCote: courante?.texteMisDeCote ?? text }));
    setText(item.text);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const terminerEdition = (envoyer: boolean) => {
    if (!edition) return;
    if (envoyer && text.trim()) {
      client.send({ type: 'queue.update', id: edition.id, text: tagsEnEspacesOrdinaires(text.trim()) });
    }
    setText(edition.texteMisDeCote);
    setEdition(null);
  };

  const submit = async (asProposal = false) => {
    // En cours de modification, le bouton d'envoi enregistre la modification.
    if (edition) {
      terminerEdition(true);
      return;
    }

    /*
     * L'ESPACE INSÉCABLE DES TAGS NE SORT PAS DU CHAMP DE SAISIE. Il n'est là
     * que pour empêcher « [fichier: nom] » de se couper en fin de ligne : le
     * message enregistré, relu et recopié garde des espaces ordinaires.
     */
    const body = tagsEnEspacesOrdinaires([text.trim(), ...picked].filter(Boolean).join('\n'));
    if (!body || !agent) return;

    /*
     * Un message parti est parti. On efface le brouillon TOUT DE SUITE, en
     * mémoire et sur le serveur, et on retient le texte envoyé : un écho tardif
     * du serveur ne peut plus le remettre dans le champ. Seule la modification
     * d'un message en attente remet du texte, et c'est un geste volontaire.
     */
    const oublierBrouillon = () => {
      dejaEnvoye.current = text;
      dernierBrouillonDistant.current = '';
      client.setPrefLocally(cleBrouillon, '');
      client.send({ type: 'prefs.set', key: cleBrouillon, value: '' });
    };

    if (asProposal && onProposeTask) {
      onProposeTask(body);
      oublierBrouillon();
      setText('');
      onClearPicked();
      return;
    }

    // Gardées pour un éventuel échec : l'envoi les vide tout de suite, mais
    // elles ne doivent pas se perdre pour autant.
    const jointesEnvoyees = attachments;

    oublierBrouillon();
    setText('');
    onClearPicked();
    setAttachments([]);
    dernieresJointesDistantes.current = [];
    jointesIgnorerProchaineSauvegarde.current = true;
    setJointesEnregistrees([]);
    curseur.current = null;
    try {
      await client.call({
        type: 'agent.prompt',
        agentId: agent.id,
        text: body,
        attachments: jointesEnvoyees.map((a) => a.id),
      });
    } catch (err: any) {
      // L'envoi a échoué : là, on rend le texte ET les pièces jointes, sinon
      // elles seraient perdues.
      client.pushToast('error', err?.message ?? t('envoi impossible'));
      dejaEnvoye.current = null;
      setText(body);
      if (jointesEnvoyees.length) {
        setAttachments(jointesEnvoyees);
        dernieresJointesDistantes.current = jointesEnvoyees;
        jointesIgnorerProchaineSauvegarde.current = true;
        setJointesEnregistrees(jointesEnvoyees);
      }
    }
  };

  /*
   * ARRÊTER SANS REMONTER EN HAUT DU FIL. La bande « en cours » garde son
   * bouton, mais dans une longue conversation elle sort de l'écran : tant que
   * l'agent travaille, la flèche d'envoi devient un carré d'arrêt, au même
   * endroit et à la même taille. C'est le MÊME geste (`useArretAgent`) :
   * même contrôle, même commande, même confirmation au-delà de cinq minutes.
   */
  const arret = useArretAgent({ agent, cardId });
  const boutons = boutonsBarreEcriture({
    occupe: busy,
    arretPossible: arret.possible,
    aDuTexte: !!text.trim() || picked.length > 0,
    enEdition: !!edition,
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /*
     * LE MENU DES COMMANDES PREND LE CLAVIER TANT QU'IL EST OUVERT. Les flèches
     * se déplacent dans la liste, Entrée et Tabulation insèrent la commande
     * visée, Échappement referme le menu sans rien écrire — et rend aussitôt
     * les mêmes touches au champ, qui garde donc son comportement habituel.
     */
    if (slashOuvert && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashFerme(zoneSlash!.mot);
        return;
      }
      if (commandesVisibles.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setSlashVise((rang) => deplacerDansLaListe(rang, commandesVisibles.length, event.key === 'ArrowDown' ? 1 : -1));
          return;
        }
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
          event.preventDefault();
          const vise = commandesVisibles[Math.min(slashVise, commandesVisibles.length - 1)];
          if (vise) choisirCommande(vise.nom);
          return;
        }
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
      return;
    }

    /*
     * UN TAG S'EFFACE D'UN BLOC. Sans cela, le retour arrière grignotait
     * « [fichier: capture.png] » lettre par lettre : le tag restait à l'écran,
     * amputé, et sa pièce jointe accrochée à un texte devenu faux. La règle
     * pure (`effacementDeTag`) dit ce qui part ; elle rend `null` quand aucun
     * tag n'est touché, et la touche suit alors son chemin normal — le champ
     * garde ainsi son historique d'annulation partout ailleurs.
     */
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const zone = event.currentTarget;
    const coupe = effacementDeTag(
      // Le texte RÉEL, pas celui du champ : les tags y sont masqués. Les deux
      // se lisent aux mêmes index, la sélection reste donc valable.
      text,
      zone.selectionStart,
      zone.selectionEnd,
      event.key === 'Backspace' ? 'arriere' : 'avant',
    );
    if (!coupe) return;
    event.preventDefault();
    majTexte(coupe.texte);
    curseur.current = coupe.curseur;
    curseurAPoser.current = coupe.curseur;
  };

  return (
    <div
      // Repère pour les contrôles : plusieurs barres d'écriture coexistent
      // (conversation, tiroir de carte), il faut viser CELLE qu'on voit.
      data-composer
      data-contexte-agent
      data-agent-contexte={agent?.id}
      className={cn(
        'px-2.5 pt-2 bg-gradient-to-b',
        fondNoir ? 'from-bg to-bg/0' : 'from-surface to-surface/0',
      )}
      /*
       * Le creux du téléphone (barre de gestes) n'est réservé QUE si la barre
       * d'écriture touche vraiment le bas de l'écran. Dans le tiroir d'une
       * carte, des boutons de décision viennent en dessous et réservent déjà
       * cette place : la réserver deux fois creusait un vide sous le composeur.
       */
      style={{ paddingBottom: dansTiroir ? '8px' : 'max(10px, env(safe-area-inset-bottom))' }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        event.preventDefault();
        // Lâché sur les mots, le fichier s'ancre À CET ENDROIT ; lâché à côté
        // du texte (réglages, pastilles, bord de la barre), il va à la fin.
        const zone = textareaRef.current;
        const surLeTexte = zone && event.target instanceof Node && zone.contains(event.target);
        const vise = surLeTexte ? indexAuPoint(zone, event.clientX, event.clientY) : null;
        if (vise === null) {
          void upload(files, true);
          return;
        }
        curseur.current = vise;
        void upload(files);
      }}
    >
      {/* La file d'attente s'empile juste au-dessus de la barre d'écriture */}
      {queue.length ? (
        <div className="mb-1.5 space-y-1">
          {queue.map((item, index) => (
            <QueuedItem
              key={item.id}
              item={item}
              index={index}
              actif={edition?.id === item.id}
              onEdit={() => ouvrirEnEdition(item)}
            />
          ))}
          <p className="px-1 text-[12px] text-faint">
            {queue.length === 1
              ? t('Votre message part dès que l\'agent a fini.')
              : t('{v0} messages en attente : ils partiront l\'un après l\'autre.', { v0: queue.length })}
          </p>
        </div>
      ) : null}

      {/* Les pastilles d'évolutions retenues partent avec le message */}
      {picked.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {picked.map((item) => (
            <button
              key={item}
              type="button"
              data-composeur-retenu
              onClick={() => onRemovePicked(item)}
              className="group inline-flex max-w-[300px] items-center gap-1 rounded-md border border-border bg-raised px-1.5 py-1 text-[13px] text-muted hover:border-danger/40 hover:text-text"
            >
              <span className="truncate">{item}</span>
              <X className="h-2.5 w-2.5 shrink-0 text-faint group-hover:text-danger" />
            </button>
          ))}
        </div>
      ) : null}

      {/* Les fichiers joints en attente : chacun est une ÉTIQUETTE qu'on peut
          glisser pour changer l'ordre d'envoi, avec sa croix à droite pour le
          retirer (lui ET son ancre du texte). Un clic sur le nom ouvre
          l'aperçu en grand. */}
      {attachments.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((file, index) => (
            <div
              key={file.id}
              draggable
              onDragStart={(event) => {
                setGlissee(index);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (glissee === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (glissee === null) return;
                setAttachments((liste) => deplacerJointe(liste, glissee, index));
                setGlissee(null);
              }}
              onDragEnd={() => setGlissee(null)}
              onMouseEnter={() => montreAncre(file)}
              onFocus={() => montreAncre(file)}
              className={cn(
                'flex h-8 max-w-[220px] cursor-grab items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 text-[12.5px] text-muted active:cursor-grabbing',
                glissee === index && 'opacity-40',
              )}
            >
              <GripVertical className="h-3 w-3 shrink-0 text-faint" />
              {file.mime.startsWith('image/') ? (
                <button
                  type="button"
                  onClick={() => setApercu(file)}
                  className="h-5 w-5 shrink-0 overflow-hidden rounded border border-border"
                >
                  <img src={`/api/attachment?id=${file.id}`} alt={file.name} className="h-full w-full object-cover" />
                </button>
              ) : (
                <button type="button" onClick={() => setApercu(file)} className="shrink-0 text-faint">
                  {file.mime === 'application/pdf' ? <FileText className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
                </button>
              )}
              <button
                type="button"
                title={file.name}
                onClick={() => setApercu(file)}
                className="min-w-0 flex-1 truncate text-left hover:text-text"
              >
                {file.name}
              </button>
              <button
                type="button"
                title={t('Retirer ce fichier')}
                onClick={() => retirerJointe(file)}
                className="shrink-0 text-faint hover:text-danger"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />

      {recorder.recording ? (
        <RecordingBar
          levels={recorder.levels}
          seconds={recorder.seconds}
          onValidate={() => recorder.finish(true)}
          onDiscard={() => recorder.finish(false)}
        />
      ) : null}

      {recorder.error ? (
        <RecorderErrorBar message={recorder.error} onRetry={recorder.retry} onDiscard={recorder.discardError} />
      ) : null}

      {edition ? (
        <div className="mb-1.5 flex items-center gap-2 rounded-md border border-accent/50 bg-surface px-2.5 py-1.5">
          <Pencil className="h-3 w-3 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            {t('Modification d\'un message en attente {v0}', { v0: edition.texteMisDeCote ? ' — ce que vous écriviez revient juste après' : '' })}</span>
          <button
            type="button"
            onClick={() => terminerEdition(false)}
            className="shrink-0 text-[12.5px] text-faint hover:text-text"
          >
            {t('Annuler')}</button>
        </div>
      ) : null}

      {/* La commande reconnue en tête du message, dite avant l'envoi. Elle ne
          transforme rien : le texte part tel quel, « /nom » compris. */}
      {commandeEcrite && !slashOuvert ? (
        <PastilleCommande
          nom={commandeEcrite}
          onRetirer={() => {
            const suite = text.replace(/^\/[a-zA-Z0-9][a-zA-Z0-9:_-]*[ ]?/, '');
            majTexte(suite);
            curseur.current = 0;
            curseurAPoser.current = 0;
            setPointeur(0);
          }}
        />
      ) : null}

      {/* Le menu des commandes « / » prend la place du repère des tâches : même
          habillage, même endroit, collé au champ — deux bandeaux empilés là se
          disputeraient le recouvrement de 8px. */}
      {slashOuvert ? (
        <MenuSlash
          commandes={commandesVisibles}
          index={Math.min(slashVise, Math.max(0, commandesVisibles.length - 1))}
          nomDuMoteur={nomCourtMoteur(moteurChoisi)}
          onChoisir={(commande) => choisirCommande(commande.nom)}
          onSurvol={setSlashVise}
        />
      ) : (
        /* Collée à la zone de saisie, rien entre les deux : la file d'attente,
           les pièces jointes et l'édition en cours restent au-dessus. */
        barreTravail
      )}

      <div className={cn('relative rounded-lg border border-border bg-raised', recorder.recording && 'hidden')}>
        {/* LE CALQUE NE COUVRE QUE LA PART VISIBLE DU CHAMP, ET SA DÉCOUPE NE
            BOUGE PAS. Deux blocs, et non un seul : une FENÊTRE posée exactement
            sur le champ, qui coupe ce qui dépasse, et DEDANS le texte, qui seul
            se déplace au rythme de l'ascenseur. Un unique bloc portant à la fois
            la découpe et le déplacement emmenait sa propre fenêtre avec le
            texte : les lignes de trop s'écrivaient alors par-dessus la rangée
            de boutons, sous le champ. */}
        {aDesDrapeaux ? (
          <div
            aria-hidden="true"
            ref={calqueRef}
            data-prompt-calque
            className="pointer-events-none absolute z-20 overflow-hidden"
            style={{
              top: calage.fenetre.top,
              left: calage.fenetre.left,
              width: calage.fenetre.width,
              height: calage.fenetre.height,
            }}
          >
            <div
              ref={texteCalqueRef}
              data-prompt-calque-texte
              className="w-full whitespace-pre-wrap break-words text-text"
              style={{ ...calage.style, boxSizing: 'border-box', transform: `translateY(${-scrollTexte}px)` }}
            >
              {texteAvecDrapeaux}
            </div>
          </div>
        ) : null}
        {drapeauGlisse
          ? createPortal(
              <>
                <div
                  className="pointer-events-none fixed z-[80] inline-flex max-w-[220px] items-center gap-1 rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[13px] text-accent shadow-md"
                  style={{ left: drapeauGlisse.x, top: drapeauGlisse.y, transform: 'translate(-50%, -50%)' }}
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate">{drapeauGlisse.nom}</span>
                </div>
                {drapeauGlisse.trait ? (
                  <div
                    data-prompt-file-caret
                    className="pointer-events-none fixed z-[81] w-0.5 rounded-full bg-accent"
                    style={{
                      left: drapeauGlisse.trait.x,
                      top: drapeauGlisse.trait.y,
                      height: drapeauGlisse.trait.hauteur,
                    }}
                  />
                ) : null}
              </>,
              document.body,
            )
          : null}
        <Textarea
          ref={textareaRef}
          value={texteDuChamp}
          onChange={(event) => {
            // CE QUI SORT DU CHAMP REDEVIENT UN VRAI TEXTE : les tags
            // retrouvent leur « [fichier: …] », et rien d'invisible ne reste
            // dans l'état du composeur — pas même la moitié d'un masque
            // qu'une frappe aurait coupé.
            majTexte(sansMasque(event.target.value));
            curseur.current = event.target.selectionStart;
            setPointeur(event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={retientCurseur}
          onClick={retientCurseur}
          onSelect={retientCurseur}
          onScroll={(event) => setScrollTexte(event.currentTarget.scrollTop)}
          onCopy={(event) => {
            const zone = textareaRef.current;
            if (!zone) return;
            const debut = zone.selectionStart;
            const fin = zone.selectionEnd;
            if (debut === fin) return;
            // Ce qui SORT du champ retrouve des espaces ordinaires : l'insécable
            // n'est là que pour empêcher un tag de se couper en fin de ligne.
            const selection = tagsEnEspacesOrdinaires(sansMasque(texteDuChamp.slice(debut, fin)));
            MARQUE_FICHIER.lastIndex = 0;
            const noms = new Set<string>();
            let trouve: RegExpExecArray | null;
            while ((trouve = MARQUE_FICHIER.exec(selection))) noms.add(nomDuTag(trouve[1]!));
            if (!noms.size) return;
            const jointes = attachments.filter((a) => noms.has(a.name));
            if (!jointes.length) return;
            // La sélection contient un tag [fichier: …] dont la pièce jointe est
            // connue ici : on l'emporte avec le texte pour la recréer au collage.
            event.preventDefault();
            event.clipboardData.setData('text/plain', selection);
            event.clipboardData.setData(TYPE_JOINTES_COLLABLES, emballerJointes(jointes));
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            /*
             * LES FICHIERS D'ORIGINE PASSENT DEVANT TOUT LE RESTE. Le texte
             * collé nomme ses fichiers par ses tags « [fichier: …] » : s'ils
             * sont connus du projet, ce sont EUX qu'on repose — jamais des
             * copies téléversées à nouveau, et même quand le presse-papiers
             * n'a porté que du texte (téléphone, presse-papiers du système,
             * où notre type maison ne survit pas).
             */
            const texteDuPressePapiers = event.clipboardData.getData('text/plain');
            const jointesParTag = projectId
              ? jointesDesTags(
                  texteDuPressePapiers,
                  client.getSnapshot().attachments[projectId] ?? [],
                )
              : [];
            if (files.length) {
              event.preventDefault();
              /*
               * Coller un message copié avec ses images (BoutonCopier) doit
               * réinjecter le TEXTE en plus des fichiers, sinon seules les
               * images arrivaient et la phrase copiée disparaissait.
               */
              const texteColle = event.clipboardData.getData('text/plain');
              if (texteColle) {
                const zone = textareaRef.current;
                const debut = zone ? zone.selectionStart : text.length;
                const fin = zone ? zone.selectionEnd : text.length;
                setText((avant) => `${avant.slice(0, debut)}${texteColle}${avant.slice(fin)}`);
                const position = debut + texteColle.length;
                curseur.current = position;
                curseurAPoser.current = position;
              }
              // Le message copié désigne des fichiers DÉJÀ là : on les repose
              // tels quels au lieu de téléverser les images du presse-papiers,
              // qui feraient doublon sous un nouvel identifiant.
              if (jointesParTag.length) {
                setAttachments((current) => ajouterJointesCollees(current, jointesParTag));
                return;
              }
              // Les fichiers, eux, ne visent aucun endroit précis : à la fin.
              void upload(files, true);
              return;
            }

            const emballees = relireJointes(event.clipboardData.getData(TYPE_JOINTES_COLLABLES));
            const jointes = emballees.length ? emballees : jointesParTag;
            if (!jointes.length) return;

            /* Un tag [fichier: …] copié, ou un message historique copié avec
               son bouton, recrée ses pièces jointes : les fichiers D'ORIGINE
               reparaissent au-dessus du champ, comme s'ils venaient d'être
               ajoutés à la main. */
            event.preventDefault();
            const texteColle = event.clipboardData.getData('text/plain');
            const zone = textareaRef.current;
            const debut = zone ? zone.selectionStart : text.length;
            const fin = zone ? zone.selectionEnd : text.length;
            setText((avant) => `${avant.slice(0, debut)}${texteColle}${avant.slice(fin)}`);
            const position = debut + texteColle.length;
            // Le curseur se repose APRÈS la peinture, par le mécanisme commun
            // du composeur (effet sur `text`) plutôt qu'à la main.
            curseur.current = position;
            curseurAPoser.current = position;
            setAttachments((current) => ajouterJointesCollees(current, jointes));
          }}
          placeholder={
            edition
              ? t('Modifiez le message en attente…')
              : /*
                 * UN AGENT ARRÊTÉ SUR SA QUESTION N'EST PAS « EN TRAIN DE
                 * TRAVAILLER » : son appel d'outil attend la réponse, et il ne
                 * fera rien d'autre avant de l'avoir. Dire « votre message
                 * attendra son tour » à cet instant était le contraire de la
                 * vérité (`shared/src/attente-question.ts`).
                 */
                agent?.attendReponse
                ? TEXTE_BARRE_EN_ATTENTE
                : busy
                  ? t('L\'agent travaille — votre message attendra son tour…')
                  : t('Écrivez votre demande…')
          }
          rows={1}
          className={cn(
            'relative z-10 min-h-[38px] border-0 bg-transparent pr-14 focus-visible:ring-0',
            aDesDrapeaux && 'texte-sous-calque caret-text',
          )}
        />

        {/* Une seule ligne, même sur téléphone : les réglages rétrécissent,
            les boutons d'envoi gardent leur taille. */}
        <div className="flex min-w-0 items-center gap-0.5 px-1.5 pb-1.5 sm:gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            // Repère pour les contrôles : d'autres écrans ont aussi un champ
            // de fichier, viser « le dernier » attrapait celui du tableau.
            data-composer-file
            className="hidden"
            onChange={(event) => event.target.files && upload(event.target.files)}
          />
          <Tooltip label={t('Joindre un fichier')}>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>

          <div className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" />

          {/* Bascule direct / plan : l'agent réfléchit sans agir tant qu'elle
              est allumée. Placée à gauche du choix de moteur, elle reste un
              réglage à part — pas un quatrième maillon de la cascade. */}
          <Tooltip label={modePlan ? t('Mode plan activé : repasser en exécution directe') : t('Passer en mode plan : l\'agent prépare sans exécuter')}>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'shrink-0 gap-1 px-1.5 text-[12.5px]',
                modePlan ? 'border border-accent/60 bg-accent/10 text-text' : 'text-faint hover:text-text',
              )}
              onClick={() => updateRun({ mode: modePlan ? 'direct' : 'plan' })}
              disabled={!agent}
              data-mode-plan={modePlan ? 'actif' : 'inactif'}
            >
              <Route className="h-3 w-3 shrink-0" />
              
{t('Plan')}
</Button>
          </Tooltip>

          <div className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" />

          {/* Trois réglages EN CASCADE, alimentés par le serveur */}
          <RunSelectors engines={engines} choix={agent?.run} onSelect={updateRun} comptes={state.quotas} />

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onProposeTask && !edition && (text.trim() || picked.length) ? (
              <Button variant="ghost" size="sm" onClick={() => submit(true)}>
                {t('En faire une tâche')}</Button>
            ) : null}
            <MicButton onStart={recorder.start} working={recorder.working} disabled={!agent} />
            {/* Le carré d'arrêt : seul quand rien n'est écrit, à côté de la
                flèche dès qu'une phrase attend d'être envoyée. */}
            {boutons.arret ? (
              <Tooltip label={t('Arrêter l\'agent')}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Arrêter l'agent"
                  className="shrink-0 border border-border text-muted hover:border-danger hover:text-danger"
                  onClick={arret.demander}
                >
                  <Square className="h-3 w-3 fill-current" />
                </Button>
              </Tooltip>
            ) : null}
            {boutons.envoi ? (
              <Button
                variant="default"
                size="icon"
                title={edition ? t('Enregistrer la modification') : t('Envoyer')}
                disabled={edition ? !text.trim() : !agent || (!text.trim() && !picked.length)}
                onClick={() => submit()}
              >
                {edition ? <Check className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
          </div>
          {arret.dialogue}
        </div>
      </div>
    </div>
  );
}

/**
 * Un message en attente tient sur UNE seule ligne : le numéro, le début du
 * texte coupé proprement, le crayon et la corbeille. Le texte entier reste
 * accessible en le modifiant — il s'ouvre alors dans la BARRE D'ÉCRITURE, en
 * bas, avec toute la place.
 */
function QueuedItem({
  item,
  index,
  actif,
  onEdit,
}: {
  item: QueuedPrompt;
  index: number;
  actif: boolean;
  onEdit: () => void;
}) {
  // Les retours à la ligne deviennent des espaces : sinon la ligne unique
  // afficherait un texte coupé au premier saut plutôt qu'à sa largeur.
  const apercu = item.text.replace(/\s+/g, ' ').trim();
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md border bg-surface px-2',
        actif ? 'border-accent/50' : 'border-border',
      )}
    >
      <GripVertical className="h-3 w-3 shrink-0 text-faint" />
      <span className="shrink-0 text-[12px] text-faint">{index + 1}</span>
      <button
        type="button"
        onClick={onEdit}
        title={apercu}
        className="min-w-0 flex-1 truncate text-left text-[13.5px] text-muted hover:text-text"
      >
        {apercu}
      </button>
      <button type="button" title={t('Modifier')} onClick={onEdit} className="shrink-0 text-faint hover:text-text">
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        title={t('Retirer de la file')}
        onClick={() => client.send({ type: 'queue.remove', id: item.id })}
        className="shrink-0 text-faint hover:text-danger"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
