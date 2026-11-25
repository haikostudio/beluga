/**
 * RÉGLAGES › ACCÈS — LES ACCÈS, PROJET PAR PROJET (carte « Retrouver la gestion des accès clients », 24/11/2026,
 * maquette #3170d).
 *
 * Elle réunit ce qui vivait à deux endroits : les comptes CLIENTS (la Messagerie) et les accès TIERS à Beluga
 * (« Mon compte »). Décisions de l'utilisateur :
 *  - la page ne liste JAMAIS tous les projets d'office : seulement ceux qu'on y a AJOUTÉS (réglage `projetsDesAcces`,
 *    ordre d'ajout), plus ceux qui ont déjà un accès — aucun accès n'est jamais caché (`projetsDeLaPageAcces`) ;
 *  - « Ajouter un projet » est EN BAS, sur TOUTE LA LARGEUR, dans le pied collé hors du défilement ; il ajoute un
 *    bloc, et les accès s'ajoutent À L'INTÉRIEUR de chaque bloc ;
 *  - quatre niveaux : Client, Lecteur, Membre, Responsable (`acces-par-projet.ts`) ; une personne est cliente OU de
 *    l'équipe, son niveau varie d'un projet à l'autre mais toujours de son côté ;
 *  - un projet ne se retire de la liste que s'il n'a plus aucun accès.
 * Un clic sur une personne ouvre sa FICHE dans le volet de droite (sous-page : retour « ‹ Accès » en tête de page sur
 * ordinateur, flèche de l'en-tête au téléphone ; la colonne de gauche ne change pas).
 *
 * Les droits ne se décident pas ici : toutes les commandes `comptes.*` sont réservées à l'administrateur par le
 * serveur, qui juge aussi le niveau (`comptes.accesProjet`).
 */
import * as React from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  MessageSquareText,
  Plus,
  ShieldOff,
  UserPlus,
} from '@/components/ui/icones';
import {
  NIVEAUX_D_ACCES,
  NIVEAUX_SERVICE,
  SERVICES_OUVRABLES,
  aideDuNiveauDAcces,
  aideDuService,
  comptesAjoutables,
  comptesDuProjet,
  comptesSansProjet,
  coteDuCompte,
  coteDuNiveau,
  droitsDuCompte,
  jugerIdentifiant,
  libelleDansUnMenu,
  libelleDuNiveau,
  libelleDuNiveauDAcces,
  libelleDuService,
  messageDInvitation,
  niveauSurLeProjet,
  nomDuCompte,
  normaliserIdentifiant,
  projetRetirable,
  projetsDeLaPageAcces,
  projetsDuCompte,
  projetsEnArbre,
  type CompteUtilisateur,
  type CoteDuCompte,
  type DroitsDAcces,
  type NiveauDAcces,
  type NiveauService,
  type Project,
  type ServiceOuvrable,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  DialogFooter,
  Input,
  Label,
  ListeDeroulante,
  Switch,
  type OptionSelecteur,
} from '@/components/ui';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { PastilleProjet } from '@/components/pastille-projet';
import { SilhouetteAccesClients } from '@/components/silhouettes';
import { Groupe } from '@/components/reglages/communs';
import { PiedDePageDeReglages } from '@/components/reglages/pied-de-page';
import { useSousPageDeReglages } from '@/components/reglages/sous-page';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn, relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

/* ------------------------------------------------------------------ */
/* Briques                                                              */
/* ------------------------------------------------------------------ */

/** Ce que rend le serveur quand un courriel d'identifiants a été demandé. */
interface IssueDuCourriel {
  envoye: boolean;
  raison?: string;
}

/** Un mot de passe à montrer UNE fois, et ce qu'est devenu son courriel. */
interface SecretMontre {
  /** Le compte qu'il concerne : le mot de passe se montre là où l'on a agi. */
  compteId: string;
  nom: string;
  identifiant: string;
  valeur: string;
  /** Le message d'invitation vise l'espace client : un compte de l'équipe n'en a pas. */
  client: boolean;
  courriel?: IssueDuCourriel & { adresse?: string };
  /** Ce qu'est devenue la copie automatique (fiche d'une personne) : faite, ou refusée par le navigateur. */
  copie?: 'faite' | 'echec';
}

/**
 * COPIER UN TEXTE, MÊME QUAND IL ARRIVE DU SERVEUR. Safari refuse une copie
 * faite APRÈS une requête (le geste de l'utilisateur est « consommé ») : le
 * texte part donc comme une promesse dans un `ClipboardItem`, posé pendant le
 * clic. Ailleurs, ou si cette voie échoue, `writeText` une fois le texte reçu.
 * Hors contexte sécurisé, le presse-papiers n'existe pas : on le DIT.
 */
async function copierAuPressePapiers(texte: string | Promise<string>): Promise<void> {
  const presse = navigator.clipboard;
  if (!presse) throw new Error(t('Le presse-papiers n’est pas accessible sur cette page.'));
  const promesse = Promise.resolve(texte);
  if (typeof ClipboardItem !== 'undefined' && presse.write) {
    try {
      await presse.write([new ClipboardItem({ 'text/plain': promesse.then((v) => new Blob([v], { type: 'text/plain' })) })]);
      return;
    } catch {
      /* Le texte lui-même a pu échouer : `await promesse` le redira. */
    }
  }
  await presse.writeText(await promesse);
}

/** Les projets en options de liste, rangés par nom, les sous-projets sous leur projet réuni. */
function optionsDesProjets(projets: Project[]): OptionSelecteur[] {
  const parNom = [...projets].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return projetsEnArbre(parNom).map((ligne) => ({
    valeur: ligne.projet.id,
    libelle: libelleDansUnMenu(ligne.projet.name, ligne),
    icone: <PastilleProjet project={ligne.projet} />,
    attributs: { 'data-membre-de': ligne.parentId },
  }));
}

/** Deux lettres pour la pastille d'une personne. */
function initiales(nom: string): string {
  const mots = nom.trim().split(/[\s._-]+/).filter(Boolean);
  const lettres = mots.length > 1 ? `${mots[0]![0]}${mots[1]![0]}` : (mots[0] ?? '?').slice(0, 2);
  return lettres.toUpperCase();
}

/** L'état d'un compte, en une phrase. */
function etatEnClair(compte: CompteUtilisateur): string {
  if (!compte.actif) return projetsDuCompte(compte).length ? t('Accès suspendu') : t('Accès retiré');
  if (!compte.derniereEntree) return t('Jamais entré — identifiants à envoyer');
  return `${t('Dernière entrée')} · ${relativeTime(compte.derniereEntree)}`;
}

const echec = (defaut: string) => (err: any) => client.pushToast('error', err?.message ?? defaut);

/** Les comptes (administrateurs exceptés), relus à la demande. */
function useComptes() {
  const [comptes, setComptes] = React.useState<CompteUtilisateur[] | null>(null);
  const recharger = React.useCallback(() => {
    void client
      .call<{ comptes: CompteUtilisateur[] }>({ type: 'comptes.lister' })
      .then((data) => setComptes((data.comptes ?? []).filter((c) => c.role !== 'admin')))
      .catch(() => setComptes((avant) => avant ?? []));
  }, []);
  React.useEffect(recharger, [recharger]);
  return { comptes, recharger };
}

/* ------------------------------------------------------------------ */
/* Le niveau d'une personne sur un projet                               */
/* ------------------------------------------------------------------ */

const RETIRER = '__retirer';

/** Les quatre niveaux en options ; ceux de l'autre côté se montrent, éteints, avec leur raison. */
function optionsDeNiveau(cote: CoteDuCompte | null, avecRetrait: boolean): OptionSelecteur[] {
  const niveaux = NIVEAUX_D_ACCES.map((niveau) => {
    const ailleurs = cote !== null && coteDuNiveau(niveau) !== cote;
    return {
      valeur: niveau,
      libelle: t(libelleDuNiveauDAcces(niveau)),
      detail: ailleurs
        ? niveau === 'client'
          ? t('Réservé aux comptes clients : une personne de l’équipe n’a pas d’espace client.')
          : t('Réservé à l’équipe : un client n’entre jamais dans Beluga.')
        : t(aideDuNiveauDAcces(niveau)),
      desactivee: ailleurs,
    };
  });
  return avecRetrait
    ? [...niveaux, { valeur: RETIRER, libelle: t('Retirer l’accès à ce projet'), icone: <ShieldOff className="h-3.5 w-3.5" /> }]
    : niveaux;
}

/** La pastille du niveau, qui s'ouvre en liste. */
function ChoixDuNiveau({
  niveau,
  cote,
  onChoisir,
  onRetirer,
  repere,
}: {
  niveau: NiveauDAcces;
  cote: CoteDuCompte | null;
  onChoisir: (niveau: NiveauDAcces) => void;
  onRetirer?: () => void;
  repere: string;
}) {
  return (
    <ListeDeroulante
      valeur={niveau}
      options={optionsDeNiveau(cote, !!onRetirer)}
      onChoisir={(v) => {
        if (v === RETIRER) onRetirer?.();
        else if (v !== niveau) onChoisir(v as NiveauDAcces);
      }}
      titre={t('Niveau d’accès')}
      repere={repere}
      seuilRecherche={99}
      empile
      declencheur={(ouvrir) => (
        <Button
          size="sm"
          variant="contraste"
          className="shrink-0 gap-1 px-2.5"
          onClick={ouvrir}
          data-niveau-acces={niveau}
          data-choix-niveau={repere}
        >
          {t(libelleDuNiveauDAcces(niveau))}
          <ChevronDown className="h-3.5 w-3.5 text-faint" />
        </Button>
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Le mot de passe montré une fois                                      */
/* ------------------------------------------------------------------ */

/**
 * LE MOT DE PASSE D'UN COMPTE NEUF (ou renouvelé), MONTRÉ UNE SEULE FOIS — et, quand un courriel a été demandé, ce
 * qu'il est devenu : parti, ou pas parti avec sa cause. Un échec d'envoi ne se tait jamais.
 */
function MotDePasseMontre({ secret, onFermer }: { secret: SecretMontre; onFermer: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-raised p-3" data-mot-de-passe-montre={secret.compteId}>
      <div className="text-[13px] font-medium text-text">
        {t('Mot de passe de')} {secret.nom}
      </div>
      <p className="text-xs text-muted">{t('Il n’est montré qu’une fois : copiez-le et transmettez-le maintenant.')}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-bg px-2 py-1.5 text-[13px] text-text" data-valeur-mot-de-passe>
          {secret.valeur}
        </code>
        <Button
          size="sm"
          variant="contraste"
          onClick={() =>
            void copierAuPressePapiers(secret.valeur)
              .then(() => client.pushToast('success', t('Mot de passe copié')))
              .catch((err) => client.pushToast('error', err?.message ?? t('copie impossible')))
          }
        >
          <Copy className="h-3.5 w-3.5" />
          {t('Copier')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onFermer}>
          {t('J’ai noté')}
        </Button>
      </div>
      {/* LE MESSAGE TOUT PRÊT pour un SMS ou une messagerie, avec CE mot de passe : aucun nouveau n'est tiré. */}
      {secret.client ? (
        <Button
          size="sm"
          variant="contraste"
          className="self-start"
          onClick={() =>
            void copierAuPressePapiers(messageDInvitation({ nom: secret.nom, identifiant: secret.identifiant, motDePasse: secret.valeur }))
              .then(() => client.pushToast('success', t('Invitation copiée')))
              .catch((err) => client.pushToast('error', err?.message ?? t('copie impossible')))
          }
          data-copier-invitation-montre
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          {t('Copier l’invitation')}
        </Button>
      ) : null}
      {secret.courriel?.envoye ? (
        <p className="text-xs text-muted" data-courriel-identifiants="envoye">
          {t('Identifiants envoyés par courriel à {adresse}.', { adresse: secret.courriel.adresse ?? '' })}
        </p>
      ) : secret.courriel ? (
        <p className="text-xs text-danger" data-courriel-identifiants="echec">
          {t('Le courriel n’est pas parti')} : {secret.courriel.raison}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La page                                                              */
/* ------------------------------------------------------------------ */

export function PageAcces({
  settings,
  update,
}: {
  settings: { projetsDesAcces?: string[] };
  update: (patch: Record<string, unknown>) => void;
}) {
  const state = useApp();
  const { comptes, recharger } = useComptes();
  const [secret, setSecret] = React.useState<SecretMontre | null>(null);
  const [ficheId, setFicheId] = React.useState<string | null>(null);
  /* LE BLOC QUI VIENT D'ÊTRE AJOUTÉ : il défile en vue. */
  const [ajoute, setAjoute] = React.useState<string | null>(null);

  const projetsActifs = React.useMemo(() => state.projects.filter((p) => !p.archived), [state.projects]);
  /* LA LISTE GARDÉE, tenue ICI aussi : deux ajouts rapprochés partiraient sinon tous deux de l'ancienne liste. Elle
     se recale sur les réglages à chaque changement venu du serveur. */
  const [liste, setListe] = React.useState<string[] | undefined>(settings.projetsDesAcces);
  const listeServeur = JSON.stringify(settings.projetsDesAcces ?? null);
  React.useEffect(() => setListe(settings.projetsDesAcces), [listeServeur]);

  const projetsDeLaPage = React.useMemo(
    () => (comptes ? projetsDeLaPageAcces(liste, comptes, projetsActifs) : []),
    [liste, comptes, projetsActifs],
  );

  /* PREMIÈRE OUVERTURE : la liste n'existe pas encore — elle naît avec les projets qui ont déjà un accès, une fois. */
  const initialisee = React.useRef(false);
  React.useEffect(() => {
    if (!comptes || initialisee.current || settings.projetsDesAcces !== undefined) return;
    initialisee.current = true;
    const depart = projetsDeLaPageAcces(undefined, comptes, projetsActifs);
    setListe(depart);
    update({ projetsDesAcces: depart });
  }, [comptes, settings.projetsDesAcces, projetsActifs]);

  const poserListe = (suite: string[]) => {
    setListe(suite);
    update({ projetsDesAcces: suite });
  };
  const ajouterProjet = (id: string) => {
    if (projetsDeLaPage.includes(id)) return;
    poserListe([...projetsDeLaPage, id]);
    setAjoute(id);
  };
  const retirerProjet = (id: string) => {
    if (!comptes || !projetRetirable(id, comptes)) return;
    poserListe(projetsDeLaPage.filter((p) => p !== id));
  };

  React.useEffect(() => {
    if (!ajoute) return;
    const bloc = document.querySelector<HTMLElement>(`[data-bloc-acces-projet="${CSS.escape(ajoute)}"]`);
    if (!bloc) return;
    bloc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setAjoute(null);
  }, [ajoute, projetsDeLaPage]);

  const fiche = ficheId && comptes ? comptes.find((c) => c.id === ficheId) ?? null : null;
  if (fiche) {
    return (
      <FicheDePersonne
        compte={fiche}
        projetsActifs={projetsActifs}
        secret={secret?.compteId === fiche.id ? secret : null}
        onSecret={setSecret}
        onChangement={recharger}
        onFermer={() => setFicheId(null)}
      />
    );
  }

  if (!comptes) return <SilhouetteAccesClients />;

  const sansProjet = comptesSansProjet(comptes);
  const ajoutables = projetsActifs.filter((p) => !projetsDeLaPage.includes(p.id));

  return (
    <div className="flex flex-col gap-7" data-page-acces data-projets-acces={projetsDeLaPage.join(',')}>
      {projetsDeLaPage.length ? null : (
        <p className="px-1 text-[13px] leading-relaxed text-muted" data-acces-vide>
          {t('Aucun projet n’est encore ouvert à quelqu’un. Ajoutez un projet, puis ses accès : un client y reçoit son espace et son site en développement.')}
        </p>
      )}
      {projetsDeLaPage.map((id) => {
        const projet = projetsActifs.find((p) => p.id === id)!;
        return (
          <BlocDeProjet
            key={id}
            projet={projet}
            comptes={comptes}
            secret={secret}
            onSecret={setSecret}
            onChangement={recharger}
            onOuvrir={setFicheId}
            onRetirerDeLaListe={projetRetirable(id, comptes) ? () => retirerProjet(id) : undefined}
          />
        );
      })}
      {sansProjet.length ? (
        <Groupe
          titre={t('Sans projet')}
          description={t('Ces personnes n’ont plus aucun projet : leur compte reste, sans rien ouvrir.')}
          liste
        >
          <div className="flex flex-col p-1" data-bloc-sans-projet>
            {sansProjet.map((compte) => (
              <LigneDePersonne key={compte.id} compte={compte} onOuvrir={() => setFicheId(compte.id)} />
            ))}
          </div>
        </Groupe>
      ) : null}

      {/* « AJOUTER UN PROJET » : EN BAS, SUR TOUTE LA LARGEUR, dans le pied collé hors du défilement (décision du
          24/11/2026 — un petit bouton calé à droite a été refusé). Gris léger, jamais une barre blanche en sombre. */}
      <PiedDePageDeReglages>
        <DialogFooter pleineLargeur className="bg-transparent px-4 sm:px-6" data-pied-acces>
          <ListeDeroulante
            valeur=""
            options={optionsDesProjets(ajoutables)}
            onChoisir={ajouterProjet}
            titre={t('Ajouter un projet')}
            repere="ajouter-projet-acces"
            seuilRecherche={0}
            declencheur={(ouvrir) => (
              <Button
                variant="subtle"
                className="w-full"
                onClick={ouvrir}
                disabled={!ajoutables.length}
                data-ajouter-projet-acces
              >
                <Plus className="h-4 w-4" />
                {t('Ajouter un projet')}
              </Button>
            )}
          />
        </DialogFooter>
      </PiedDePageDeReglages>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Le bloc d'un projet                                                  */
/* ------------------------------------------------------------------ */

function BlocDeProjet({
  projet,
  comptes,
  secret,
  onSecret,
  onChangement,
  onOuvrir,
  onRetirerDeLaListe,
}: {
  projet: Project;
  comptes: CompteUtilisateur[];
  secret: SecretMontre | null;
  onSecret: (secret: SecretMontre | null) => void;
  onChangement: () => void;
  onOuvrir: (compteId: string) => void;
  onRetirerDeLaListe?: () => void;
}) {
  const personnes = comptesDuProjet(comptes, projet.id);
  const [ajout, setAjout] = React.useState(false);
  const [aRetirer, setARetirer] = React.useState<CompteUtilisateur | null>(null);
  const secretIci = secret && personnes.some((c) => c.id === secret.compteId) ? secret : null;

  const changerNiveau = (compte: CompteUtilisateur, niveau: NiveauDAcces | null) =>
    void client
      .geste({ type: 'comptes.accesProjet', id: compte.id, projectId: projet.id, niveau }, t('Enregistrement de l’accès'))
      .then(onChangement)
      .catch(() => onChangement());

  return (
    <section className="flex flex-col gap-2" data-bloc-acces-projet={projet.id}>
      <div className="flex min-h-[28px] items-center gap-2 px-1">
        <PastilleProjet project={projet} taille={18} />
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text">{projet.name}</h3>
        {onRetirerDeLaListe ? (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[12.5px]" onClick={onRetirerDeLaListe} data-retirer-projet-acces={projet.id}>
            {t('Retirer de la liste')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 rounded-2xl bg-surface p-1" data-bloc-reglages="liste">
        {secretIci ? (
          <div className="p-2">
            <MotDePasseMontre secret={secretIci} onFermer={() => onSecret(null)} />
          </div>
        ) : null}
        {personnes.map((compte) => (
          <LigneDePersonne
            key={compte.id}
            compte={compte}
            onOuvrir={() => onOuvrir(compte.id)}
            libelleDuNiveau={t(libelleDuNiveauDAcces(niveauSurLeProjet(compte, projet.id)!))}
            niveau={
              <ChoixDuNiveau
                niveau={niveauSurLeProjet(compte, projet.id)!}
                cote={coteDuCompte(compte)}
                onChoisir={(niveau) => changerNiveau(compte, niveau)}
                onRetirer={() => setARetirer(compte)}
                repere={`${projet.id}-${compte.id}`}
              />
            }
          />
        ))}
        {!personnes.length && !ajout ? (
          <p className="px-3 py-2.5 text-[13px] text-faint" data-aucun-acces>
            {t('Aucun accès pour l’instant.')}
          </p>
        ) : null}
        {ajout ? (
          <FormulaireDAjout
            projet={projet}
            comptes={comptes}
            onFini={(neuf) => {
              setAjout(false);
              if (neuf) onSecret(neuf);
              onChangement();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAjout(true)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
            data-ajouter-acces-projet={projet.id}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('Ajouter un accès')}
          </button>
        )}
      </div>
      {aRetirer ? (
        <ConfirmDialog
          open
          title={t('Retirer l’accès à ce projet ?')}
          description={t('{nom} n’ouvrira plus {projet}. Ses autres projets ne changent pas.', {
            nom: nomDuCompte(aRetirer),
            projet: projet.name,
          })}
          confirmLabel={t('Retirer')}
          danger
          onClose={() => setARetirer(null)}
          onConfirm={() => {
            changerNiveau(aRetirer, null);
            setARetirer(null);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * Une personne dans un bloc : pastille, nom, état, niveau, et la fiche au clic.
 *
 * SUR TÉLÉPHONE, UNE LIGNE SIMPLE (décision de l'utilisateur du 24/11/2026, piste B #a09d4 — « tout est compacté, on ne
 * voit rien ») : la pastille, le nom en grand, puis « <niveau> · <état> » qui passe à la ligne au lieu d'être coupé, et
 * le chevron. Le choix du niveau n'est PAS dans la ligne : toute la ligne ouvre la fiche, où le niveau se change.
 */
function LigneDePersonne({
  compte,
  niveau,
  libelleDuNiveau,
  onOuvrir,
}: {
  compte: CompteUtilisateur;
  niveau?: React.ReactNode;
  /** Le niveau sur ce projet, en clair (téléphone : il se lit dans la ligne au lieu de s'y choisir). */
  libelleDuNiveau?: string;
  onOuvrir: () => void;
}) {
  const nom = nomDuCompte(compte);
  const telephone = useTelephone();
  if (telephone) {
    return (
      <button
        type="button"
        onClick={onOuvrir}
        className="flex min-h-[60px] w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-raised"
        data-acces={compte.id}
        data-acces-actif={compte.actif ? 'oui' : 'non'}
        data-ouvrir-fiche={compte.id}
        data-ligne-simple
      >
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-controle-doux text-[11px] font-medium text-text">
          {initiales(nom)}
        </span>
        {/* Tailles écrites AVANT l'échelle du téléphone (+2, fin de styles.css) : le nom se lit en 16 px, la ligne
            « niveau · état » en 13,5 px. */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[14px] text-text">{nom}</span>
          <span className="break-words text-[11.5px] leading-snug" data-etat-acces>
            {libelleDuNiveau ? (
              <>
                <span className="font-medium text-text" data-niveau-ligne>
                  {libelleDuNiveau}
                </span>
                <span className="text-faint"> · </span>
              </>
            ) : null}
            <span className="text-faint">{etatEnClair(compte)}</span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
      </button>
    );
  }
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-raised/60"
      data-acces={compte.id}
      data-acces-actif={compte.actif ? 'oui' : 'non'}
    >
      <button type="button" onClick={onOuvrir} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left" data-ouvrir-fiche={compte.id}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-controle-doux text-[12px] font-medium text-text">
          {initiales(nom)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] text-text">{nom}</span>
          <span className="truncate text-[12px] text-faint">{etatEnClair(compte)}</span>
        </span>
      </button>
      {niveau}
      <button
        type="button"
        onClick={onOuvrir}
        title={t('Ouvrir la fiche')}
        aria-label="Ouvrir la fiche"
        className="flex h-8 w-6 shrink-0 items-center justify-center rounded-md text-faint hover:text-text"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ajouter un accès dans un bloc                                        */
/* ------------------------------------------------------------------ */

/**
 * AJOUTER UN ACCÈS, DANS LE BLOC DU PROJET : une personne NOUVELLE (son compte naît avec ce seul projet), ou une
 * personne DÉJÀ CONNUE (seuls les niveaux de son côté sont proposés).
 */
function FormulaireDAjout({
  projet,
  comptes,
  onFini,
}: {
  projet: Project;
  comptes: CompteUtilisateur[];
  onFini: (neuf: SecretMontre | null) => void;
}) {
  const connus = comptesAjoutables(comptes, projet.id);
  const [mode, setMode] = React.useState<'nouvelle' | 'connue'>('nouvelle');
  const [niveau, setNiveau] = React.useState<NiveauDAcces>('client');
  const [nom, setNom] = React.useState('');
  const [identifiant, setIdentifiant] = React.useState('');
  const identifiantTouche = React.useRef(false);
  const [courriel, setCourriel] = React.useState('');
  const [envoyer, setEnvoyer] = React.useState(false);
  const [connueId, setConnueId] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const connue = connus.find((c) => c.id === connueId) ?? null;
  const coteConnu = connue ? coteDuCompte(connue) : null;
  const avecAdresse = courriel.trim().length > 0;
  const idChamp = React.useId();

  /* L'IDENTIFIANT SE PROPOSE DEPUIS LE NOM tant qu'on ne l'a pas écrit soi-même. */
  const changerNom = (valeur: string) => {
    setNom(valeur);
    if (!identifiantTouche.current) {
      setIdentifiant(normaliserIdentifiant(valeur).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32));
    }
  };

  const creer = async () => {
    const juge = jugerIdentifiant(identifiant);
    if (!juge.ok) {
      client.pushToast('error', juge.raison!);
      return;
    }
    setEnCours(true);
    try {
      const estClient = niveau === 'client';
      const data = await client.call<{ compte: CompteUtilisateur; motDePasse: string; courriel?: IssueDuCourriel }>(
        estClient
          ? {
              type: 'comptes.creer',
              identifiant,
              nomAffiche: nom,
              role: 'client',
              projets: [projet.id],
              courriel: courriel.trim() || undefined,
              envoyerIdentifiants: envoyer && avecAdresse,
            }
          : {
              type: 'comptes.creer',
              identifiant,
              nomAffiche: nom,
              role: 'lecteur',
              projets: [projet.id],
              droits: { projets: { [projet.id]: niveau }, services: {} },
              courriel: courriel.trim() || undefined,
            },
      );
      onFini({
        compteId: data.compte.id,
        nom: nomDuCompte(data.compte),
        identifiant: data.compte.identifiant,
        valeur: data.motDePasse,
        client: estClient,
        courriel: data.courriel ? { ...data.courriel, adresse: courriel.trim() } : undefined,
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('accès non créé'));
    } finally {
      setEnCours(false);
    }
  };

  const ajouterConnue = async () => {
    if (!connue) return;
    setEnCours(true);
    try {
      await client.call({ type: 'comptes.accesProjet', id: connue.id, projectId: projet.id, niveau });
      onFini(null);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('accès non créé'));
    } finally {
      setEnCours(false);
    }
  };

  const niveauxPermis = (cote: CoteDuCompte | null) => optionsDeNiveau(cote, false);

  return (
    <div className="m-1 flex flex-col gap-3 rounded-xl bg-raised p-3" data-formulaire-acces={projet.id}>
      {connus.length ? (
        <BarreDOnglets
          onglets={[
            { cle: 'nouvelle', libelle: t('Nouvelle personne') },
            /* « Déjà connue », pas « Personne déjà connue » : à 390 px, le second onglet sortait de la barre. */
            { cle: 'connue', libelle: t('Déjà connue') },
          ]}
          valeur={mode}
          onChange={(cle) => {
            setMode(cle);
            setNiveau(cle === 'nouvelle' ? 'client' : niveau);
          }}
          repere={`ajout-${projet.id}`}
          pleineLargeur
        />
      ) : null}

      {mode === 'nouvelle' ? (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${idChamp}-nom`} className="text-[12px] text-muted">
              {t('Nom affiché')}
            </Label>
            <Input id={`${idChamp}-nom`} value={nom} onChange={(e) => changerNom(e.target.value)} data-champ-nom autoFocus />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${idChamp}-id`} className="text-[12px] text-muted">
              {t('Identifiant de connexion')}
            </Label>
            <Input
              id={`${idChamp}-id`}
              value={identifiant}
              onChange={(e) => {
                identifiantTouche.current = true;
                setIdentifiant(e.target.value);
              }}
              data-champ-identifiant
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${idChamp}-courriel`} className="text-[12px] text-muted">
              {t('Adresse de courriel (facultative)')}
            </Label>
            <Input
              id={`${idChamp}-courriel`}
              type="email"
              value={courriel}
              onChange={(e) => {
                setCourriel(e.target.value);
                if (!e.target.value.trim()) setEnvoyer(false);
              }}
              data-champ-courriel-neuf
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[12px] text-muted">{t('Niveau d’accès')}</Label>
            <ListeDeroulante
              valeur={niveau}
              options={niveauxPermis(null)}
              onChoisir={(v) => setNiveau(v as NiveauDAcces)}
              titre={t('Niveau d’accès')}
              repere={`niveau-neuf-${projet.id}`}
              seuilRecherche={99}
              empile
            />
          </div>
          {niveau === 'client' ? (
            <label
              className={cn('flex items-center gap-2 text-[12.5px]', avecAdresse ? 'text-text' : 'text-faint')}
              data-envoyer-identifiants={envoyer && avecAdresse ? 'oui' : 'non'}
            >
              <Switch checked={envoyer && avecAdresse} disabled={!avecAdresse} onCheckedChange={setEnvoyer} />
              <Mail className="h-3.5 w-3.5 shrink-0" />
              {t('Envoyer les identifiants par courriel')}
            </label>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-[12px] text-muted">{t('Personne')}</Label>
            <ListeDeroulante
              valeur={connueId}
              options={connus.map((c) => ({
                valeur: c.id,
                libelle: nomDuCompte(c),
                detail: coteDuCompte(c) === 'client' ? t('Client') : t('Équipe'),
              }))}
              onChoisir={(id) => {
                setConnueId(id);
                const choisie = connus.find((c) => c.id === id);
                setNiveau(choisie && coteDuCompte(choisie) === 'client' ? 'client' : 'voir');
              }}
              titre={t('Personne')}
              placeholder={t('Choisir une personne')}
              repere={`personne-connue-${projet.id}`}
              empile
            />
          </div>
          {connue ? (
            <div className="flex flex-col gap-1">
              <Label className="text-[12px] text-muted">{t('Niveau d’accès')}</Label>
              <ListeDeroulante
                valeur={niveau}
                options={niveauxPermis(coteConnu)}
                onChoisir={(v) => setNiveau(v as NiveauDAcces)}
                titre={t('Niveau d’accès')}
                repere={`niveau-connu-${projet.id}`}
                seuilRecherche={99}
                empile
              />
              <p className="px-0.5 text-[12px] text-faint">
                {coteConnu === 'client'
                  ? t('Cette personne est cliente : seul le niveau Client lui est proposé.')
                  : t('Cette personne fait partie de l’équipe : le niveau Client ne lui est pas proposé.')}
              </p>
            </div>
          ) : null}
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onFini(null)} disabled={enCours}>
          {t('Annuler')}
        </Button>
        {mode === 'nouvelle' ? (
          <Button variant="principal" onClick={() => void creer()} disabled={enCours || !identifiant.trim()} data-creer-acces>
            {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {t('Créer l’accès')}
          </Button>
        ) : (
          <Button variant="principal" onClick={() => void ajouterConnue()} disabled={enCours || !connue} data-ajouter-personne-connue>
            {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('Ajouter')}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La fiche d'une personne                                              */
/* ------------------------------------------------------------------ */

/**
 * LA FICHE D'UNE PERSONNE, EN SECTIONS (décision de l'utilisateur du 25/11/2026, maquette #98ddf) — chaque bouton vit
 * dans la section qu'il concerne, et le pied collé en bas ne porte que le geste sur la personne entière :
 *  - Identité : nom, courriel, identifiant, puis « Accès actif » en dernière ligne ;
 *  - Mot de passe, JUSTE DESSOUS : le mot de passe tiré se montre ICI, dans un champ, et part tout seul dans le
 *    presse-papiers ; puis « Nouveau mot de passe », « Copier l'invitation » (client), « Envoyer les identifiants » ;
 *  - Projets, puis Services ouverts (équipe seulement) ;
 *  - pied : « Retirer la personne », seul.
 * C'est une SOUS-PAGE : elle s'ouvre dans le volet de droite, l'entête de la page devient « ‹ Accès » (ordinateur) et
 * la flèche de la barre d'en-tête ramène à la liste (téléphone). La colonne de gauche ne change pas.
 */
function FicheDePersonne({
  compte,
  projetsActifs,
  secret,
  onSecret,
  onChangement,
  onFermer,
}: {
  compte: CompteUtilisateur;
  projetsActifs: Project[];
  secret: SecretMontre | null;
  onSecret: React.Dispatch<React.SetStateAction<SecretMontre | null>>;
  onChangement: () => void;
  onFermer: () => void;
}) {
  const cote = coteDuCompte(compte);
  const nom = nomDuCompte(compte);
  const [aRetirer, setARetirer] = React.useState(false);
  const [tirage, setTirage] = React.useState(false);
  const [invitation, setInvitation] = React.useState<'confirmer' | 'en-cours' | null>(null);
  const [envoi, setEnvoi] = React.useState<'confirmer' | 'en-cours' | null>(null);
  const [droits, setDroits] = React.useState<DroitsDAcces>(() => droitsDuCompte(compte));
  const droitsServeur = JSON.stringify(droitsDuCompte(compte));
  React.useEffect(() => setDroits(droitsDuCompte(compte)), [droitsServeur]);

  useSousPageDeReglages({ cle: `personne:${compte.id}`, retour: t('Accès'), onRetour: onFermer, titre: nom });

  const projetsOuverts = projetsDuCompte(compte)
    .map((id) => projetsActifs.find((p) => p.id === id))
    .filter((p): p is Project => !!p)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const projetsAOuvrir = projetsActifs.filter((p) => niveauSurLeProjet(compte, p.id) === null);

  const changerNiveau = (projectId: string, niveau: NiveauDAcces | null) =>
    void client
      .geste({ type: 'comptes.accesProjet', id: compte.id, projectId, niveau }, t('Enregistrement de l’accès'))
      .then(onChangement)
      .catch(() => onChangement());

  const poserService = (service: ServiceOuvrable, niveau: NiveauService) => {
    const services = { ...droits.services };
    if (niveau === 'aucun') delete services[service];
    else services[service] = niveau;
    const suite = { ...droits, services };
    setDroits(suite);
    void client
      .call({ type: 'comptes.droits', id: compte.id, droits: suite })
      .then(onChangement)
      .catch((err) => {
        echec(t('droits non changés'))(err);
        onChangement();
      });
  };

  const nouveauMotDePasse = (envoyerIdentifiants = false) =>
    client
      .call<{ motDePasse: string; courriel?: IssueDuCourriel }>({ type: 'comptes.motDePasse', id: compte.id, envoyerIdentifiants })
      .then((data) => {
        onSecret({
          compteId: compte.id,
          nom,
          identifiant: compte.identifiant,
          valeur: data.motDePasse,
          client: cote === 'client',
          courriel: data.courriel ? { ...data.courriel, adresse: compte.courriel } : undefined,
        });
        onChangement();
        return data.motDePasse;
      });

  /* Ce que la copie est devenue, posé sur LE mot de passe copié (un autre, tiré entre-temps, n'en hérite pas). */
  const marquerCopie = (valeur: string, copie: 'faite' | 'echec') =>
    onSecret((avant) => (avant && avant.valeur === valeur ? { ...avant, copie } : avant));

  /* « NOUVEAU MOT DE PASSE » : il s'affiche dans sa section ET part dans le presse-papiers, sans second geste. La copie
     part PENDANT le clic, en promesse (`copierAuPressePapiers`) : Safari refuse une copie faite après la requête. Une
     copie refusée laisse le mot de passe lisible dans son champ, et le dit. */
  const tirerMotDePasse = () => {
    setTirage(true);
    const motDePasse = nouveauMotDePasse();
    void copierAuPressePapiers(motDePasse)
      .then(async () => {
        marquerCopie(await motDePasse, 'faite');
        client.pushToast('success', t('Nouveau mot de passe copié'));
      })
      .catch((err) =>
        motDePasse.then(
          (valeur) => {
            marquerCopie(valeur, 'echec');
            client.pushToast('error', t('Copie impossible : le mot de passe est affiché dans sa section.'));
          },
          () => client.pushToast('error', err?.message ?? t('mot de passe non changé')),
        ),
      )
      .finally(() => setTirage(false));
  };

  /* L'INVITATION : avec le mot de passe DÉJÀ affiché s'il y en a un (aucun nouveau, aucune confirmation) ; sinon elle en
     tire un nouveau, après confirmation — l'ancien n'est gardé qu'en empreinte. */
  const copierInvitation = (affiche: SecretMontre | null) => {
    setInvitation('en-cours');
    const motDePasse = affiche ? Promise.resolve(affiche.valeur) : nouveauMotDePasse();
    void copierAuPressePapiers(motDePasse.then((valeur) => messageDInvitation({ nom, identifiant: compte.identifiant, motDePasse: valeur })))
      .then(() => client.pushToast('success', affiche ? t('Invitation copiée') : t('Invitation copiée, avec un nouveau mot de passe')))
      .catch((err) =>
        motDePasse.then(
          () => client.pushToast('error', t('Copie impossible : le mot de passe est affiché dans sa section.')),
          () => client.pushToast('error', err?.message ?? t('mot de passe non changé')),
        ),
      )
      .finally(() => setInvitation(null));
  };

  const envoyerIdentifiants = () => {
    setEnvoi('en-cours');
    void nouveauMotDePasse(true)
      .catch(echec(t('mot de passe non changé')))
      .finally(() => setEnvoi(null));
  };

  const retirable = projetsDuCompte(compte).length > 0 || compte.actif;

  return (
    <div className="flex flex-col gap-7" data-fiche-acces={compte.id}>
      <div className="flex items-center gap-3 px-1" data-tete-fiche>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-[14px] font-medium text-text">
          {initiales(nom)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[18px] font-semibold text-text" data-nom-fiche>
            {nom}
          </span>
          <span className="text-[13px] leading-snug text-muted sm:truncate" data-etat-fiche>
            {cote === 'client' ? t('Client') : t('Équipe')} · {etatEnClair(compte)}
          </span>
        </div>
      </div>

      <div data-partie-fiche="identite">
        <Groupe titre={t('Identité')}>
          <ChampEnregistre
            libelle={t('Nom affiché')}
            valeur={compte.nomAffiche}
            onEnregistrer={(v) => client.call({ type: 'comptes.renommer', id: compte.id, nomAffiche: v })}
            onChangement={onChangement}
            repere="nom"
          />
          <ChampEnregistre
            libelle={t('Adresse de courriel (facultative)')}
            valeur={compte.courriel ?? ''}
            type="email"
            onEnregistrer={(v) => client.call({ type: 'comptes.courriel', id: compte.id, courriel: v })}
            onChangement={onChangement}
            repere="courriel"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">{t('Identifiant de connexion')}</span>
            <code className="text-[13.5px] text-text" data-identifiant-fiche>
              {compte.identifiant}
            </code>
          </div>
          <label className="flex min-h-[36px] items-center gap-3 text-[13.5px] text-text" data-ligne-acces-actif>
            <span className="min-w-0 flex-1">{t('Accès actif')}</span>
            <Switch
              checked={compte.actif}
              onCheckedChange={(actif) =>
                void client
                  .call({ type: 'comptes.suspendre', id: compte.id, suspendu: !actif })
                  .then(onChangement)
                  .catch(echec(t('état non changé')))
              }
              data-suspendre={compte.id}
            />
          </label>
        </Groupe>
      </div>

      <div data-partie-fiche="mot-de-passe">
        <Groupe titre={t('Mot de passe')} liste>
          <div className="flex flex-col p-1">
            {secret ? <MotDePasseDeLaFiche secret={secret} onCopie={(copie) => marquerCopie(secret.valeur, copie)} /> : null}
            <LigneDeGeste
              icone={<KeyRound className="h-4 w-4" />}
              libelle={t('Nouveau mot de passe')}
              detail={t('Affiché ici et copié tout seul. L’ancien ne fonctionnera plus.')}
              enCours={tirage}
              onClick={tirerMotDePasse}
              repere={`reinitialiser-${compte.id}`}
            />
            {cote === 'client' ? (
              <LigneDeGeste
                icone={<MessageSquareText className="h-4 w-4" />}
                libelle={t('Copier l’invitation')}
                detail={secret ? t('Un message prêt à envoyer, avec le mot de passe affiché.') : t('Un message prêt à envoyer, avec un nouveau mot de passe.')}
                enCours={invitation === 'en-cours'}
                onClick={() => (secret ? copierInvitation(secret) : setInvitation('confirmer'))}
                repere={`copier-invitation-${compte.id}`}
              />
            ) : null}
            <LigneDeGeste
              icone={<Mail className="h-4 w-4" />}
              libelle={t('Envoyer les identifiants par courriel')}
              detail={compte.courriel ? t('Un nouveau mot de passe part à {adresse}.', { adresse: compte.courriel }) : t('Ajoutez d’abord une adresse de courriel.')}
              enCours={envoi === 'en-cours'}
              desactive={!compte.courriel}
              onClick={() => setEnvoi('confirmer')}
              repere={`envoyer-identifiants-${compte.id}`}
            />
          </div>
        </Groupe>
      </div>

      <div data-partie-fiche="projets">
        <Groupe titre={t('Projets')} liste>
          <div className="flex flex-col p-1" data-projets-fiche={projetsOuverts.map((p) => p.id).join(',')}>
            {projetsOuverts.map((projet) => (
              <div key={projet.id} className="flex items-center gap-3 rounded-xl px-3 py-2" data-projet-fiche={projet.id}>
                <PastilleProjet project={projet} taille={18} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{projet.name}</span>
                <ChoixDuNiveau
                  niveau={niveauSurLeProjet(compte, projet.id)!}
                  cote={cote}
                  onChoisir={(niveau) => changerNiveau(projet.id, niveau)}
                  onRetirer={() => changerNiveau(projet.id, null)}
                  repere={`fiche-${projet.id}`}
                />
              </div>
            ))}
            {!projetsOuverts.length ? (
              <p className="px-3 py-2.5 text-[13px] text-faint">{t('Aucun projet ouvert.')}</p>
            ) : null}
            {projetsAOuvrir.length && cote ? (
              <ListeDeroulante
                valeur=""
                options={optionsDesProjets(projetsAOuvrir)}
                onChoisir={(id) => changerNiveau(id, cote === 'client' ? 'client' : 'voir')}
                titre={t('Ouvrir un projet')}
                repere={`ouvrir-projet-${compte.id}`}
                seuilRecherche={0}
                empile
                declencheur={(ouvrir) => (
                  <button
                    type="button"
                    onClick={ouvrir}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
                    data-ouvrir-projet-fiche
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('Ouvrir un projet')}
                  </button>
                )}
              />
            ) : null}
          </div>
        </Groupe>
      </div>

      {cote === 'equipe' ? (
        <div data-partie-fiche="services">
          <Groupe titre={t('Services ouverts')} description={t('Ce que cette personne peut voir ou modifier hors de ses projets.')} liste>
            <div className="flex flex-col p-1">
              {SERVICES_OUVRABLES.map((service) => (
                <div key={service} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" data-droit-service={service}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-text">{t(libelleDuService(service))}</span>
                    <span className="block text-[12px] leading-snug text-faint">{t(aideDuService(service))}</span>
                  </span>
                  <BarreDOnglets
                    onglets={NIVEAUX_SERVICE.map((n) => ({ cle: n, libelle: t(libelleDuNiveau(n)) }))}
                    valeur={droits.services[service] ?? 'aucun'}
                    onChange={(n) => poserService(service, n)}
                    repere={`service-${service}`}
                  />
                </div>
              ))}
            </div>
          </Groupe>
        </div>
      ) : null}

      {/* LE PIED NE PORTE QUE LE GESTE SUR LA PERSONNE ENTIÈRE : la retirer. Le pied de la liste (« Ajouter un projet »)
          n'est pas monté pendant ce temps : la fiche remplace la liste. */}
      {retirable ? (
        <PiedDePageDeReglages>
          <DialogFooter pleineLargeur className="bg-transparent px-4 sm:px-6" data-pied-fiche-acces>
            <Button variant="subtle" className="w-full text-danger" onClick={() => setARetirer(true)} data-retirer-personne={compte.id}>
              <ShieldOff className="h-4 w-4" />
              {t('Retirer la personne')}
            </Button>
          </DialogFooter>
        </PiedDePageDeReglages>
      ) : null}

      {aRetirer ? (
        <ConfirmDialog
          open
          title={t('Retirer cette personne ?')}
          description={t('Tous ses accès se ferment. Ses demandes et ses messages restent lisibles.')}
          confirmLabel={t('Retirer')}
          danger
          onClose={() => setARetirer(false)}
          onConfirm={() => {
            void client.call({ type: 'comptes.retirer', id: compte.id }).then(onChangement).catch(echec(t('état non changé')));
            setARetirer(false);
          }}
        />
      ) : null}
      {invitation === 'confirmer' ? (
        <ConfirmDialog
          open
          title={t('Copier l’invitation ?')}
          description={t(
            'Un nouveau mot de passe va être créé et glissé dans le message à envoyer au client. L’ancien mot de passe ne fonctionnera plus.',
          )}
          confirmLabel={t('Nouveau mot de passe et copier')}
          onClose={() => setInvitation((avant) => (avant === 'confirmer' ? null : avant))}
          onConfirm={() => copierInvitation(null)}
        />
      ) : null}
      {envoi === 'confirmer' ? (
        <ConfirmDialog
          open
          title={t('Envoyer de nouveaux identifiants ?')}
          description={t('Un nouveau mot de passe va être créé et envoyé à {adresse}. L’ancien ne fonctionnera plus.', {
            adresse: compte.courriel ?? '',
          })}
          confirmLabel={t('Envoyer')}
          onClose={() => setEnvoi((avant) => (avant === 'confirmer' ? null : avant))}
          onConfirm={envoyerIdentifiants}
        />
      ) : null}
    </div>
  );
}

/**
 * LE MOT DE PASSE TIRÉ, DANS SA SECTION : un champ en lecture (texte à chasse fixe, sur le fond creusé des champs), le
 * bouton de copie qui dit « Copié » une fois fait, et une phrase — copié ou non, montré seulement ici. Le sort du
 * courriel d'identifiants s'y lit aussi : parti, ou pas parti avec sa cause.
 */
function MotDePasseDeLaFiche({ secret, onCopie }: { secret: SecretMontre; onCopie: (copie: 'faite' | 'echec') => void }) {
  const copier = () =>
    void copierAuPressePapiers(secret.valeur)
      .then(() => {
        onCopie('faite');
        client.pushToast('success', t('Mot de passe copié'));
      })
      .catch((err) => {
        onCopie('echec');
        client.pushToast('error', err?.message ?? t('copie impossible'));
      });
  return (
    <div className="flex flex-col gap-2 px-2 pb-2 pt-1.5" data-mot-de-passe-montre={secret.compteId} data-copie={secret.copie ?? 'aucune'}>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={secret.valeur}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Mot de passe"
          className="min-w-0 flex-1 font-mono"
          data-valeur-mot-de-passe
        />
        <Button variant="contraste" className="shrink-0" onClick={copier} data-copier-mot-de-passe>
          {secret.copie === 'faite' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {secret.copie === 'faite' ? t('Copié') : t('Copier')}
        </Button>
      </div>
      <p className={cn('px-0.5 text-[12.5px] leading-snug', secret.copie === 'echec' ? 'text-danger' : 'text-muted')}>
        {secret.copie === 'faite'
          ? t('Copié dans le presse-papiers. Il n’est montré qu’ici : transmettez-le maintenant.')
          : secret.copie === 'echec'
            ? t('La copie n’a pas pu se faire : copiez-le avec le bouton. Il n’est montré qu’ici.')
            : t('Il n’est montré qu’ici : transmettez-le maintenant.')}
      </p>
      {secret.courriel?.envoye ? (
        <p className="px-0.5 text-[12.5px] text-muted" data-courriel-identifiants="envoye">
          {t('Identifiants envoyés par courriel à {adresse}.', { adresse: secret.courriel.adresse ?? '' })}
        </p>
      ) : secret.courriel ? (
        <p className="px-0.5 text-[12.5px] text-danger" data-courriel-identifiants="echec">
          {t('Le courriel n’est pas parti')} : {secret.courriel.raison}
        </p>
      ) : null}
    </div>
  );
}

/** Un champ qui s'enregistre en quittant la saisie ; l'échec se dit et la valeur revient. */
function ChampEnregistre({
  libelle,
  valeur,
  type,
  onEnregistrer,
  onChangement,
  repere,
}: {
  libelle: string;
  valeur: string;
  type?: string;
  onEnregistrer: (valeur: string) => Promise<unknown>;
  onChangement: () => void;
  repere: string;
}) {
  const id = React.useId();
  const [texte, setTexte] = React.useState(valeur);
  React.useEffect(() => setTexte(valeur), [valeur]);
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[12px] text-muted">
        {libelle}
      </Label>
      <Input
        id={id}
        type={type}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onBlur={() => {
          if (texte.trim() === valeur.trim()) return;
          void onEnregistrer(texte.trim())
            .then(() => {
              client.pushToast('success', t('Enregistré'));
              onChangement();
            })
            .catch((err) => {
              echec(t('état non changé'))(err);
              setTexte(valeur);
            });
        }}
        data-champ-fiche={repere}
      />
    </div>
  );
}

/** Une ligne de geste dans la fiche : icône, libellé, une phrase, et le geste au clic. */
function LigneDeGeste({
  icone,
  libelle,
  detail,
  onClick,
  enCours,
  desactive,
  danger,
  repere,
}: {
  icone: React.ReactNode;
  libelle: string;
  detail: string;
  onClick: () => void;
  enCours?: boolean;
  desactive?: boolean;
  danger?: boolean;
  repere: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={enCours || desactive}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-raised disabled:opacity-50 disabled:hover:bg-transparent',
        danger ? 'text-danger' : 'text-text',
      )}
      data-geste-fiche={repere}
    >
      <span className={cn('shrink-0', danger ? 'text-danger' : 'text-faint')}>
        {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : icone}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px]">{libelle}</span>
        <span className="text-[12px] leading-snug text-faint sm:truncate">{detail}</span>
      </span>
    </button>
  );
}
