import * as React from 'react';
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Pilcrow,
  Quote,
} from 'lucide-react';
import {
  couleurSure,
  markdownVersHtml,
  noeudsVersMarkdown,
  adresseSure,
  TONS_EDITEUR,
  type NoeudRiche,
} from '@beluga/shared';
import { ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * L'ÉDITEUR RICHE D'UNE NOTE — on écrit dans la page, pas dans un formulaire.
 *
 * La zone est modifiable (`contenteditable`) : le texte s'y met en forme sous
 * les yeux, exactement comme il se relira. Ce qui est ENREGISTRÉ reste du
 * Markdown (`shared/src/editeur-riche.ts`) : lisible sans cet éditeur, et qui
 * survivra à sa prochaine refonte.
 *
 * DEUX BARRES, ET C'EST VOULU : une barre fixe en tête, toujours là pour poser
 * un titre ou une liste sur la ligne où l'on est ; une barre FLOTTANTE qui
 * n'apparaît qu'au-dessus d'une sélection, pour la mettre en forme sans quitter
 * des yeux ce qu'on retouche. Aucune des deux ne prend le curseur : les boutons
 * refusent le `mousedown`, donc la sélection reste vivante pendant le clic.
 *
 * AUCUNE COULEUR N'EST ÉCRITE EN DUR : les tons proposés sont les jetons du
 * thème (`--danger`, `--warning`, `--ok`, `--accent`), lus sur la page. Les
 * douze palettes s'appliquent donc sans qu'une seule teinte soit fixée ici.
 */

/** La valeur réelle d'un jeton du thème, en couleur utilisable dans le texte. */
function couleurDuJeton(jeton: string): string {
  if (typeof window === 'undefined') return '';
  const brut = getComputedStyle(document.documentElement).getPropertyValue(jeton).trim();
  if (!brut) return '';
  // Les jetons sont écrits en composantes HSL nues (« 210 40% 96% »).
  return /^[\d.]+\s/.test(brut) ? `hsl(${brut})` : brut;
}

/**
 * UN VRAI NŒUD DU NAVIGATEUR, TRADUIT EN FORME MINUSCULE.
 *
 * Le HTML produit par une zone modifiable est brouillon : des `<span>`
 * imbriqués, des `<font>`, des `<div>` sans fin. On n'en garde ici que ce qui
 * porte du sens ; le reste du travail (le Markdown) se fait dans `shared/`,
 * sans navigateur, et se teste donc tout seul.
 */
function lireNoeud(noeud: Node): NoeudRiche | null {
  if (noeud.nodeType === Node.TEXT_NODE) {
    const texte = noeud.textContent ?? '';
    return texte ? { texte } : null;
  }
  if (noeud.nodeType !== Node.ELEMENT_NODE) return null;
  const element = noeud as HTMLElement;
  const balise = element.tagName.toLowerCase();

  if (balise === 'img') {
    return {
      balise: 'img',
      enfants: [],
      src: element.getAttribute('src') ?? '',
      alt: element.getAttribute('alt') ?? '',
    };
  }
  if (balise === 'br') return { balise: 'br', enfants: [] };

  const enfants = lireEnfants(element);
  const couleur = couleurSure(element.style.color || element.getAttribute('color') || '');
  // Le navigateur écrit encore `font-weight: bold` au lieu d'un `<b>` selon la
  // façon dont la sélection a été faite : on rattrape les deux.
  const gras = /^(bold|[6-9]00)$/.test(element.style.fontWeight || '');
  const italique = element.style.fontStyle === 'italic';

  let sortie: NoeudRiche = { balise, enfants, couleur: couleur || undefined };
  if (element.hasAttribute('href')) sortie = { ...sortie, href: element.getAttribute('href') ?? '' };
  if (gras) sortie = { balise: 'b', enfants: [sortie] };
  if (italique) sortie = { balise: 'i', enfants: [sortie] };
  return sortie;
}

function lireEnfants(element: Node): NoeudRiche[] {
  const sortie: NoeudRiche[] = [];
  element.childNodes.forEach((enfant) => {
    const lu = lireNoeud(enfant);
    if (lu) sortie.push(lu);
  });
  return sortie;
}

/** Ce que la zone modifiable contient, en Markdown. */
export function zoneVersMarkdown(zone: HTMLElement): string {
  return noeudsVersMarkdown(lireEnfants(zone));
}

export function EditeurRiche({
  valeur,
  /** Change à chaque note ouverte : c'est ce qui autorise à REPEINDRE la zone. */
  cle,
  onChange,
  onInsererImage,
  placeholder,
  className,
}: {
  valeur: string;
  cle: string;
  onChange: (markdown: string) => void;
  /** Rend l'adresse d'une image déposée, ou rien si l'envoi a échoué. */
  onInsererImage?: () => Promise<string | null>;
  placeholder?: string;
  className?: string;
}) {
  const zoneRef = React.useRef<HTMLDivElement>(null);
  const dernierEnvoi = React.useRef<string>('');
  const [vide, setVide] = React.useState(!valeur.trim());
  const [barre, setBarre] = React.useState<{ x: number; y: number } | null>(null);

  /*
   * LA ZONE N'EST REPEINTE QUE SUR UN CHANGEMENT DE NOTE, jamais à chaque
   * frappe : réécrire le HTML sous le curseur le renverrait au début du texte à
   * chaque lettre tapée. Le Markdown que l'on vient d'émettre est donc ignoré
   * quand il revient par la propriété.
   */
  React.useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    zone.innerHTML = markdownVersHtml(valeur);
    dernierEnvoi.current = valeur;
    setVide(!valeur.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  React.useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    if (valeur === dernierEnvoi.current) return;
    zone.innerHTML = markdownVersHtml(valeur);
    dernierEnvoi.current = valeur;
    setVide(!valeur.trim());
  }, [valeur]);

  const emettre = React.useCallback(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const markdown = zoneVersMarkdown(zone);
    setVide(!markdown.trim());
    if (markdown === dernierEnvoi.current) return;
    dernierEnvoi.current = markdown;
    onChange(markdown);
  }, [onChange]);

  /*
   * LA BARRE FLOTTANTE SUIT LA SÉLECTION. Elle se pose juste au-dessus du texte
   * choisi, en coordonnées d'écran (`position: fixed`) : la zone défile sous
   * elle sans qu'elle se décale. Sélection vide, ou faite ailleurs dans la
   * page : elle disparaît.
   */
  React.useEffect(() => {
    const suivre = () => {
      const zone = zoneRef.current;
      const selection = window.getSelection();
      if (!zone || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setBarre(null);
        return;
      }
      const plage = selection.getRangeAt(0);
      if (!zone.contains(plage.commonAncestorContainer)) {
        setBarre(null);
        return;
      }
      const cadre = plage.getBoundingClientRect();
      if (!cadre.width && !cadre.height) {
        setBarre(null);
        return;
      }
      /*
       * ELLE SE POSE AU-DESSUS DE LA SÉLECTION — SAUF S'IL N'Y A PAS LA PLACE.
       * Une sélection faite sur la première ligne collerait la barre flottante
       * par-dessus la barre fixe : les deux se recouvriraient, et le bouton
       * visé ne serait plus celui qu'on croit cliquer. Dans ce cas elle passe
       * SOUS la sélection.
       */
      const zoneCadre = zone.getBoundingClientRect();
      const dessus = cadre.top - 44;
      setBarre({
        x: cadre.left + cadre.width / 2,
        y: dessus >= zoneCadre.top ? dessus : cadre.bottom + 8,
      });
    };
    document.addEventListener('selectionchange', suivre);
    return () => document.removeEventListener('selectionchange', suivre);
  }, []);

  /** Une commande de mise en forme, appliquée à la sélection en cours. */
  const commande = (nom: string, valeurCommande?: string) => {
    const zone = zoneRef.current;
    if (!zone) return;
    zone.focus();
    // Les couleurs et les graisses s'écrivent en style CSS, pas en `<font>` :
    // c'est ce que le convertisseur Markdown sait relire.
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(nom, false, valeurCommande);
    emettre();
  };

  const poserBloc = (balise: string) => commande('formatBlock', `<${balise}>`);

  const poserLien = () => {
    const adresse = window.prompt(t('Adresse du lien'), 'https://');
    if (!adresse) return;
    const sure = adresseSure(adresse);
    if (!sure) return;
    commande('createLink', sure);
  };

  const poserImage = async () => {
    if (onInsererImage) {
      const adresse = await onInsererImage();
      if (adresse) commande('insertImage', adresse);
      return;
    }
    const adresse = window.prompt(t('Adresse de l’image'), 'https://');
    const sure = adresse ? adresseSure(adresse) : '';
    if (sure) commande('insertImage', sure);
  };

  const poserCouleur = (jeton: string) => {
    const couleur = couleurDuJeton(jeton);
    if (couleur) commande('foreColor', couleur);
  };

  /** Un bouton de barre : il ne prend JAMAIS le curseur au texte. */
  const Bouton = ({
    titre,
    repere,
    onAction,
    children,
  }: {
    /** L'infobulle, TRADUITE. */
    titre: string;
    /** Le repère technique, en français et le MÊME dans les cinq langues. */
    repere: string;
    onAction: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      title={titre}
      aria-label={repere}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onAction}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-text"
    >
      {children}
    </button>
  );

  const outils = (
    <>
      <Bouton titre={t('Gras')} repere="Gras" onAction={() => commande('bold')}>
        <Bold className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Italique')} repere="Italique" onAction={() => commande('italic')}>
        <Italic className="h-3.5 w-3.5" />
      </Bouton>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-faint/40" />
      <Bouton titre={t('Grand titre')} repere="Grand titre" onAction={() => poserBloc('h1')}>
        <Heading1 className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Titre')} repere="Titre" onAction={() => poserBloc('h2')}>
        <Heading2 className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Sous-titre')} repere="Sous-titre" onAction={() => poserBloc('h3')}>
        <Heading3 className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Texte courant')} repere="Texte courant" onAction={() => poserBloc('p')}>
        <Pilcrow className="h-3.5 w-3.5" />
      </Bouton>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-faint/40" />
      <Bouton titre={t('Liste à puces')} repere="Liste à puces" onAction={() => commande('insertUnorderedList')}>
        <List className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Liste numérotée')} repere="Liste numérotée" onAction={() => commande('insertOrderedList')}>
        <ListOrdered className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Citation')} repere="Citation" onAction={() => poserBloc('blockquote')}>
        <Quote className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Bloc de code')} repere="Bloc de code" onAction={() => poserBloc('pre')}>
        <Code2 className="h-3.5 w-3.5" />
      </Bouton>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-faint/40" />
      <Bouton titre={t('Lien')} repere="Lien" onAction={poserLien}>
        <Link2 className="h-3.5 w-3.5" />
      </Bouton>
      <Bouton titre={t('Image')} repere="Image" onAction={() => void poserImage()}>
        <ImageIcon className="h-3.5 w-3.5" />
      </Bouton>
      <span className="ml-0.5 inline-flex items-center gap-0.5" data-couleurs-note>
        <Palette className="h-3.5 w-3.5 shrink-0 text-faint" />
        {TONS_EDITEUR.map((ton) => (
          <button
            key={ton.cle}
            type="button"
            title={t(ton.libelle)}
            aria-label={ton.libelle}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => poserCouleur(ton.jeton)}
            className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: `hsl(var(${ton.jeton}))` }}
          />
        ))}
      </span>
    </>
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {/* La barre FIXE : elle sert quand rien n'est sélectionné — poser un
          titre sur la ligne courante, démarrer une liste. */}
      <div
        data-barre-edition
        className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
      >
        {outils}
      </div>

      {/* La barre FLOTTANTE : elle n'existe qu'au-dessus d'une sélection. */}
      {barre ? (
        <div
          data-barre-flottante
          className="fixed z-40 flex flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-0.5 shadow-lg"
          /*
           * SUR TÉLÉPHONE ELLE TIENT LES DEUX BORDS : la rangée d'outils est
           * plus large qu'un écran de téléphone ; centrée sur la sélection,
           * une moitié sortait de l'écran et devenait inatteignable. Sur grand
           * écran elle reste centrée sur ce qu'on a sélectionné.
           */
          style={
            window.innerWidth < 640
              ? { left: 8, right: 8, top: Math.max(8, barre.y) }
              : {
                  left: Math.max(8, Math.min(barre.x, window.innerWidth - 8)),
                  top: Math.max(8, barre.y),
                  transform: 'translateX(-50%)',
                }
          }
        >
          {outils}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {vide && placeholder ? (
          <p className="pointer-events-none absolute left-4 top-3 text-[14.5px] text-faint">
            {placeholder}
          </p>
        ) : null}
        {/* Le texte défile dans la zone commune : même barre fine que partout. */}
        <ZoneDefilement voile={false} classeEnveloppe="h-full">
        <div
          ref={zoneRef}
          data-editeur-note
          role="textbox"
          aria-multiline="true"
          aria-label="Contenu de la note"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={emettre}
          onBlur={emettre}
          // COLLER NE RAMÈNE QUE DU TEXTE : un morceau de page web collé tel
          // quel amènerait ses propres polices, ses fonds et ses scripts.
          onPaste={(event) => {
            event.preventDefault();
            const texte = event.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, texte);
            emettre();
          }}
          className="note-riche min-h-full px-4 py-3 outline-none"
        />
        </ZoneDefilement>
      </div>
    </div>
  );
}
