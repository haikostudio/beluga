import * as React from 'react';
import { Check, ChevronDown, Loader2, Maximize2, Minimize2, TerminalSquare, TriangleAlert, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui';
import {
  ROUTE_TERMINAL,
  SESSION_TERMINAL,
  decoderSortie,
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
 * UN VOLET ANCRÉ EN BAS DE L'APPLICATION, pas un tiroir : il monte du bas comme
 * s'il venait de derrière la page, ne voile rien (la page reste utilisable
 * au-dessus), s'agrandit, se redimensionne à la poignée et se ferme. Fermer
 * DÉTACHE seulement : la session tmux, elle, continue.
 *
 * CE MORCEAU NE SE TÉLÉCHARGE QU'À L'OUVERTURE (`PanneauALaDemande`) :
 * l'afficheur de terminal pèse à lui seul plus que plusieurs écrans de
 * l'application, et il ne sert qu'à qui clique sur le bouton.
 */

/** Les couleurs du terminal suivent le thème de l'application, pas l'inverse. */
function couleursDuTheme(): Record<string, string> {
  const lire = (jeton: string, repli: string) => {
    const valeur = getComputedStyle(document.documentElement).getPropertyValue(jeton).trim();
    return valeur ? `hsl(${valeur})` : repli;
  };
  return {
    background: lire('--surface', '#111111'),
    foreground: lire('--text', '#eeeeee'),
    cursor: lire('--accent', '#ffffff'),
    cursorAccent: lire('--surface', '#111111'),
    selectionBackground: lire('--raised', '#333333'),
  };
}

/** Le volet ne descend pas sous cette hauteur, et laisse cette marge en haut. */
const HAUTEUR_MINI_DU_VOLET = 200;
const MARGE_HAUTE_DU_VOLET = 56;

export function TerminalServeur({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  const comptesClaude = (state.quotas ?? []).filter((quota) => quota.engine === 'claude' && !quota.disabled);
  const [compte, setCompte] = React.useState<CompteAffiche | undefined>(undefined);
  const [avertissement, setAvertissement] = React.useState('');
  /** Chaque tour de ce compteur refait l'attache : c'est ainsi qu'on se rattache. */
  const [cycle, setCycle] = React.useState(0);
  const [aConfirmer, setAConfirmer] = React.useState<{ id: string; label: string } | null>(null);
  const [bascule, setBascule] = React.useState(false);
  const voieRef = React.useRef<WebSocket | null>(null);

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

  React.useEffect(() => {
    if (open) setSortant(false);
  }, [open]);

  /** Fermer joue la descente du volet, puis détache : la session continue. */
  const fermer = () => {
    setSortant(true);
    window.setTimeout(onClose, 190);
  };

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
      theme: couleursDuTheme(),
    });
    const ajustement = new FitAddon();
    terminal.loadAddon(ajustement);
    terminal.open(hote);
    ajustement.fit();

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
        return;
      }
      if (message.type === 'pret') {
        setEtat('pret');
        setCompte(message.compte);
        setAvertissement(message.avertissement ?? '');
        setBascule(false);
        terminal.focus();
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
      ajustement.fit();
      if (voie.readyState === WebSocket.OPEN) {
        voie.send(JSON.stringify({ type: 'taille', colonnes: terminal.cols, lignes: terminal.rows }));
      }
    };
    const observateur = new ResizeObserver(suivreLaTaille);
    observateur.observe(hote);

    return () => {
      observateur.disconnect();
      frappe.dispose();
      voie.onclose = null;
      voie.close();
      if (voieRef.current === voie) voieRef.current = null;
      terminal.dispose();
    };
  }, [open, hote, cycle]);

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

  return (
    <div
      ref={volet}
      data-terminal-volet
      data-terminal-volet-taille={grand ? 'grand' : libre !== null ? 'libre' : 'normal'}
      style={{
        height:
          libre !== null
            ? `min(${libre}px, calc(var(--hauteur-app, 100dvh) - ${MARGE_HAUTE_DU_VOLET}px))`
            : grand
              ? `calc(var(--hauteur-app, 100dvh) - ${MARGE_HAUTE_DU_VOLET}px)`
              : 'min(46dvh, calc(var(--hauteur-app, 100dvh) - 120px))',
        paddingBottom: 'var(--zone-sure-bas, 0px)',
      }}
      className={cn(
        'fixed inset-x-0 bottom-0 z-[45] flex min-h-[200px] flex-col rounded-t-xl bg-surface shadow-[0_-8px_30px_rgba(0,0,0,0.25)]',
        sortant ? 'animate-slide-sheet-out' : 'animate-slide-sheet',
      )}
    >
      {/* LA POIGNÉE : tirer règle la hauteur, double clic agrandit ou réduit. */}
      <div
        data-terminal-poignee
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('Régler la hauteur du terminal')}
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
          <DropdownMenuTrigger asChild disabled={bascule || !comptesClaude.length}>
            <button
              type="button"
              data-terminal-compte
              className="flex min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] text-faint hover:bg-raised disabled:opacity-60"
              disabled={bascule || !comptesClaude.length}
            >
              {bascule ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span className="max-w-[220px] truncate max-sm:max-w-[120px]">
                {compte
                  ? t('Compte : {v0}', { v0: compte.plan ? `${compte.label} · ${compte.plan}` : compte.label })
                  : t('Aucun compte Claude')}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {comptesClaude.map((quota) => (
              <DropdownMenuItem
                key={quota.id}
                data-terminal-compte-choix={quota.id}
                onSelect={() => {
                  if (quota.id === compte?.id) return;
                  setAConfirmer({ id: quota.id, label: quota.label });
                }}
              >
                <span className="flex-1 truncate">{quota.plan ? `${quota.label} · ${quota.plan}` : quota.label}</span>
                {quota.id === compte?.id ? <Check className="h-3.5 w-3.5 text-termine" /> : null}
              </DropdownMenuItem>
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
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          data-terminal-agrandir
          title={grand ? t('Réduire') : t('Agrandir')}
          aria-label={grand ? t('Réduire') : t('Agrandir')}
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
          aria-label={t('Fermer')}
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

      {/* Le fond suit le thème ; la boîte prend la hauteur que le volet lui
          laisse (le volet a une hauteur posée, il ne grandit pas à chaque
          ligne écrite). `ResizeObserver` renvoie la taille à la session. */}
      <div data-terminal-serveur ref={setHote} className="mx-3 mb-3 min-h-0 flex-1 overflow-hidden rounded-md bg-surface p-2" />

      <ConfirmDialog
        open={!!aConfirmer}
        danger
        title={t('Faire tourner le terminal sur « {v0} » ?', { v0: aConfirmer?.label ?? '' })}
        description={t(
          'La session partagée sera recréée avec le coffre de ce compte. Tout ce qui tourne dans le terminal sera perdu, pour tous les écrans attachés.',
        )}
        confirmLabel={t('Changer de compte')}
        onConfirm={() => aConfirmer && changerDeCompte(aConfirmer.id)}
        onClose={() => setAConfirmer(null)}
      />
    </div>
  );
}
