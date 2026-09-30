import * as React from 'react';
import { BookOpen } from 'lucide-react';
import { Button, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { estTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';

/** Le texte ne montre qu'un début, mais il s'écrit à la même taille que le tiroir. */
const CLASSE_TEXTE = 'text-[13px] leading-relaxed';
/** Le retour à la ligne forcé : un mot très long ou un bloc de code ne fait plus déborder. */
const CLASSE_DEBORDEMENT = 'min-w-0 max-w-full break-words [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap';

/**
 * L'ÉTUDE DE L'AGENT, EN APERÇU (demande du 29/09/2026) — le récit que l'agent
 * de configuration a écrit sous « Processus en place ». Entière, elle
 * s'étalait sur des dizaines de lignes et poussait le processus hors de
 * l'écran. On n'en montre plus qu'un DÉBUT d'environ cinq lignes, fondu par un
 * dégradé vers le fond de la zone (`--fond-zone`, posé par la section), et un
 * bouton « Voir plus » ouvre le texte ENTIER dans un tiroir empilé, où il
 * défile seul (`ZoneDefilement`).
 *
 * Le texte garde son propre cadre et reste sélectionnable : le bouton vit À CÔTÉ,
 * jamais autour (règle du texte replié). Un texte assez court pour tenir dans
 * l'aperçu s'affiche entier, sans dégradé ni bouton : la mesure se refait à
 * l'arrivée du texte et au redimensionnement.
 */
export function EtudeRepliee({ texte }: { texte: string }) {
  const cadre = React.useRef<HTMLDivElement>(null);
  const interne = React.useRef<HTMLDivElement>(null);
  const [tronquee, setTronquee] = React.useState(false);
  const [ouvert, setOuvert] = React.useState(false);

  React.useEffect(() => {
    const zone = cadre.current;
    const contenu = interne.current;
    if (!zone || !contenu) return;
    const mesurer = () => setTronquee(contenu.offsetHeight > zone.clientHeight + 1);
    mesurer();
    const suivi = new ResizeObserver(mesurer);
    suivi.observe(zone);
    suivi.observe(contenu);
    return () => suivi.disconnect();
  }, [texte]);

  return (
    <div data-etude-processus data-etude-tronquee={tronquee ? 'oui' : 'non'}>
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-text">
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted" />
        {t('Étude de l’agent')}
      </p>
      <div
        ref={cadre}
        className={`relative mt-1 max-h-[8.125em] overflow-hidden ${CLASSE_TEXTE}`}
        data-etude-apercu
      >
        <div ref={interne} className={CLASSE_DEBORDEMENT}>
          <Markdown content={texte} className={CLASSE_TEXTE} />
        </div>
        {tronquee ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{ background: 'linear-gradient(to top, hsl(var(--fond-zone)), hsl(var(--fond-zone) / 0))' }}
            aria-hidden
            data-etude-degrade
          />
        ) : null}
      </div>
      {tronquee ? (
        <Button variant="subtle" size="sm" className="mt-1.5" onClick={() => setOuvert(true)} data-etude-voir-plus>
          {t('Voir plus')}
        </Button>
      ) : null}
      <Drawer open={ouvert} onClose={() => setOuvert(false)} empile plein={estTelephone()}>
        <div className="flex min-h-0 flex-1 flex-col" data-tiroir-etude-processus>
          <header className="flex shrink-0 items-center gap-2 px-4 pb-[13px]">
            <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted" />
            <DialogTitle className="min-w-0 flex-1 truncate">{t('Étude de l’agent')}</DialogTitle>
          </header>
          <ZoneDefilement className="min-h-0 flex-1 px-4 pb-4">
            <div className={CLASSE_DEBORDEMENT}>
              <Markdown content={texte} className={CLASSE_TEXTE} />
            </div>
          </ZoneDefilement>
        </div>
      </Drawer>
    </div>
  );
}
