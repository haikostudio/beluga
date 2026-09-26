import * as React from 'react';
import { Check, ChevronDown, Loader2, TerminalSquare, TriangleAlert } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  ConfirmDialog,
  Drawer,
  DialogTitle,
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

export function TerminalServeur({ open, onClose }: { open: boolean; onClose: () => void }) {
  /*
   * LA BOÎTE EST TENUE EN ÉTAT, PAS EN RÉFÉRENCE, et c'est ce qui fait toute la
   * différence ici. Le tiroir est monté par Radix à travers un portail : au
   * premier passage de l'effet, la boîte n'existe PAS ENCORE, et une référence
   * serait restée vide sans que rien ne rappelle l'effet — le tiroir s'ouvrait
   * sur un rectangle noir, indéfiniment « Attache… ». En état, l'arrivée de la
   * boîte relance l'effet, et le terminal se pose dedans.
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

  return (
    <Drawer open={open} onClose={onClose} className="max-w-[1400px]">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Terminal du serveur')}</DialogTitle>
        {/* LE COMPTE QUI DÉPENSE, À CÔTÉ DU NOM DE LA SESSION. Sans lui, le
            `claude` tapé ici consommait un abonnement qu'aucun écran ne montre. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={bascule || !comptesClaude.length}>
            <button
              type="button"
              data-terminal-compte
              className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] text-faint hover:bg-raised disabled:opacity-60"
              disabled={bascule || !comptesClaude.length}
            >
              {bascule ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span className="max-w-[220px] truncate">
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

        <span className="shrink-0 text-[12.5px] text-faint">
          {etat === 'pret' ? t('session partagée « {v0} »', { v0: SESSION_TERMINAL }) : null}
          {etat === 'ouverture' ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('Attache…')}
            </span>
          ) : null}
        </span>
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

      {/* Le fond suit le thème ; la hauteur est fixe pour que la fenêtre ne
          grandisse pas à chaque ligne écrite dans le terminal. */}
      <div
        data-terminal-serveur
        ref={setHote}
        className="mx-3 mb-3 h-[62dvh] min-h-[240px] overflow-hidden rounded-md border border-border bg-surface p-2"
      />

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
    </Drawer>
  );
}
