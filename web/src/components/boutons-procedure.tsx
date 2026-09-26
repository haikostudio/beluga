import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { CiblePublication, libelleInitier } from '@beluga/shared';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * LE BOUTON « CONFIGURATION DE LA PROCÉDURE » (autrefois « Initialiser… »),
 * posé là où vit d'habitude le bouton d'action : il mène à la conversation
 * avec l'agent, qu'elle commence ou qu'elle reprenne. Il tient toute la
 * largeur par défaut ; `compact` le réduit à la taille des autres boutons
 * d'action, pour vivre dans le bandeau de titre d'une rangée. L'icône de
 * réglages qui l'accompagnait a disparu (refonte du 24/09/2026) : le tiroir du
 * bandeau porte lui-même l'onglet « Conversation ».
 */
export function BoutonInitierProcedure({
  cible,
  onOuvrir,
  compact,
}: {
  cible: CiblePublication;
  onOuvrir: () => void;
  compact?: boolean;
}) {
  return (
    <Button size={compact ? 'sm' : 'pied'} data-initier-procedure={cible} onClick={onOuvrir}>
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="truncate">{t(libelleInitier(cible))}</span>
    </Button>
  );
}
