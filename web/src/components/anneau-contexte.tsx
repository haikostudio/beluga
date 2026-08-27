import * as React from 'react';
import { Gauge as IconeJauge } from 'lucide-react';
import {
  Agent,
  AgentContextUsage,
  detailDuContexte,
  jetonsLisibles,
  niveauDeContexte,
  plafondDeContexte,
  traceDeLAnneau,
  type NiveauContexte,
} from '@haikodev/shared';
import { Dialog, DialogContent, DialogTitle, Gauge, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE CONTEXTE DU MODÈLE, EN ANNEAU, À CÔTÉ DU CHOIX DU MODÈLE.
 *
 * La mesure existait déjà et ne se voyait NULLE PART : on lançait un tour sans
 * savoir si le fil était vide ou à deux doigts d'une compression. L'anneau la
 * remet sous les yeux, à l'endroit exact où l'on choisit son modèle — deux
 * cercles superposés, le fond puis la part remplie —, et un clic ouvre la
 * fenêtre qui donne les nombres en clair.
 *
 * TANT QU'AUCUNE MESURE N'EST VENUE DU MOTEUR, RIEN NE S'AFFICHE. Un anneau
 * vide se lirait comme « contexte à zéro », alors qu'il ne dit que « je ne sais
 * pas encore » : c'est la même règle que partout ailleurs dans l'application,
 * une absence de mesure ne devient jamais un faux zéro.
 */

const COULEUR_TRAIT: Record<NiveauContexte, string> = {
  repos: 'text-accent',
  charge: 'text-warning',
  critique: 'text-danger',
};

const COULEUR_TEXTE: Record<NiveauContexte, string> = {
  repos: 'text-muted',
  charge: 'text-warning',
  critique: 'text-danger',
};

/** Les deux cercles, dessinés à la taille demandée. */
export function CerclesContexte({
  pourcentage,
  taille = 16,
  epaisseur = 2.5,
}: {
  pourcentage: number;
  taille?: number;
  epaisseur?: number;
}) {
  const rayon = (taille - epaisseur) / 2;
  const trace = traceDeLAnneau(pourcentage, rayon);
  const centre = taille / 2;
  return (
    <svg
      width={taille}
      height={taille}
      viewBox={`0 0 ${taille} ${taille}`}
      className="shrink-0 -rotate-90"
      aria-hidden
    >
      <circle
        cx={centre}
        cy={centre}
        r={trace.rayon}
        fill="none"
        stroke="currentColor"
        strokeWidth={epaisseur}
        className="text-faint/30"
      />
      <circle
        cx={centre}
        cy={centre}
        r={trace.rayon}
        fill="none"
        stroke="currentColor"
        strokeWidth={epaisseur}
        strokeLinecap="round"
        strokeDasharray={`${trace.rempli} ${trace.vide}`}
        className="transition-[stroke-dasharray] duration-500"
      />
    </svg>
  );
}

export function AnneauContexte({ agent }: { agent: Agent | undefined }) {
  const [ouvert, setOuvert] = React.useState(false);
  const usage = agent?.contextUsage as AgentContextUsage | undefined;

  // Pas de mesure, pas d'anneau : voir l'en-tête de ce fichier.
  if (!agent || !usage) return null;

  const niveau = niveauDeContexte(usage.percentage);

  return (
    <>
      <Tooltip label={t('Contexte du modèle : {n} % — voir le détail', { n: usage.percentage })}>
        <button
          type="button"
          data-anneau-contexte={usage.percentage}
          // Un repère technique ne change JAMAIS de langue : l'infobulle
          // au-dessus, elle, est bien traduite.
          aria-label="Contexte du modèle" 
          onClick={() => setOuvert(true)}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[12.5px] tabular-nums hover:bg-raised',
            COULEUR_TEXTE[niveau],
          )}
        >
          <span className={COULEUR_TRAIT[niveau]}>
            <CerclesContexte pourcentage={usage.percentage} />
          </span>
          <span className="hidden sm:inline">{usage.percentage} %</span>
        </button>
      </Tooltip>

      <FenetreContexte agent={agent} usage={usage} ouvert={ouvert} onClose={() => setOuvert(false)} />
    </>
  );
}

/**
 * LA FENÊTRE DÉTAILLÉE : un grand anneau, une barre de progression, puis les
 * nombres. Elle ne dit QUE ce qui a été mesuré — et elle explique le seuil de
 * compression, qui est le seul chiffre qu'on ne peut pas deviner en regardant
 * le pourcentage.
 */
function FenetreContexte({
  agent,
  usage,
  ouvert,
  onClose,
}: {
  agent: Agent;
  usage: AgentContextUsage;
  ouvert: boolean;
  onClose: () => void;
}) {
  const detail = detailDuContexte(usage, plafondDeContexte(agent.role));
  const modele = agent.run?.model;
  const compressions = agent.context?.compressionCount ?? 0;

  return (
    <Dialog open={ouvert} onOpenChange={(next) => !next && onClose()}>
      <DialogContent data-fenetre-contexte>
        <DialogTitle>{t('Contexte du modèle')}</DialogTitle>

        <div className="mt-3 flex items-center gap-4">
          <span className={COULEUR_TRAIT[detail.niveau]}>
            <CerclesContexte pourcentage={detail.pourcentage} taille={64} epaisseur={7} />
          </span>
          <div className="min-w-0">
            <div className={cn('text-[26px] font-semibold leading-none tabular-nums', COULEUR_TEXTE[detail.niveau])}>
              {detail.pourcentage} %
            </div>
            <div className="mt-1 truncate text-[12.5px] text-faint">
              {modele ? t('Fenêtre du modèle {modele}', { modele }) : t('Fenêtre du modèle')}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Gauge value={detail.pourcentage} height="h-2" />
          <div className="mt-1.5 flex justify-between text-[12px] text-faint tabular-nums">
            <span>{t('{n} jetons utilisés', { n: jetonsLisibles(detail.utilises) })}</span>
            <span>{t('{n} au total', { n: jetonsLisibles(detail.capacite) })}</span>
          </div>
        </div>

        <dl className="mt-4 space-y-1.5 text-[13px]" data-lignes-contexte>
          <Ligne libelle={t('Jetons utilisés')} valeur={jetonsLisibles(detail.utilises)} />
          <Ligne libelle={t('Limite du modèle')} valeur={jetonsLisibles(detail.capacite)} />
          <Ligne libelle={t('Place restante')} valeur={jetonsLisibles(detail.restants)} />
          <Ligne libelle={t('Remplissage')} valeur={`${detail.pourcentage} %`} />
          <Ligne
            libelle={t('Compression à partir de')}
            valeur={t('{n} jetons ({p} %)', { n: jetonsLisibles(detail.seuilJetons), p: detail.seuilPourcentage })}
          />
          <Ligne
            libelle={t('Avant compression')}
            valeur={
              detail.avantCompression > 0
                ? t('{n} jetons', { n: jetonsLisibles(detail.avantCompression) })
                : t('seuil atteint')
            }
          />
          {compressions > 0 ? (
            <Ligne libelle={t('Compressions déjà faites')} valeur={String(compressions)} />
          ) : null}
        </dl>

        <p className="mt-4 flex gap-2 text-[12.5px] leading-snug text-faint">
          <IconeJauge className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t(
              'Cette mesure est celle du dernier appel au modèle, rapportée à la fenêtre du modèle qui porte le fil. Elle se rafraîchit à chaque réponse, et n’a rien à voir avec le quota du compte.',
            )}
          </span>
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-faint/20 pb-1.5 last:border-0">
      <dt className="text-muted">{libelle}</dt>
      <dd className="shrink-0 font-medium text-text tabular-nums">{valeur}</dd>
    </div>
  );
}
