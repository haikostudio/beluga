import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * COPIER UN DOCUMENT ENTIER dans le presse-papiers (le cahier des charges, le
 * cahier de réalisation), à côté du bouton « Télécharger ». Le bouton coche un
 * court instant ; un presse-papiers refusé (page non sécurisée) passe par un
 * champ caché.
 */
export function BoutonCopierDocument({ texte, repere }: { texte: string; repere: string }) {
  const [copie, setCopie] = React.useState(false);
  const minuterie = React.useRef<number>();
  React.useEffect(() => () => window.clearTimeout(minuterie.current), []);
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
    window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => setCopie(false), 1800);
  };
  return (
    <Button
      size="icon"
      variant="ghost"
      className="shrink-0"
      title={copie ? t('Copié') : t('Copier le document')}
      aria-label="Copier le document"
      onClick={() => void copier()}
      {...{ [repere]: '' }}
    >
      {copie ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}
