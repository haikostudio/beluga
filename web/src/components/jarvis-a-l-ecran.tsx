import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui';
import { RondDEtape } from '@/components/rond-d-etape';
import { client } from '@/lib/client';
import type { ActionDuDirect } from '@/lib/direct-codex';
import { abonnerAuCurseur, dureeDuTrajet, lireLeCurseur } from '@/lib/gestes-de-jarvis';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { nomDeLAssistant } from '@beluga/shared';

/*
 * JARVIS À L'ÉCRAN (carte « Relier Beluga Pass dans les réglages », 16/11/2026 — maquette #ab43) : son CURSEUR, qui
 * se pose par-dessus tout sans jamais rien bloquer (aucun appui ne le traverse vers lui), et l'ENCADRÉ « Jarvis agit
 * sur l'écran » du fil du module de voix, où chaque geste se coche en direct. Le moteur des gestes vit dans
 * `lib/gestes-de-jarvis.ts`, le plan et sa garde côté démon dans `server/src/gestes-de-jarvis.ts`.
 */

/**
 * LE CURSEUR DE JARVIS (maquette #786b validée, 17/11/2026) : une flèche BLEUE — le bleu de sa voix (`--voix-jarvis`),
 * exception assumée à la règle monochrome, réservée à Jarvis — et sa pastille « Jarvis · <ce qu'il fait> » (au doigt,
 * un rond bleu). Il n'existe que pendant une action ; celui de l'utilisateur reste intact. AUCUN CADRE pendant la
 * visée : à chaque clic, un cercle bleu s'ouvre sous la pointe et l'élément touché s'ALLUME un instant en bleu pâle
 * (l'éclair), puis plus rien.
 */
export function CurseurDeJarvis() {
  const etat = React.useSyncExternalStore(abonnerAuCurseur, lireLeCurseur, lireLeCurseur);
  const state = useApp();
  const cercleRef = React.useRef<HTMLSpanElement | null>(null);
  const eclairRef = React.useRef<HTMLDivElement | null>(null);
  const auDoigt = React.useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches, []);
  const duree = dureeDuTrajet();
  const nom = nomDeLAssistant(state.settings);

  React.useEffect(() => {
    if (!etat.clics) return;
    if (cercleRef.current && duree) {
      cercleRef.current.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0.7 },
          { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 },
        ],
        { duration: 520, easing: 'ease-out' },
      );
    }
    // L'ÉCLAIR : posé sur la boîte de la cible AU MOMENT DU CLIC (elle ne suit pas un défilement ultérieur), puis éteint.
    const eclair = eclairRef.current;
    const boite = lireLeCurseur().contour;
    if (!eclair || !boite) return;
    eclair.style.transform = `translate(${boite.x}px, ${boite.y}px)`;
    eclair.style.width = `${boite.l}px`;
    eclair.style.height = `${boite.h}px`;
    eclair.dataset.allume = '';
    const animation = eclair.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: duree ? 420 : 200, easing: 'ease-out' });
    animation.onfinish = () => delete eclair.dataset.allume;
    return () => animation.cancel();
  }, [etat.clics, duree]);

  if (typeof document === 'undefined' || !etat.visible) return null;
  const transition = duree ? `transform ${duree}ms cubic-bezier(.2,.7,.2,1)` : 'none';
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[2147483000]" data-curseur-jarvis-calque>
      <div
        ref={eclairRef}
        data-eclair-jarvis
        className="absolute left-0 top-0 rounded-lg opacity-0"
        style={{ background: 'hsl(var(--voix-jarvis) / 0.14)' }}
      />
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${etat.x}px, ${etat.y}px)`, transition, color: 'hsl(var(--voix-jarvis))' }}
        data-curseur-jarvis
        data-x={etat.x}
        data-y={etat.y}
      >
        <span ref={cercleRef} className="absolute left-0 top-0 h-7 w-7 rounded-full border-2 border-current opacity-0" style={{ transform: 'translate(-50%, -50%)' }} />
        {auDoigt ? (
          <span className="absolute left-0 top-0 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg" style={{ background: 'hsl(var(--voix-jarvis) / 0.45)' }} />
        ) : (
          <svg width="22" height="24" viewBox="0 0 22 24" className="absolute -left-[3px] -top-[3px] drop-shadow-sm">
            <path d="M2 2 L2 20 L7 15.5 L10.5 22.5 L13.5 21 L10 14 L17 14 Z" fill="currentColor" stroke="hsl(var(--bg))" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        )}
        <span
          data-pastille-jarvis
          className="absolute left-4 top-4 flex max-w-[min(60vw,320px)] items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
          style={{ background: 'hsl(var(--voix-jarvis))' }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
          <span className="truncate">{etat.libelle ? `${nom} · ${etat.libelle}` : nom}</span>
        </span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * L'ENCADRÉ « JARVIS AGIT SUR L'ÉCRAN » : un rond par geste (plein et coché, en cours, à venir), JAMAIS de texte barré.
 * Arrêtée par l'utilisateur, l'action dit où elle s'est arrêtée et pose deux boutons DANS LE FIL : « Reprendre » relance
 * la suite là où elle s'est arrêtée, « Annuler » l'abandonne (décision du 16/11/2026).
 */
export function EncadreDAction({ action }: { action: ActionDuDirect }) {
  const [envoi, setEnvoi] = React.useState<'reprendre' | 'annuler' | null>(null);
  const enPause = action.statut === 'arretee' || action.statut === 'echouee';
  const agir = (quoi: 'reprendre' | 'annuler') => {
    setEnvoi(quoi);
    void client
      .call({ type: quoi === 'reprendre' ? 'jarvis.action.reprendre' : 'jarvis.action.annuler', id: action.id })
      .catch(() => undefined)
      .finally(() => setEnvoi(null));
  };
  return (
    <span className="flex flex-col gap-1.5 rounded-lg bg-surface px-2.5 py-2" data-action-jarvis={action.statut} data-action-id={action.id}>
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-faint">{t('Jarvis agit sur l’écran')}</span>
      {action.gestes.map((g, i) => (
        <span key={i} className="flex flex-col" data-geste-jarvis={i} data-etat={g.etat}>
          <span className="flex items-center gap-2">
            <RondDEtape etat={g.etat} className="h-4 w-4" />
            <span className={`min-w-0 text-[12px] ${g.etat === 'todo' ? 'text-faint' : 'text-text'}`}>{g.libelle}</span>
          </span>
          {g.etat === 'stopped' ? <span className="pl-6 text-[11.5px] text-muted">{t('Arrêté à votre demande')}</span> : null}
          {g.etat === 'failed' && action.erreur ? <span className="pl-6 text-[11.5px] text-danger">{action.erreur}</span> : null}
        </span>
      ))}
      {action.statut === 'annulee' ? <span className="text-[11.5px] text-muted">{t('Action annulée.')}</span> : null}
      {enPause ? (
        <span className="mt-1 flex gap-2">
          <Button
            variant="creation"
            size="sm"
            disabled={envoi !== null}
            onClick={(e) => {
              e.stopPropagation();
              agir('reprendre');
            }}
            data-reprendre-action
          >
            {t('Reprendre')}
          </Button>
          <Button
            variant="subtle"
            size="sm"
            disabled={envoi !== null}
            onClick={(e) => {
              e.stopPropagation();
              agir('annuler');
            }}
            data-annuler-action
          >
            {t('Annuler')}
          </Button>
        </span>
      ) : null}
    </span>
  );
}
