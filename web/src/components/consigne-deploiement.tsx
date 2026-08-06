import * as React from 'react';
import { Rocket } from 'lucide-react';
import {
  CONSIGNE_MAX,
  ColonneConsigne,
  consigneDeploiement,
  ecrireConsigneDeploiement,
  rappelDeConsigne,
  titreDeConsigne,
} from '@haikodev/shared';
import { Button, Dialog, DialogContent, DialogTitle, Label, Textarea } from '@/components/ui';
import { Filet } from '@/components/filet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

/**
 * La fenêtre qui règle le DÉROULÉ de déploiement d'une étape.
 *
 * On y écrit, en texte libre, la consigne que l'agent de déploiement recevra :
 * quoi faire, dans quel ordre, ce qu'il ne doit pas faire. Une consigne par
 * étape et par colonne, indépendantes l'une de l'autre — les règles sont pures
 * (`shared/src/consigne-deploiement.ts`), ici on ne fait que saisir.
 *
 * Écrire la consigne ne DÉCLENCHE rien : aucune publication ne part, et le
 * mécanisme de mise en ligne ne la lit pas encore. C'est un réglage du projet,
 * enregistré par la commande `project.update` déjà en place — pas un second
 * chemin d'écriture.
 *
 * Sur téléphone, `DialogContent` est déjà un tiroir bas : rien à faire ici.
 */
export function FenetreConsigneDeploiement({
  projectId,
  colonne,
  open,
  onClose,
}: {
  projectId: string;
  colonne: ColonneConsigne;
  open: boolean;
  onClose: () => void;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const enregistree = consigneDeploiement(projet, colonne);

  const [texte, setTexte] = React.useState(enregistree);
  const [enregistrement, setEnregistrement] = React.useState(false);

  /*
   * La saisie repart de ce qui est ENREGISTRÉ à chaque ouverture, et seulement
   * là : la recopier à chaque rendu effacerait ce qu'on est en train d'écrire
   * dès qu'un événement du serveur rafraîchit le projet.
   */
  React.useEffect(() => {
    if (open) setTexte(enregistree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, colonne]);

  if (!projet) return null;

  const enregistrer = async () => {
    setEnregistrement(true);
    try {
      await client.call({
        type: 'project.update',
        id: projet.id,
        patch: {
          consignesDeploiement: ecrireConsigneDeploiement(
            projet.consignesDeploiement,
            colonne,
            texte,
          ),
        },
      });
      client.pushToast('success', 'Consigne de déploiement enregistrée');
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'enregistrement impossible');
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(valeur) => !valeur && onClose()}>
      <DialogContent className="sm:w-[min(560px,100%)]" data-fenetre-consigne={colonne}>
        <DialogTitle>{titreDeConsigne(colonne)}</DialogTitle>
        <Filet zone="Consigne de déploiement" onReprendre={onClose}>
          <div className="mt-3 space-y-3">
            {/* Ce qui est déjà connu du projet, pour ne pas écrire à l'aveugle. */}
            <p
              data-rappel-consigne
              className="flex items-start gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 text-[12.5px] leading-snug text-faint"
            >
              <Rocket className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{rappelDeConsigne(projet)}</span>
            </p>

            <div>
              <Label>Consigne donnée à l’agent de déploiement</Label>
              <Textarea
                data-consigne-deploiement
                value={texte}
                maxLength={CONSIGNE_MAX}
                onChange={(event) => setTexte(event.target.value)}
                placeholder={
                  'Ce qu’il faut faire pour déployer cette étape, dans l’ordre.\n' +
                  'Exemple : construire, arrêter le service, copier le dossier, redémarrer, contrôler l’adresse.\n' +
                  'Dites aussi ce qu’il ne faut PAS faire.'
                }
                className="mt-1 min-h-[180px]"
              />
              <p className="mt-1 text-[12.5px] leading-snug text-faint">
                Laissée vide, c’est le déroulé habituel qui s’applique. Cette consigne ne vaut que
                pour cette étape : l’autre colonne garde la sienne.
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button data-enregistrer-consigne onClick={enregistrer} disabled={enregistrement}>
              {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </Filet>
      </DialogContent>
    </Dialog>
  );
}
