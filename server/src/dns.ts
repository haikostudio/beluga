import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { blocReverseProxySousDomaine, identiteDInstallation, ipsPubliquesDesInterfaces, zoneDesProjets } from '@beluga/shared';
import { fournisseurRetenu, piloteDeNoms, secretsDuFournisseur, type PiloteDeNoms } from './fournisseurs-de-noms.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Les adresses publiques (PLAN §12) : Beluga Build sait créer lui-même le
 * sous-domaine d'un projet, comme le faisait l'outil précédent. Le jeton du
 * fournisseur vit sur le serveur, jamais dans l'interface.
 *
 * Tout se passe EN LOCAL, sur la machine de Beluga Build : lire le jeton,
 * écrire le reverse-proxy, recharger le service web. L'ancienne exécution
 * distante par SSH (réglage « Accès au VPS ») a été retirée — elle n'était
 * plus jamais renseignée.
 *
 * Ordre CRITIQUE : l'enregistrement DNS d'abord, le reverse-proxy ensuite.
 * L'inverse fait échouer l'émission du certificat et déclenche une limitation
 * d'une heure sur le sous-domaine.
 */

/*
 * LA ZONE N'EST PLUS ÉCRITE ICI : c'est celle de l'installation
 * (`zoneDesProjets`, réglée dans l'assistant ou les réglages). Sans zone, la
 * création d'adresse est ÉTEINTE et le dit.
 *
 * LE FOURNISSEUR NON PLUS : ce fichier tient l'ORDRE (enregistrement,
 * propagation, reverse-proxy) et parle à un PILOTE (`fournisseurs-de-noms.ts`)
 * sans savoir lequel — Hetzner, Cloudflare, Infomaniak, OVH ou Gandi, selon le
 * réglage `fournisseurDeNoms` de l'installation.
 *
 * DEUX FAÇONS DE FAIRE EXISTER LE NOM, selon ce que l'installation a réglé :
 *  - un fournisseur et ses SECRETS : le démon crée lui-même l'enregistrement de
 *    chaque projet. Les secrets vivent au coffre-fort, une fiche par secret ;
 *    le jeton Hetzner est d'abord cherché dans son propre fichier,
 *    `/etc/beluga/jeton-hetzner`, où les installations d'avant le coffre le
 *    gardent ;
 *  - AUCUN secret (règle « tous les noms », ou réglage vide sans jeton Hetzner) :
 *    le nom doit déjà exister — un enregistrement joker (`*.zone`) posé une fois
 *    chez n'importe quel fournisseur suffit. Le démon vérifie seulement que le
 *    nom mène bien à cette machine, puis pose le reverse-proxy.
 *
 * Un fournisseur RÉGLÉ dont les secrets manquent suit le second chemin — rien
 * n'est écrit — et le DIT, au lieu de laisser croire à une panne du fournisseur.
 */

/** Exécute une commande sur cette machine. */
function exec(programme: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(programme, args, { timeout });
}

/**
 * LE PILOTE DES NOMS de cette installation, ou la raison de son absence.
 *
 * `pilote: null` veut dire « rien ne sera écrit chez un fournisseur » ; `manque`
 * distingue alors les deux cas : vide, c'est voulu (règle « tous les noms ») ;
 * rempli, un fournisseur est réglé mais ses secrets ne sont pas là.
 *
 * Réglage VIDE : c'est la présence d'un jeton Hetzner qui tranche, comme avant
 * ce réglage — il n'est lu que dans ce cas, et resservi sans seconde lecture.
 */
async function piloteRetenu(): Promise<{ pilote: PiloteDeNoms | null; manque: string }> {
  const regle = identiteDInstallation().fournisseurDeNoms;
  // « Sans jeton Hetzner, ce serait le joker » alors que le joker n'est pas
  // demandé : le réglage est vide (ou inconnu), et c'est le jeton qui décide.
  const sansReglage = regle !== 'joker' && fournisseurRetenu(regle, false) === 'joker';
  const hetzner = sansReglage ? await secretsDuFournisseur('hetzner') : null;
  const fournisseur = fournisseurRetenu(regle, hetzner !== null && !hetzner.manque);
  if (fournisseur === 'joker') return { pilote: null, manque: '' };
  const secrets = hetzner ?? (await secretsDuFournisseur(fournisseur));
  if (secrets.manque) return { pilote: null, manque: secrets.manque };
  return { pilote: piloteDeNoms(fournisseur, secrets.valeurs), manque: '' };
}

/**
 * L'ADRESSE IP PUBLIQUE DE CETTE MACHINE : demandée au dehors, sinon lue sur
 * ses propres interfaces. Jamais une adresse écrite ici — celle d'une autre
 * machine ferait pointer chaque projet ailleurs.
 */
export async function serverIp(): Promise<string> {
  const forcee = process.env.BELUGA_IP_PUBLIQUE?.trim();
  if (forcee) return forcee;
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10000) });
    const ip = (await res.text()).trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {
    /* on retombe sur les interfaces de la machine */
  }
  return ipsPubliquesDesInterfaces(os.networkInterfaces() as any).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ?? '';
}

export interface DnsResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Crée l'enregistrement, attend qu'il se propage, puis pose le reverse-proxy. */
export async function publishSubdomain(subdomain: string, port: number): Promise<DnsResult> {
  const slug = subdomain
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!slug) return { ok: false, error: 'nom de sous-domaine vide' };

  const ZONE = zoneDesProjets();
  if (!ZONE) {
    return {
      ok: false,
      error:
        "cette installation n'a pas encore de nom de domaine pour ses projets : il se règle dans Réglages, page « Installation »",
    };
  }

  const { pilote, manque } = await piloteRetenu();
  const ip = await serverIp();
  if (!ip) return { ok: false, error: "l'adresse publique de ce serveur n'a pas pu être lue" };

  // 1. L'enregistrement, ajouté seul : les autres noms ne sont pas touchés.
  //    SANS PILOTE, rien n'est écrit : le nom doit déjà exister (joker `*.zone`),
  //    et l'étape 2 le vérifie comme pour un nom tout juste créé.
  if (pilote) try {
    const raison = await pilote.creerA(ZONE, slug, ip);
    if (raison) return { ok: false, error: raison };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'appel au fournisseur impossible' };
  }

  // 2. La propagation, AVANT de toucher au reverse-proxy. Elle se lit d'ici :
  //    le nom est visible partout sur Internet, machine locale ou distante.
  const nom = `${slug}.${ZONE}`;
  let resolu = false;
  for (let essai = 0; essai < 20 && !resolu; essai++) {
    try {
      const { stdout } = await execFileAsync('dig', ['+short', '@1.1.1.1', nom, 'A'], { timeout: 10000 });
      resolu = stdout.includes(ip);
    } catch {
      /* on réessaie */
    }
    if (!resolu) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!resolu) {
    return {
      ok: false,
      error: pilote
        ? "le nom n'est pas encore visible sur Internet, réessayez dans un instant"
        : manque
          ? `${nom} ne mène pas à ce serveur (${ip}) : ${manque}`
          : `${nom} ne mène pas à ce serveur (${ip}) : sans jeton du fournisseur de noms, il faut un enregistrement « *.${ZONE} » qui pointe ici`,
    };
  }
  // Le nom mène ici sans que le démon l'ait posé, alors qu'un fournisseur est
  // réglé : la publication aboutit, mais le secret absent ne doit pas passer
  // inaperçu — le prochain nom n'aura peut-être pas cette chance.
  if (manque) log.warn(`${nom} mène déjà à ce serveur, rien n'a été écrit chez le fournisseur : ${manque}`);

  // 3. Le reverse-proxy, une fois le nom résolu.
  try {
    // L'adresse demandée arrive INTACTE au projet : voir blocReverseProxySousDomaine.
    const bloc = blocReverseProxySousDomaine(nom, port);
    await exec(
      'sudo',
      ['-n', 'bash', '-c', `cat > /etc/caddy/project-autostart.d/${slug}.caddy <<'FIN'\n${bloc}FIN`],
      20000,
    );
    await exec('sudo', ['-n', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], 30000);
    await exec('sudo', ['-n', 'systemctl', 'reload', 'caddy'], 30000);
  } catch (err: any) {
    return { ok: false, error: `nom créé, mais le service web a refusé la configuration : ${err?.message ?? err}` };
  }

  log.info(`sous-domaine publié : https://${nom} → 127.0.0.1:${port}`);
  return { ok: true, url: `https://${nom}` };
}

/**
 * RETIRE L'ADRESSE PUBLIQUE d'un projet supprimé : le bloc du reverse-proxy
 * d'abord (l'adresse cesse de répondre), puis l'enregistrement DNS. Ne touche que
 * `<nom>.<zone>` où `<nom>` est un seul mot simple — jamais un chemin,
 * jamais un autre domaine. Un échec est DIT, il n'arrête rien : le projet est
 * déjà parti, une adresse orpheline se retire à la main.
 */
export async function retirerSousDomaine(devUrl: string): Promise<{ ok: boolean; detail: string }> {
  let hote = '';
  try {
    hote = new URL(devUrl).hostname.toLowerCase();
  } catch {
    return { ok: true, detail: 'adresse non standard, rien à retirer' };
  }
  const ZONE = zoneDesProjets();
  const suffixe = `.${ZONE}`;
  const slug = ZONE && hote.endsWith(suffixe) ? hote.slice(0, -suffixe.length) : '';
  if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
    return { ok: true, detail: `${hote} n’est pas une adresse posée par Beluga Build, laissée telle quelle` };
  }
  const dits: string[] = [];
  let ok = true;
  try {
    await exec('sudo', ['-n', 'rm', '-f', `/etc/caddy/project-autostart.d/${slug}.caddy`], 20000);
    await exec('sudo', ['-n', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], 30000);
    await exec('sudo', ['-n', 'systemctl', 'reload', 'caddy'], 30000);
    dits.push('reverse-proxy retiré');
  } catch (err: any) {
    ok = false;
    dits.push(`reverse-proxy non retiré (${err?.message ?? err})`);
  }
  try {
    const { pilote, manque } = await piloteRetenu();
    // Sans pilote, le nom n'a pas été créé par le démon (joker) : rien à retirer.
    if (!pilote) throw new Error(manque || 'aucun jeton du fournisseur de noms, enregistrement laissé');
    const raison = await pilote.supprimerA(ZONE, slug);
    if (raison) throw new Error(raison);
    dits.push('enregistrement DNS retiré');
  } catch (err: any) {
    ok = false;
    dits.push(`enregistrement DNS non retiré (${err?.message ?? err})`);
  }
  log.info(`sous-domaine retiré : ${hote}`);
  return { ok, detail: `${hote} : ${dits.join(', ')}` };
}
