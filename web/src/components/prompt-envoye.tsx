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
import { t } from '@/lib/langue';

/**
 * LE PROMPT ENVOYÉ, EN BULLES DE MESSAGE — plus aucun tiroir.
 *
 * Il fallait auparavant repérer une pastille « Prompt envoyé » sous la demande,
 * cliquer, puis lire un tiroir plein écran : quatre gestes pour voir le texte
 * qu'on avait sous les yeux. Ce qui est parti au moteur se lit maintenant DANS
 * la conversation, comme des messages de l'utilisateur — alignés à droite, dans
 * le même encadré gris que ses demandes — et dans l'ordre fixé par
 * `bullesDuPromptEnvoye` (`shared/src/prompt-envoye.ts`) : sa demande, puis
 * « Mémoire transmise ».
 *
 * Une bulle longue ne montre que ses premières lignes ; « voir plus », en
 * bas, déroule le reste. Le LECTEUR DE PROMPTS complet, avec tous les tours,
 * reste dans l'onglet « Détails » d'une carte.
 *
 * « MÉMOIRE TRANSMISE » FAIT BANDE À PART, ET REGROUPE DEUX VOLETS EN UN.
 * Elle réunit ce que la recherche a retrouvé dans la mémoire du projet ET le
 * prompt complet — auparavant deux bulles séparées, qui portaient le même
 * encadré gris et disaient en partie la même chose (les passages retrouvés
 * apparaissaient déjà dans le prompt complet, à leur place). Posées l'une
 * sous l'autre, elles se lisaient comme un seul texte coupé en deux sans
 * frontière claire. La bulle unique reprend EXACTEMENT l'habillage de la
 * bulle de prompt juste au-dessus (même fond, même bordure discrète, même
 * taille de texte pour le corps), avec un repli court et un entête cliquable
 * qui l'ouvre et la referme ; deux labels (« Mémoire cache », gris,
 * « Mémoire ajoutée », jaune) rappellent ce que la coloration ligne par
 * ligne du texte veut dire — toute la ligne d'en-tête (titre, détail,
 * labels, mentions) partage la même petite taille de texte.
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
      title={t('Copier ce texte')}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {copie ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
      {copie ? t('Copié') : t('Copier')}
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

  // LA BULLE « MÉMOIRE TRANSMISE » SEULE porte `bulle.lignes` : gris pour un
  // morceau relu au cache (déjà présent), jaune pour un morceau écrit pour ce
  // tour (facturé). Ses lignes reconstruisent EXACTEMENT `bulle.texte` (même
  // découpe par `\n`) : la coupe à « voir plus » (`tronque`, ci-dessus) reste
  // donc valable.
  const lignesAAfficher = bulle.lignes;

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
   * UNE BULLE ISOLÉE GARDE LE MÊME HABILLAGE que les bulles de prompt
   * (fond `raised`, bordure `border` discrète) — seule sa « queue » de bulle
   * (le coin bas droit rabattu) disparaît, et un peu d'air au-dessus et
   * au-dessous la distingue comme une note à part, jamais comme la suite du
   * bloc voisin.
   */
  const encadre = bulle.isole
    ? 'my-3 rounded-lg border border-border bg-raised'
    : 'rounded-lg rounded-br-sm border border-border bg-raised';

  // Le détail (compte, mode de recherche, raison) ne redit rien qu'on ne lise
  // déjà dans le corps de la bulle — c'est le cas sans passage, où la mention
  // ET le texte portent la même raison. Il n'apparaît donc que s'il ajoute
  // vraiment quelque chose.
  const detailUtile = bulle.mention && bulle.mention !== bulle.texte ? bulle.mention : undefined;

  const boite = (
    <div
      data-bulle-prompt={bulle.cle}
      data-bulle-isolee={bulle.isole ? '' : undefined}
      className={cn(
        'min-w-0 max-w-full overflow-hidden px-3 py-2',
        bulle.isole ? 'w-full' : 'w-[min(78%,520px)]',
        encadre,
      )}
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
            title={deroule ? t('Replier cette mémoire') : t('Déplier cette mémoire')}
            className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-raised"
          >
            <span className="min-w-0 flex-1 break-words text-[12px] font-medium text-faint [overflow-wrap:anywhere]">
              {bulle.titre}
            </span>
            <ChevronDown
              className={cn('h-3 w-3 shrink-0 text-faint transition-transform', deroule && 'rotate-180')}
            />
          </button>
        ) : (
          <span className="min-w-0 flex-1 break-words text-[12px] font-medium text-faint [overflow-wrap:anywhere]">
            {bulle.titre}
          </span>
        )}
      </div>

      {detailUtile ? (
        <p className="-mt-0.5 mb-1.5 break-words text-[12px] text-faint [overflow-wrap:anywhere]">{detailUtile}</p>
      ) : null}

      {/*
        LES DEUX LABELS COLORÉS : un repère, pas un compte. Cette bulle
        regroupe deux volets qui formaient auparavant deux bulles séparées
        (« Mémoire retrouvée » puis « Prompt complet ») ; le texte plus bas
        reprend déjà la coloration ligne par ligne (`ligne.cached`) — ces deux
        pastilles disent simplement ce que chaque couleur veut dire, une fois
        pour toute la bulle plutôt que répétée à chaque ligne.
      */}
      {bulle.lignes ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span
            data-label-cache
            className="rounded-full border border-border px-1.5 py-0.5 text-[12px] text-faint"
          >
            {t('Mémoire cache')}
          </span>
          <span
            data-label-ajoutee
            className="rounded-full border border-border px-1.5 py-0.5 text-[12px] text-nouveau"
          >
            {t('Mémoire ajoutée')}
          </span>
        </div>
      ) : null}

      {/* CE QUI EST PARTI EN MÊME TEMPS : briefing, mémoire, carte, pièces
          jointes. Leurs NOMS se lisent sans rien dérouler, en texte normal —
          des pastilles arrondies ne se lisaient pas sur le fond sombre et
          n'ajoutaient rien qu'une simple liste ne dise aussi bien. Leur texte
          est dans la bulle, à sa place. Jamais un chiffre de jetons. */}
      {bulle.noms?.length ? (
        <p data-donnees-paralleles className="mb-1.5 break-words text-[12px] text-faint [overflow-wrap:anywhere]">
          {t('Transmis en même temps : {v0}', { v0: bulle.noms.join(', ') })}</p>
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
        {lignesAAfficher
          ? (deroule ? lignesAAfficher : lignesAAfficher.slice(0, lignes)).map((ligne, index, tableau) => (
              <span key={index} className={ligne.cached ? 'text-faint' : 'text-nouveau'}>
                {ligne.texte}
                {index < tableau.length - 1 ? '\n' : ''}
              </span>
            ))
          : deroule
            ? bulle.texte
            : apercu}
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
          {deroule ? t('voir moins') : t('voir plus')}
        </button>
      ) : null}
    </div>
  );

  /*
   * L'ICÔNE ET LE BOUTON « COPIER » VIVENT HORS DE LA BULLE, comme partout
   * ailleurs dans l'application (`LigneReperes`, sous les messages) : une
   * icône collée à l'intérieur d'un encadré, ou un bouton en haut à droite
   * dedans, ne s'y lisaient nulle part ailleurs. L'icône du livre se pose à
   * GAUCHE, à l'extérieur, seulement pour la bulle isolée (les autres n'en
   * portent pas) ; « Copier » se pose EN DESSOUS, à l'extérieur, pour les
   * trois.
   *
   * L'icône est posée en POSITION ABSOLUE, décalée hors du conteneur : mise
   * dans un `flex` classique, elle mangeait sa largeur au texte, et la bulle
   * de mémoire se retrouvait plus étroite que les deux autres bulles du fil
   * pour une même largeur affichée. Le conteneur garde donc la MÊME largeur
   * (`w-[min(78%,520px)]`) que les bulles ordinaires, l'icône flottant devant
   * lui, plus à gauche qu'avant.
   */
  return (
    <div data-bulle-groupe={bulle.cle} className="flex flex-col items-end gap-1">
      {bulle.isole ? (
        <div className="relative w-[min(78%,520px)] min-w-0 max-w-full">
          <BookOpen
            className="absolute -left-6 top-2 h-3.5 w-3.5 shrink-0 text-faint"
            aria-hidden="true"
          />
          {boite}
        </div>
      ) : (
        boite
      )}
      <BoutonCopier texte={bulle.texte} />
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
