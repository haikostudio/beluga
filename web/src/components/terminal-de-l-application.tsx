import * as React from 'react';
import { PanneauALaDemande } from '@/lib/panneau-a-la-demande';
import { EVENEMENT_OUVRIR_TERMINAL } from '@/lib/ouvrir-terminal';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import { PastilleDuTerminal } from '@/components/pastille-terminal';

/** L'afficheur de terminal est lourd : il part dans son propre morceau. */
const TerminalServeur = React.lazy(() =>
  import('@/components/terminal-serveur').then((m) => ({ default: m.TerminalServeur })),
);

/** Fermé, ouvert, ou réduit en pastille : dans ce dernier cas il reste attaché. */
type EtatDuTerminal = 'ferme' | 'ouvert' | 'reduit';

/** Le terminal réduit se retrouve après un rechargement : sa pastille revient et se rattache. */
const CLE_TERMINAL_REDUIT = 'beluga-terminal-reduit';

function etatInitial(): EtatDuTerminal {
  try {
    return window.localStorage.getItem(CLE_TERMINAL_REDUIT) === '1' ? 'reduit' : 'ferme';
  } catch {
    return 'ferme';
  }
}

/**
 * LE TERMINAL DU SERVEUR, PORTÉ PAR LA RACINE. Ses entrées : le bouton du
 * tableau de bord (en haut à droite) et la page « Serveur et agents » des
 * réglages. Lui est un VOLET ancré en bas de l'application, et il garde son
 * mot dans l'adresse (« terminal ») : un lien collé ou un rechargement le
 * rouvre, que les réglages soient ouverts ou non.
 *
 * RÉDUIT (décision de l'utilisateur du 20/10/2026), il laisse une PASTILLE en
 * bas à droite, sur toutes les pages, qui tourne tant que quelque chose
 * travaille dedans. L'afficheur reste monté et attaché : rouvrir — par la
 * pastille ou par les entrées habituelles — le montre tel qu'il était,
 * historique compris. Seule la croix le retire ; la session tmux, elle,
 * continue dans tous les cas.
 *
 * `onOuverture` laisse la racine refermer ce qui le couvrirait — la fenêtre
 * des réglages, d'où part la demande.
 */
export function TerminalDeLApplication({ onOuverture }: { onOuverture: () => void }) {
  const [etat, setEtat] = React.useState<EtatDuTerminal>(etatInitial);
  const [actif, setActif] = React.useState(false);
  const ouvert = etat === 'ouvert';
  /* L'adresse ne suit que le volet ouvert. Un retour arrière qui la retire
     referme ; un terminal réduit, lui, n'est déjà plus dans l'adresse. */
  const suivreLAdresse = React.useCallback(
    (voulu: boolean) => setEtat((precedent) => (voulu ? 'ouvert' : precedent === 'ouvert' ? 'ferme' : precedent)),
    [],
  );
  useTiroirAdresse('terminal', ouvert, suivreLAdresse);

  React.useEffect(() => {
    try {
      if (etat === 'reduit') window.localStorage.setItem(CLE_TERMINAL_REDUIT, '1');
      else window.localStorage.removeItem(CLE_TERMINAL_REDUIT);
    } catch {
      /* stockage indisponible : la pastille ne survivra pas au rechargement */
    }
    if (etat !== 'reduit') setActif(false);
  }, [etat]);

  React.useEffect(() => {
    const ouvrir = () => {
      onOuverture();
      setEtat('ouvert');
    };
    window.addEventListener(EVENEMENT_OUVRIR_TERMINAL, ouvrir);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_TERMINAL, ouvrir);
  }, [onOuverture]);

  return (
    <>
      {/* L'afficheur de terminal ne se télécharge qu'au premier clic. */}
      <PanneauALaDemande monte={etat !== 'ferme'}>
        <TerminalServeur
          open={etat !== 'ferme'}
          reduit={etat === 'reduit'}
          onClose={() => setEtat('ferme')}
          onReduire={() => setEtat('reduit')}
          onActivite={setActif}
        />
      </PanneauALaDemande>
      {etat === 'reduit' ? (
        <PastilleDuTerminal
          actif={actif}
          onOuvrir={() => {
            onOuverture();
            setEtat('ouvert');
          }}
        />
      ) : null}
    </>
  );
}
