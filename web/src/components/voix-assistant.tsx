import * as React from 'react';
import { Volume2 } from 'lucide-react';
import {
  decisionsOuvertes,
  gesteDOuverture,
  phraseDecisionAttendue,
  phraseVocaleDeNotification,
  pileApres,
  type ContexteDecision,
} from '@haikodev/shared';
import { client } from '@/lib/client';
import { usePref } from '@/lib/prefs';
import { useSurvol } from '@/lib/pointeur';
import { useApp } from '@/lib/use-app';

/** La clé de préférence du bouton « Muet » (partagée avec la barre du haut). */
export const CLE_VOIX_MUETTE = 'voix.muet';

/** Combien de messages prononcés on garde sous la main pour les réécouter. */
export const VOIX_MESSAGES_MAX = 10;

type DonneesVoix = Pick<
  ReturnType<typeof useApp>,
  'projects' | 'cards' | 'decisions'
>;

/** Un message déjà prononcé, gardé en mémoire côté navigateur pour le rejouer. */
interface MessageDit {
  id: number;
  texte: string;
}

/**
 * De quoi parle la décision qui vient d'arriver sur `projectId` : le nom du
 * projet, et le titre de la tâche si la décision la plus récente y tient à une
 * carte. Sans projet repéré, on ne dit aucun nom (repli propre côté phrase).
 */
function contexteDecision(
  projectId: string | undefined,
  { projects, cards, decisions }: DonneesVoix,
): ContexteDecision | undefined {
  if (!projectId) return undefined;
  const projet = projects.find((p) => p.id === projectId)?.name;
  const duProjet = decisionsOuvertes(decisions).filter((d) => d.projectId === projectId);
  // La plus récemment posée : celle qui vient de faire monter le compte.
  const derniere = duProjet.reduce<(typeof duProjet)[number] | undefined>(
    (recente, d) => ((d.poseeA ?? 0) >= (recente?.poseeA ?? 0) ? d : recente),
    undefined,
  );
  const tache = derniere?.cardId ? cards[derniere.cardId]?.title : undefined;
  return { projet, tache };
}

/**
 * LA VOIX D'ASSISTANT PROACTIVE (PLAN §22, mémoire n°35, n°156).
 *
 * L'application parle d'elle-même aux moments qui comptent : une tâche qui se
 * termine (motif de notification « tache-terminee ») et une décision qui se met
 * à attendre (le compte d'« attention » qui monte). On réutilise Piper par une
 * adresse audio ordinaire (`/api/speak`) ; si le serveur n'a pas de voix, on
 * retombe sur celle du navigateur.
 *
 * Le module est TOUJOURS à l'écran, réduit en un petit icône rond au centre en
 * bas. Au repos, l'icône montre cinq barres figées en vibration sonore
 * symétrique. Au survol (souris) ou à l'appui (doigt) — même choix que la pile
 * des messages (`(hover: hover) and (pointer: fine)`) —, il se déplie et montre
 * les dix derniers messages prononcés, le plus récent en haut ; un clic les
 * rejoue. Pendant qu'il parle, le rond s'OUVRE tout seul en un bloc
 * rectangulaire et l'icône devient un flux d'ondes VERTES animées ; à la fin, le
 * flux se referme et l'icône de vibration revient.
 *
 * Le bouton « Muet » de la barre du haut coupe la parole AUTOMATIQUE (jamais les
 * notifications visuelles ni le badge, jamais l'icône, jamais la réécoute
 * manuelle) ; son état est retenu en préférence.
 */
export function VoixAssistant() {
  const state = useApp();
  const [muet] = usePref<boolean>(CLE_VOIX_MUETTE, false);
  const [parle, setParle] = React.useState(false);
  const [messages, setMessages] = React.useState<MessageDit[]>([]);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  // La valeur lue au fil de l'eau par les écouteurs, sans les réabonner.
  const muetRef = React.useRef(muet);
  // Un compteur stable pour distinguer deux messages au même texte.
  const compteurRef = React.useRef(0);

  const taire = React.useCallback(() => {
    try {
      audioRef.current?.pause();
    } catch {
      /* l'audio était déjà arrêté */
    }
    audioRef.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setParle(false);
  }, []);

  /**
   * Prononce une phrase. `force` fait passer la parole même en Muet : c'est la
   * réécoute manuelle, que le Muet ne bâillonne pas. Une parole chasse l'autre.
   */
  const dire = React.useCallback((texte: string, force = false) => {
    if ((muetRef.current && !force) || !texte) return;
    taire();
    const audio = new Audio(`/api/speak?text=${encodeURIComponent(texte)}`);
    audioRef.current = audio;
    setParle(true);

    const fin = () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setParle(false);
      }
    };
    audio.addEventListener('ended', fin);
    audio.addEventListener('error', () => {
      fin();
      // Repli : la voix du navigateur, si le serveur n'a pas de moteur Piper.
      if ((!muetRef.current || force) && 'speechSynthesis' in window) {
        const parole = new SpeechSynthesisUtterance(texte);
        parole.lang = 'fr-FR';
        window.speechSynthesis.speak(parole);
      }
    });
    void audio.play().catch(fin);
  }, [taire]);

  /**
   * Une ANNONCE automatique : on la garde dans la liste des dix derniers (plus
   * récent en tête), puis on la prononce. On la garde même en Muet — la parole
   * se tait, mais la trace reste pour une réécoute plus tard.
   */
  const annoncer = React.useCallback((texte: string) => {
    if (!texte) return;
    compteurRef.current += 1;
    const entree = { id: compteurRef.current, texte };
    setMessages((liste) => [entree, ...liste].slice(0, VOIX_MESSAGES_MAX));
    dire(texte);
  }, [dire]);

  // Le son coupé fait taire ce qui parle à l'instant même.
  React.useEffect(() => {
    muetRef.current = muet;
    if (muet) taire();
  }, [muet, taire]);

  // Fin de tâche : la notification déjà émise porte le titre réel de la carte.
  React.useEffect(
    () =>
      client.onNotify((event) => {
        const texte = phraseVocaleDeNotification(event.motif, event.title);
        if (texte) annoncer(texte);
      }),
    [annoncer],
  );

  /*
   * Décision attendue : on suit le compte d'attention, rangé PAR PROJET. On ne
   * parle qu'à la HAUSSE — une décision de plus — jamais sur le déjà-là du
   * chargement ni quand une décision est traitée. La décision passe par ce
   * compte et non par la notification, sinon on l'entendrait deux fois.
   *
   * De quel projet parle la décision qui arrive ? Celui dont le compte a monté.
   * Sur ce projet, la décision la plus récente donne, si elle tient à une carte,
   * le titre de la tâche — plus parlant que le seul nom du projet.
   */
  const attention = state.attention;
  // Projets, cartes et décisions relus au fil de l'eau, sans réabonner l'effet.
  const donneesRef = React.useRef({ projects: state.projects, cards: state.cards, decisions: state.decisions });
  donneesRef.current = { projects: state.projects, cards: state.cards, decisions: state.decisions };

  const precedent = React.useRef<{ total: number; parProjet: Record<string, number> } | null>(null);
  React.useEffect(() => {
    const parProjet = attention;
    const total = Object.values(parProjet).reduce((somme, n) => somme + n, 0);
    const avant = precedent.current;
    precedent.current = { total, parProjet };
    if (avant === null) return;
    if (total <= avant.total) return;

    const projectId = Object.keys(parProjet).find(
      (id) => (parProjet[id] ?? 0) > (avant.parProjet[id] ?? 0),
    );
    annoncer(phraseDecisionAttendue(total - avant.total, contexteDecision(projectId, donneesRef.current)));
  }, [attention, annoncer]);

  // À la fermeture, on ne laisse pas un son continuer dans le vide.
  React.useEffect(() => taire, [taire]);

  // Comment le module se déplie : au survol à la souris, à l'appui au doigt.
  const survolPossible = useSurvol();
  const geste = gesteDOuverture(survolPossible);
  const [ouvert, setOuvert] = React.useState(false);
  const racineRef = React.useRef<HTMLDivElement | null>(null);

  // Au doigt, un appui hors du module le referme (les navigateurs tactiles ne
  // fabriquent pas de « survol-sort » fiable).
  React.useEffect(() => {
    if (geste !== 'appui' || !ouvert) return;
    const dehors = (e: PointerEvent) => {
      if (!racineRef.current?.contains(e.target as Node)) {
        setOuvert((o) => pileApres(o, 'appui-dehors', geste));
      }
    };
    document.addEventListener('pointerdown', dehors);
    return () => document.removeEventListener('pointerdown', dehors);
  }, [geste, ouvert]);

  const nb = messages.length;

  return (
    <div
      ref={racineRef}
      data-module-voix
      className="fixed bottom-20 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2 sm:bottom-6"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      onMouseEnter={() => setOuvert((o) => pileApres(o, 'survol-entre', geste))}
      onMouseLeave={() => setOuvert((o) => pileApres(o, 'survol-sort', geste))}
    >
      {ouvert ? (
        <div
          data-liste-voix
          className="w-64 max-w-[80vw] animate-fade-in overflow-hidden rounded-lg border border-border bg-surface/95 shadow-lg backdrop-blur"
        >
          <div className="border-b border-border px-3 py-2 text-[11.5px] font-medium text-muted">
            Derniers messages
          </div>
          {nb === 0 ? (
            <p className="px-3 py-3 text-[12px] text-faint">Aucune annonce pour l’instant.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    data-message-voix
                    // L'appui garde le module ouvert : on ne le rabat pas d'un clic.
                    onClick={(e) => {
                      e.stopPropagation();
                      dire(m.texte, true);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12.5px] text-text hover:bg-raised"
                    aria-label={`Réécouter : ${m.texte}`}
                  >
                    <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 line-clamp-2">{m.texte}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        data-icone-voix
        data-parle={parle ? '' : undefined}
        aria-label={
          parle
            ? 'L’assistant parle'
            : `Voix de l’assistant — ${nb} message${nb > 1 ? 's' : ''} à réécouter`
        }
        onClick={() => setOuvert((o) => pileApres(o, 'appui-dedans', geste))}
        // Au repos, un petit rond ; pendant la parole, il s'OUVRE tout seul en un
        // bloc RECTANGULAIRE plus large — la transition anime largeur et coins.
        className={`grid h-11 place-items-center border border-border bg-surface/90 shadow-lg backdrop-blur transition-all duration-300 hover:bg-raised ${
          parle ? 'w-24 rounded-xl' : 'w-11 rounded-full'
        }`}
      >
        {parle ? (
          // Le flux d'ondes façon dictée : des barres VERTES qui ondulent, un peu
          // plus nombreuses, décalées pour donner le mouvement d'un enregistrement.
          <span data-onde-vocale className="flex items-center gap-0.5" aria-hidden>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span
                key={i}
                className="h-5 w-1 origin-center rounded-full bg-success animate-onde"
                // Chaque barre décalée : l'onde ondule au lieu de battre d'un bloc.
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </span>
        ) : (
          // Au repos, cinq lignes figées en vibration sonore SYMÉTRIQUE :
          // petite, moyenne, grande, moyenne, petite.
          <span data-icone-repos className="flex items-center gap-0.5" aria-hidden>
            {['h-1.5', 'h-3', 'h-4', 'h-3', 'h-1.5'].map((hauteur, i) => (
              <span key={i} className={`w-1 rounded-full bg-text ${hauteur}`} />
            ))}
          </span>
        )}
      </button>
    </div>
  );
}
