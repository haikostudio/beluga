import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { PLAGE_PORTS_PROJETS, mentionBrancheParDefaut, mentionEcartAuSchema, zoneDesProjets } from '@beluga/shared';
import { FormulaireEnColonnes, Input, LigneFormulaire } from '@/components/ui';
import { t } from '@/lib/langue';
import { CLASSE_TITRE_DE_TEMPS, OuJEnSuis, ProcessusEnPlace } from './processus-en-place';
import { ChoixDeBranche, EcartAuSchema, Repli, TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LE DÉPLOIEMENT : rafraîchir la version de TRAVAIL de ce projet, sur CE
 * serveur. Tant qu'aucun processus propre au projet n'est écrit, le déroulé
 * commun s'applique (`shared/src/publication-simple.ts`), réglé par la
 * commande de mise à jour et les services à relancer. Depuis le 29/09/2026,
 * un agent de configuration peut écrire un processus propre au projet.
 *
 * LA RUBRIQUE SE LIT EN TROIS TEMPS, les mêmes que la mise en production
 * (11/10/2026) : où j'en suis (`OuJEnSuis` — une phrase, trois repères, le
 * bouton de l'agent), ce qui se passera au clic (`ProcessusEnPlace`), puis les
 * réglages. Seule l'ADRESSE reste à vue ; le port, la branche, la commande et
 * les services se rangent derrière « Réglages avancés », fermé par défaut.
 * Rangés ou non, tous les champs partent avec l'unique « Enregistrer » : ils
 * sont tenus par la coquille. Et un avertissement ne se range jamais — un port
 * partagé ou une branche hors schéma se lit sous le repli fermé.
 */
export function RubriqueDeploiement({ ctx }: { ctx: ContexteConfig }) {
  const [avances, setAvances] = React.useState(false);
  const conflitDePort = ctx.portPartage ? (
    <p className="text-[11.5px] leading-snug text-danger" data-port-conflit>
      {t('Le port {port} est aussi attribué au projet « {nom} » : deux projets ne peuvent pas écouter le même port.', {
        port: String(ctx.portLu),
        nom: ctx.portPartage.name,
      })}
    </p>
  ) : null;
  const brancheHorsSchema = !!mentionEcartAuSchema('dev', ctx.brancheDev);

  return (
    <div data-rubrique-contenu="deploiement" data-deploiement className="space-y-5">
      <TeteDeRubrique
        titre={t('Déploiement')}
        resume={t('Rafraîchir la version de travail de ce projet, sur ce serveur.')}
        aide={t('Déployer fusionne les branches des cartes, enregistre et envoie sur le dépôt, puis joue le processus propre au projet s’il en a un, sinon la commande de mise à jour et les services réglés ci-dessous. Rien de tout cela ne passe par un agent : chaque étape a une durée maximale, et une panne s’arrête net en disant pourquoi.')}
      />

      <OuJEnSuis projet={ctx.project} cible="dev" />

      <ProcessusEnPlace projet={ctx.project} cible="dev" branche={ctx.project.branchesDePublication?.dev} />

      <section className="space-y-3" data-reglages-de-l-etape="dev">
        <h3 className={CLASSE_TITRE_DE_TEMPS}>{t('Réglages')}</h3>

        <LigneFormulaire
          libelle={t('Adresse à contrôler')}
          aide={t('Elle est remplie toute seule à la création du projet, et se corrige ici à la main. Elle est ouverte à la fin de chaque déploiement : si elle ne répond pas, le déploiement est déclaré en échec. Laissée vide, aucune adresse n\'est contrôlée. Le bouton « Icône » relance la récupération du favicon de la colonne de gauche, sans attendre la révision automatique : sur cette adresse quand elle est remplie, et sinon dans le dépôt du projet (public/favicon.svg, favicon.ico…).')}
        >
          <div className="flex items-center gap-1.5">
            <Input
              value={ctx.devUrl}
              onChange={(event) => ctx.setDevUrl(event.target.value)}
              className="flex-1"
              data-url-dev
              placeholder={`https://mon-projet.${zoneDesProjets() || 'exemple.com'}`}
            />
            <button
              type="button"
              data-favicon-retry
              disabled={ctx.faviconEnCours}
              title={t('Aller rechercher l\'icône du site : sur cette adresse, ou dans le dépôt du projet')}
              onClick={ctx.relancerFavicon}
              className="flex shrink-0 items-center gap-1 rounded-md bg-raised px-2 py-1.5 text-[12.5px] text-text hover:bg-border disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${ctx.faviconEnCours ? 'animate-spin' : ''}`} />
              {t('Icône')}
            </button>
          </div>
        </LigneFormulaire>

        <Repli
          titre={t('Réglages avancés')}
          repere="reglages-avances"
          ouvert={avances}
          onBascule={() => setAvances((avant) => !avant)}
          avertissements={
            conflitDePort || brancheHorsSchema ? (
              <>
                {conflitDePort}
                <EcartAuSchema cible="dev" valeur={ctx.brancheDev} />
              </>
            ) : null
          }
        >
          <FormulaireEnColonnes>
            <LigneFormulaire
              libelle={t('Port du projet sur le serveur')}
              aide={t('La porte d’entrée fixe du projet : le port où son serveur écoute, et le premier que la publication interroge après le redémarrage. Attribué à la création, retrouvé tout seul pour les projets plus anciens.')}
              data-port-projet
            >
              <Input
                value={ctx.port}
                onChange={(event) => ctx.setPort(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="w-32"
                data-port-projet-champ
                placeholder={String(PLAGE_PORTS_PROJETS.min)}
              />
              {conflitDePort ??
                (ctx.portHorsPlage ? (
                  <p className="text-[11.5px] text-faint" data-port-hors-plage>
                    {t('Hors de la plage des projets ({min}-{max}) : vérifiez qu’aucun service voisin ne l’utilise.', {
                      min: String(PLAGE_PORTS_PROJETS.min),
                      max: String(PLAGE_PORTS_PROJETS.max),
                    })}
                  </p>
                ) : null)}
            </LigneFormulaire>

            <ChoixDeBranche
              repere="data-branche-dev"
              titre={t('Branche du déploiement')}
              cible="dev"
              valeur={ctx.brancheDev}
              onChange={ctx.setBrancheDev}
              branches={ctx.branches}
              enCours={ctx.branchesEnCours}
              raison={ctx.branchesRaison}
              mention={mentionBrancheParDefaut('dev', ctx.branches)}
            />

            <LigneFormulaire
              libelle={t('Commande de mise à jour')}
              aide={t('Lancée dans le dossier du projet après l’envoi : une construction, ou le script de mise à jour du projet. Dix minutes au plus. Vide : rien n’est lancé. Sautée quand seule la documentation a changé depuis le dernier déploiement.')}
              data-commande-deploiement
            >
              <Input
                value={ctx.commandeDeploiement}
                onChange={(event) => ctx.setCommandeDeploiement(event.target.value)}
                className="font-mono text-[13px]"
                data-commande-deploiement-champ
                placeholder="npm run build"
                disabled={ctx.saving}
              />
            </LigneFormulaire>

            <LigneFormulaire
              libelle={t('Services à relancer')}
              aide={t('Le ou les services système relancés à la fin, séparés par une espace ; on attend que le port du projet réponde (dix minutes au plus, le temps qu’un service qui construit au démarrage ait fini). Vide : rien n’est relancé.')}
              data-service-deploiement
            >
              <Input
                value={ctx.serviceDeploiement}
                onChange={(event) => ctx.setServiceDeploiement(event.target.value)}
                className="font-mono text-[13px]"
                data-service-deploiement-champ
                placeholder="autoproject-mon-projet"
                disabled={ctx.saving}
              />
            </LigneFormulaire>
          </FormulaireEnColonnes>
        </Repli>
      </section>
    </div>
  );
}
