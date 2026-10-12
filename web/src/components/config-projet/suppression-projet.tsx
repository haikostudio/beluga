import * as React from 'react';
import { Archive, Loader2, Trash2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import type { ContexteConfig } from './communs';

/** Ce que le démon rend pour `project.apercuSuppression` (voir `server/src/suppression-projet.ts`). */
interface Apercu {
  depot?: string;
  dossier: string;
  dossierExiste: boolean;
  cartes: number;
  conversations: number;
  piecesJointes: number;
  miseEnLigne: number;
  refus?: string;
}

/**
 * LA SUPPRESSION DÉFINITIVE D'UN PROJET — TROIS VERROUS, DANS L'ORDRE.
 *
 * 1. « Mettre de côté » est proposé EN PREMIER, comme geste par défaut : il ne
 *    perd rien. 2. Les nombres réels de ce qui partirait sont lus au démon à
 *    l'ouverture. 3. Le bouton rouge reste éteint tant que le nom du projet n'est
 *    pas recopié à l'identique. Le démon refuse de toute façon un nom faux, un
 *    agent au travail ou une mise en ligne en cours : son refus s'affiche ici.
 */
export function SuppressionDefinitive({ ctx }: { ctx: ContexteConfig }) {
  const { project } = ctx;
  const [ouvert, setOuvert] = React.useState(false);
  const [apercu, setApercu] = React.useState<Apercu | null>(null);
  const [panne, setPanne] = React.useState('');
  const [saisie, setSaisie] = React.useState('');
  const [erreur, setErreur] = React.useState('');
  /*
   * LA SUPPRESSION EST LONGUE PAR NATURE (copie de secours des fichiers du
   * projet, GitHub, adresse, dossier) : le bouton porte SA propre attente, sans
   * l'avertissement commun « … prend plus de temps que prévu » qui faisait
   * recliquer. Pendant ce temps, rien ne ferme la fenêtre ni ne relance le geste.
   */
  const [enCours, setEnCours] = React.useState(false);

  React.useEffect(() => {
    if (!ouvert) return;
    setApercu(null);
    setPanne('');
    setSaisie('');
    setErreur('');
    let actif = true;
    client
      .call<Apercu>({ type: 'project.apercuSuppression', id: project.id })
      .then((lu) => actif && setApercu(lu))
      .catch((err: any) => actif && setPanne(err?.message ?? t('Impossible de lire ce qui serait effacé.')));
    return () => {
      actif = false;
    };
  }, [ouvert, project.id]);

  const nomRecopie = saisie === project.name;
  const bloque = !apercu || !!apercu.refus || !nomRecopie || enCours;

  const supprimer = async () => {
    if (enCours) return;
    setErreur('');
    setEnCours(true);
    try {
      // Vingt minutes : la copie de secours peut porter des vidéos de plusieurs gigaoctets.
      await client.call({ type: 'project.supprimerDefinitivement', id: project.id, nomConfirme: saisie }, 20 * 60 * 1000);
    } catch (err: any) {
      setErreur(err?.message ?? t('Suppression impossible'));
      setEnCours(false);
      return;
    }
    setEnCours(false);
    setOuvert(false);
    ctx.fermer();
  };

  return (
    <>
      <div className="rounded-md border border-border bg-bloc px-3 py-2.5">
        <p className="text-[13.5px] font-medium text-text">{t('Supprimer définitivement')}</p>
        <p className="mt-0.5 text-[13px] text-muted">
          {t('Efface le dépôt GitHub, le dossier du serveur et tout le projet dans l’application. Impossible à défaire.')}
        </p>
        <Button variant="ghost" size="sm" className="mt-2 text-danger hover:text-danger" data-supprimer-projet onClick={() => setOuvert(true)}>
          <Trash2 className="h-3 w-3" />
          {t('Supprimer définitivement…')}
        </Button>
      </div>

      <Dialog open={ouvert} onOpenChange={(suite) => !enCours && setOuvert(suite)}>
        <DialogContent adresse="suppression-projet" className="sm:w-[min(480px,100%)]" data-dialogue-suppression>
          <DialogHeader>
            <DialogTitle>{t('Supprimer définitivement « {nom} » ?', { nom: project.name })}</DialogTitle>
            <DialogDescription>{t('Une copie de secours du projet, avec ses fichiers, est gardée 15 jours.')}</DialogDescription>
          </DialogHeader>

          {!project.archived ? (
            <div className="mt-1 rounded-md bg-raised px-3 py-2.5">
              <p className="text-[13.5px] text-text">
                {t('Mettre de côté suffit souvent : le projet quitte la colonne de gauche sans rien perdre, et revient d’un clic.')}
              </p>
              <Button
                variant="default"
                size="sm"
                className="mt-2"
                data-dialogue-mettre-de-cote
                onClick={async () => {
                  await ctx.archiver();
                  setOuvert(false);
                }}
              >
                <Archive className="h-3 w-3" />
                {t('Mettre de côté')}
              </Button>
            </div>
          ) : null}

          <div className="mt-3 text-[13.5px] text-text" data-suppression-apercu>
            {panne ? <p className="text-danger">{panne}</p> : null}
            {!apercu && !panne ? <p className="text-muted">{t('Lecture de ce qui sera effacé…')}</p> : null}
            {apercu ? (
              <>
                <p className="font-medium">{t('Sera effacé pour toujours :')}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                  {apercu.depot ? <li className="break-all">{t('Le dépôt GitHub {depot}', { depot: apercu.depot })}</li> : null}
                  {apercu.dossierExiste ? <li className="break-all">{t('Le dossier du serveur {dossier}', { dossier: apercu.dossier })}</li> : null}
                  <li>
                    {t('Dans l’application — cartes : {cartes}, conversations : {conversations}, pièces jointes : {pieces}, mises en ligne : {mises}', {
                      cartes: apercu.cartes,
                      conversations: apercu.conversations,
                      pieces: apercu.piecesJointes,
                      mises: apercu.miseEnLigne,
                    })}
                  </li>
                </ul>
                {apercu.refus ? <p className="mt-2 text-danger" data-suppression-refus>{apercu.refus}</p> : null}
              </>
            ) : null}
          </div>

          <label className="mt-3 block text-[13.5px] text-text" htmlFor="suppression-nom">
            {t('Pour confirmer, recopiez le nom du projet : {nom}', { nom: project.name })}
          </label>
          <Input
            id="suppression-nom"
            data-suppression-nom
            className="mt-1"
            value={saisie}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t('Nom du projet')}
            onChange={(event) => setSaisie(event.target.value)}
          />
          {erreur ? <p className="mt-2 text-[13.5px] text-danger" data-suppression-erreur>{erreur}</p> : null}

          <DialogFooter className="mt-2">
            <Button variant="ghost" size="sm" disabled={enCours} onClick={() => setOuvert(false)}>
              {t('Annuler')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              sansAttente
              disabled={bloque}
              aria-busy={enCours || undefined}
              data-confirmer-suppression
              data-attente={enCours ? 'en-cours' : undefined}
              onClick={() => void supprimer()}
            >
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {enCours ? t('Suppression en cours…') : t('Supprimer pour toujours')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
