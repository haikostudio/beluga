/**
 * MON PROFIL — CE QU'UN CLIENT CHANGE LUI-MÊME SUR SON PROPRE COMPTE.
 *
 * Son nom affiché, son adresse de courriel, son identifiant de connexion et
 * son mot de passe. Rien d'autre : ni sa portée, ni son rôle, ni sa suspension
 * — ce sont des décisions de Haiko, et les commandes qui les portent
 * (`comptes.*`) restent fermées au client.
 *
 * AUCUNE COMMANDE D'ICI NE NOMME UN COMPTE. Elles agissent toutes sur celui du
 * canal (`espace.moi.*`) : viser le voisin n'est pas « refusé », c'est
 * inécrivable.
 *
 * TROIS BLOCS, TROIS ENREGISTREMENTS SÉPARÉS. Le nom et l'adresse se changent
 * sans rien prouver ; l'identifiant et le mot de passe exigent le mot de passe
 * ACTUEL — un écran laissé ouvert ne doit pas suffire à s'emparer d'un compte.
 *
 * SANS CADRE NI TRAIT, comme la fiche d'une demande : la hiérarchie passe par
 * les fonds et les tons, jamais par une bordure.
 */
import * as React from 'react';
import { Loader2, X } from 'lucide-react';
import { BulleInfo, Button, DialogTitle, Drawer, Input, Label, ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { canalEspace } from './canal-espace';

interface MonProfil {
  id: string;
  identifiant: string;
  nomAffiche: string;
  courriel: string;
  apparence: string;
}

/** Un bloc de la fiche : un titre et son « i », des champs, un bouton. */
function Bloc({
  titre,
  aide,
  children,
  repere,
}: {
  titre: string;
  aide?: string;
  children: React.ReactNode;
  repere: string;
}) {
  return (
    <section className="flex flex-col gap-2 pt-1" data-bloc-profil={repere}>
      <div className="flex items-center gap-1">
        <h3 className="text-[12px] font-medium uppercase tracking-wide text-faint">{titre}</h3>
        {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
      </div>
      {children}
    </section>
  );
}

function Champ({
  libelle,
  ...props
}: { libelle: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[12px] text-muted">
        {libelle}
      </Label>
      <Input id={id} {...props} />
    </div>
  );
}

export function TiroirProfil({ onFermer }: { onFermer: () => void }) {
  const telephone = useTelephone();
  const [profil, setProfil] = React.useState<MonProfil | null>(null);
  const [nom, setNom] = React.useState('');
  const [courriel, setCourriel] = React.useState('');
  const [identifiant, setIdentifiant] = React.useState('');
  const [motDePasseIdentifiant, setMotDePasseIdentifiant] = React.useState('');
  const [actuel, setActuel] = React.useState('');
  const [nouveau, setNouveau] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  /** Le bloc en cours d'enregistrement : son bouton le dit dès le clic. */
  const [enCours, setEnCours] = React.useState<'profil' | 'identifiant' | 'motDePasse' | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [dit, setDit] = React.useState<string | null>(null);

  const poser = React.useCallback((fiche: MonProfil) => {
    setProfil(fiche);
    setNom(fiche.nomAffiche);
    setCourriel(fiche.courriel ?? '');
    setIdentifiant(fiche.identifiant);
  }, []);

  React.useEffect(() => {
    void canalEspace
      .demander({ type: 'espace.moi' })
      .then((reponse) => poser(reponse as MonProfil))
      .catch((err) => setErreur(err?.message ?? t('Votre profil n’a pas pu être lu.')));
  }, [poser]);

  const lancer = async (quoi: 'profil' | 'identifiant' | 'motDePasse', geste: () => Promise<void>) => {
    setEnCours(quoi);
    setErreur(null);
    setDit(null);
    try {
      await geste();
    } catch (err: any) {
      setErreur(err?.message ?? t('Cette modification n’a pas pu être enregistrée.'));
    } finally {
      setEnCours(null);
    }
  };

  const enregistrerLeProfil = () =>
    lancer('profil', async () => {
      const reponse = await canalEspace.demander({
        type: 'espace.moi.profil',
        nomAffiche: nom,
        courriel,
      });
      poser(reponse as MonProfil);
      setDit(t('Vos informations sont enregistrées.'));
    });

  const enregistrerLIdentifiant = () =>
    lancer('identifiant', async () => {
      const reponse = await canalEspace.demander({
        type: 'espace.moi.identifiant',
        identifiant,
        motDePasse: motDePasseIdentifiant,
      });
      poser(reponse as MonProfil);
      setMotDePasseIdentifiant('');
      setDit(t('Votre identifiant de connexion est changé. Votre session reste ouverte.'));
    });

  const changerLeMotDePasse = () =>
    lancer('motDePasse', async () => {
      if (nouveau !== confirmation) throw new Error(t('Les deux mots de passe ne sont pas les mêmes.'));
      await canalEspace.demander({ type: 'espace.moi.motDePasse', actuel, nouveau });
      setActuel('');
      setNouveau('');
      setConfirmation('');
      setDit(t('Mot de passe changé. Vous allez être invité à vous reconnecter.'));
      /*
       * TOUTES LES SESSIONS TOMBENT, LA SIENNE COMPRISE — c'est ce qu'on attend
       * d'un changement de mot de passe. On le DIT, puis on renvoie à la porte :
       * personne ne se retrouve dehors sans explication.
       */
      window.setTimeout(() => {
        window.location.href = '/auth/logout';
      }, 1800);
    });

  const rienNAChange =
    profil !== null && nom.trim() === profil.nomAffiche && courriel.trim() === (profil.courriel ?? '');

  return (
    <Drawer open onClose={onFermer} plein={telephone}>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-profil data-profil-charge={profil ? '' : undefined}>
        <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Mon profil')}</DialogTitle>
          <Button size="icon-sm" variant="ghost" onClick={onFermer} title={t('Fermer')} data-fermer-profil>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {erreur ? (
          <div className="shrink-0 px-3 pb-1.5 text-xs text-danger" data-erreur-profil>
            {erreur}
          </div>
        ) : null}
        {dit ? (
          <div className="shrink-0 px-3 pb-1.5 text-xs text-success" data-dit-profil>
            {dit}
          </div>
        ) : null}

        {!profil ? (
          /* UNE ZONE QUI N'A PAS ENCORE SES DONNÉES MONTRE UNE SILHOUETTE. */
          <div className="flex flex-col gap-2 px-3" aria-hidden data-silhouette-profil>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-md bg-raised" />
            ))}
          </div>
        ) : (
          <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 space-y-4 px-3 pb-3">
            <Bloc
              repere="informations"
              titre={t('Vos informations')}
              aide={t('Le nom que voit Haiko sous vos messages, et l’adresse où vous prévenir.')}
            >
              <Champ
                libelle={t('Nom affiché')}
                value={nom}
                onChange={(event) => setNom(event.target.value)}
                data-champ-nom-profil
              />
              <Champ
                libelle={t('Adresse de courriel')}
                type="email"
                autoComplete="email"
                value={courriel}
                onChange={(event) => setCourriel(event.target.value)}
                placeholder={t('Vide : ne rien vous envoyer')}
                data-champ-courriel-profil
              />
              <Button
                size="sm"
                className="self-start"
                disabled={enCours !== null || rienNAChange}
                onClick={enregistrerLeProfil}
                data-enregistrer-profil
              >
                {enCours === 'profil' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('Enregistrer')}
              </Button>
            </Bloc>

            <Bloc
              repere="identifiant"
              titre={t('Identifiant de connexion')}
              aide={t('Ce que vous tapez pour entrer. Votre mot de passe actuel est demandé, et votre session reste ouverte.')}
            >
              <Champ
                libelle={t('Identifiant')}
                autoComplete="username"
                value={identifiant}
                onChange={(event) => setIdentifiant(event.target.value)}
                data-champ-identifiant-profil
              />
              <Champ
                libelle={t('Mot de passe actuel')}
                type="password"
                autoComplete="current-password"
                value={motDePasseIdentifiant}
                onChange={(event) => setMotDePasseIdentifiant(event.target.value)}
                data-champ-mot-de-passe-identifiant
              />
              <Button
                size="sm"
                className="self-start"
                disabled={
                  enCours !== null ||
                  !motDePasseIdentifiant ||
                  identifiant.trim().toLowerCase() === profil.identifiant
                }
                onClick={enregistrerLIdentifiant}
                data-enregistrer-identifiant
              >
                {enCours === 'identifiant' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('Changer mon identifiant')}
              </Button>
            </Bloc>

            <Bloc
              repere="mot-de-passe"
              titre={t('Mot de passe')}
              aide={t('En le changeant, tous vos appareils déjà connectés devront entrer à nouveau.')}
            >
              <Champ
                libelle={t('Mot de passe actuel')}
                type="password"
                autoComplete="current-password"
                value={actuel}
                onChange={(event) => setActuel(event.target.value)}
                data-champ-mot-de-passe-actuel
              />
              <Champ
                libelle={t('Nouveau mot de passe')}
                type="password"
                autoComplete="new-password"
                value={nouveau}
                onChange={(event) => setNouveau(event.target.value)}
                data-champ-mot-de-passe-nouveau
              />
              <Champ
                libelle={t('Répétez le nouveau mot de passe')}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                data-champ-mot-de-passe-confirmation
              />
              <Button
                size="sm"
                className="self-start"
                disabled={enCours !== null || !actuel || !nouveau || !confirmation}
                onClick={changerLeMotDePasse}
                data-changer-mot-de-passe
              >
                {enCours === 'motDePasse' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('Changer mon mot de passe')}
              </Button>
            </Bloc>
          </ZoneDefilement>
        )}
      </div>
    </Drawer>
  );
}
