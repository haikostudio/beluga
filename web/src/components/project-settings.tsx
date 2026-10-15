import * as React from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  Loader2,
  Rocket,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Project,
  RUBRIQUES_CONFIG_PROJET,
  RUBRIQUE_CONFIG_PAR_DEFAUT,
  rubriqueConnue,
  rubriqueDeConfig,
  normaliserPort,
  portDansLaPlage,
  projetQuiPorteLePort,
  ecrireServices,
} from '@beluga/shared';
import {
  Button,
  Dialog,
  DialogContentLibre,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ZoneDefilement,
} from '@/components/ui';
import { Filet } from '@/components/filet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { type ContexteConfig } from '@/components/config-projet/communs';
import { RubriqueGeneral } from '@/components/config-projet/page-general';
import { RubriqueDossiers } from '@/components/config-projet/page-dossiers';
import { RubriqueDeploiement } from '@/components/config-projet/page-deploiement';
import { RubriqueProduction } from '@/components/config-projet/page-production';
import { RubriqueRetrait } from '@/components/config-projet/page-retrait';

/* ------------------------------------------------------------------ */
/* CE QUE L'ÉCRAN AJOUTE AUX RUBRIQUES : une icône, un rendu            */
/* ------------------------------------------------------------------ */

/**
 * La liste des rubriques — clés, titres, ordre — vit dans le socle partagé
 * (`shared/src/config-projet-rubriques.ts`). Ici on ne pose que ce qui ne peut
 * pas y vivre : l'ICÔNE de chaque rubrique et le bloc qu'elle affiche.
 */
const RENDU_DES_RUBRIQUES: Record<
  string,
  { icone: React.ComponentType<{ className?: string }>; rendu: React.ComponentType<{ ctx: ContexteConfig }> }
> = {
  general: { icone: Settings2, rendu: RubriqueGeneral },
  dossiers: { icone: FolderGit2, rendu: RubriqueDossiers },
  deploiement: { icone: Rocket, rendu: RubriqueDeploiement },
  production: { icone: Upload, rendu: RubriqueProduction },
  retrait: { icone: Trash2, rendu: RubriqueRetrait },
};

/* ------------------------------------------------------------------ */
/* LA FENÊTRE : un menu à gauche, une rubrique à droite                 */
/* ------------------------------------------------------------------ */

/**
 * LA CONFIGURATION D'UN PROJET EST UNE FENÊTRE À RUBRIQUES, plus une colonne
 * de 1150 lignes à dérouler.
 *
 * C'était l'écran le plus dense de l'application : le nom, le moteur,
 * les dossiers, les copies de travail, le déploiement, les
 * adresses, les branches, la mise en production, le client, puis l'archivage
 * et la suppression, tout à la suite dans une seule colonne. Trouver un
 * réglage voulait dire tout parcourir.
 *
 * Même ossature que les réglages généraux : sur grand écran, le menu à gauche
 * et la rubrique choisie à droite, chacun dans sa propre `ZoneDefilement` ; sur
 * téléphone, le menu occupe l'écran et la rubrique le RECOUVRE, avec un bouton
 * de retour. Dans les deux cas, la rubrique qui retire le projet a son entrée
 * à part : un bouton rouge « Supprimer », tout en bas du menu.
 *
 * UN SEUL « ENREGISTRER », en pied de fenêtre : les champs vivent ici et
 * descendent dans les rubriques, qui affichent et modifient sans jamais
 * enregistrer elles-mêmes. Changer de rubrique ne perd donc rien, et rien ne
 * part avant le clic.
 */
export function ProjectSettings({
  project,
  open,
  onClose,
  rubrique,
  onRubrique,
}: {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  /** La rubrique demandée par l'adresse ; vide = la première du menu. */
  rubrique?: string;
  onRubrique?: (rubrique: string) => void;
}) {
  const state = useApp();
  const [saving, setSaving] = React.useState(false);

  const [name, setName] = React.useState('');
  /* La SEULE chose que le déploiement demande de régler : l'adresse de
     l'instance de dev, contrôlée à la fin de chaque déploiement. */
  const [devUrl, setDevUrl] = React.useState('');
  const [adresseProduction, setAdresseProduction] = React.useState('');
  /*
   * LES DEUX BRANCHES DE MISE EN LIGNE : où le déploiement fusionne, où la mise
   * en production fusionne. Vide = rien de choisi, et le comportement d'avant
   * s'applique (`shared/src/branche-de-publication.ts`). La liste proposée est
   * lue sur le DÉPÔT GITHUB du projet, jamais écrite à la main.
   */
  const [brancheDev, setBrancheDev] = React.useState('');
  const [brancheProduction, setBrancheProduction] = React.useState('');
  const [branches, setBranches] = React.useState<string[]>([]);
  const [branchesEnCours, setBranchesEnCours] = React.useState(false);
  const [branchesRaison, setBranchesRaison] = React.useState('');
  /*
   * LE DÉPLOIEMENT SE RÈGLE EN DEUX CHOIX, identiques pour tous les projets
   * (`shared/src/publication-simple.ts`) : la commande de mise à jour et le
   * service à relancer. La mise en production n'a AUCUN champ ici : son
   * processus est écrit par l'agent d'initialisation, jamais à la main.
   */
  const [commandeDeploiement, setCommandeDeploiement] = React.useState('');
  const [serviceDeploiement, setServiceDeploiement] = React.useState('');
  const [engine, setEngine] = React.useState<string>('claude');
  const [faviconEnCours, setFaviconEnCours] = React.useState(false);
  /* LA PORTE D'ENTRÉE FIXE DU PROJET (`shared/src/port-projet.ts`), en texte
     tant qu'on la saisit. Vide à l'enregistrement = le port est retiré. */
  const [port, setPort] = React.useState('');

  /* LA RUBRIQUE OUVERTE. Une rubrique INCONNUE — un vieux lien, une rubrique
     renommée — retombe sur la première et le DIT : un écran vide passerait
     pour une panne, alors que l'adresse est simplement périmée. */
  const [rubriqueInterne, setRubriqueInterne] = React.useState<string>(rubrique ?? RUBRIQUE_CONFIG_PAR_DEFAUT);
  React.useEffect(() => {
    if (rubrique) setRubriqueInterne(rubrique);
  }, [rubrique]);
  React.useEffect(() => {
    if (!open || !rubrique || rubriqueConnue(rubrique)) return;
    client.pushToast('warning', t('Cette rubrique n’existe plus : voici la première.'));
    setRubriqueInterne(RUBRIQUE_CONFIG_PAR_DEFAUT);
    onRubrique?.(RUBRIQUE_CONFIG_PAR_DEFAUT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rubrique]);
  const ouverte = rubriqueDeConfig(rubriqueInterne);

  /* SUR TÉLÉPHONE, une seule des deux colonnes est à l'écran : le menu, ou la
     rubrique. À l'ouverture on montre le MENU, sauf si l'adresse désignait
     déjà une rubrique précise. */
  const [rubriqueAuPremierPlan, setRubriqueAuPremierPlan] = React.useState(!!rubrique);
  React.useEffect(() => {
    if (!open) return;
    setRubriqueAuPremierPlan(!!rubrique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ouvrir = (cle: string) => {
    setRubriqueInterne(cle);
    setRubriqueAuPremierPlan(true);
    onRubrique?.(cle);
  };

  React.useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDevUrl(project.devUrl ?? '');
    setAdresseProduction(project.adresseProduction ?? '');
    setPort(project.port ? String(project.port) : '');
    setBrancheDev(project.branchesDePublication?.dev ?? '');
    setBrancheProduction(project.branchesDePublication?.production ?? '');
    setCommandeDeploiement(project.deploiement?.commande ?? '');
    setServiceDeploiement(project.deploiement?.service ?? '');
    setEngine(project.defaultEngine ?? 'claude');
  }, [project?.id, open]);


  /*
   * LES BRANCHES DU DÉPÔT, à l'ouverture de la fenêtre. Elles viennent de
   * GitHub par le serveur ; injoignable, on retombe sur les branches locales et
   * on le dit. Une liste vide ne bloque pas : le champ reste saisissable.
   */
  React.useEffect(() => {
    if (!open || !project) return;
    setBranchesEnCours(true);
    setBranchesRaison('');
    client
      .call<{ branches: string[]; source: string; raison?: string }>(
        { type: 'project.branches', id: project.id },
        60000,
      )
      .then((data) => {
        setBranches(data.branches ?? []);
        if (data.source === 'local') setBranchesRaison(t('Branches lues sur le serveur : GitHub n’a rien rendu.'));
        if (data.source === 'aucune') setBranchesRaison(t('Aucune branche lisible : ce projet n’a pas de dépôt joignable.'));
      })
      .catch(() => {
        setBranches([]);
        setBranchesRaison(t('Lecture des branches impossible.'));
      })
      .finally(() => setBranchesEnCours(false));
  }, [open, project?.id]);

  /*
   * TOUS les réglages internes sont posés PLUS HAUT, avant cette sortie : ils
   * doivent être déclarés dans le même ordre à chaque passage. Quand la fenêtre
   * était fermée (aucun projet) puis ouverte, les déclarer plus bas en ajoutait
   * plusieurs d'un coup — React arrêtait tout et l'écran devenait noir.
   */
  if (!project) return null;

  /* Le port saisi, lu avec la MÊME règle que le serveur : un autre projet qui
     le porte déjà se dit ici, avant l'enregistrement. */
  const portLu = port.trim() ? normaliserPort(port.trim()) : null;
  const portPartage = projetQuiPorteLePort(portLu, state.projects, project.id);
  const portHorsPlage = portLu !== null && !portDansLaPlage(portLu);

  const save = async () => {
    if (port.trim() && portLu === null) {
      client.pushToast('error', t('Port invalide : un nombre entier entre 1 et 65535.'));
      return;
    }
    setSaving(true);
    try {
      await client.call({
        type: 'project.update',
        id: project.id,
        patch: {
          name: name.trim() || project.name,
          defaultEngine: engine,
          devUrl: devUrl.trim() || undefined,
          adresseProduction: adresseProduction.trim() || undefined,
          /* `null`, et non `undefined` : seul lui RETIRE un port enregistré. */
          port: portLu,
          /* Les deux branches partent ensemble ; vides, elles ne sont pas
             enregistrées et le comportement par défaut reprend la main. */
          branchesDePublication: {
            dev: brancheDev.trim() || undefined,
            production: brancheProduction.trim() || undefined,
          },
          /* Le processus de mise en production n'est PAS envoyé : seul
             l'agent d'initialisation l'écrit. */
          deploiement: {
            commande: commandeDeploiement.trim() || undefined,
            service: ecrireServices(serviceDeploiement),
          },
        },
      });
      client.pushToast('success', t('Réglages du projet enregistrés'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const archiver = async () => {
    await client.call({ type: 'project.archive', id: project.id, archived: !project.archived });
    onClose();
  };

  const ctx: ContexteConfig = {
    project,
    open,
    saving,
    name,
    setName,
    engine,
    setEngine,
    devUrl,
    setDevUrl,
    adresseProduction,
    setAdresseProduction,
    port,
    setPort,
    portLu,
    portPartage,
    portHorsPlage,
    faviconEnCours,
    relancerFavicon: () => {
      setFaviconEnCours(true);
      client
        .call({ type: 'project.faviconRetry', id: project.id }, 15000)
        .catch(() => {})
        .finally(() => setFaviconEnCours(false));
    },
    brancheDev,
    setBrancheDev,
    commandeDeploiement,
    setCommandeDeploiement,
    serviceDeploiement,
    setServiceDeploiement,
    brancheProduction,
    setBrancheProduction,
    branches,
    branchesEnCours,
    branchesRaison,
    archiver,
    fermer: onClose,
  };

  const Rendu = RENDU_DES_RUBRIQUES[ouverte.cle]?.rendu;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContentLibre
        className="sm:w-[min(940px,100%)] sm:h-[min(680px,85dvh)] h-[88dvh]"
        data-config-projet={project.id}
      >
        <DialogHeader
          className="border-b border-border pb-2.5"
          /* Le retour n'existe QUE sur téléphone, et seulement quand la
             rubrique recouvre le menu : il prend la place de gauche, le titre
             reste au milieu. */
          gauche={
            rubriqueAuPremierPlan ? (
              <button
                type="button"
                data-retour-menu-config
                onClick={() => setRubriqueAuPremierPlan(false)}
                className="flex items-center gap-0.5 rounded p-1 text-muted hover:bg-raised hover:text-text sm:hidden"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="text-[13px]">{t('Configuration')}</span>
              </button>
            ) : null
          }
        >
          <DialogTitle className="min-w-0 truncate">
            <span className={cn(rubriqueAuPremierPlan && 'max-sm:hidden')}>{t('Configuration du projet')}</span>
            {rubriqueAuPremierPlan ? <span className="sm:hidden">{t(ouverte.titre)}</span> : null}
          </DialogTitle>
        </DialogHeader>

        <Filet zone="Réglages du projet" onReprendre={onClose}>
          <div className="flex min-h-0 flex-1">
            {/* ---------------------------- LE MENU ---------------------------- */}
            <nav
              data-menu-config
              className={cn(
                'flex min-h-0 w-full flex-col border-border sm:w-[236px] sm:shrink-0 sm:border-r',
                rubriqueAuPremierPlan && 'hidden sm:flex',
              )}
            >
              <ZoneDefilement className="px-2 py-2">
                <div className="space-y-0.5">
                  {RUBRIQUES_CONFIG_PROJET.filter((item) => !item.apart).map((item) => {
                    const Icone = RENDU_DES_RUBRIQUES[item.cle]?.icone;
                    return (
                      <button
                        key={item.cle}
                        type="button"
                        data-rubrique-config={item.cle}
                        data-actif={ouverte.cle === item.cle ? 'oui' : undefined}
                        onClick={() => ouvrir(item.cle)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px]',
                          /* SUR TÉLÉPHONE CE MENU EST UNE LISTE DE PAGES : aucune
                             n'est « choisie » tant qu'on ne l'a pas ouverte, et la
                             première ne se colore donc pas d'office. */
                          ouverte.cle === item.cle
                            ? 'text-muted sm:bg-raised sm:text-teinte'
                            : 'text-muted hover:bg-raised/60 hover:text-text',
                        )}
                      >
                        {Icone ? <Icone className="h-3.5 w-3.5 shrink-0 text-faint" /> : null}
                        <span className="min-w-0 flex-1 truncate">{t(item.titre)}</span>
                        <ChevronRight className="h-3 w-3 shrink-0 text-faint sm:hidden" />
                      </button>
                    );
                  })}
                </div>
              </ZoneDefilement>
              {/* LA RUBRIQUE ÉCARTÉE (retirer le projet) VIT TOUT EN BAS DU
                  MENU, sous la liste qui défile et hors d'elle : un bouton
                  PLEIN ROUGE, sans trait au-dessus — l'exception demandée à la
                  charte en noir et blanc, pour qu'on ne la confonde avec
                  aucune autre. Il OUVRE la rubrique, il ne supprime rien. Le
                  texte est BLANC dans les deux thèmes (`encre-fg`), comme
                  demandé : en sombre, où le rouge du thème est plus pâle, le
                  fond est foncé d'un cran (`dark:bg-danger/70`, posé sur le
                  fond de la fenêtre) pour que ce blanc s'y lise. */}
              <div className="shrink-0 space-y-1 px-2 pb-2 pt-1" data-menu-config-pied>
                {RUBRIQUES_CONFIG_PROJET.filter((item) => item.apart).map((item) => {
                  const Icone = RENDU_DES_RUBRIQUES[item.cle]?.icone;
                  return (
                    <button
                      key={item.cle}
                      type="button"
                      data-rubrique-config={item.cle}
                      data-rubrique-a-part
                      data-actif={ouverte.cle === item.cle ? 'oui' : undefined}
                      aria-current={ouverte.cle === item.cle ? 'page' : undefined}
                      onClick={() => ouvrir(item.cle)}
                      className="flex w-full items-center gap-2 rounded-md bg-danger px-2 py-1.5 text-left text-[13.5px] font-medium text-encre-fg transition-opacity hover:opacity-90 dark:bg-danger/70"
                    >
                      {Icone ? <Icone className="h-3.5 w-3.5 shrink-0" /> : null}
                      <span className="min-w-0 flex-1 truncate">{t(item.titre)}</span>
                      <ChevronRight className="h-3 w-3 shrink-0 sm:hidden" />
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* -------------------------- LA RUBRIQUE -------------------------- */}
            <section
              data-rubrique-ouverte={ouverte.cle}
              className={cn(
                'flex min-h-0 w-full flex-1 flex-col',
                !rubriqueAuPremierPlan && 'hidden sm:flex',
              )}
            >
              <ZoneDefilement fond="hsl(var(--surface))" data-fenetre-corps className="p-4">
                {Rendu ? <Rendu ctx={ctx} /> : null}
              </ZoneDefilement>
            </section>
          </div>
        </Filet>

        <DialogFooter data-pied-reglages-projet className="border-t border-border">
          <Button variant="subtle" size="sm" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="default" size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {t('Enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContentLibre>
    </Dialog>
  );
}
