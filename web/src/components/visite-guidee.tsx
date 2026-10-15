import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  CLE_DE_LA_VISITE,
  ETAPES_DE_LA_VISITE,
  VISITE_A_FAIRE,
  assistantDeDemarrageOuvert,
  etapeAMontrer,
  etatDeLaVisite,
  visiteADemarrer,
  type EtatDeLaVisite,
  type IdDEtapeDeVisite,
} from '@beluga/shared';
import { Button } from '@/components/ui';
import { usePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';

/*
 * LA VISITE GUIDÉE — une bulle qui montre où cliquer, et rien de plus.
 *
 * Elle ne clique jamais et ne remplit jamais rien : c'est la personne qui fait
 * chaque geste. Pas de voile sur l'écran — un simple anneau autour du bouton
 * visé, qui laisse passer les clics. Une étape dont le bouton n'est pas affiché
 * est sautée ; une fenêtre ouverte (l'ajout d'un projet…) la fait s'effacer le
 * temps qu'on la remplisse. Une croix la ferme à tout moment, pour de bon ;
 * elle se relance depuis Réglages, page « Installation » (`relancerLaVisite`).
 * Règles pures : `shared/src/visite-guidee.ts`.
 */

const EVENEMENT_RELANCE = 'beluga:visite-guidee';

/** Relance la visite depuis la première étape. */
export function relancerLaVisite(): void {
  window.dispatchEvent(new Event(EVENEMENT_RELANCE));
}

function texteDeLEtape(id: IdDEtapeDeVisite): { titre: string; texte: string } {
  switch (id) {
    case 'projet':
      return {
        titre: t('Votre premier projet'),
        texte: t('Cliquez sur ce « + » pour ajouter un projet : un dépôt GitHub existant, ou un nouveau. C’est vous qui remplissez la fenêtre.'),
      };
    case 'agent':
      return {
        titre: t('Confier une demande'),
        texte: t('« Nouvel agent » ouvre une conversation : décrivez ce que vous voulez, l’agent en fait une carte.'),
      };
    case 'tableau':
      return {
        titre: t('Suivre le travail'),
        texte: t('Chaque carte avance ici, de « Planifié » à « En cours », puis « À déployer ».'),
      };
    case 'publier':
      return {
        titre: t('Publier'),
        texte: t('Les cartes terminées attendent ici. Rien ne part en ligne sans vous : vous publiez quand vous le décidez.'),
      };
    case 'services':
      return {
        titre: t('Les services'),
        texte: t('Messagerie avec vos clients, sauvegardes, statistiques, coffre-fort… : chacun vous guide la première fois.'),
      };
  }
}

/** Le repère est-il réellement à l'écran (présent, avec une taille) ? */
function rectangleDe(selecteur: string): DOMRect | null {
  const element = document.querySelector(selecteur);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Une fenêtre, ou un écran plein (mise en route, « Mettons un moteur en place »), est-il ouvert par-dessus ? La bulle s'efface alors. */
function fenetreOuverte(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [data-assistant-demarrage], [data-assistant-moteurs]'));
}

const LARGEUR_BULLE = 300;
const MARGE = 12;

export function VisiteGuidee() {
  const state = useApp();
  const telephone = useTelephone();
  const [brut, retenir] = usePref<EtatDeLaVisite>(CLE_DE_LA_VISITE, VISITE_A_FAIRE);
  const visite = etatDeLaVisite(brut);
  const assistantOuvert = state.pret && assistantDeDemarrageOuvert(state.settings?.assistant);
  const nbProjets = state.projects.length;

  // Le départ seul : une installation sans projet, une fois la mise en route refermée.
  React.useEffect(() => {
    if (visiteADemarrer({ visite, pret: Boolean(state.pret), assistantOuvert: Boolean(assistantOuvert), projets: nbProjets })) {
      retenir({ statut: 'en-cours', rang: 0 });
    }
  }, [visite.statut, state.pret, assistantOuvert, nbProjets, retenir]);

  // La relance, depuis les réglages.
  React.useEffect(() => {
    const relancer = () => retenir({ statut: 'en-cours', rang: 0 });
    window.addEventListener(EVENEMENT_RELANCE, relancer);
    return () => window.removeEventListener(EVENEMENT_RELANCE, relancer);
  }, [retenir]);

  // Le geste fait : un projet existe, la première étape est passée d'elle-même.
  React.useEffect(() => {
    if (visite.statut === 'en-cours' && visite.rang === 0 && nbProjets > 0) retenir({ statut: 'en-cours', rang: 1 });
  }, [visite.statut, visite.rang, nbProjets, retenir]);

  // Où en est l'écran : l'étape montrable, la place de son repère, une fenêtre ouverte.
  const [vue, setVue] = React.useState<{ rang: number | null; rect: DOMRect | null; cachee: boolean }>({ rang: null, rect: null, cachee: true });
  const enCours = visite.statut === 'en-cours';
  React.useEffect(() => {
    if (!enCours) return;
    const lire = () => {
      const rang = etapeAMontrer(visite.rang, (selecteur) => rectangleDe(selecteur) !== null);
      setVue({ rang, rect: rang === null ? null : rectangleDe(ETAPES_DE_LA_VISITE[rang].selecteur), cachee: fenetreOuverte() });
    };
    lire();
    const minuterie = window.setInterval(lire, 400);
    window.addEventListener('resize', lire);
    return () => {
      window.clearInterval(minuterie);
      window.removeEventListener('resize', lire);
    };
  }, [enCours, visite.rang]);

  if (!enCours || vue.cachee || vue.rang === null || !vue.rect || typeof document === 'undefined') return null;

  const rang = vue.rang;
  const etape = ETAPES_DE_LA_VISITE[rang];
  const { titre, texte } = texteDeLEtape(etape.id);
  const derniere = etapeAMontrer(rang + 1, (selecteur) => rectangleDe(selecteur) !== null) === null;
  const fermer = () => retenir({ statut: 'fermee', rang });
  const suivant = () => retenir(derniere ? { statut: 'terminee', rang } : { statut: 'en-cours', rang: rang + 1 });

  /*
   * La bulle sous le repère s'il reste de la place, sinon au-dessus ; un repère
   * qui prend presque tout l'écran (le tableau) la reçoit DANS son coin haut.
   * Jamais hors de l'écran.
   */
  const rect = vue.rect;
  const HAUTEUR_BULLE = 180;
  const largeur = Math.min(LARGEUR_BULLE, window.innerWidth - 2 * MARGE);
  const gauche = Math.min(Math.max(MARGE, rect.left + rect.width / 2 - largeur / 2), window.innerWidth - largeur - MARGE);
  const dessous = rect.bottom + 10 + HAUTEUR_BULLE < window.innerHeight;
  const dessus = rect.top - 10 - HAUTEUR_BULLE > 0;
  const place: React.CSSProperties = telephone
    ? { left: MARGE, right: MARGE, bottom: `max(${MARGE}px, env(safe-area-inset-bottom))` }
    : dessous
      ? { left: gauche, top: rect.bottom + 10, width: largeur }
      : dessus
        ? { left: gauche, bottom: window.innerHeight - rect.top + 10, width: largeur }
        : { left: gauche, top: Math.max(MARGE, rect.top + 16), width: largeur };

  return createPortal(
    <>
      {/* L'anneau autour du bouton visé : il ne retient aucun clic. */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[44] rounded-lg ring-2 ring-text/60 transition-all"
        style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div
        role="complementary"
        aria-label={titre}
        data-visite-guidee
        data-etape-visite={etape.id}
        className="fixed z-[44] rounded-xl bg-raised p-3.5 shadow-2xl"
        style={place}
      >
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[14px] font-medium text-text">{titre}</p>
          <Button variant="ghost" size="icon-sm" onClick={fermer} title={t('Fermer la visite')} data-fermer-visite>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{texte}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[12px] text-faint">
            {t('Étape {n} sur {total}', { n: String(rang + 1), total: String(ETAPES_DE_LA_VISITE.length) })}
          </span>
          <Button variant="ghost" size="sm" onClick={fermer} data-passer-visite>
            {t('Passer')}
          </Button>
          {etape.id === 'projet' ? null : (
            <Button size="sm" onClick={suivant} data-suivant-visite>
              {derniere ? t('Terminer') : t('Suivant')}
            </Button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
