import * as React from 'react';
import { BookOpen, Check, ChevronDown, Copy } from 'lucide-react';
import {
  BulleDePrompt,
  LIGNES_VISIBLES_BULLE,
  LIGNES_VISIBLES_MEMOIRE,
  SentContextSnapshot,
  apercuDeBulle,
  bullesDuPromptEnvoye,
} from '@haikodev/shared';
import { cn } from '@/lib/utils';

/**
 * LE PROMPT ENVOYÉ, EN BULLES DE MESSAGE — plus aucun tiroir.
 *
 * Il fallait auparavant repérer une pastille « Prompt envoyé » sous la demande,
 * cliquer, puis lire un tiroir plein écran : quatre gestes pour voir le texte
 * qu'on avait sous les yeux. Ce qui est parti au moteur se lit maintenant DANS
 * la conversation, comme des messages de l'utilisateur — alignés à droite, dans
 * le même encadré gris que ses demandes — et dans l'ordre fixé par
 * `bullesDuPromptEnvoye` (`shared/src/prompt-envoye.ts`) : sa demande, la
 * mémoire retrouvée par la recherche, puis le prompt complet.
 *
 * Une bulle longue ne montre que ses CINQ premières lignes ; « voir plus », en
 * bas, déroule le reste. Le LECTEUR DE PROMPTS complet, avec tous les tours,
 * reste dans l'onglet « Détails » d'une carte.
 *
 * LA MÉMOIRE RETROUVÉE FAIT BANDE À PART. Les trois bulles portaient le même
 * encadré gris : posée juste au-dessus du prompt complet, la mémoire se lisait
 * comme sa première moitié, et ses passages cités en entier repoussaient la
 * réponse de l'agent hors de l'écran. Elle a désormais son propre fond, son
 * propre écart, un repli plus court (trois lignes) et un entête cliquable qui
 * l'ouvre et la referme.
 */

function BoutonCopier({ texte }: { texte: string }) {
  const [copie, setCopie] = React.useState(false);
  if (!texte.trim()) return null;

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      const zone = document.createElement('textarea');
      zone.value = texte;
      zone.style.position = 'fixed';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      document.execCommand('copy');
      zone.remove();
    }
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={copier}
      title="Copier ce texte"
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {copie ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
      {copie ? 'Copié' : 'Copier'}
    </button>
  );
}

/**
 * UNE BULLE : son titre, son texte, et « voir plus » quand il déborde.
 *
 * La coupe se décide à DEUX endroits, parce qu'aucun des deux ne suffit seul :
 * la règle pure compte les vraies lignes du texte, et la mesure d'écran voit ce
 * que la règle ne peut pas voir — une ligne unique mais si longue qu'elle se
 * replie toute seule sur dix hauteurs. Le texte reste du texte simple, jamais
 * un pavé rogné : il se sélectionne et se copie comme n'importe quelle bulle.
 */
function BulleDuPrompt({ bulle }: { bulle: BulleDePrompt }) {
  const [deroule, setDeroule] = React.useState(false);
  const [deborde, setDeborde] = React.useState(false);
  const zone = React.useRef<HTMLPreElement>(null);
  const lignes = bulle.lignesVisibles ?? LIGNES_VISIBLES_BULLE;
  const { apercu, tronque } = React.useMemo(
    () => apercuDeBulle(bulle.texte, lignes),
    [bulle.texte, lignes],
  );

  React.useLayoutEffect(() => {
    const element = zone.current;
    // Déroulée, la bulle ne déborde plus par construction : on garde la mesure
    // prise à l'état replié, sinon « voir moins » disparaîtrait sous le doigt.
    if (!element || deroule) return;
    setDeborde(element.scrollHeight > element.clientHeight + 1);
  }, [apercu, deroule]);

  const aVoirPlus = tronque || deborde;
  const basculer = () => setDeroule((valeur) => !valeur);

  /*
   * UNE BULLE ISOLÉE PORTE SON PROPRE ENCADRÉ. Pas la « queue » de bulle des
   * messages (le coin bas droit rabattu), pas le même gris : un fond `surface`,
   * un liseré à gauche et un peu d'air au-dessus et au-dessous — de quoi la lire
   * comme une note à part, jamais comme la suite du bloc voisin.
   */
  const encadre = bulle.isole
    ? 'my-3 rounded-lg border border-border border-l-2 border-l-faint bg-surface'
    : 'rounded-lg rounded-br-sm border border-border bg-raised';

  return (
    <div className="flex justify-end">
      <div
        data-bulle-prompt={bulle.cle}
        data-bulle-isolee={bulle.isole ? '' : undefined}
        className={cn('w-[min(78%,520px)] min-w-0 max-w-full overflow-hidden px-3 py-2', encadre)}
      >
        <div className="mb-1 flex items-baseline gap-2">
          {/*
            L'ENTÊTE ENTIER OUVRE ET REFERME la bulle isolée : un clic n'importe
            où sur son titre suffit, sans viser le petit « voir plus » du bas.
            Les autres bulles gardent un titre inerte — leur repli tient au seul
            bouton, et rendre le titre cliquable volerait la sélection du texte.
          */}
          {bulle.isole ? (
            <button
              type="button"
              data-bulle-entete
              onClick={basculer}
              aria-expanded={deroule}
              title={deroule ? 'Replier cette mémoire' : 'Déplier cette mémoire'}
              className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-raised"
            >
              <BookOpen className="h-3 w-3 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 break-words text-[12px] font-medium text-faint [overflow-wrap:anywhere]">
                {bulle.titre}
                {bulle.mention ? <span className="text-faint"> · {bulle.mention}</span> : null}
              </span>
              <ChevronDown
                className={cn('h-3 w-3 shrink-0 text-faint transition-transform', deroule && 'rotate-180')}
              />
            </button>
          ) : (
            <span className="min-w-0 flex-1 break-words text-[12px] font-medium text-faint [overflow-wrap:anywhere]">
              {bulle.titre}
              {bulle.mention ? <span className="text-faint"> · {bulle.mention}</span> : null}
            </span>
          )}
          <BoutonCopier texte={bulle.texte} />
        </div>

        {/* CE QUI EST PARTI EN MÊME TEMPS : briefing, mémoire, carte, pièces
            jointes. Leurs NOMS se lisent sans rien dérouler ; leur texte est
            dans la bulle, à sa place. Jamais un chiffre de jetons. */}
        {bulle.noms?.length ? (
          <div data-donnees-paralleles className="mb-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[11.5px] text-faint">Transmis en même temps :</span>
            {bulle.noms.map((nom) => (
              <span
                key={nom}
                className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted"
              >
                {nom}
              </span>
            ))}
          </div>
        ) : null}

        <pre
          ref={zone}
          data-texte-bulle
          /*
            REPLIÉE, une bulle isolée s'ouvre aussi d'un clic sur son aperçu :
            trois lignes coupées ne se lisent pas, elles s'ouvrent. Une fois
            DÉROULÉE, le clic ne referme plus rien — sinon sélectionner une
            citation pour la copier refermerait la bulle sous le doigt.
          */
          onClick={bulle.isole && !deroule && aVoirPlus ? basculer : undefined}
          className={cn(
            'whitespace-pre-wrap break-words font-sans text-[13.5px] leading-[1.6] text-text [overflow-wrap:anywhere]',
            !deroule && (bulle.isole ? 'max-h-[4.8em] overflow-hidden' : 'max-h-[8em] overflow-hidden'),
            bulle.isole && !deroule && aVoirPlus && 'cursor-pointer',
          )}
        >
          {deroule ? bulle.texte : apercu}
        </pre>

        {aVoirPlus ? (
          <button
            type="button"
            data-voir-plus
            onClick={basculer}
            // Le survol se voit sur le fond de SA bulle : gris clair sur une
            // bulle de message, gris de message sur la bulle isolée.
            className={cn(
              'mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-faint transition-colors hover:text-text',
              bulle.isole ? 'hover:bg-raised' : 'hover:bg-surface',
            )}
          >
            <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', deroule && 'rotate-180')} />
            {deroule ? 'voir moins' : 'voir plus'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * LES BULLES D'UN TOUR, posées sous la demande (ou à sa place).
 *
 * `demandeDejaAffichee` vaut vrai quand l'utilisateur a TAPÉ sa demande : sa
 * bulle est déjà là, juste au-dessus, et la répéter mot pour mot n'apprendrait
 * rien. Un tour lancé par un BOUTON n'écrit aucune bulle — la première est
 * alors posée ici, là où elle se serait trouvée.
 */
export function BullesDuPromptEnvoye({
  contexte,
  demandeDejaAffichee = false,
}: {
  contexte: SentContextSnapshot;
  demandeDejaAffichee?: boolean;
}) {
  const bulles = React.useMemo(
    () => bullesDuPromptEnvoye(contexte, { demandeDejaAffichee }),
    [contexte, demandeDejaAffichee],
  );
  if (!bulles.length) return null;

  return (
    <div data-prompt-envoye className="space-y-2">
      {bulles.map((bulle) => (
        <BulleDuPrompt key={bulle.cle} bulle={bulle} />
      ))}
    </div>
  );
}

/** Le nombre de lignes montrées avant « voir plus », pour les contrôles. */
export const LIGNES_AVANT_VOIR_PLUS = LIGNES_VISIBLES_BULLE;
