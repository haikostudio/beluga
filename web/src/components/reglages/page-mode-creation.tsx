import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { reglageCreation, type AffectationCreation, type ReglageCreation } from '@beluga/shared';
import { Button, Input, SelecteurTiroir, type OptionSelecteur } from '@/components/ui';
import { Champ } from '@/components/card-panel';
import { Groupe } from '@/components/reglages/communs';
import type { ProprietesReglages } from '@/components/reglages/page-agents';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

/**
 * LA RÉPARTITION DU MODE « CRÉATION » : qui écrit le texte, qui programme, qui
 * donne un avis, et combien d'avis par tour. C'est le SEUL endroit où elle se
 * règle — la barre d'écriture ne porte que la bascule (DEC-090).
 *
 * Les moteurs et leurs modèles viennent du catalogue réel (`state.engines`),
 * jamais d'une liste écrite ici. L'évaluation n'a rien à régler : elle revient
 * toujours au juge local, qui s'allume ou s'éteint dans « Juge rapide ».
 */

const SEPARATEUR = '|';

function valeurDe(affectation: AffectationCreation): string {
  return `${affectation.moteur}${SEPARATEUR}${affectation.modele ?? ''}`;
}

function affectationDe(valeur: string): AffectationCreation {
  const [moteur, modele] = valeur.split(SEPARATEUR);
  return {
    moteur: moteur as AffectationCreation['moteur'],
    ...(modele ? { modele } : {}),
  };
}

export function PageModeCreation({ settings, update }: ProprietesReglages) {
  const state = useApp();
  const reglage = reglageCreation(settings.creation);

  const options = React.useMemo<OptionSelecteur[]>(
    () =>
      (state.engines ?? [])
        .filter((engine) => engine.installed)
        .flatMap((engine) => [
          { valeur: `${engine.id}${SEPARATEUR}`, libelle: engine.label, detail: t('Modèle par défaut du moteur') },
          ...engine.models.map((modele) => ({
            valeur: `${engine.id}${SEPARATEUR}${modele.id}`,
            libelle: `${engine.label} · ${modele.label || modele.id}`,
          })),
        ]),
    [state.engines],
  );

  const enregistrer = (suite: ReglageCreation) => update({ creation: suite });

  return (
    <div className="space-y-6" data-reglages-mode-creation>
      <Groupe
        titre={t('Qui fait quoi')}
        aide={`${t(
          'Quand l’interrupteur « Création » est allumé sur une carte, l’agent confie chaque morceau au modèle réglé ici. Un moteur sans quota est contourné tout seul ; l’agent peut aussi vous proposer un autre modèle, pour une carte seulement.',
        )}\n\n${t('Évaluation : toujours le juge local, Laya, quand il est installé et allumé.')}`}
      >
        <Champ label={t('Texte')} aide={t('Rédaction, formulation, contenus.')}>
          <SelecteurTiroir
            valeur={valeurDe(reglage.texte)}
            options={options}
            titre={t('Texte')}
            repere="creation-texte"
            onChoisir={(valeur) => enregistrer({ ...reglage, texte: affectationDe(valeur) })}
          />
        </Champ>
        <Champ label={t('Code')} aide={t('Programmation.')}>
          <SelecteurTiroir
            valeur={valeurDe(reglage.code)}
            options={options}
            titre={t('Code')}
            repere="creation-code"
            onChoisir={(valeur) => enregistrer({ ...reglage, code: affectationDe(valeur) })}
          />
        </Champ>
      </Groupe>

      <Groupe
        titre={t('Avis complémentaires')}
        aide={t('Des regards neufs demandés à d’autres modèles du serveur, sur les choix qui comptent.')}
      >
        <div className="space-y-2">
          {reglage.avis.map((affectation, index) => (
            <div key={`${valeurDe(affectation)}-${index}`} className="flex items-center gap-2">
              <SelecteurTiroir
                className="min-w-0 flex-1"
                valeur={valeurDe(affectation)}
                options={options}
                titre={t('Avis complémentaires')}
                repere={`creation-avis-${index}`}
                onChoisir={(valeur) =>
                  enregistrer({
                    ...reglage,
                    avis: reglage.avis.map((a, i) => (i === index ? affectationDe(valeur) : a)),
                  })
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`retirer-avis-${index}`}
                onClick={() => enregistrer({ ...reglage, avis: reglage.avis.filter((_, i) => i !== index) })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            disabled={!options.length}
            onClick={() => enregistrer({ ...reglage, avis: [...reglage.avis, affectationDe(options[0]?.valeur ?? 'cursor|')] })}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('Ajouter un avis')}
          </Button>
        </div>
        <Champ
          label={t('Avis au plus, par tour')}
          aide={t('Chaque avis consomme le quota d’un autre compte. Zéro coupe les avis.')}
        >
          <Input
            type="number"
            min={0}
            max={10}
            defaultValue={reglage.plafondAvis}
            onBlur={(event) => {
              const lu = Math.round(Number(event.target.value));
              if (Number.isFinite(lu)) enregistrer({ ...reglage, plafondAvis: Math.min(10, Math.max(0, lu)) });
            }}
          />
        </Champ>
      </Groupe>
    </div>
  );
}
