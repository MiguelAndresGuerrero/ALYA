// --- Guías paso a paso ---
// Minitutoriales que ALYA muestra cuando alguien tiene que hacer un
// trámite fuera de ALYA (crear una app en Spotify, por ejemplo). El texto
// vive en un solo lugar y lo usan dos pantallas: la tarjeta del chat
// (herramienta mostrar_guia) y el panel de Configuración.
//
// Si Spotify cambia su página, lo único que hay que actualizar es este archivo.

// La dirección a la que Spotify devuelve al usuario después de aprobar el
// acceso. Tiene que ser EXACTAMENTE la misma acá, en spotify.ts y en la
// app creada en Spotify for Developers.
export const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback';
export const SPOTIFY_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

export interface GuideStep {
    title: string;
    text: string;
    /** Un valor para copiar con un botón (ej. el Redirect URI). */
    copy?: string;
    /** Un enlace para abrir en el navegador. */
    link?: { label: string; url: string };
}

export interface GuideAction {
    label: string;
    action: 'settings' | 'link';
    url?: string;
}

export interface Guide {
    id: string;
    title: string;
    intro: string;
    /** Cosas a saber antes de empezar. */
    notes: string[];
    steps: GuideStep[];
    /** Si algo sale mal: qué se ve y cómo se arregla. */
    problems: Array<{ problem: string; fix: string }>;
    actions: GuideAction[];
}

const SPOTIFY_GUIDE: Guide = {
    id: 'spotify',
    title: 'Conectar Spotify con ALYA',
    intro:
        'Para que ALYA reproduzca canciones directo en tu Spotify necesita dos datos de una "app" que creas gratis ' +
        'en la página de desarrolladores de Spotify: el Client ID y el Client Secret. Se hace una sola vez y toma unos 5 minutos.',
    notes: [
        'Necesitas Spotify Premium: desde febrero de 2026 Spotify lo exige para crear apps de desarrollador.',
        'Solo se permite una app por cuenta. Si ya creaste una antes, usa esa: no hace falta otra.',
        'El Client Secret es como una contraseña: no lo compartas ni lo pegues en el chat, solo en Configuración.',
    ],
    steps: [
        {
            title: 'Abre el Dashboard de Spotify',
            text: 'Entra con tu cuenta de Spotify. Si es la primera vez, te pedirá aceptar los términos de desarrollador.',
            link: { label: 'Abrir el Dashboard', url: SPOTIFY_DASHBOARD_URL },
        },
        {
            title: 'Crea la app',
            text: 'Pulsa el botón "Create app" (arriba a la derecha). En "App name" y "App description" escribe lo que quieras, por ejemplo ALYA.',
        },
        {
            title: 'Pega el Redirect URI',
            text:
                'En el campo "Redirect URIs" pega esta dirección y pulsa "Add". Tiene que quedar idéntica: con http (no https), ' +
                'con 127.0.0.1 (no "localhost") y sin barra al final.',
            copy: SPOTIFY_REDIRECT_URI,
        },
        {
            title: 'Marca Web API y guarda',
            text: 'Donde pregunta qué API vas a usar, marca "Web API". Acepta los términos ("Developer Terms of Service") y pulsa "Save".',
        },
        {
            title: 'Copia el Client ID y el Client Secret',
            text: 'Entra a la app que acabas de crear y pulsa "Settings". Ahí aparece el Client ID. Para ver el otro dato pulsa "View client secret".',
        },
        {
            title: 'Pégalos en ALYA',
            text:
                'En Configuración de ALYA, sección Spotify, pega los dos datos y pulsa "Guardar y conectar Spotify". ' +
                'Se abre tu navegador para que apruebes el acceso: acepta y listo.',
        },
    ],
    problems: [
        {
            problem: 'Al conectar sale un error 400 o "Spotify rechazó las credenciales"',
            fix: 'El Client Secret no corresponde a ese Client ID, o se pegó con un espacio de más. Cópialos de nuevo, los dos de la misma app.',
        },
        {
            problem: 'El navegador muestra "INVALID_CLIENT: Invalid redirect URI"',
            fix: `El Redirect URI guardado en la app no es exactamente ${SPOTIFY_REDIRECT_URI}. Corrígelo en "Settings" de la app y guarda.`,
        },
        {
            problem: 'No te deja crear la app',
            fix: 'Tu cuenta no es Premium, o ya tienes una app creada (solo se permite una): usa la que ya existe.',
        },
        {
            problem: 'Error 403 al iniciar sesión con otra cuenta',
            fix: 'Esa cuenta no es la dueña de la app. En el Dashboard entra a "User Management" y agrégala (máximo 5 personas). Lo ideal es que cada persona cree su propia app.',
        },
        {
            problem: 'Conecta bien pero no reproduce',
            fix: 'Spotify necesita un dispositivo activo: abre Spotify y dale play a cualquier canción una vez.',
        },
    ],
    actions: [
        { label: 'Abrir el Dashboard de Spotify', action: 'link', url: SPOTIFY_DASHBOARD_URL },
        { label: 'Abrir Configuración de ALYA', action: 'settings' },
    ],
};

const GUIDES: Record<string, Guide> = {
    spotify: SPOTIFY_GUIDE,
};

export const GUIDE_IDS = Object.keys(GUIDES);

export function getGuide(id: string): Guide | null {
    return GUIDES[String(id).toLowerCase().trim()] ?? null;
}