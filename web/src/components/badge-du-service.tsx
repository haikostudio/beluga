import { NOM_DU_SERVICE, type ServiceDeCarte } from '@beluga/shared';
import { Badge } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * LE BADGE DU SERVICE D'OÙ VIENT UNE CARTE (Studio, Marketing, Surveillance,
 * Sauvegardes, Bibliothèque) : posé à côté de « Travail » sur la ligne du haut
 * d'une carte « En route », ou sur sa propre ligne au tableau. Il porte le jaune
 * du cadre de la carte (jeton `nouveau`, présent dans les douze palettes).
 */
export function BadgeDuService({ service }: { service: ServiceDeCarte }) {
  return (
    <Badge tone="service" className="shrink-0" data-badge-service={service}>
      {t(NOM_DU_SERVICE[service])}
    </Badge>
  );
}
