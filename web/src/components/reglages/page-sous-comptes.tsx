import * as React from 'react';
import { KeyRound, Loader2, Plus, ShieldOff, UserPlus } from 'lucide-react';
import {
  ROLES_CREABLES,
  aideDuRole,
  etatDuCompteEnClair,
  jugerIdentifiant,
  libelleDuRole,
  nomDuCompte,
  type CompteUtilisateur,
  type RoleCompte,
} from '@beluga/shared';
import { Button, ConfirmDialog, Input, ListeDeroulante, Switch } from '@/components/ui';
import { Groupe } from '@/components/reglages/communs';
import {
  MotDePasseMontre,
  PastillesDeProjets,
  optionsDesProjets,
  type SecretMontre,
} from '@/components/reglages/comptes-clients';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn, relativeTime } from '@/lib/utils';

/**
 * LES SOUS-COMPTES : les accès que l'administrateur ouvre à d'autres personnes,
 * chacun avec un NIVEAU — membre, lecteur ou client — et les projets qu'il a le
 * droit de voir. Les droits de chaque niveau se décident au serveur
 * (`shared/src/droits-commandes.ts`) ; cet écran ne fait que les nommer.
 *
 * Rien n'est caché ici : un membre ou un lecteur n'a pas cette page (les
 * réglages ne lui montrent que « Mon compte »), et toutes les commandes
 * `comptes.*` lui sont fermées.
 */

type NiveauCreable = Exclude<RoleCompte, 'admin'>;

/** Les trois niveaux en boutons côte à côte, et la phrase qui dit ce que permet celui qui est choisi. */
function ChoixDuNiveau({
  valeur,
  onChoisir,
  repere,
  desactive,
}: {
  valeur: NiveauCreable;
  onChoisir: (niveau: NiveauCreable) => void;
  repere: string;
  desactive?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1" data-choix-niveau={repere}>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Niveau">
        {ROLES_CREABLES.map((niveau) => (
          <Button
            key={niveau}
            type="button"
            size="sm"
            variant="ghost"
            role="radio"
            aria-checked={valeur === niveau}
            disabled={desactive}
            onClick={() => valeur !== niveau && onChoisir(niveau)}
            className={cn('h-7 px-2.5 text-[12.5px]', valeur === niveau ? 'bg-raised text-text' : 'text-muted')}
            data-niveau={niveau}
          >
            {t(libelleDuRole(niveau))}
          </Button>
        ))}
      </div>
      <p className="text-[12px] leading-snug text-faint">{t(aideDuRole(valeur))}</p>
    </div>
  );
}

function FormulaireSousCompte({
  onCree,
}: {
  onCree: (secret: SecretMontre, niveau: NiveauCreable) => void;
}) {
  const state = useApp();
  const [identifiant, setIdentifiant] = React.useState('');
  const [nomAffiche, setNomAffiche] = React.useState('');
  const [courriel, setCourriel] = React.useState('');
  const [niveau, setNiveau] = React.useState<NiveauCreable>('membre');
  const [projets, setProjets] = React.useState<string[]>([]);
  const [enCours, setEnCours] = React.useState(false);

  const basculer = (id: string) =>
    setProjets((liste) => (liste.includes(id) ? liste.filter((p) => p !== id) : [...liste, id]));

  const creer = async () => {
    const juge = jugerIdentifiant(identifiant);
    if (!juge.ok) {
      client.pushToast('error', juge.raison!);
      return;
    }
    setEnCours(true);
    try {
      const data = await client.call<{ compte: CompteUtilisateur; motDePasse: string }>({
        type: 'comptes.creer',
        identifiant,
        nomAffiche,
        role: niveau,
        projets,
        courriel: courriel.trim() || undefined,
      });
      onCree({ nom: nomDuCompte(data.compte), identifiant: data.compte.identifiant, valeur: data.motDePasse }, niveau);
      setIdentifiant('');
      setNomAffiche('');
      setCourriel('');
      setProjets([]);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('accès non créé'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface p-3" data-formulaire-sous-compte>
      <div className="flex items-center gap-2 text-[13px] font-medium text-text">
        <UserPlus className="h-4 w-4" />
        {t('Ouvrir un accès')}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} placeholder={t('Identifiant')} data-champ-identifiant />
        <Input value={nomAffiche} onChange={(e) => setNomAffiche(e.target.value)} placeholder={t('Nom affiché')} data-champ-nom />
      </div>
      <Input
        type="email"
        value={courriel}
        onChange={(e) => setCourriel(e.target.value)}
        placeholder={t('Adresse de courriel (facultative)')}
      />
      <ChoixDuNiveau valeur={niveau} onChoisir={setNiveau} repere="creation" />
      <div className="flex flex-col gap-1.5" data-choix-projets={projets.join(',')}>
        <ListeDeroulante
          valeur=""
          valeurs={projets}
          options={optionsDesProjets(state.projects)}
          onChoisir={basculer}
          titre={t('Projets ouverts')}
          placeholder={t('Choisir les projets')}
          repere="projets-sous-compte"
          empile
        />
        <PastillesDeProjets ids={projets} onRetirer={basculer} attributs={(id) => ({ 'data-projet': id })} />
      </div>
      <div className="flex justify-end">
        <Button onClick={creer} disabled={enCours || !identifiant.trim()} data-creer-sous-compte>
          {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('Créer l’accès')}
        </Button>
      </div>
    </div>
  );
}

function LigneSousCompte({
  compte,
  onChangement,
  onSecret,
  onRetirer,
}: {
  compte: CompteUtilisateur;
  onChangement: () => void;
  onSecret: (secret: SecretMontre) => void;
  onRetirer: (compte: CompteUtilisateur) => void;
}) {
  const state = useApp();
  const [portee, setPortee] = React.useState(compte.projets);
  const porteeServeur = compte.projets.join(',');
  React.useEffect(() => setPortee(compte.projets), [porteeServeur]);

  const echec = (defaut: string) => (err: any) => {
    client.pushToast('error', err?.message ?? defaut);
    onChangement();
  };
  const changerPortee = (id: string) => {
    const suite = portee.includes(id) ? portee.filter((p) => p !== id) : [...portee, id];
    setPortee(suite);
    void client.call({ type: 'comptes.portee', id: compte.id, projets: suite }).then(onChangement).catch(echec(t('portée non changée')));
  };
  const changerNiveau = (role: NiveauCreable) =>
    void client.call({ type: 'comptes.niveau', id: compte.id, role }).then(onChangement).catch(echec(t('niveau non changé')));
  const suspendre = (suspendu: boolean) =>
    void client.call({ type: 'comptes.suspendre', id: compte.id, suspendu }).then(onChangement).catch(echec(t('état non changé')));
  const nouveauMotDePasse = () =>
    void client
      .call<{ motDePasse: string }>({ type: 'comptes.motDePasse', id: compte.id })
      .then((data) => {
        onSecret({ nom: nomDuCompte(compte), identifiant: compte.identifiant, valeur: data.motDePasse });
        onChangement();
      })
      .catch(echec(t('mot de passe non changé')));

  return (
    <div className="rounded-md bg-surface p-3" data-sous-compte={compte.id} data-niveau-du-compte={compte.role} data-acces-actif={compte.actif ? 'oui' : 'non'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-text">{nomDuCompte(compte)}</div>
          <div className="text-xs text-muted">
            {compte.identifiant} · {t(etatDuCompteEnClair(compte))}
            {compte.derniereEntree ? ` · ${relativeTime(compte.derniereEntree)}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Switch checked={compte.actif} onCheckedChange={(actif) => suspendre(!actif)} data-suspendre={compte.id} />
          <Button size="sm" variant="ghost" onClick={nouveauMotDePasse} data-reinitialiser={compte.id}>
            <KeyRound className="h-3.5 w-3.5" />
            {t('Nouveau mot de passe')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRetirer(compte)} data-retirer={compte.id}>
            <ShieldOff className="h-3.5 w-3.5" />
            {t('Retirer')}
          </Button>
        </div>
      </div>
      <div className="mt-2">
        <ChoixDuNiveau
          valeur={compte.role === 'admin' ? 'membre' : (compte.role as NiveauCreable)}
          onChoisir={changerNiveau}
          repere={compte.id}
          desactive={compte.role === 'admin'}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-portee-acces={portee.join(',')}>
        <PastillesDeProjets ids={portee} onRetirer={changerPortee} attributs={(id) => ({ 'data-portee': id })} />
        <ListeDeroulante
          valeur=""
          valeurs={portee}
          options={optionsDesProjets(state.projects)}
          onChoisir={changerPortee}
          titre={t('Projets ouverts')}
          repere={`portee-${compte.id}`}
          empile
          declencheur={(ouvrir) => (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[12px] text-muted" onClick={ouvrir} data-modifier-portee={compte.id}>
              <Plus className="h-3 w-3" />
              {t('Projets')}
            </Button>
          )}
        />
      </div>
    </div>
  );
}

export function PageSousComptes() {
  const [comptes, setComptes] = React.useState<CompteUtilisateur[] | null>(null);
  const [secret, setSecret] = React.useState<{ secret: SecretMontre; niveau: RoleCompte } | null>(null);
  const [aRetirer, setARetirer] = React.useState<CompteUtilisateur | null>(null);

  const recharger = React.useCallback(() => {
    void client
      .call<{ comptes: CompteUtilisateur[] }>({ type: 'comptes.lister' })
      .then((data) => setComptes((data.comptes ?? []).filter((c) => c.role !== 'admin')))
      .catch(() => setComptes((avant) => avant ?? []));
  }, []);
  React.useEffect(recharger, [recharger]);

  return (
    <Groupe
      titre={t('Sous-comptes')}
      aide={t('Donnez un accès à une autre personne : chaque niveau ouvre des droits différents, sur les seuls projets que vous cochez.')}
    >
      <div className="space-y-3" data-page-sous-comptes>
        {secret ? (
          <MotDePasseMontre secret={secret.secret} onFermer={() => setSecret(null)} sansInvitation={secret.niveau !== 'client'} />
        ) : null}
        <FormulaireSousCompte
          onCree={(neuf, niveau) => {
            setSecret({ secret: neuf, niveau });
            recharger();
          }}
        />
        <div className="flex flex-col gap-2" data-liste-sous-comptes={comptes?.length ?? 0}>
          {(comptes ?? []).map((compte) => (
            <LigneSousCompte
              key={compte.id}
              compte={compte}
              onChangement={recharger}
              onSecret={(neuf) => setSecret({ secret: neuf, niveau: compte.role })}
              onRetirer={setARetirer}
            />
          ))}
          {comptes && !comptes.length ? <p className="text-xs text-muted">{t('Aucun sous-compte pour l’instant.')}</p> : null}
        </div>
      </div>
      {aRetirer ? (
        <ConfirmDialog
          open
          title={t('Retirer cet accès ?')}
          description={t('Le compte est mis de côté. Ses demandes et ses messages restent lisibles.')}
          confirmLabel={t('Retirer')}
          danger
          onClose={() => setARetirer(null)}
          onConfirm={() => {
            void client.call({ type: 'comptes.retirer', id: aRetirer.id }).then(recharger);
            setARetirer(null);
          }}
        />
      ) : null}
    </Groupe>
  );
}
