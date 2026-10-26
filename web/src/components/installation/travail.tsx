import * as React from 'react';
import { Check, ChevronDown, ChevronUp, Download, Loader2, TerminalSquare, TriangleAlert } from 'lucide-react';
import type { TravailDInstallation } from '@beluga/shared';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { useTravailDInstallation } from '@/lib/travail-installation';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * CE QUE L'ÉCRAN FAIT INSTALLER — le bouton, et le terminal qui montre.
 *
 * Qui installe Beluga Build ne colle plus de commande dans un terminal : il
 * clique « Installer », le démon lance l'installation sous son propre compte
 * (`server/src/installation-travaux.ts`) et la sortie s'affiche ici, en direct.
 * L'écran ne nomme qu'un GENRE ; la commande est écrite dans le démon.
 *
 * DEUX PLACES POUR LE TERMINAL :
 *  - dans l'assistant de démarrage, une BARRE collée en bas de l'écran
 *    (`BarreDuTerminal`), repliée au repos : elle s'ouvre toute seule quand une
 *    installation travaille et se referme quand elle a réussi — un volet de
 *    droite toujours ouvert prenait la moitié de l'écran pour ne rien montrer ;
 *  - partout ailleurs (réglages, écran des moteurs), il se déplie SOUS le
 *    bouton qui a lancé le travail (`SortieDuTravail`).
 * `TerminalACote` dit aux boutons lequel des deux est en place.
 */

const AfficheurDeSortie = React.lazy(() => import('@/components/installation/afficheur-de-sortie'));

/** Vrai quand la barre du terminal de l'assistant montre déjà la sortie : le bouton ne déplie alors rien sous lui. */
export const TerminalACote = React.createContext(false);

/** Lance un travail d'installation ; rend le refus à afficher, ou `null` quand il est parti. */
async function lancer(commande: Parameters<typeof client.call>[0]): Promise<string | null> {
  try {
    const rendu = await client.call<{ ok: boolean; erreur?: string }>(commande, 30_000);
    return rendu.ok ? null : (rendu.erreur ?? t('L’installation n’a pas pu démarrer.'));
  } catch (err: any) {
    return err?.message ?? t('L’installation n’a pas pu démarrer.');
  }
}

/** Où en est le travail de CE genre, s'il est celui que le démon suit. */
export function useTravailDuGenre(genre: string): { travail: TravailDInstallation | null; occupe: boolean } {
  const courant = useTravailDInstallation();
  return {
    travail: courant?.genre === genre ? courant : null,
    // Un seul travail à la fois : pendant qu'un autre tourne, ce bouton attend.
    occupe: courant?.etat === 'en-cours' && courant.genre !== genre,
  };
}

/**
 * LE BOUTON « INSTALLER ». Il dit son départ dès le clic, tourne tant que le
 * travail dure, et laisse la place à l'issue : rien quand c'est réussi (la ligne
 * d'état de l'appelant passe au vert), le refus en clair quand c'est raté.
 */
export function BoutonInstaller({
  genre,
  libelle,
  commande,
  apres,
  className,
}: {
  genre: string;
  libelle?: string;
  /** La commande exacte à envoyer, quand ce n'est pas `installation.installer` (la copie, par exemple). */
  commande?: Parameters<typeof client.call>[0];
  /** Appelé une fois le travail terminé, réussi ou non : l'appelant relit ce qui a changé. */
  apres?: () => void | Promise<void>;
  className?: string;
}) {
  const { travail, occupe } = useTravailDuGenre(genre);
  const [depart, setDepart] = React.useState(false);
  const [refus, setRefus] = React.useState<string | null>(null);
  const enCours = depart || travail?.etat === 'en-cours';

  // La fin du travail se lit dans son état, pas dans la réponse du clic : la
  // commande rend la main dès le lancement.
  const finVue = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (!travail || travail.etat === 'en-cours' || finVue.current === travail.debut) return;
    finVue.current = travail.debut;
    void apres?.();
  }, [travail, apres]);

  const cliquer = async () => {
    setDepart(true);
    setRefus(null);
    const probleme = await lancer(commande ?? { type: 'installation.installer', genre });
    setRefus(probleme);
    setDepart(false);
  };

  return (
    <div className={cn('space-y-2', className)} data-travail={genre} data-etat-du-travail={travail?.etat ?? 'aucun'}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="subtle" size="md" data-installer={genre} disabled={enCours || occupe} onClick={() => void cliquer()}>
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {enCours ? t('Installation en cours…') : (libelle ?? t('Installer'))}
        </Button>
        {occupe ? <span className="text-[13px] text-faint">{t('Une autre installation est en cours.')}</span> : null}
        {travail?.etat === 'reussi' ? (
          <span className="flex items-center gap-1 text-[13px] text-success">
            <Check className="h-3 w-3" />
            {t('Terminé.')}
          </span>
        ) : null}
      </div>
      {refus || travail?.etat === 'echoue' ? (
        <p data-refus-installation className="flex items-start gap-1.5 text-[13px] leading-relaxed text-danger">
          <TriangleAlert className="mt-[3px] h-3 w-3 shrink-0" />
          <span className="min-w-0">{refus ?? travail?.erreur ?? t('L’installation a échoué.')}</span>
        </p>
      ) : null}
      {travail ? <SortieDuTravail /> : null}
    </div>
  );
}

/**
 * Le terminal déplié sous le bouton : une boîte de hauteur fixe, qui ne pousse
 * pas la page à chaque ligne. Il ne se pose pas quand la barre de l'assistant
 * montre déjà la même sortie.
 */
export function SortieDuTravail() {
  const aCote = React.useContext(TerminalACote);
  if (aCote) return null;
  return (
    <div data-terminal-d-installation="dessous" className="h-56 overflow-hidden rounded-lg bg-surface p-2">
      <React.Suspense fallback={null}>
        <AfficheurDeSortie />
      </React.Suspense>
    </div>
  );
}

/** Le temps pendant lequel une installation réussie reste sous les yeux avant que la barre se replie. */
const REPLI_APRES_REUSSITE_MS = 2500;

/**
 * LA BARRE DU TERMINAL DE L'ASSISTANT, collée TOUT en bas de l'écran, sous les boutons.
 *
 * Repliée, elle tient sur une ligne : ce qui tourne, ou la dernière issue. Elle
 * S'OUVRE TOUTE SEULE au départ d'une installation, se REPLIE quelques
 * secondes après une réussite, et RESTE OUVERTE sur un échec, pour qu'on lise
 * pourquoi. Un clic sur la ligne l'ouvre ou la replie à la main. Tant que rien
 * n'a jamais été lancé, elle ne se montre pas.
 */
export function BarreDuTerminal({ className }: { className?: string }) {
  const travail = useTravailDInstallation();
  const etat = travail?.etat;
  const [ouverte, setOuverte] = React.useState(etat === 'en-cours' || etat === 'echoue');

  React.useEffect(() => {
    if (etat === 'en-cours' || etat === 'echoue') {
      setOuverte(true);
      return;
    }
    if (etat !== 'reussi') return;
    const repli = window.setTimeout(() => setOuverte(false), REPLI_APRES_REUSSITE_MS);
    return () => window.clearTimeout(repli);
  }, [etat, travail?.debut]);

  if (!travail) return null;
  return (
    <section
      data-terminal-d-installation="en-bas"
      data-ouvert={ouverte ? 'oui' : 'non'}
      /* UN TERMINAL À L'ARRIÈRE-PLAN : collé au bas de l'écran, sur toute la
         largeur, sous une OMBRE PORTÉE vers le haut — l'interface semble posée
         par-dessus, et remonte quand il s'ouvre (demande du 18/10/2026). */
      className={cn(
        'flex shrink-0 flex-col bg-surface shadow-[inset_0_10px_14px_-8px_hsl(var(--voile)/0.45)]',
        className,
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <button
        type="button"
        data-basculer-terminal
        aria-expanded={ouverte}
        onClick={() => setOuverte((avant) => !avant)}
        className="flex h-12 sm:h-10 w-full shrink-0 items-center gap-2 px-3 pt-1 text-left text-[13px] text-muted transition-colors hover:text-text sm:px-5"
      >
        <TerminalSquare className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t('Ce qui se passe sur le serveur')}</span>
        {etat === 'en-cours' ? (
          <span className="flex items-center gap-1.5 text-teinte" data-travail-en-cours>
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('en cours')}
          </span>
        ) : etat === 'reussi' ? (
          <span className="flex items-center gap-1 text-success">
            <Check className="h-3 w-3" />
            {t('Terminé.')}
          </span>
        ) : etat === 'echoue' ? (
          <span className="flex items-center gap-1 text-danger">
            <TriangleAlert className="h-3 w-3" />
            {t('L’installation a échoué.')}
          </span>
        ) : null}
        {ouverte ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronUp className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {ouverte ? (
        <div className="h-[min(320px,38vh)] min-h-0 px-2 pb-2">
          <React.Suspense fallback={null}>
            <AfficheurDeSortie />
          </React.Suspense>
        </div>
      ) : null}
    </section>
  );
}
