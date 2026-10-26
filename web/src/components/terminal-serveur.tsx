import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, Loader2, Maximize2, Minimize2, Minus, TerminalSquare, TriangleAlert, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import {
  ROUTE_TERMINAL,
  SESSION_TERMINAL,
  decoderSortie,
  texteDuPressePapiers,
  type CompteAffiche,
  type MessageDuTerminal,
} from '@beluga/shared';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE TERMINAL DU SERVEUR, DANS L'APPLICATION.
 *
 * Un vrai terminal, pas une boîte où taper une commande : c'est la session tmux
 * partagée du serveur (`shared/src/terminal-serveur.ts`) qui s'affiche ici, avec
 * ses couleurs, ses écrans pleins et ses outils interactifs. `claude`, `codex`,
 * `npm run build`, `git` s'y lancent comme dans n'importe quel terminal — et ce
 * qui y tourne SURVIT à la fermeture de la fenêtre.
 *
 * L'HISTORIQUE DES COMMANDES EST CELUI DU SHELL, et c'est voulu. Une liste
 * tenue par l'écran aurait été une deuxième mémoire, fausse dès qu'on tape une
 * commande depuis un autre écran attaché à la même session. La flèche du haut
 * remonte le vrai historique de bash, la molette remonte le défilement de tmux :
 * deux choses que tout le monde connaît déjà.
 *
 * UN VOLET POSÉ DERRIÈRE L'APPLICATION (décision de l'utilisateur du
 * 19/10/2026) : c'est TOUTE l'application, colonne de gauche comprise, qui
 * remonte de la hauteur du volet, comme une feuille soulevée, avec une ombre
 * sur son bord bas (`html[data-terminal-ouvert]`, `styles.css`). Le volet,
 * lui, ne bouge pas : il est révélé, sur toute la largeur. Il est NOIR quel que
 * soit le thème (`.terminal-noir`), s'agrandit, se règle à la poignée et se
 * ferme. Fermer DÉTACHE seulement : la session tmux, elle, continue. Il est
 * porté à la racine du document (`createPortal`) : un parent déplacé ferait
 * bouger avec lui un élément `fixed`.
 *
 * CE MORCEAU NE SE TÉLÉCHARGE QU'À L'OUVERTURE (`PanneauALaDemande`) :
 * l'afficheur de terminal pèse à lui seul plus que plusieurs écrans de
 * l'application, et il ne sert qu'à qui clique sur le bouton.
 */

/**
 * LE TERMINAL EST NOIR, EN CLAIR COMME EN SOMBRE : un fond fixe, un texte clair.
 * Les seize couleurs d'outils restent celles d'origine de l'afficheur (sur fond
 * noir, elles sont faites pour ça).
 */
const COULEURS_DU_TERMINAL: Record<string, string> = {
  background: '#0a0a0a',
  foreground: '#e6e6e6',
  cursor: '#f2f2f2',
  cursorAccent: '#0a0a0a',
  selectionBackground: '#3a3a3a',
};

/** Le nom de marque de chaque moteur du terminal : le même dans les cinq langues. */
const NOM_DU_MOTEUR: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

/** La durée du soulèvement de l'application, à l'ouverture comme à la fermeture. */
const DUREE_DU_SOULEVEMENT_MS = 190;

/** Le volet ne descend pas sous cette hauteur, et laisse cette marge en haut. */
const HAUTEUR_MINI_DU_VOLET = 200;
const MARGE_HAUTE_DU_VOLET = 56;

/**
 * L'ACTIVITÉ DU TERMINAL RÉDUIT : il « travaille » tant qu'il a reçu des octets
 * depuis moins que ce délai. Après une attache ou une redimension, tmux redessine
 * tout l'écran : cette rafale-là n'est pas du travail, elle est ignorée pendant
 * `SILENCE_APRES_REDESSIN_MS`.
 */
const DELAI_D_ACTIVITE_MS = 1500;
const SILENCE_APRES_REDESSIN_MS = 900;

/**
 * COPIER LA SÉLECTION. Le presse-papiers du navigateur exige une page sûre
 * (https, ou localhost) : ailleurs, ou s'il refuse, on repasse par l'ancienne
 * commande de copie sur un champ caché. Le texte part TEL QU'IL S'AFFICHE
 * (décision de l'utilisateur du 20/10/2026 : aucun nettoyage).
 */
async function copierLeTexte(texte: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
  } catch {
    /* repli plus bas */
  }
  const champ = document.createElement('textarea');
  champ.value = texte;
  champ.setAttribute('readonly', '');
  champ.style.position = 'fixed';
  champ.style.opacity = '0';
  champ.style.pointerEvents = 'none';
  document.body.appendChild(champ);
  champ.select();
  let reussi = false;
  try {
    reussi = document.execCommand('copy');
  } catch {
    reussi = false;
  }
  champ.remove();
  return reussi;
}

export function TerminalServeur({
  open,
  onClose,
  reduit = false,
  onReduire,
  onActivite,
}: {
  /** Monté et attaché à la session : vrai aussi quand il est réduit. */
  open: boolean;
  onClose: () => void;
  /**
   * RÉDUIT : le volet disparaît et l'application redescend, mais l'afficheur et
   * sa voie RESTENT en place — l'historique de l'écran est gardé, et la sortie
   * qui continue d'arriver dit si quelque chose travaille (`onActivite`).
   */
  reduit?: boolean;
  onReduire?: () => void;
  onActivite?: (actif: boolean) => void;
}) {
  /*
   * LA BOÎTE EST TENUE EN ÉTAT, PAS EN RÉFÉRENCE : au premier passage de
   * l'effet, la boîte peut ne pas exister encore (le volet ne se monte que
   * lorsqu'il est ouvert), et une référence serait restée vide sans que rien
   * ne rappelle l'effet — un rectangle noir, indéfiniment « Attache… ». En
   * état, l'arrivée de la boîte relance l'effet, et le terminal se pose dedans.
   */
  const [hote, setHote] = React.useState<HTMLDivElement | null>(null);
  const [etat, setEtat] = React.useState<'ouverture' | 'pret' | 'panne'>('ouverture');
  const [panne, setPanne] = React.useState('');

  /*
   * LE COMPTE QUI FAIT TOURNER CE TERMINAL. Il vient du serveur, pas d'ici : la
   * session tmux est PARTAGÉE, donc le compte est un réglage du serveur et non
   * une préférence d'onglet. L'entête ne fait que l'afficher et proposer d'en
   * changer.
   */
  const state = useApp();
  /* LES COMPTES CLAUDE ET CODEX, rangés par moteur : choisir l'un d'eux recrée
     la session sur son coffre ET y lance son moteur (`ws-terminal.ts`). */
  const comptesDesMoteurs = (state.quotas ?? []).filter((quota) => (quota.engine === 'claude' || quota.engine === 'codex') && !quota.disabled);
  const groupesDeComptes = (['claude', 'codex'] as const)
    .map((engine) => ({ engine, comptes: comptesDesMoteurs.filter((quota) => quota.engine === engine) }))
    .filter((groupe) => groupe.comptes.length);
  const [compte, setCompte] = React.useState<CompteAffiche | undefined>(undefined);
  const [avertissement, setAvertissement] = React.useState('');
  /** Chaque tour de ce compteur refait l'attache : c'est ainsi qu'on se rattache. */
  const [cycle, setCycle] = React.useState(0);
  const [aConfirmer, setAConfirmer] = React.useState<{ id: string; label: string; engine: string } | null>(null);
  const [bascule, setBascule] = React.useState(false);
  const voieRef = React.useRef<WebSocket | null>(null);
  const terminalRef = React.useRef<Terminal | null>(null);
  /** Refait l'ajustement et renvoie la taille à la session (réouverture d'un terminal réduit). */
  const reajusterRef = React.useRef<(() => void) | null>(null);
  /** L'instant du dernier octet reçu qui compte comme travail, et la fin du silence d'après redessin. */
  const dernierOctetRef = React.useRef(0);
  const silenceJusquaRef = React.useRef(0);
  const [aSelection, setASelection] = React.useState(false);
  const [copie, setCopie] = React.useState(false);
  /**
   * UNE COPIE FAITE PAR UN PROGRAMME QUE LE NAVIGATEUR A REFUSÉE. Hors d'un geste
   * de l'utilisateur, certains navigateurs (Safari) n'écrivent pas le
   * presse-papiers : le texte attend alors sur le bouton « Copier », et un clic
   * termine la copie.
   */
  const [copieEnAttente, setCopieEnAttente] = React.useState<string | null>(null);
  const copieEnAttenteRef = React.useRef<string | null>(null);
  copieEnAttenteRef.current = copieEnAttente;
  const reduitRef = React.useRef(reduit);
  reduitRef.current = reduit;
  const onActiviteRef = React.useRef(onActivite);
  onActiviteRef.current = onActivite;

  /*
   * LA HAUTEUR DU VOLET. `grand` le monte presque jusqu'en haut ; `libre` est
   * la hauteur tirée à la poignée (en pixels, bornée à chaque lecture). Sans
   * l'un ni l'autre, la hauteur usuelle. La hauteur de l'écran est celle de
   * l'application (`--hauteur-app`) : sur téléphone installé, l'écran réel.
   */
  const [grand, setGrand] = React.useState(false);
  const [libre, setLibre] = React.useState<number | null>(null);
  const [sortant, setSortant] = React.useState(false);
  const volet = React.useRef<HTMLDivElement | null>(null);
  /* Le volet est en état : son arrivée relance l'effet du soulèvement. */
  const [monte, setMonte] = React.useState<HTMLDivElement | null>(null);
  const poserLeVolet = React.useCallback((noeud: HTMLDivElement | null) => {
    volet.current = noeud;
    setMonte(noeud);
  }, []);

  const sortantRef = React.useRef(false);
  sortantRef.current = sortant;
  React.useEffect(() => {
    if (open && !reduit) setSortant(false);
  }, [open, reduit]);

  /*
   * RÉDUIT, LE TERMINAL NE GARDE PAS LE CLAVIER : sinon ce qu'on tape dans
   * l'application partirait dans la session. Rouvert, il reprend le clavier et
   * renvoie sa taille — la fenêtre a pu changer pendant qu'il était caché.
   */
  React.useEffect(() => {
    if (!open) return;
    if (reduit) {
      terminalRef.current?.blur();
      terminalRef.current?.clearSelection();
      return;
    }
    reajusterRef.current?.();
    terminalRef.current?.focus();
  }, [open, reduit]);

  /*
   * L'ACTIVITÉ NE SE MESURE QUE RÉDUIT, par un minuteur léger — jamais un rendu
   * par octet reçu. Elle ne remonte qu'à son changement.
   */
  React.useEffect(() => {
    if (!open || !reduit) return;
    let precedent: boolean | null = null;
    const regarder = () => {
      const actif = Date.now() - dernierOctetRef.current < DELAI_D_ACTIVITE_MS;
      if (actif !== precedent) {
        precedent = actif;
        onActiviteRef.current?.(actif);
      }
    };
    regarder();
    const minuteur = window.setInterval(regarder, 400);
    return () => window.clearInterval(minuteur);
  }, [open, reduit]);

  /*
   * L'APPLICATION REMONTE DE LA HAUTEUR DU VOLET. La hauteur réelle (mesurée,
   * donc juste après une poignée tirée ou un écran tourné) part dans
   * `--hauteur-terminal` ; `data-terminal-ouvert` sur <html> allume le
   * soulèvement. Une image d'abord à zéro : la montée s'anime depuis le bas.
   * Fermer redescend l'application sur le volet, puis le retire.
   */
  React.useEffect(() => {
    const racine = document.documentElement;
    const noeud = volet.current;
    if (!open || reduit || !noeud) return;
    racine.setAttribute('data-terminal-ouvert', '');
    racine.style.setProperty('--hauteur-terminal', '0px');
    let image = 0;
    const poser = () => {
      if (sortantRef.current) return;
      racine.style.setProperty('--hauteur-terminal', `${Math.round(noeud.getBoundingClientRect().height)}px`);
    };
    image = window.requestAnimationFrame(() => {
      image = window.requestAnimationFrame(poser);
    });
    const observateur = new ResizeObserver(poser);
    observateur.observe(noeud);
    return () => {
      window.cancelAnimationFrame(image);
      observateur.disconnect();
      racine.removeAttribute('data-terminal-ouvert');
      racine.style.removeProperty('--hauteur-terminal');
    };
  }, [open, reduit, monte]);

  /** Fermer redescend l'application sur le volet, puis détache : la session continue. */
  const fermer = () => {
    setSortant(true);
    document.documentElement.style.setProperty('--hauteur-terminal', '0px');
    window.setTimeout(onClose, DUREE_DU_SOULEVEMENT_MS);
  };

  /** Réduire redescend l'application de la même façon, mais rien ne se détache. */
  const reduire = () => {
    if (!onReduire) return;
    setSortant(true);
    document.documentElement.style.setProperty('--hauteur-terminal', '0px');
    /* La descente finie, le volet n'est plus « sortant » : à la réouverture, le
       soulèvement doit pouvoir poser sa hauteur dès la première image. */
    window.setTimeout(() => {
      setSortant(false);
      onReduire();
    }, DUREE_DU_SOULEVEMENT_MS);
  };

  const montrerCopie = React.useCallback(() => {
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1500);
  }, []);

  const copierLaSelection = React.useCallback(async () => {
    const terminal = terminalRef.current;
    const texte = terminal?.getSelection() || copieEnAttenteRef.current || '';
    if (!texte) return;
    if (await copierLeTexte(texte)) {
      setCopieEnAttente(null);
      montrerCopie();
    }
    terminal?.focus();
  }, [montrerCopie]);

  /**
   * LA COPIE FAITE PAR LE PROGRAMME QUI TOURNE (Claude Code sélectionne lui-même
   * à la souris et l'envoie par la séquence OSC 52, que tmux relaie) : elle part
   * droit au presse-papiers de l'ordinateur, avec le même « Copié » que le bouton.
   */
  const recevoirUneCopie = React.useCallback(
    async (texte: string) => {
      if (await copierLeTexte(texte)) {
        setCopieEnAttente(null);
        montrerCopie();
      } else {
        setCopieEnAttente(texte);
      }
    },
    [montrerCopie],
  );

  /**
   * TIRER LA POIGNÉE. Un geste de redimensionnement, sans cible de dépôt : il
   * suit le pointeur (capturé par la poignée, souris comme doigt) et pose la
   * hauteur de l'écran moins la position du pointeur.
   */
  const tirerLaPoignee = (evenement: React.PointerEvent<HTMLDivElement>) => {
    evenement.preventDefault();
    const poignee = evenement.currentTarget;
    try {
      poignee.setPointerCapture(evenement.pointerId);
    } catch {
      /* rien */
    }
    const deplacer = (e: PointerEvent) => {
      const bas = volet.current?.getBoundingClientRect().bottom ?? window.innerHeight;
      const plafond = bas - MARGE_HAUTE_DU_VOLET;
      setGrand(false);
      setLibre(Math.max(HAUTEUR_MINI_DU_VOLET, Math.min(plafond, bas - e.clientY)));
    };
    const lacher = () => {
      poignee.removeEventListener('pointermove', deplacer);
      poignee.removeEventListener('pointerup', lacher);
      poignee.removeEventListener('pointercancel', lacher);
    };
    poignee.addEventListener('pointermove', deplacer);
    poignee.addEventListener('pointerup', lacher);
    poignee.addEventListener('pointercancel', lacher);
  };

  const basculerGrand = () => {
    setLibre(null);
    setGrand((precedent) => !precedent);
  };

  React.useEffect(() => {
    if (!open || !hote) return;

    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 12.5,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: 5000,
      theme: COULEURS_DU_TERMINAL,
      /* Sur Mac, Option + glisser sélectionne même quand l'outil lancé (Codex…)
         capte la souris ; ailleurs, c'est Maj + glisser, natif dans l'afficheur. */
      macOptionClickForcesSelection: true,
    });
    terminalRef.current = terminal;
    const ajustement = new FitAddon();
    terminal.loadAddon(ajustement);
    terminal.open(hote);
    ajustement.fit();

    /*
     * LA COPIE. Un bouton paraît dans l'entête tant qu'un texte est sélectionné ;
     * Ctrl+Maj+C (Cmd+C sur Mac) copie au clavier sans rien envoyer à la session.
     * Ctrl+C seul garde son rôle : arrêter la commande.
     */
    const selection = terminal.onSelectionChange(() => setASelection(terminal.hasSelection()));
    /* OSC 52 : écrire le presse-papiers, oui ; le lire (« ? »), jamais. Le
       gestionnaire rend vrai dans tous les cas : la séquence ne s'affiche pas. */
    const pressePapiers = terminal.parser.registerOscHandler(52, (donnees) => {
      const texte = texteDuPressePapiers(donnees);
      if (texte) void recevoirUneCopie(texte);
      return true;
    });
    terminal.attachCustomKeyEventHandler((evenement) => {
      if (evenement.type !== 'keydown') return true;
      const touche = evenement.key.toLowerCase();
      const raccourci =
        touche === 'c' &&
        ((evenement.ctrlKey && evenement.shiftKey && !evenement.altKey && !evenement.metaKey) ||
          (evenement.metaKey && !evenement.ctrlKey && terminal.hasSelection()));
      if (!raccourci) return true;
      evenement.preventDefault();
      evenement.stopPropagation();
      void copierLaSelection();
      return false;
    });

    /*
     * LA TAILLE PART AVEC LA DEMANDE D'OUVERTURE. Le serveur crée ou
     * redimensionne la session AVANT la première image : sans cela, le terminal
     * s'afficherait en 80×24 puis sauterait sous les yeux au premier message de
     * redimension.
     */
    const protocole = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const voie = new WebSocket(
      `${protocole}//${location.host}${ROUTE_TERMINAL}?colonnes=${terminal.cols}&lignes=${terminal.rows}`,
    );
    voieRef.current = voie;

    voie.onmessage = (evenement) => {
      const message = JSON.parse(evenement.data as string) as MessageDuTerminal;
      if (message.type === 'sortie') {
        // Des OCTETS, pas du texte : c'est l'afficheur qui recolle un accent
        // coupé entre deux morceaux (voir `encoderSortie`).
        terminal.write(decoderSortie(message.donnees));
        if (Date.now() >= silenceJusquaRef.current) dernierOctetRef.current = Date.now();
        return;
      }
      if (message.type === 'pret') {
        silenceJusquaRef.current = Date.now() + SILENCE_APRES_REDESSIN_MS;
        setEtat('pret');
        setCompte(message.compte);
        setAvertissement(message.avertissement ?? '');
        setBascule(false);
        if (!reduitRef.current) terminal.focus();
        return;
      }
      if (message.type === 'compte-change') {
        /*
         * LA SESSION A ÉTÉ TUÉE PUIS SERA REFAITE : on se rattache de nous-mêmes
         * plutôt que d'afficher la coupure comme une panne. Le compteur relance
         * l'effet, qui rouvre une voie et donc une session neuve, avec le
         * coffre du compte choisi.
         */
        setCompte(message.compte);
        setAvertissement(message.avertissement ?? '');
        setEtat('ouverture');
        setCycle((precedent) => precedent + 1);
        return;
      }
      // Seule une PANNE annoncée est une panne. Tout autre message est ignoré :
      // une version du serveur qui ne connaîtrait pas encore cette voie renvoie
      // les événements de l'application, et il ne faut pas les prendre pour des
      // erreurs à afficher en rouge.
      if (message.type !== 'panne') return;
      setEtat('panne');
      setPanne(message.message);
    };
    voie.onerror = () => {
      setEtat('panne');
      setPanne(t('La liaison avec le terminal du serveur a été refusée.'));
    };
    voie.onclose = () => setEtat((precedent) => (precedent === 'panne' ? precedent : 'ouverture'));

    const frappe = terminal.onData((donnees) => {
      if (voie.readyState === WebSocket.OPEN) voie.send(JSON.stringify({ type: 'frappe', donnees }));
    });

    /*
     * LE REDIMENSIONNEMENT PASSE PAR LA SESSION, pas seulement par l'afficheur :
     * tmux doit redessiner à la nouvelle taille, sinon le texte se replierait
     * sur l'ancienne largeur.
     */
    const suivreLaTaille = () => {
      /* Réduit, la boîte est cachée : on ne renvoie rien, la réouverture le fera. */
      if (reduitRef.current || !hote.clientWidth || !hote.clientHeight) return;
      const avant = `${terminal.cols}x${terminal.rows}`;
      ajustement.fit();
      if (`${terminal.cols}x${terminal.rows}` !== avant) silenceJusquaRef.current = Date.now() + SILENCE_APRES_REDESSIN_MS;
      if (voie.readyState === WebSocket.OPEN) {
        voie.send(JSON.stringify({ type: 'taille', colonnes: terminal.cols, lignes: terminal.rows }));
      }
    };
    reajusterRef.current = suivreLaTaille;
    const observateur = new ResizeObserver(suivreLaTaille);
    observateur.observe(hote);

    return () => {
      observateur.disconnect();
      frappe.dispose();
      selection.dispose();
      pressePapiers.dispose();
      setASelection(false);
      if (reajusterRef.current === suivreLaTaille) reajusterRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      voie.onclose = null;
      voie.close();
      if (voieRef.current === voie) voieRef.current = null;
      terminal.dispose();
    };
    // `copierLaSelection` et `recevoirUneCopie` sont stables.
  }, [open, hote, cycle, copierLaSelection, recevoirUneCopie]);

  /**
   * CHANGER DE COMPTE COUPE CE QUI TOURNE, POUR TOUT LE MONDE. tmux fige
   * l'environnement d'un shell à sa création : le seul moyen de faire pointer
   * `claude` sur un autre coffre est de recréer la session. D'où la
   * confirmation, et le bouton qui dit dès le clic qu'il part en requête.
   */
  const changerDeCompte = (id: string) => {
    setBascule(true);
    setAConfirmer(null);
    const voie = voieRef.current;
    if (voie && voie.readyState === WebSocket.OPEN) {
      voie.send(JSON.stringify({ type: 'compte', id }));
      return;
    }
    // Voie déjà fermée : on se rattache, le serveur relira son réglage.
    setBascule(false);
    setCycle((precedent) => precedent + 1);
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={poserLeVolet}
      data-terminal-volet
      data-terminal-volet-taille={grand ? 'grand' : libre !== null ? 'libre' : 'normal'}
      data-terminal-reduit={reduit ? 'oui' : undefined}
      aria-hidden={reduit || undefined}
      style={{
        height:
          libre !== null
            ? `min(${libre}px, calc(var(--hauteur-app, 100dvh) - ${MARGE_HAUTE_DU_VOLET}px))`
            : grand
              ? `calc(var(--hauteur-app, 100dvh) - ${MARGE_HAUTE_DU_VOLET}px)`
              : 'min(46dvh, calc(var(--hauteur-app, 100dvh) - 120px))',
        paddingBottom: 'var(--zone-sure-bas, 0px)',
      }}
      /* DERRIÈRE L'APPLICATION : sous sa couche (`z-0` contre la sienne), noir
         dans tous les thèmes (`terminal-noir` redonne les jetons de couleur). */
      /* RÉDUIT, il reste en place mais invisible et inerte : sa taille ne bouge
         pas, donc rien n'est renvoyé à la session, et l'historique est intact. */
      className={cn(
        'terminal-noir fixed inset-x-0 bottom-0 z-0 flex min-h-[200px] flex-col bg-bg',
        reduit && 'pointer-events-none invisible',
      )}
    >
      {/* LA POIGNÉE : tirer règle la hauteur, double clic agrandit ou réduit. */}
      <div
        data-terminal-poignee
        role="separator"
        aria-orientation="horizontal"
        aria-label="Régler la hauteur du terminal"
        onPointerDown={tirerLaPoignee}
        onDoubleClick={basculerGrand}
        className="flex h-3.5 shrink-0 cursor-ns-resize touch-none items-center justify-center"
      >
        <span className="h-1 w-10 rounded-full bg-faint/50" />
      </div>

      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-accent" />
        {/* Sur téléphone, la place va aux boutons : le titre et le nom de la
            session s'effacent, l'icône et le compte suffisent. */}
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium text-text max-sm:hidden">{t('Terminal du serveur')}</h2>
        {/* LE COMPTE QUI DÉPENSE, À CÔTÉ DU NOM DE LA SESSION. Sans lui, le
            `claude` tapé ici consommait un abonnement qu'aucun écran ne montre. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={bascule || !comptesDesMoteurs.length}>
            <button
              type="button"
              data-terminal-compte
              className="flex min-w-0 shrink items-center gap-1.5 rounded-md px-2 sm:px-1.5 py-1 sm:py-0.5 text-[12.5px] text-faint hover:bg-raised disabled:opacity-60"
              disabled={bascule || !comptesDesMoteurs.length}
            >
              {bascule ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span className="max-w-[220px] truncate max-sm:max-w-[120px]">
                {compte
                  ? t('Compte : {v0}', { v0: compte.plan ? `${compte.label} · ${compte.plan}` : compte.label })
                  : t('Aucun compte Claude ni Codex')}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="terminal-noir">
            {groupesDeComptes.map((groupe, rang) => (
              <React.Fragment key={groupe.engine}>
                {rang ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel data-terminal-groupe={groupe.engine}>{NOM_DU_MOTEUR[groupe.engine]}</DropdownMenuLabel>
                {groupe.comptes.map((quota) => (
                  <DropdownMenuItem
                    key={quota.id}
                    data-terminal-compte-choix={quota.id}
                    data-terminal-compte-moteur={quota.engine}
                    onSelect={() => {
                      if (quota.id === compte?.id) return;
                      setAConfirmer({ id: quota.id, label: quota.label, engine: quota.engine });
                    }}
                  >
                    <span className="flex-1 truncate">{quota.plan ? `${quota.label} · ${quota.plan}` : quota.label}</span>
                    {quota.id === compte?.id ? <Check className="h-3.5 w-3.5 text-termine" /> : null}
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="shrink-0 text-[12.5px] text-faint max-sm:hidden">
          {etat === 'pret' ? t('session partagée « {v0} »', { v0: SESSION_TERMINAL }) : null}
          {etat === 'ouverture' ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('Attache…')}
            </span>
          ) : null}
        </span>

        <span className="min-w-0 flex-1 sm:hidden" />
        {/* COPIER : présent seulement quand un texte est sélectionné. Le clic ne
            doit pas voler le focus, sinon la sélection disparaît avant la copie. */}
        {aSelection || copie || copieEnAttente ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-[34px] sm:h-7 shrink-0 gap-1.5 px-2 text-[12.5px]"
            data-terminal-copier
            data-terminal-copie={copie ? 'oui' : undefined}
            data-terminal-copie-en-attente={copieEnAttente && !aSelection ? 'oui' : undefined}
            title={
              copieEnAttente && !aSelection
                ? t('Le navigateur a bloqué la copie automatique : cliquez pour copier')
                : t('Copier la sélection (Ctrl+Maj+C) · Option ou Maj + glisser force la sélection')
            }
            aria-label="Copier la sélection"
            onMouseDown={(evenement) => evenement.preventDefault()}
            onClick={() => void copierLaSelection()}
          >
            {copie ? <Check className="h-3.5 w-3.5 text-termine" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="max-sm:hidden">{copie ? t('Copié') : t('Copier')}</span>
          </Button>
        ) : null}
        {onReduire ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            data-terminal-reduire
            title={t('Réduire le terminal')}
            aria-label="Réduire le terminal"
            onClick={reduire}
          >
            <Minus className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          data-terminal-agrandir
          title={grand ? t('Taille normale') : t('Agrandir')}
          aria-label={grand ? 'Taille normale' : 'Agrandir'}
          onClick={basculerGrand}
        >
          {grand ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          data-terminal-fermer
          title={t('Fermer')}
          aria-label="Fermer"
          onClick={fermer}
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* L'ABSENCE DE COMPTE SE DIT, elle ne se devine pas à un libellé vide. */}
      {avertissement ? (
        <p data-terminal-avertissement className="flex items-start gap-1.5 px-3 pb-2 text-[12.5px] text-faint">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-encours" />
          <span className="min-w-0">{avertissement}</span>
        </p>
      ) : null}

      {etat === 'panne' ? (
        <p data-terminal-panne className="px-3 pb-2 text-[13px] text-danger">
          {panne}
        </p>
      ) : null}

      {/* Le fond est noir ; la boîte prend la hauteur que le volet lui
          laisse (le volet a une hauteur posée, il ne grandit pas à chaque
          ligne écrite). `ResizeObserver` renvoie la taille à la session. */}
      <div data-terminal-serveur ref={setHote} className="mx-3 mb-3 min-h-0 flex-1 overflow-hidden rounded-md bg-surface p-2" />

      <ConfirmDialog
        open={!!aConfirmer}
        danger
        title={t('Faire tourner le terminal sur « {v0} » ?', { v0: aConfirmer?.label ?? '' })}
        description={t(
          'La session partagée sera recréée avec le coffre de ce compte, et {v0} y sera lancé. Tout ce qui tourne dans le terminal sera perdu, pour tous les écrans attachés.',
          { v0: NOM_DU_MOTEUR[aConfirmer?.engine ?? 'claude'] ?? '' },
        )}
        confirmLabel={t('Changer de compte')}
        onConfirm={() => aConfirmer && changerDeCompte(aConfirmer.id)}
        onClose={() => setAConfirmer(null)}
      />
    </div>,
    document.body,
  );
}
