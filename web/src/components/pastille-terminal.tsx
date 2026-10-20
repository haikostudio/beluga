import * as React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, TerminalSquare } from 'lucide-react';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** L'écart entre la pastille et le bord de l'écran (ou ce qu'elle évite). */
const ECART = 12;
/** Sa hauteur (`h-9`) : de quoi la centrer sur le robot de l'assistant. */
const HAUTEUR_DE_LA_PASTILLE = 36;

/** Où poser la pastille : distances au bas et à la droite de l'écran. */
interface Place {
  bas: number;
  droite: number;
}

/**
 * LA PASTILLE NE SE POSE SUR RIEN.
 *  - SUR TÉLÉPHONE, le bas de l'écran appartient au menu du bas
 *    (`nav[data-menu-bas]`, de hauteur variable selon la page) : elle se pose
 *    au-dessus de lui.
 *  - SUR ORDINATEUR, le coin appartient au robot de l'assistant
 *    (`[data-assistant-robot]`, qu'on peut faire glisser) : quand il est dans le
 *    coin, elle se range à sa gauche, centrée sur lui.
 * Relu au redimensionnement, quand le robot bouge, et toutes les deux secondes
 * tant qu'elle est là — une mesure de deux boîtes, jamais par octet ni par rendu.
 */
function usePlaceDeLaPastille(): Place {
  const [place, setPlace] = React.useState<Place>({ bas: ECART, droite: ECART });
  React.useEffect(() => {
    let robotSuivi: Element | null = null;
    const suiviDuRobot = new MutationObserver(() => mesurer());
    const mesurer = () => {
      let bas = ECART;
      let droite = ECART;
      const menu = window.matchMedia('(max-width: 639px)').matches ? document.querySelector('nav[data-menu-bas]') : null;
      const boiteMenu = menu?.getBoundingClientRect();
      if (boiteMenu && boiteMenu.height > 0) bas = Math.max(0, Math.round(window.innerHeight - boiteMenu.top)) + ECART;
      const robot = document.querySelector('[data-assistant-robot]');
      if (robot !== robotSuivi) {
        suiviDuRobot.disconnect();
        if (robot) suiviDuRobot.observe(robot, { attributes: true, attributeFilter: ['style'] });
        robotSuivi = robot;
      }
      const r = robot?.getBoundingClientRect();
      // Le robot occupe le coin : la pastille passe à sa gauche, à sa hauteur.
      if (r && r.width > 0 && window.innerWidth - r.right < 160 && window.innerHeight - r.bottom < 120) {
        droite = Math.round(window.innerWidth - r.left) + ECART;
        bas = Math.max(bas, Math.round(window.innerHeight - r.bottom + (r.height - HAUTEUR_DE_LA_PASTILLE) / 2));
      }
      setPlace((avant) => (avant.bas === bas && avant.droite === droite ? avant : { bas, droite }));
    };
    mesurer();
    const minuteur = window.setInterval(mesurer, 2000);
    window.addEventListener('resize', mesurer);
    return () => {
      window.clearInterval(minuteur);
      suiviDuRobot.disconnect();
      window.removeEventListener('resize', mesurer);
    };
  }, []);
  return place;
}

/**
 * LA PASTILLE DU TERMINAL RÉDUIT : en bas à droite, sur toutes les pages, au-dessus
 * de l'application (le volet, lui, est dessous). Elle tourne — en violet, la
 * couleur du travail — tant que la session reçoit de la sortie ; un clic rouvre
 * le terminal tel qu'il était.
 */
export function PastilleDuTerminal({ actif, onOuvrir }: { actif: boolean; onOuvrir: () => void }) {
  const place = usePlaceDeLaPastille();
  return createPortal(
    <button
      type="button"
      data-terminal-pastille
      data-terminal-actif={actif ? 'oui' : 'non'}
      title={actif ? t('Le terminal travaille — cliquer pour le rouvrir') : t('Rouvrir le terminal')}
      aria-label="Rouvrir le terminal"
      onClick={onOuvrir}
      style={{ bottom: `max(${place.bas}px, calc(var(--zone-sure-bas, 0px) + ${ECART}px))`, right: place.droite }}
      className={cn(
        'terminal-noir fixed z-30 flex h-9 items-center gap-2 rounded-full bg-bg px-3.5 text-[13px] font-medium text-text shadow-lg',
        'transition-transform hover:scale-[1.03] active:scale-[0.98]',
      )}
    >
      {actif ? (
        <Loader2 data-terminal-pastille-travail className="h-3.5 w-3.5 animate-spin text-teinte" />
      ) : (
        <TerminalSquare className="h-3.5 w-3.5 text-faint" />
      )}
      <span>{t('Terminal')}</span>
    </button>,
    document.body,
  );
}
