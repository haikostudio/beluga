import * as React from 'react';
import { PanneauALaDemande } from '@/lib/panneau-a-la-demande';
import { EVENEMENT_OUVRIR_TERMINAL, publierEtatDuTerminal, type EtatDuTerminal } from '@/lib/ouvrir-terminal';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import { useTelephone } from '@/lib/telephone';
import { RondDuTerminal } from '@/components/pastille-terminal';

/** L'afficheur de terminal est lourd : il part dans son propre morceau. */
const TerminalServeur = React.lazy(() =>
  import('@/components/terminal-serveur').then((m) => ({ default: m.TerminalServeur })),
);

/** Le terminal réduit se retrouve après un rechargement : il se rattache, et son rond tourne s'il travaille. */
const CLE_TERMINAL_REDUIT = 'beluga-terminal-reduit';

function etatInitial(): EtatDuTerminal {
  try {
    return window.localStorage.getItem(CLE_TERMINAL_REDUIT) === '1' ? 'reduit' : 'ferme';
  } catch {
    return 'ferme';
  }
}

/**
 * LE TERMINAL DU SERVEUR, PORTÉ PAR LA RACINE. Ses entrées : sur ordinateur,
 * le ROND posé à gauche du robot de l'assistant, toujours affiché ; sur
 * téléphone, un bouton du pied du menu principal ; partout, la page « Serveur »
 * des réglages. Lui est un VOLET ancré en bas de l'application, et il garde son
 * mot dans l'adresse (« terminal ») : un lien collé ou un rechargement le
 * rouvre, que les réglages soient ouverts ou non.
 *
 * RÉDUIT (décision de l'utilisateur du 20/10/2026), l'afficheur reste monté et
 * attaché, et le rond (ou le bouton du pied) TOURNE tant que quelque chose
 * travaille dedans. Rouvrir le montre tel qu'il était, historique compris.
 * Seule la croix le retire ; la session tmux, elle, continue dans tous les cas.
 *
 * `onOuverture` laisse la racine refermer ce qui le couvrirait — la fenêtre
 * des réglages, d'où part la demande.
 */
export function TerminalDeLApplication({
  onOuverture,
  admin,
}: {
  onOuverture: () => void;
  /** Le terminal est un accès à la machine : son rond n'est posé que pour l'administrateur. */
  admin: boolean;
}) {
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
      /* stockage indisponible : la réduction ne survivra pas au rechargement */
    }
    if (etat !== 'reduit') setActif(false);
  }, [etat]);

  // Le bouton du pied du menu (téléphone) lit l'état hors de la racine.
  React.useEffect(() => publierEtatDuTerminal({ etat, actif }), [etat, actif]);
  const telephone = useTelephone();

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
      {!telephone && admin ? (
        <RondDuTerminal
          etat={etat}
          actif={actif}
          onBasculer={() => {
            if (etat === 'ouvert') {
              setEtat('reduit');
              return;
            }
            onOuverture();
            setEtat('ouvert');
          }}
        />
      ) : null}
    </>
  );
}
