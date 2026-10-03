import * as path from 'path';

// --- Credenciales y archivos sensibles ---
// ALYA puede buscar, leer y editar archivos, correr comandos y ver sus
// resultados. Nada de eso debe servir para que una contraseña, una API
// key o un archivo de cuentas termine en el chat, en la voz, en la
// consola o viajando al modelo. Acá viven las dos defensas:
//
// 1. isSensitivePath(): qué archivos y carpetas ALYA no lista, no lee y
//    no modifica.
// 2. redactSecrets() / redactDeep(): tacha cualquier secreto que igual
//    aparezca dentro de un texto o de un resultado de herramienta.
//
// Son reglas del programa, no pedidos al modelo: se cumplen aunque el
// modelo "quiera" otra cosa.

export const SENSITIVE_FILE_MESSAGE =
    'Ese archivo está protegido: puede contener credenciales o datos de cuentas, así que ALYA no lo abre, ' +
    'no lo muestra ni lo modifica. Las claves de ALYA se configuran desde el panel de Configuración.';

// Carpetas enteras que no se tocan (llaves SSH, credenciales de nube,
// perfiles de navegador con contraseñas y cookies guardadas, etc.).
const SENSITIVE_DIR_NAMES = new Set(['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.password-store']);
const SENSITIVE_DIR_FRAGMENTS = [
    '/google/chrome/user data',
    '/bravesoftware/',
    '/microsoft/edge/user data',
    '/mozilla/firefox/profiles',
    '/opera software/',
    '/vivaldi/user data',
    '/microsoft/credentials',
    '/microsoft/protect',
    '/microsoft/vault',
];

// Archivos sensibles por su nombre exacto o su extensión.
const SENSITIVE_EXACT_NAMES = new Set([
    '.npmrc',
    '.netrc',
    '.pypirc',
    '.git-credentials',
    'login data',
    'cookies',
    'cookies.sqlite',
    'logins.json',
    'key3.db',
    'key4.db',
    'wallet.dat',
    'web data',
    'local state',
]);
const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.pfx', '.p12', '.ppk', '.kdbx', '.kdb', '.keystore', '.jks', '.wallet', '.ovpn']);
const SAFE_ENV_SUFFIXES = ['.example', '.sample', '.template', '.dist'];

// Palabras que, en el nombre de un archivo de DATOS, indican que guarda
// credenciales o cuentas (ej. "spotifyAccount.json", "tokens.txt").
// En archivos de código no aplican: "spotifyAccountRepository.ts" es
// código que habla de cuentas, no una cuenta guardada.
//
// Hay dos niveles, para no esconder archivos normales:
// - Palabras inequívocas (contraseñas, tokens, claves): valen para
//   cualquier archivo de datos o documento ("contraseñas.xlsx").
// - Palabras ambiguas (cuenta, sesión...): solo en archivos de
//   configuración o datos de programas. "cuentas del mes.xlsx" es una
//   planilla de gastos, no una credencial.
const STRONG_WORDS =
    /(credential|credencial|\bsecrets?\b|\bsecretos?\b|password|passwd|contrasen|contraseñ|api ?keys?\b|\btokens?\b|\boauth\b|\bllaves?\b|\bkeys?\b|\bclaves?\b)/;
const WEAK_WORDS = /(\baccounts?\b|\bcuentas?\b|\bauth\b|\bsessions?\b|\bsesion(es)?\b|\bcookies?\b|\bprivate\b|\bprivad[oa]s?\b|\blogins?\b|\busers?\b|\busuarios?\b)/;

const CONFIG_EXTENSIONS = new Set([
    '',
    '.json',
    '.yml',
    '.yaml',
    '.ini',
    '.cfg',
    '.conf',
    '.config',
    '.xml',
    '.db',
    '.sqlite',
    '.sqlite3',
    '.dat',
    '.bak',
    '.properties',
    '.toml',
]);
const DOCUMENT_EXTENSIONS = new Set(['.txt', '.csv', '.log', '.xlsx', '.xls', '.docx', '.doc', '.md', '.rtf', '.pdf']);

/** ¿ALYA debe mantenerse lejos de este archivo o carpeta? */
export function isSensitivePath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const segments = normalized.split('/').filter(Boolean);
    const name = segments[segments.length - 1] ?? '';

    if (segments.some((segment) => SENSITIVE_DIR_NAMES.has(segment))) return true;
    if (SENSITIVE_DIR_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true;

    // .env, .env.local, produccion.env... (pero no .env.example)
    if (name === '.env' || name.startsWith('.env.') || name.endsWith('.env')) {
        return !SAFE_ENV_SUFFIXES.some((suffix) => name.endsWith(suffix));
    }

    if (SENSITIVE_EXACT_NAMES.has(name)) return true;
    if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) return true;

    const extension = path.posix.extname(name);
    if (SENSITIVE_EXTENSIONS.has(extension)) return true;

    const isConfig = CONFIG_EXTENSIONS.has(extension);
    if (isConfig || DOCUMENT_EXTENSIONS.has(extension)) {
        // Se separan las palabras del nombre: "spotifyAccount" -> "spotify account".
        const original = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
        const words = original
            .replace(/\.[^.]*$/, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_\-.]+/g, ' ')
            .toLowerCase();
        if (STRONG_WORDS.test(words)) return true;
        if (isConfig && WEAK_WORDS.test(words)) return true;
    }

    return false;
}

/**
 * ¿Este comando de terminal intenta leer un archivo sensible? Es una
 * revisión simple del texto del comando: no es infalible (por eso además
 * se tacha la salida), pero frena los casos directos tipo "type .env".
 */
export function commandTouchesSensitiveFiles(command: string): boolean {
    const text = command.toLowerCase();
    if (/(^|[\s"'\\/=])\.env(\.[a-z]+)?($|[\s"'|;&>])/.test(text) && !/\.env\.(example|sample|template)/.test(text)) return true;
    if (/(id_rsa|id_ed25519|id_ecdsa|\.pem\b|\.pfx\b|\.p12\b|\.ppk\b|\.kdbx\b|\.git-credentials|\.npmrc|\.netrc|\.ssh[\\/]|\.aws[\\/])/.test(text)) return true;
    if (/(login data|logins\.json|cookies\.sqlite|key4\.db|wallet\.dat)/.test(text)) return true;
    // Volcar todas las variables de entorno también expone las claves de ALYA.
    if (/(^|[\s;&|(])(set|printenv|env)\s*($|[|>;&])/.test(text)) return true;
    if (/(get-childitem|gci|dir|ls)\s+env:/.test(text) || /\$env:[a-z_]*(key|token|secret|password)/.test(text)) return true;
    if (/%[a-z_]*(key|token|secret|password)[a-z_]*%/.test(text)) return true;
    // Gestores de credenciales de Windows.
    if (/(cmdkey|vaultcmd|netsh\s+wlan\s+show\s+profile.*key\s*=\s*clear)/.test(text)) return true;
    return false;
}

const MASK = '[oculto]';

// Formatos reconocibles de claves y tokens.
const SECRET_PATTERNS: RegExp[] = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\bAIza[0-9A-Za-z_-]{30,}/g, // Google
    /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub
    /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
    /\bsk-[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic y similares
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
    /\bAKIA[0-9A-Z]{16}\b/g, // AWS
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g, // JWT
    /\b[MN][A-Za-z\d]{23,25}\.[\w-]{6}\.[\w-]{27,}/g, // token de bot de Discord
];

// "password = hunter2", "client_secret: abc...", "TOKEN=xyz": se deja el
// nombre y se tacha el valor. Partes: (nombre)(separador)(espacios)(comilla)(valor)
const ASSIGNMENT_PATTERN =
    /((?:pass(?:word|wd)?|pwd|contrase[nñ]a|secret(?:o)?|token|api[ _-]?key|apikey|client[ _-]?(?:secret|id)|access[ _-]?key|refresh[ _-]?token|access[ _-]?token|auth(?:orization)?|bearer|credential[s]?)["']?\s*)([:=])(\s*)(["']?)([^\s"',;&]{6,})/gi;

/**
 * ¿Ese valor parece de verdad una clave? En un archivo de configuración
 * ("password=perrito", "token": "abc") se tacha siempre. En una frase
 * normal ("el token: necesitas pedirlo en...") solo si tiene pinta de
 * clave — así no se tachan palabras comunes de una explicación.
 */
function looksLikeSecretValue(separator: string, quote: string, value: string): boolean {
    if (separator === '=' || quote) return true;
    return /\d/.test(value) || value.length >= 12;
}

const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CLIENT_ID|CHATROOM_ID)/i;

/** Los valores reales de las claves que ALYA tiene cargadas (del .env). */
function ownSecretValues(): string[] {
    const values: string[] = [];
    for (const [name, value] of Object.entries(process.env)) {
        // (se descartan valores con espacios o barras invertidas: son rutas o
        // frases, no claves, y tacharlas rompería textos normales)
        if (value && value.length >= 8 && SECRET_ENV_NAME.test(name) && !/[\s\\]/.test(value)) values.push(value);
    }
    // Las más largas primero, por si una contiene a otra.
    return values.sort((a, b) => b.length - a.length);
}

/** Tacha cualquier secreto que aparezca en un texto. */
export function redactSecrets(text: string): string {
    if (!text) return text;
    let clean = text;

    for (const value of ownSecretValues()) {
        if (clean.includes(value)) clean = clean.split(value).join(MASK);
    }
    for (const pattern of SECRET_PATTERNS) {
        clean = clean.replace(pattern, MASK);
    }
    clean = clean.replace(
        ASSIGNMENT_PATTERN,
        (match: string, label: string, separator: string, spaces: string, quote: string, value: string) => {
            if (value === MASK || !looksLikeSecretValue(separator, quote, value)) return match;
            return `${label}${separator}${spaces}${quote}${MASK}`;
        }
    );

    return clean;
}

/** Lo mismo, recorriendo objetos y listas (para resultados de herramientas). */
export function redactDeep<T>(value: T): T {
    if (typeof value === 'string') return redactSecrets(value) as unknown as T;
    if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as unknown as T;
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = redactDeep(item);
        return out as T;
    }
    return value;
}