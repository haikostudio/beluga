import * as React from 'react';
import { PanneauALaDemande } from '@/lib/panneau-a-la-demande';
import { EVENEMENT_OUVRIR_TERMINAL } from '@/lib/ouvrir-terminal';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';

/** L'afficheur de terminal est lourd : il part dans son propre morceau. */
const TerminalServeur = React.lazy(() =>
  import('@/components/terminal-serveur').then((m) => ({ default: m.TerminalServeur })),
);

/**
 * LE TERMINAL DU SERVEUR, PORTÉ PAR LA RACINE. Ses entrées : le bouton du
 * tableau de bord (en haut à droite) et la page « Serveur et agents » des
 * réglages. Lui est un VOLET ancré en bas de l'application, et il garde son
 * mot dans l'adresse (« terminal ») : un lien collé ou un rechargement le
 * rouvre, que les réglages soient ouverts ou non.
 *
 * `onOuverture` laisse la racine refermer ce qui le couvrirait — la fenêtre
 * des réglages, d'où part la demande.
 */
export function TerminalDeLApplication({ onOuverture }: { onOuverture: () => void }) {
  const [ouvert, setOuvert] = React.useState(false);
  useTiroirAdresse('terminal', ouvert, setOuvert);

  React.useEffect(() => {
    const ouvrir = () => {
      onOuverture();
      setOuvert(true);
    };
    window.addEventListener(EVENEMENT_OUVRIR_TERMINAL, ouvrir);
    return () => window.removeEventListener(EVENEMENT_OUVRIR_TERMINAL, ouvrir);
  }, [onOuverture]);

  return (
    /* L'afficheur de terminal ne se télécharge qu'au premier clic. */
    <PanneauALaDemande monte={ouvert}>
      <TerminalServeur open={ouvert} onClose={() => setOuvert(false)} />
    </PanneauALaDemande>
  );
}
