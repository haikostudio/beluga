import * as React from 'react';
import { Rocket, Sparkles } from 'lucide-react';
import {
  CONSIGNE_MAX,
  ColonneConsigne,
  baseDeploiement,
  consigneDeploiement,
  ecrireBaseDeploiement,
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
 * Deux textes par colonne, conservés côte à côte :
 *  - la BASE, la procédure brute écrite à la main par l'utilisateur ;
 *  - la CONSIGNE, la version mise en forme que l'agent de déploiement recevra.
 *
 * Un bouton « Générer » confie la base à un agent (tour PAYANT) qui en rédige
 * une consigne claire. Le résultat s'affiche dans un champ MODIFIABLE : ce n'est
 * la consigne retenue qu'une fois « Enregistrer » cliqué. On peut ré-éditer la
 * base et relancer la génération autant qu'on veut.
 *
 * Écrire ne DÉCLENCHE rien : aucune publication ne part, et le mécanisme de mise
 * en ligne ne lit pas encore ces consignes de colonne. L'enregistrement passe
 * par la commande `project.update` déjà en place — pas un second chemin
 * d'écriture. Les règles sont pures (`shared/src/consigne-deploiement.ts`).
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
  const baseEnregistree = baseDeploiement(projet, colonne);
  const consigneEnregistree = consigneDeploiement(projet, colonne);

  const [base, setBase] = React.useState(baseEnregistree);
  const [consigne, setConsigne] = React.useState(consigneEnregistree);
  const [generation, setGeneration] = React.useState(false);
  const [enregistrement, setEnregistrement] = React.useState(false);

  /*
   * La saisie repart de ce qui est ENREGISTRÉ à chaque ouverture, et seulement
   * là : la recopier à chaque rendu effacerait ce qu'on est en train d'écrire
   * dès qu'un événement du serveur rafraîchit le projet.
   */
  React.useEffect(() => {
    if (open) {
      setBase(baseEnregistree);
      setConsigne(consigneEnregistree);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, colonne]);

  if (!projet) return null;

  const generer = async () => {
    if (!base.trim()) {
      client.pushToast('error', 'Écrivez d’abord la base de texte à mettre en forme.');
      return;
    }
    setGeneration(true);
    try {
      // Un tour d'agent peut être long : on laisse dix minutes.
      const res = await client.call<{ ok: boolean; consigne?: string; raison?: string }>(
        { type: 'consigne.generer', projectId: projet.id, colonne, base },
        600000,
      );
      if (res.ok && res.consigne) {
        setConsigne(res.consigne);
        client.pushToast('success', 'Consigne rédigée. Relisez-la, puis enregistrez.');
      } else {
        client.pushToast('error', res.raison ?? 'la génération n’a rien rendu');
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'génération impossible');
    } finally {
      setGeneration(false);
    }
  };

  const enregistrer = async () => {
    setEnregistrement(true);
    try {
      await client.call({
        type: 'project.update',
        id: projet.id,
        patch: {
          basesDeploiement: ecrireBaseDeploiement(projet.basesDeploiement, colonne, base),
          consignesDeploiement: ecrireConsigneDeploiement(
            projet.consignesDeploiement,
            colonne,
            consigne,
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

  const occupe = generation || enregistrement;

  return (
    <Dialog open={open} onOpenChange={(valeur) => !valeur && onClose()}>
      <DialogContent className="sm:w-[min(600px,100%)]" data-fenetre-consigne={colonne}>
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

            {/* La base brute : la procédure du projet dans ses propres mots. */}
            <div>
              <Label>Base de texte — votre procédure, dans vos mots</Label>
              <Textarea
                data-consigne-base
                value={base}
                maxLength={CONSIGNE_MAX}
                disabled={occupe}
                onChange={(event) => setBase(event.target.value)}
                placeholder={
                  'Décrivez, sans forcément soigner la formulation, ce qu’il faut faire pour déployer cette étape.\n' +
                  'Exemple : construire, arrêter le service, copier le dossier, redémarrer, contrôler l’adresse.\n' +
                  'Dites aussi ce qu’il ne faut PAS faire.'
                }
                className="mt-1 min-h-[130px]"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-[12.5px] leading-snug text-faint">
                  Générer confie cette base à un agent qui en rédige la consigne finale. C’est un tour
                  d’agent : cela consomme du quota.
                </p>
                <Button
                  data-generer-consigne
                  variant="subtle"
                  onClick={generer}
                  disabled={occupe || !base.trim()}
                  className="shrink-0 gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {generation ? 'Génération…' : 'Générer'}
                </Button>
              </div>
            </div>

            {/* La consigne finale : rédigée par l'agent, puis relue et modifiable. */}
            <div>
              <Label>Consigne donnée à l’agent de déploiement</Label>
              <Textarea
                data-consigne-deploiement
                value={consigne}
                maxLength={CONSIGNE_MAX}
                disabled={occupe}
                onChange={(event) => setConsigne(event.target.value)}
                placeholder={
                  generation
                    ? 'Rédaction en cours…'
                    : 'La consigne rédigée apparaîtra ici. Vous pouvez aussi l’écrire ou la corriger à la main.'
                }
                className="mt-1 min-h-[160px]"
              />
              <p className="mt-1 text-[12.5px] leading-snug text-faint">
                C’est ce texte qui est enregistré. Laissé vide, c’est le déroulé habituel qui
                s’applique. Cette consigne ne vaut que pour cette étape : l’autre colonne garde la
                sienne.
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={occupe}>
              Annuler
            </Button>
            <Button data-enregistrer-consigne onClick={enregistrer} disabled={occupe}>
              {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </Filet>
      </DialogContent>
    </Dialog>
  );
}
