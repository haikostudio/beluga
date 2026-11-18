/**
 * LE CONTRÔLE DE SÉCURITÉ DU PROJET COURANT — LES RELEVÉS.
 *
 * Ce fichier ne juge rien : il relève, dans le dossier d'un projet QUELCONQUE, ce que les règles
 * pures de `shared/src/controle-securite.ts` vont classer — les fichiers VERSIONNÉS (jamais ce qui
 * est ignoré par git), l'audit des dépendances selon la pile trouvée (npm, composer, pip-audit),
 * la visibilité du dépôt sur GitHub, les en-têtes de l'adresse publique.
 *
 * Il n'importe ni la base ni la configuration du démon : le script `scripts/controle-securite.mjs`
 * le lance seul, sur n'importe quel dossier. Un relevé qui ne peut pas se faire (outil absent,
 * réseau coupé) ne fait pas échouer le contrôle : il devient une ligne « non vérifié » du rapport.
 * Rien n'est corrigé : chaque point rend une carte PROPOSÉE.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  carteDeCorrection,
  clesEcrites,
  constatsDAcces,
  constatsDeCles,
  constatsDeDependances,
  constatsDEntetes,
  constatsDInjections,
  fichierAExaminer,
  gardeGlobaleDansLeCode,
  graviteDAudit,
  injectionsDansLeCode,
  rapportEnTexte,
  routesDuFichier,
  trierParGravite,
  type CarteProposee,
  type CleTrouvee,
  type ConstatSecurite,
  type DependanceVulnerable,
  type EtapeDuControle,
  type InjectionTrouvee,
  type RapportDeSecurite,
  type ReponseHttp,
  type RoutesDUnFichier,
} from '@beluga/shared';

export interface OptionsDuControle {
  dossier: string;
  /** Nom affiché ; par défaut le nom du dossier. */
  nom?: string;
  /** Adresse publique dont on lit les en-têtes. */
  adresse?: string;
  /** Force la visibilité du dépôt (sinon lue sur GitHub). */
  depotPublic?: boolean;
}

export interface ResultatDuControle {
  rapport: RapportDeSecurite;
  texte: string;
  cartes: CarteProposee[];
}

interface Sortie {
  code: number | null;
  stdout: string;
  stderr: string;
  absent?: boolean;
}

function lancer(cmd: string, args: string[], cwd: string, delai = 120_000): Promise<Sortie> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: delai, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        resolve({
          code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          absent: e?.code === 'ENOENT',
        });
      },
    );
  });
}

/** Les fichiers versionnés du dossier — ce que git ignore n'est jamais lu. */
async function fichiersVersionnes(dossier: string): Promise<string[] | null> {
  const r = await lancer('git', ['ls-files', '-z'], dossier, 30_000);
  if (r.code !== 0) return null;
  return r.stdout.split('\0').filter(Boolean);
}

/** Le dépôt est-il public ? `null` = inconnu (pas de remote GitHub, ou GitHub injoignable). */
export async function visibiliteDuDepot(dossier: string): Promise<boolean | null> {
  const remote = await lancer('git', ['remote', 'get-url', 'origin'], dossier, 10_000);
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(\.git)?\s*$/.exec(remote.stdout.trim());
  if (!m) return null;
  const r = await lancer('gh', ['repo', 'view', `${m[1]}/${m[2]}`, '--json', 'visibility', '-q', '.visibility'], dossier, 20_000);
  if (r.code !== 0) return null;
  const v = r.stdout.trim().toUpperCase();
  return v === 'PUBLIC' ? true : v ? false : null;
}

/** npm audit, dans chaque dossier versionné qui porte un `package-lock.json`. */
async function auditNpm(dossier: string, fichiers: readonly string[]): Promise<{ liste: DependanceVulnerable[]; note: string } | null> {
  const verrous = fichiers.filter((f) => /(^|\/)package-lock\.json$/.test(f) && !/node_modules\//.test(f));
  if (!verrous.length) return null;
  const liste: DependanceVulnerable[] = [];
  const echecs: string[] = [];
  for (const verrou of verrous.slice(0, 6)) {
    const ici = path.join(dossier, path.dirname(verrou));
    // Les dépendances de production seulement : ce sont elles qui tournent en ligne.
    const r = await lancer('npm', ['audit', '--json', '--omit=dev'], ici, 120_000);
    try {
      const json = JSON.parse(r.stdout) as {
        vulnerabilities?: Record<string, { severity: string; fixAvailable?: boolean | { isSemVerMajor?: boolean } }>;
        error?: unknown;
      };
      if (json.error && !json.vulnerabilities) throw new Error('audit refusé');
      for (const [nom, v] of Object.entries(json.vulnerabilities ?? {})) {
        const fix = v.fixAvailable;
        liste.push({
          nom,
          gravite: graviteDAudit(v.severity),
          correctionDisponible: fix === true || (typeof fix === 'object' && !fix.isSemVerMajor),
          pile: 'npm',
        });
      }
    } catch {
      echecs.push(path.dirname(verrou));
    }
  }
  const dedoublonnee = [...new Map(liste.map((d) => [d.nom, d])).values()];
  return {
    liste: dedoublonnee,
    note: `${verrous.length} ensemble(s) de composants JavaScript${echecs.length ? ` — audit impossible pour ${echecs.join(', ')}` : ''}`,
  };
}

async function auditComposer(dossier: string, fichiers: readonly string[]): Promise<{ liste: DependanceVulnerable[]; note: string } | 'absent' | null> {
  if (!fichiers.includes('composer.lock')) return null;
  const r = await lancer('composer', ['audit', '--format=json', '--locked', '--no-dev'], dossier, 120_000);
  if (r.absent) return 'absent';
  try {
    const json = JSON.parse(r.stdout) as { advisories?: Record<string, Array<{ severity?: string }>> };
    const liste: DependanceVulnerable[] = Object.entries(json.advisories ?? {}).map(([nom, avis]) => ({
      nom,
      gravite: graviteDAudit(avis[0]?.severity ?? 'moderate'),
      correctionDisponible: true,
      pile: 'composer',
    }));
    return { liste, note: 'composants PHP' };
  } catch {
    return 'absent';
  }
}

async function auditPython(dossier: string, fichiers: readonly string[]): Promise<{ liste: DependanceVulnerable[]; note: string } | 'absent' | null> {
  const req = fichiers.find((f) => f === 'requirements.txt');
  if (!req && !fichiers.includes('pyproject.toml')) return null;
  const args = req ? ['-r', req, '-f', 'json', '--progress-spinner', 'off'] : ['-f', 'json', '--progress-spinner', 'off'];
  const r = await lancer('pip-audit', args, dossier, 180_000);
  if (r.absent) return 'absent';
  try {
    const json = JSON.parse(r.stdout) as { dependencies?: Array<{ name: string; vulns?: Array<{ fix_versions?: string[] }> }> };
    const liste: DependanceVulnerable[] = (json.dependencies ?? [])
      .filter((d) => d.vulns?.length)
      .map((d) => ({ nom: d.name, gravite: 'moyenne', correctionDisponible: !!d.vulns?.some((v) => v.fix_versions?.length), pile: 'pip' }));
    return { liste, note: 'composants Python' };
  } catch {
    return 'absent';
  }
}

/** Les en-têtes de l'adresse publique, et le renvoi de http vers https. */
export async function releverLesEntetes(adresse: string): Promise<ReponseHttp> {
  const reponse = await fetch(adresse, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
  const entetes: Record<string, string | string[]> = {};
  reponse.headers.forEach((valeur, nom) => {
    if (nom !== 'set-cookie') entetes[nom] = valeur;
  });
  const cookies = reponse.headers.getSetCookie?.() ?? [];
  if (cookies.length) entetes['set-cookie'] = cookies;
  let redirigeVersHttps: boolean | undefined;
  const finale = reponse.url || adresse;
  if (finale.startsWith('https://')) {
    try {
      const http = await fetch(finale.replace(/^https:/, 'http:'), { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const vers = http.headers.get('location') ?? '';
      redirigeVersHttps = http.status >= 300 && http.status < 400 && vers.startsWith('https://');
    } catch {
      redirigeVersHttps = undefined; // port 80 fermé : rien de lisible en clair, rien à signaler
    }
  }
  return { adresse: finale, statut: reponse.status, entetes, redirigeVersHttps };
}

const TAILLE_MAX = 1024 * 1024;

export async function controlerLaSecurite(options: OptionsDuControle): Promise<ResultatDuControle> {
  const dossier = path.resolve(options.dossier);
  const etapes: EtapeDuControle[] = [];
  const constats: ConstatSecurite[] = [];

  const fichiers = (await fichiersVersionnes(dossier)) ?? [];
  const depotPublic = options.depotPublic ?? (await visibiliteDuDepot(dossier));

  // 1. Lecture des fichiers versionnés : clés, injections, routes.
  const cles: CleTrouvee[] = [];
  const injections: InjectionTrouvee[] = [];
  const routes: RoutesDUnFichier[] = [];
  let gardeGlobale = false;
  let lus = 0;
  for (const f of fichiers) {
    if (!fichierAExaminer(f)) continue;
    const chemin = path.join(dossier, f);
    let contenu: string;
    try {
      const st = fs.statSync(chemin);
      if (!st.isFile() || st.size > TAILLE_MAX) continue;
      contenu = fs.readFileSync(chemin, 'utf8');
    } catch {
      continue;
    }
    if (contenu.includes('\0')) continue;
    lus++;
    cles.push(...clesEcrites(f, contenu));
    injections.push(...injectionsDansLeCode(f, contenu));
    const r = routesDuFichier(f, contenu);
    if (r) routes.push(r);
    if (!gardeGlobale && gardeGlobaleDansLeCode(contenu)) gardeGlobale = true;
  }
  if (!fichiers.length) {
    etapes.push({ nom: 'Lecture du code', etat: 'non-verifie', note: "le dossier n'est pas suivi par git" });
  } else {
    etapes.push({ nom: 'Lecture du code enregistré', etat: 'fait', note: `${lus} fichier(s) lus` });
    constats.push(...constatsDeCles(cles, depotPublic === true));
    etapes.push({
      nom: 'Clés et mots de passe lisibles par des inconnus',
      etat: depotPublic === null ? 'non-verifie' : 'fait',
      note:
        depotPublic === null
          ? 'visibilité du dépôt inconnue : seules les clés envoyées au navigateur ont été cherchées'
          : depotPublic
            ? 'dépôt public : toute clé écrite compte'
            : 'dépôt privé : seules les clés envoyées au navigateur comptent',
    });
    constats.push(...constatsDInjections(injections));
    etapes.push({ nom: 'Requêtes, commandes système et insertions de HTML', etat: 'fait' });
    constats.push(...constatsDAcces(routes, gardeGlobale));
    etapes.push({
      nom: "Contrôle d'accès des adresses du serveur",
      etat: 'fait',
      note: routes.length
        ? `${routes.reduce((s, r) => s + r.routes, 0)} route(s) repérée(s)${gardeGlobale ? ', une garde commune les couvre' : ''}`
        : 'aucune route repérée sous les formes connues (Express, Fastify, Next…) : à relire si le serveur aiguille ses adresses à la main',
    });
  }

  // 2. Dépendances, selon la pile trouvée.
  const audits = await Promise.all([auditNpm(dossier, fichiers), auditComposer(dossier, fichiers), auditPython(dossier, fichiers)]);
  const vulnerables: DependanceVulnerable[] = [];
  const noms = ['JavaScript', 'PHP', 'Python'];
  audits.forEach((a, i) => {
    if (a === null) return;
    if (a === 'absent') {
      etapes.push({ nom: `Composants externes ${noms[i]}`, etat: 'non-verifie', note: "l'outil d'audit n'est pas installé sur le serveur" });
      return;
    }
    vulnerables.push(...a.liste);
    etapes.push({ nom: `Composants externes et socle du site (${noms[i]})`, etat: 'fait', note: a.note });
  });
  if (audits.every((a) => a === null)) {
    etapes.push({ nom: 'Composants externes', etat: 'non-verifie', note: 'aucune liste de composants reconnue (npm, composer, pip)' });
  }
  constats.push(...constatsDeDependances(vulnerables));

  // 3. En-têtes de l'adresse publique.
  if (options.adresse) {
    try {
      constats.push(...constatsDEntetes(await releverLesEntetes(options.adresse)));
      etapes.push({ nom: "En-têtes de l'adresse publique", etat: 'fait', note: options.adresse });
    } catch (e) {
      etapes.push({ nom: "En-têtes de l'adresse publique", etat: 'non-verifie', note: `${options.adresse} ne répond pas (${(e as Error).message})` });
    }
  } else {
    etapes.push({ nom: "En-têtes de l'adresse publique", etat: 'non-verifie', note: 'aucune adresse publique donnée' });
  }

  const rapport: RapportDeSecurite = {
    projet: options.nom ?? path.basename(dossier),
    date: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    depotPublic,
    adresse: options.adresse,
    constats: trierParGravite(constats),
    etapes,
  };
  return { rapport, texte: rapportEnTexte(rapport), cartes: rapport.constats.map(carteDeCorrection) };
}
