import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Project,
  mentionEcartAuSchema,
  type ReglageApparence,
} from '@beluga/shared';
import { BulleInfo, LigneFormulaire, ListeDeroulante } from '@/components/ui';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* CE QUE CHAQUE RUBRIQUE REÇOIT                                        */
/* ------------------------------------------------------------------ */

/**
 * LES RÉGLAGES EN COURS DE SAISIE, TENUS PAR LA COQUILLE.
 *
 * La configuration d'un projet s'enregistre d'un SEUL geste : un unique
 * « Enregistrer », en pied de fenêtre, envoie tout ce qui a été modifié dans
 * n'importe quelle rubrique. Les champs vivent donc dans la coquille
 * (`project-settings.tsx`) et descendent ici : une rubrique AFFICHE et MODIFIE,
 * elle n'enregistre jamais toute seule.
 *
 * C'est ce qui permet de découper la fenêtre sans toucher au comportement :
 * passer d'une rubrique à l'autre ne perd rien, et rien ne part avant le clic.
 */
export interface ContexteConfig {
  project: Project;
  /** La fenêtre est-elle ouverte ? Certaines rubriques ne lisent qu'alors. */
  open: boolean;
  /** Un enregistrement est en cours : les champs se figent le temps qu'il dure. */
  saving: boolean;

  /* --- L'essentiel --- */
  name: string;
  setName: (valeur: string) => void;
  engine: string;
  setEngine: (valeur: string) => void;

  /* --- Apparence --- */
  themeProjet: ReglageApparence | null;
  setThemeProjet: (valeur: ReglageApparence | null) => void;
  apparenceGenerale: ReglageApparence;
  systemeSombre: boolean;

  /* --- Déploiement --- */
  devUrl: string;
  setDevUrl: (valeur: string) => void;
  adresseProduction: string;
  setAdresseProduction: (valeur: string) => void;
  port: string;
  setPort: (valeur: string) => void;
  portLu: number | null;
  /** L'autre projet qui porte déjà ce port, ou `null` (`projetQuiPorteLePort`). */
  portPartage: Project | null;
  portHorsPlage: boolean;
  faviconEnCours: boolean;
  relancerFavicon: () => void;
  brancheDev: string;
  setBrancheDev: (valeur: string) => void;
  /** La commande lancée après l'envoi (« npm run build », un script du projet…). Vide = aucune. */
  commandeDeploiement: string;
  setCommandeDeploiement: (valeur: string) => void;
  /** Le service système relancé à la fin. Vide = aucun. */
  serviceDeploiement: string;
  setServiceDeploiement: (valeur: string) => void;

  /* --- Mise en production --- */
  brancheProduction: string;
  setBrancheProduction: (valeur: string) => void;

  /* --- Les branches, lues sur le dépôt, partagées par les deux étapes --- */
  branches: string[];
  branchesEnCours: boolean;
  branchesRaison: string;


  /* --- Les gestes qui retirent le projet --- */
  archiver: () => Promise<void> | void;
  /** Ferme la fenêtre des réglages (le projet vient d'être supprimé). */
  fermer: () => void;
}


/* ------------------------------------------------------------------ */
/* Les briques partagées par plusieurs rubriques                        */
/* ------------------------------------------------------------------ */

/**
 * LE TITRE D'UNE RUBRIQUE, et ce qu'elle regroupe derrière son « i ». Chaque
 * rubrique s'ouvre dessus : on doit savoir où l'on vient d'atterrir sans avoir
 * à relire le menu — la phrase d'explication, elle, ne prend plus de place.
 */
export function TeteDeRubrique({
  titre,
  resume,
  aide,
  action,
}: {
  titre: string;
  resume: string;
  aide?: string;
  /** Un bouton posé en haut à droite du titre (le cahier des charges du projet). */
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-3 flex min-h-7 items-center gap-1" data-tete-de-rubrique>
      <h2 className="text-[15px] font-medium text-text">{titre}</h2>
      <BulleInfo cote="start">
        {resume}
        {aide ? `\n\n${aide}` : null}
      </BulleInfo>
      {action ? <div className="ml-auto flex shrink-0 items-center pl-2">{action}</div> : null}
    </header>
  );
}

/**
 * UN REPLI : ce qui se règle rarement se range derrière une ligne à ouvrir
 * (11/10/2026 — « trop d'informations »). Fermé, son contenu est RETIRÉ de la
 * page : il ne reste ni au clavier ni aux contrôles. Rien n'est perdu pour
 * autant, puisque les champs sont tenus par la coquille (`ContexteConfig`) et
 * que l'unique « Enregistrer » les envoie tous, rangés ou non.
 *
 * UN AVERTISSEMENT NE SE RANGE JAMAIS : ce que le contenu aurait signalé
 * (`avertissements`) reste écrit sous la ligne tant que le repli est fermé.
 * Ouvert, c'est le contenu lui-même qui le dit, à côté de son champ.
 *
 * L'état est tenu par l'appelant, qui sait ainsi où poser ses avertissements.
 * La ligne est un bouton à fond, sans bordure, et dit son état (`aria-expanded`).
 */
export function Repli({
  titre,
  repere,
  ouvert,
  onBascule,
  avertissements,
  children,
}: {
  titre: string;
  /** Le repère du bouton, pour les contrôles : « reglages-avances » donne `data-reglages-avances`. */
  repere: string;
  ouvert: boolean;
  onBascule: () => void;
  /** Ce qui doit rester lisible quand le repli est fermé. */
  avertissements?: React.ReactNode;
  children: React.ReactNode;
}) {
  const identifiant = React.useId();
  return (
    <section className="flex flex-col gap-2" data-repli-de-rubrique={repere} data-repli-ouvert={ouvert ? 'oui' : 'non'}>
      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={ouvert ? identifiant : undefined}
        onClick={onBascule}
        className="flex w-full items-center gap-1.5 rounded-md bg-raised/60 px-2.5 py-1.5 text-left text-[13px] text-text transition-colors hover:bg-raised"
        {...{ [`data-${repere}`]: '' }}
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert ? '' : '-rotate-90')}
          aria-hidden
        />
        <span className="min-w-0 flex-1">{titre}</span>
      </button>
      {!ouvert && avertissements ? (
        <div className="flex flex-col gap-1.5" data-repli-avertissements={repere}>
          {avertissements}
        </div>
      ) : null}
      {ouvert ? (
        <div id={identifiant} data-repli-contenu={repere}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * LE CHOIX D'UNE BRANCHE — ET L'ÉCART QU'IL PEUT CRÉER.
 *
 * La liste vient du dépôt GitHub du projet : on ne tape pas un nom de branche,
 * on prend celui qui existe. Rien de choisi reste la première option, et la
 * phrase en dessous dit ce qui s'appliquera alors. Une branche déjà réglée mais
 * absente de la liste (branche effacée, dépôt injoignable) reste proposée : on
 * ne fait jamais disparaître un réglage en silence.
 *
 * Le schéma est imposé sur tous les projets : « dev » au déploiement, « main »
 * en production. Ce choix reste ouvert pour ne pas casser un projet en cours,
 * mais il n'est plus présenté comme une option ordinaire : dès qu'il nomme
 * autre chose, un encart le DIT sous la liste.
 */
export function ChoixDeBranche({
  repere,
  titre,
  cible,
  valeur,
  onChange,
  branches,
  enCours,
  raison,
  mention,
}: {
  repere: string;
  titre: string;
  cible: 'dev' | 'production';
  valeur: string;
  onChange: (valeur: string) => void;
  branches: string[];
  enCours: boolean;
  raison: string;
  mention: string;
}) {
  const proposees = valeur && !branches.includes(valeur) ? [valeur, ...branches] : branches;
  return (
    <LigneFormulaire libelle={titre} {...{ [repere]: '' }}>
      <ListeDeroulante
        valeur={valeur}
        titre={titre}
        repere={repere.replace(/^data-/, '')}
        onChoisir={onChange}
        desactivee={enCours}
        options={[
          { valeur: '', libelle: enCours ? t('Lecture des branches du dépôt…') : t('Branche par défaut') },
          ...proposees.map((branche) => ({ valeur: branche, libelle: branche })),
        ]}
      />
      <p className="text-[11.5px] leading-snug text-faint">
        {valeur ? t('Le lot sera fusionné, enregistré et poussé sur « {valeur} ».', { valeur }) : mention}
        {raison ? ` ${raison}` : ''}
      </p>
      <EcartAuSchema cible={cible} valeur={valeur} />
    </LigneFormulaire>
  );
}

/**
 * L'ÉCART AU SCHÉMA DES DEUX BRANCHES, dit en clair. Il s'écrit sous la liste
 * des branches ; et quand cette liste est rangée derrière « Réglages avancés »,
 * la rubrique le repose sous le repli fermé — un avertissement ne se range pas.
 */
export function EcartAuSchema({ cible, valeur }: { cible: 'dev' | 'production'; valeur: string }) {
  const ecart = mentionEcartAuSchema(cible, valeur);
  if (!ecart) return null;
  return (
    <p
      data-ecart-schema
      className="rounded-md border border-transparent bg-en-cours/10 px-2 py-1.5 text-[11.5px] leading-snug text-text"
    >
      {ecart}
    </p>
  );
}
