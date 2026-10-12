import { Check } from 'lucide-react';
import { LANGUES } from '@beluga/shared';
import { CLASSE_GROUPE_DE_LIGNES, CLASSE_LIGNE_DE_GROUPE } from '@/components/ui';
import { Groupe } from '@/components/reglages/communs';
import { t, useLangueGenerale } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LA LANGUE DE L'INTERFACE. Elle vivait dans le menu « … » de la barre
 * d'en-tête, qu'on n'a pas sous la main sur tous les écrans : un réglage
 * GÉNÉRAL se range dans cette fenêtre, atteinte de partout.
 *
 * Le nom d'une langue est écrit DANS cette langue (« Deutsch », « 中文 ») et ne
 * passe donc PAS par le dictionnaire — c'est ce qui permet de retrouver la
 * sienne quand l'écran est dans une langue qu'on ne lit pas. La langue retenue
 * s'écrit en violet, avec sa coche.
 */
export function SectionLangue() {
  const [langue, setLangue] = useLangueGenerale();
  return (
    <Groupe titre={t('Langue')}>
      <div className={CLASSE_GROUPE_DE_LIGNES} role="radiogroup" aria-label="Langue" data-langue-menu>
        {LANGUES.map((item) => {
          const retenue = item.id === langue;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={retenue}
              onClick={() => setLangue(item.id)}
              data-langue-choix={item.id}
              className={cn(
                CLASSE_LIGNE_DE_GROUPE,
                'flex w-full items-center gap-2 text-[14px]',
                retenue ? 'text-teinte' : 'text-text',
              )}
            >
              <span className="min-w-0 flex-1 truncate" lang={item.etiquette}>
                {item.libelle}
              </span>
              {retenue ? <Check className="h-4 w-4 shrink-0" /> : null}
            </button>
          );
        })}
      </div>
    </Groupe>
  );
}
