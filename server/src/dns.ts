import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AccesVps, accesRenseignes, argumentsSsh, commandeDistante } from '@haikodev/shared';
import { accesVpsActuel } from './acces-vps.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Les adresses publiques (PLAN §12) : HaikoDev sait créer lui-même le
 * sous-domaine d'un projet, comme le faisait l'outil précédent. Le jeton du
 * fournisseur vit sur le serveur, jamais dans l'interface.
 *
 * Où tournent les commandes ? Cela dépend des ACCÈS AU VPS réglés dans l'onglet
 * Système (`shared/src/acces-vps.ts`). Vides — l'état par défaut —, tout se
 * passe EN LOCAL, mot pour mot comme avant. Renseignés, les mêmes gestes (lire
 * le jeton, écrire le reverse-proxy, recharger le service web) sont exécutés sur
 * la machine distante en SSH. La résolution DNS, elle, reste locale : le nom est
 * visible partout sur Internet.
 *
 * Ordre CRITIQUE : l'enregistrement DNS d'abord, le reverse-proxy ensuite.
 * L'inverse fait échouer l'émission du certificat et déclenche une limitation
 * d'une heure sur le sous-domaine.
 */

const ZONE = 'haikostudio.cloud';
const API = 'https://developers.hostinger.com/api/dns/v1/zones';

/** Exécute une commande, ici même ou sur la machine distante selon les accès. */
type Executeur = (programme: string, args: string[], timeout: number) => Promise<{ stdout: string; stderr: string }>;

function executeur(acces: AccesVps): Executeur {
  if (!accesRenseignes(acces)) {
    return (programme, args, timeout) => execFileAsync(programme, args, { timeout });
  }
  return (programme, args, timeout) => {
    const { programme: p, args: a } = argumentsSsh(acces, commandeDistante([programme, ...args]));
    return execFileAsync(p, a, { timeout });
  };
}

async function token(exec: Executeur): Promise<string | null> {
  try {
    const { stdout } = await exec(
      'sudo',
      ['-n', 'grep', '-oP', 'HOSTINGER_API_TOKEN=\\K.*', '/etc/root-storage-dashboard.env'],
      15000,
    );
    return stdout.trim().replace(/^["']|["']$/g, '') || null;
  } catch {
    return null;
  }
}

async function serverIp(acces: AccesVps, exec: Executeur): Promise<string> {
  // Machine distante : le sous-domaine doit pointer vers SON adresse publique.
  if (accesRenseignes(acces)) {
    const brut = acces.hote.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(brut)) return brut; // l'adresse réglée EST déjà une IP
    try {
      const { stdout } = await exec('curl', ['-s', 'https://api.ipify.org'], 15000);
      const ip = stdout.trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch {
      /* on retombe sur l'adresse réglée telle quelle */
    }
    return brut;
  }
  // Chemin local d'aujourd'hui, inchangé.
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10000) });
    const ip = (await res.text()).trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {
    /* on retombe sur l'adresse connue */
  }
  return '203.0.113.10';
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

  const acces = accesVpsActuel();
  const exec = executeur(acces);

  const key = await token(exec);
  if (!key) return { ok: false, error: "aucun accès au fournisseur de noms depuis ce serveur" };

  const ip = await serverIp(acces, exec);

  // 1. L'enregistrement, en fusion : les autres noms ne sont pas touchés.
  try {
    const res = await fetch(`${API}/${ZONE}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        overwrite: false,
        zone: [{ name: slug, type: 'A', ttl: 300, records: [{ content: ip }] }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.text();
      // Un conflit signifie que le nom existe déjà : c'est le résultat voulu.
      if (!/conflict|already/i.test(body) && res.status !== 422) {
        return { ok: false, error: `le fournisseur a refusé (${res.status})` };
      }
    }
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
  if (!resolu) return { ok: false, error: "le nom n'est pas encore visible sur Internet, réessayez dans un instant" };

  // 3. Le reverse-proxy, une fois le nom résolu.
  try {
    const bloc = `${nom} {\n\tencode gzip\n\n\treverse_proxy 127.0.0.1:${port} {\n\t\theader_up Host {upstream_hostport}\n\t}\n}\n`;
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
