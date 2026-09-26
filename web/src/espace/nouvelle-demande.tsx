/**
 * DÉPOSER UNE DEMANDE — DANS LE TIROIR DE L'APPLICATION.
 *
 * UNE DEMANDE NEUVE PART D'UN MODÈLE. « Ça marche pas » et une anomalie qu'on
 * peut reproduire ne coûtent pas le même travail : le modèle pose une trame de
 * description et, s'il y a lieu, ses cases à cocher. La page blanche
 * reste possible — c'est un modèle comme un autre.
 *
 * Ce n'était pas un tiroir mais une FENÊTRE centrée : sur téléphone elle
 * couvrait l'écran sans dire d'où elle venait, et sur ordinateur elle coupait
 * le tableau. Elle emploie maintenant le `Drawer` de la maison, celui des
 * réglages de l'agent — un seul geste à apprendre, partout.
 *
 * ET LE FORMULAIRE PORTE LES MÊMES OPTIONS QUE LA FICHE, par le même accordéon
 * et dans le même bloc replié : importance, échéance, étiquettes. Il n'y avait ici qu'un rang de boutons
 * d'importance — poser une date ou une étiquette obligeait à créer la demande,
 * la rouvrir, puis la remplir. Le serveur, lui, acceptait déjà tout cela au
 * dépôt.
 */
import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button, DialogFooter, DialogTitle, Drawer, Input, Textarea, ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';
import {
  MODELES_DEMANDE,
  type ModeleDeDemande,
} from '@beluga/shared';
import { canalEspace } from './canal-espace';
import { OptionsDemande, type ValeursDOptions } from './options-demande';
import { BlocDeFiche } from './bloc-de-fiche';
import { BoutonJoindre, EnvoisEnCours, PiecesDeposees, useEnvois } from './pieces';

export function NouvelleDemande({
  projectId,
  onFerme,
  onCreee,
}: {
  projectId: string;
  onFerme: () => void;
  onCreee: () => void;
}) {
  const [modele, setModele] = React.useState<ModeleDeDemande | null>(null);
  const [titre, setTitre] = React.useState('');
  const [description, setDescription] = React.useState('');
  /*
   * LES OPTIONS VIVENT ICI JUSQU'AU DÉPÔT. Rien ne part au serveur avant le
   * clic sur « Créer la demande » : une demande à moitié écrite n'existe pas.
   */
  const [options, setOptions] = React.useState<ValeursDOptions>({
    importance: 'normale',
    echeance: null,
    etiquettes: [],
  });
  const [erreur, setErreur] = React.useState<string | null>(null);
  const envois = useEnvois(projectId);

  /** Le modèle POSE les options — il ne les fige pas : tout reste modifiable. */
  const choisir = (choix: ModeleDeDemande) => {
    setModele(choix);
    setDescription(choix.description);
    setOptions((avant) => ({
      ...avant,
      importance: choix.importance,
    }));
  };

  const creer = async () => {
    setErreur(null);
    try {
      await canalEspace.demander({
        type: 'espace.demande.creer',
        projectId,
        titre,
        description,
        importance: options.importance,
        etiquettes: options.etiquettes,
        echeance: options.echeance ?? undefined,
        taches: (modele?.taches ?? []).map((texte, i) => ({ id: `t${i}`, texte, faite: false })),
        fichiers: envois.pieces.map((p) => p.id),
      });
      onCreee();
      onFerme();
    } catch (err: any) {
      setErreur(err?.message ?? t('La demande n’a pas pu être créée.'));
    }
  };

  return (
    <Drawer open onClose={onFerme} className="max-h-[86dvh]">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <DialogTitle className="min-w-0 flex-1 truncate">
          {modele ? t(modele.nom) : t('Nouvelle demande')}
        </DialogTitle>
      </header>
      <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 px-3 pb-4">
        {!modele ? (
          <div className="flex flex-col gap-1.5" data-choix-modele>
            <p className="text-xs text-muted">{t('De quoi s’agit-il ?')}</p>
            {MODELES_DEMANDE.map((choix) => (
              <Button
                key={choix.id}
                variant="outline"
                className="justify-start"
                onClick={() => choisir(choix)}
                data-modele={choix.id}
              >
                {t(choix.nom)}
              </Button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-formulaire-demande data-modele-retenu={modele.id}>
            <Input
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              placeholder={t('Titre de la demande')}
              data-champ-titre
              autoFocus
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('Décrivez ce dont vous avez besoin…')}
              rows={7}
              data-champ-description
            />
            {/*
             * LES MÊMES OPTIONS QUE LA FICHE, DANS LE MÊME BLOC REPLIÉ. Les
             * quatre sections s'affichaient ici À NU, sous la description :
             * une liste de traits qui reléguait les pièces jointes et le
             * bouton « Créer la demande » hors de l'écran, pour des réglages
             * dont la plupart des dépôts n'ont pas besoin. Elles tiennent
             * maintenant sur UNE ligne à chevron, exactement comme dans la
             * fiche — un seul geste à apprendre pour les deux tiroirs.
             */}
            <BlocDeFiche
              repere="options-creation"
              icone={<SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />}
              titre={t('Options')}
              attributs={{ 'data-bloc-options-creation': '' }}
            >
              <OptionsDemande
                valeurs={options}
                onChanger={(patch) =>
                  setOptions((avant) => ({
                    ...avant,
                    ...(patch.importance !== undefined ? { importance: patch.importance } : {}),
                    ...(patch.echeance !== undefined ? { echeance: patch.echeance } : {}),
                    ...(patch.etiquettes !== undefined ? { etiquettes: patch.etiquettes } : {}),
                  }))
                }
                avecLivraison={false}
                repere="creation"
              />
            </BlocDeFiche>
            <EnvoisEnCours envois={envois.envois} onReprendre={envois.reprendre} onOublier={envois.oublier} />
            <PiecesDeposees pieces={envois.pieces} onRetirer={envois.retirerPiece} />
            {erreur ? <div className="text-xs text-danger">{erreur}</div> : null}
          </div>
        )}
      </ZoneDefilement>
      {modele ? (
        /* Le tiroir réserve déjà la zone sûre du bas : le pied ne la recompte pas. */
        <DialogFooter className="justify-between gap-2 px-3 pt-2" style={{ paddingBottom: '12px' }}>
          <BoutonJoindre onFichiers={envois.ajouter} />
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setModele(null)}>
              {t('Changer de modèle')}
            </Button>
            <Button onClick={creer} disabled={!titre.trim() || envois.occupe} data-creer-demande>
              {t('Créer la demande')}
            </Button>
          </div>
        </DialogFooter>
      ) : null}
    </Drawer>
  );
}
