import * as React from 'react';
import { Braces, Check, ChevronRight, Copy, SendHorizonal } from 'lucide-react';
import {
  SentContextSnapshot,
  demandeDuPromptEnvoye,
  mentionDesPassages,
  morceauxDuPromptEnvoye,
  nomDuMoteurEnvoye,
  texteDuPromptEnvoye,
} from '@haikodev/shared';
import { DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * LE REPÈRE DU PROMPT ENVOYÉ — à GAUCHE, dès que la demande est partie.
 *
 * Le bloc « Contexte envoyé » vivait sous la bulle de la demande, à droite,
 * et ouvrait une chronologie de TOUS les tours avec sa recherche et ses blocs
 * repliés. À sa place : un repère discret, posé à GAUCHE sous la demande dès
 * que le prompt est parti au moteur, et un tiroir qui montre CE tour-là — le
 * texte réellement envoyé, dans l'ordre, passages retrouvés compris
 * (`shared/src/prompt-envoye.ts`). Rien d'autre : ni chiffre, ni recherche, ni
 * pile des autres tours. Le LECTEUR DE PROMPTS complet, lui, reste dans
 * l'onglet « Détails » d'une carte.
 */

function BoutonCopierPrompt({ texte }: { texte: string }) {
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
      title="Copier le prompt envoyé"
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {copie ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
      {copie ? 'Copié' : 'Copier'}
    </button>
  );
}

/** Un morceau du prompt : son nom, puis son texte en clair — jamais replié. */
function MorceauDuPrompt({
  label,
  texte,
  cached,
  passage,
}: {
  label: string;
  texte?: string;
  cached: boolean;
  passage: boolean;
}) {
  return (
    <div data-morceau-prompt data-passage={passage ? 'oui' : 'non'} className="space-y-1">
      <div className="flex items-center gap-2">
        {/* Jamais de MAJUSCULES ici : un nom de morceau porte souvent un chemin
            de fichier (« docs/regles/quotas.md »), qu'une capitale rend faux à
            l'œil et illisible. */}
        <span className="min-w-0 flex-1 break-words text-[12px] font-medium text-faint [overflow-wrap:anywhere]">
          {label}
        </span>
        {cached ? (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-faint">
            relu au cache
          </span>
        ) : null}
      </div>
      {texte ? (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-raised px-2.5 py-2 font-sans text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
          {texte}
        </pre>
      ) : (
        <p className="text-[12px] text-faint">Texte non conservé (tour ancien, retiré pour borner le disque).</p>
      )}
    </div>
  );
}

export function RepereDuPrompt({ contexte }: { contexte: SentContextSnapshot }) {
  const [open, setOpen] = React.useState(false);
  const morceaux = React.useMemo(() => morceauxDuPromptEnvoye(contexte), [contexte]);
  const mention = mentionDesPassages(contexte);

  return (
    <>
      <button
        type="button"
        data-contexte-envoye
        onClick={() => setOpen(true)}
        title="Voir le prompt réellement envoyé au moteur"
        className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-2 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-raised hover:text-text"
      >
        <Braces className="h-3 w-3 shrink-0 text-accent" />
        Prompt envoyé
      </button>

      <Drawer open={open} onClose={() => setOpen(false)}>
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <Braces className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">Prompt envoyé</DialogTitle>
          <BoutonCopierPrompt texte={texteDuPromptEnvoye(contexte)} />
        </header>

        <ZoneDefilement data-contexte-envoye-contenu className="px-3 py-3">
          <div className="space-y-3">
            <p className="text-[12px] text-faint">
              {nomDuMoteurEnvoye(contexte.engine)}
              {contexte.model ? ` · ${contexte.model}` : ''} ·{' '}
              {new Date(contexte.sentAt).toLocaleString('fr-CH')}
              {mention ? ` · ${mention}` : ''}
            </p>
            {morceaux.map((morceau, index) => (
              <MorceauDuPrompt
                key={`${morceau.label}-${index}`}
                label={morceau.label}
                texte={morceau.texte}
                cached={morceau.cached}
                passage={morceau.passage}
              />
            ))}
          </div>
        </ZoneDefilement>
      </Drawer>
    </>
  );
}

/**
 * LA DEMANDE ENVOYÉE, QUAND PERSONNE N'A ÉCRIT DE BULLE.
 *
 * Une carte lancée par un bouton — comme une reprise ou un dépannage de
 * publication — n'a pas de message d'utilisateur dans son fil : l'onglet
 * « Conversation » du tiroir s'ouvrait donc directement sur « Exécution de la
 * tâche », sans qu'on puisse voir ce qui était réellement parti au moteur ni ce
 * que le système était allé chercher dans la mémoire du projet.
 *
 * Ce bloc prend la place qu'une bulle aurait occupée, AU-DESSUS du déroulé : le
 * texte de la demande (replié par défaut, comme la mémoire juste en dessous),
 * la phrase qui dit combien de passages la recherche a rapportés, et le repère
 * qui ouvre le prompt entier. Le tiroir, lui, ne change pas : c'est le même.
 */
export function DemandeEnvoyee({ contexte }: { contexte: SentContextSnapshot }) {
  const [ouvert, setOuvert] = React.useState(false);
  const demande = demandeDuPromptEnvoye(contexte);
  const mention = mentionDesPassages(contexte);

  return (
    <div data-demande-envoyee className="mb-2 overflow-hidden rounded-md border border-border bg-surface/60">
      <button
        type="button"
        disabled={!demande}
        onClick={() => setOuvert((valeur) => !valeur)}
        className={cn('flex w-full items-center gap-2 px-2.5 py-1.5 text-left', demande && 'hover:bg-raised')}
      >
        <SendHorizonal className={cn('h-3 w-3 shrink-0', demande ? 'text-accent' : 'text-faint')} />
        <span className="flex-1 truncate text-[13.5px] text-muted">
          Demande envoyée à l'agent{mention ? ` — ${mention}` : ''}
        </span>
        {demande ? (
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')} />
        ) : null}
      </button>

      {ouvert && demande ? (
        <div className="mx-2 mb-2">
          <ZoneDefilement
            fond="hsl(var(--raised))"
            classeEnveloppe="max-h-64 flex-none rounded bg-raised"
            className="p-2"
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
              {demande}
            </pre>
          </ZoneDefilement>
        </div>
      ) : null}

      {/* Le prompt ENTIER — briefing, carte, passages retrouvés — reste derrière
          le même repère qu'ailleurs dans l'application. */}
      <div className="px-2.5 pb-1.5">
        <RepereDuPrompt contexte={contexte} />
      </div>
    </div>
  );
}
