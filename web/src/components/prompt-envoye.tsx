import * as React from 'react';
import { Braces, Check, Copy } from 'lucide-react';
import {
  SentContextSnapshot,
  mentionDesPassages,
  morceauxDuPromptEnvoye,
  nomDuMoteurEnvoye,
  texteDuPromptEnvoye,
} from '@haikodev/shared';
import { DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';

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
