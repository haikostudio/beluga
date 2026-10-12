import * as React from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { installationEnDirect } from '@/lib/travail-installation';

/**
 * L'AFFICHEUR DE LA SORTIE D'UNE INSTALLATION — un terminal qu'on REGARDE.
 *
 * Le même afficheur que le terminal du serveur (`terminal-serveur.tsx`), sans
 * clavier : rien ne s'y tape, il montre ce que le démon est en train de faire
 * pour l'écran. Les installateurs dessinent des barres d'avancement et des
 * couleurs ; un bloc de texte ordinaire les aurait rendues en lignes brisées.
 *
 * Il rejoue d'abord la sortie déjà accumulée (un écran rechargé retrouve le
 * travail en cours), puis écrit chaque morceau à son arrivée. Un autre travail
 * qui commence efface l'écran.
 *
 * CE MORCEAU NE SE TÉLÉCHARGE QUE LÀ OÙ UN TRAVAIL S'AFFICHE : l'afficheur pèse
 * plus que plusieurs écrans de l'application (`travail.tsx` le charge à la demande).
 */

function couleursDuTheme(): Record<string, string> {
  const lire = (jeton: string, repli: string) => {
    const valeur = getComputedStyle(document.documentElement).getPropertyValue(jeton).trim();
    return valeur ? `hsl(${valeur})` : repli;
  };
  return {
    background: lire('--surface', '#111111'),
    foreground: lire('--text', '#eeeeee'),
    cursor: lire('--surface', '#111111'),
    selectionBackground: lire('--raised', '#333333'),
  };
}

export default function AfficheurDeSortie() {
  const [hote, setHote] = React.useState<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!hote) return;
    const terminal = new Terminal({
      // Les installateurs écrivent des fins de ligne nues : sans cela, chaque
      // ligne repartirait de la colonne où la précédente s'est arrêtée.
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: 8000,
      theme: couleursDuTheme(),
    });
    const ajustement = new FitAddon();
    terminal.loadAddon(ajustement);
    terminal.open(hote);
    const ajuster = () => {
      try {
        ajustement.fit();
      } catch {
        /* la boîte n'a pas encore de taille : le prochain passage ajustera */
      }
    };
    ajuster();

    let suivi = installationEnDirect.travail();
    if (suivi?.sortie) terminal.write(suivi.sortie);
    const seDesabonnerDeLaSortie = installationEnDirect.suivreLaSortie((donnees) => terminal.write(donnees));
    // Un AUTRE travail qui commence : l'écran repart vide.
    const seDesabonnerDeLEtat = installationEnDirect.sAbonner(() => {
      const courant = installationEnDirect.travail();
      if (courant && suivi && (courant.genre !== suivi.genre || courant.debut !== suivi.debut)) {
        terminal.reset();
        if (courant.sortie) terminal.write(courant.sortie);
      }
      suivi = courant;
    });

    const observateur = new ResizeObserver(ajuster);
    observateur.observe(hote);
    return () => {
      observateur.disconnect();
      seDesabonnerDeLaSortie();
      seDesabonnerDeLEtat();
      terminal.dispose();
    };
  }, [hote]);

  return <div ref={setHote} data-afficheur-de-sortie className="h-full min-h-0 w-full overflow-hidden" />;
}
