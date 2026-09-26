import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import {
  COLUMN_LABELS,
  Card,
  ColumnKey,
  AvanceDEtape,
  avanceDEtape,
  lotDAvance,
} from '@beluga/shared';
import { Button, ConfirmDialog, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * AVANCER UNE CARTE D'UN CRAN, DEPUIS N'IMPORTE OÙ.
 *
 * Trois endroits offrent le même geste — le tiroir d'une carte, le menu d'une
 * ligne du tableau, et l'action de masse sur une sélection. Ils partagent donc
 * UN seul crochet : la règle (`avanceDEtape`, `lotDAvance`, testée dans
 * `shared/`) décide, ce fichier ne fait que demander confirmation quand elle le
 * réclame, puis rejouer le déplacement carte par carte.
 *
 * Les cartes partent l'une APRÈS l'autre : un archivage écrit un document, et
 * huit demandes lancées d'un coup se marcheraient dessus — c'est déjà la règle
 * des pieds de colonne du tableau.
 */

/** Une carte candidate, avec ce que l'écran sait de son travail en cours. */
export interface CarteAAvancer {
  card: Card;
  /** La colonne AFFICHÉE, quand elle diffère de celle enregistrée. */
  colonne?: ColumnKey;
  agentActif?: boolean;
}

/**
 * CE QUE DIT LE BOUTON, DANS LA LANGUE DE L'ÉCRAN. La règle partagée rend une
 * phrase française toute faite ; ici on la RECOMPOSE à partir de la cible, pour
 * que le dictionnaire n'ait qu'une clé à trou (« Passer à « {v0} » ») au lieu
 * d'une par colonne.
 */
export function libelleAvance(verdict: AvanceDEtape): string {
  if (!verdict.cible) return t('Dernière étape atteinte');
  if (verdict.cible === 'running') return t('Lancer maintenant');
  return t('Passer à « {v0} »', { v0: t(COLUMN_LABELS[verdict.cible]) });
}

export function useAvancerEtapes() {
  const [demande, setDemande] = React.useState<{
    question: string;
    avances: { card: Card; cible: ColumnKey }[];
  } | null>(null);

  const appliquer = async (avances: { card: Card; cible: ColumnKey }[]) => {
    for (const { card, cible } of avances) {
      // `moveCard` dit lui-même un refus et remet la carte où elle était :
      // rien à rattraper ici, on enchaîne simplement la suivante.
      await client.moveCard(card, cible);
    }
  };

  /**
   * Le geste, pour une carte ou pour un lot. Ce qui ne peut pas bouger est DIT,
   * jamais avalé en silence : sinon on croirait le clic perdu.
   */
  const avancer = async (cartes: CarteAAvancer[]) => {
    const lot = lotDAvance(
      cartes.map((item) => ({
        id: item.card.id,
        colonne: item.colonne ?? item.card.column,
        agentActif: item.agentActif,
        card: item.card,
      })),
    );
    if (lot.bloquees.length) {
      const premiere = lot.bloquees[0]!;
      /* « warning » et non « info » : seuls trois genres alertent, et une
         info simple ne s'afficherait jamais (`messageAlerte`). Une carte qui
         REFUSE de bouger doit se voir. */
      client.pushToast(
        'warning',
        lot.bloquees.length === 1
          ? premiere.raison
          : t('{v0} tâche(s) restent en place : {v1}', { v0: lot.bloquees.length, v1: premiere.raison }),
      );
    }
    if (!lot.avances.length) return;
    const avances = lot.avances.map(({ carte, cible }) => ({ card: carte.card, cible }));
    if (lot.confirmation && lot.question) {
      setDemande({ question: lot.question, avances });
      return;
    }
    await appliquer(avances);
  };

  const dialogue = (
    <ConfirmDialog
      open={!!demande}
      title={t('Passer à l’étape suivante')}
      description={demande?.question ?? ''}
      confirmLabel={t('Continuer')}
      onConfirm={async () => {
        if (demande) await appliquer(demande.avances);
      }}
      onClose={() => setDemande(null)}
    />
  );

  return { avancer, dialogue };
}

/**
 * LE BOUTON DU TIROIR. Il ne double jamais un bouton déjà présent : le
 * lancement (« Planifié → En cours ») et la clôture (« En cours → À déployer »)
 * ont chacun le leur, avec leurs propres garde-fous. Ce bouton-ci prend les
 * crans qui n'en avaient aucun.
 */
export function BoutonEtapeSuivante({
  card,
  agentActif,
  onAvancer,
  className,
}: {
  card: Card;
  agentActif?: boolean;
  onAvancer: () => void;
  /** La hauteur commune des boutons sous le fil, quand il y est posé. */
  className?: string;
}) {
  const verdict = avanceDEtape({ colonne: card.column, agentActif });
  if (!verdict.cible) return null;
  return (
    <Tooltip label={verdict.possible ? libelleAvance(verdict) : verdict.raison ?? ''}>
      <Button
        size="sm"
        variant="outline"
        data-geste="etape-suivante"
        disabled={!verdict.possible}
        onClick={onAvancer}
        className={className}
      >
        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{libelleAvance(verdict)}</span>
      </Button>
    </Tooltip>
  );
}
