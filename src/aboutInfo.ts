// --- Contenido de la ventana "Acerca de ALYA" ---
// Todo el texto fijo de esa ventana vive acá: quién la hizo, los enlaces,
// las novedades de cada versión, el resumen de privacidad y los créditos
// de código abierto. Para publicar una versión nueva, lo único que hay
// que tocar es CHANGELOG (agregar la versión arriba de todo).

export const DEVELOPER = 'Andrés Guerrero';
export const TAGLINE = 'Tu asistente personal para el escritorio.';

const REPOSITORY = 'https://github.com/MiguelAndresGuerrero/ALYA';

export const LINKS = {
    repository: REPOSITORY,
    releases: `${REPOSITORY}/releases`,
    reportBug: `${REPOSITORY}/issues/new`,
};

/** Nombre legible del modelo (el identificador técnico no le dice nada a nadie). */
export function modelLabel(modelId: string): string {
    const known: Record<string, string> = {
        'gemini-3.5-flash-lite': 'Gemini 3.5 Flash-Lite',
        'gemini-3.5-flash': 'Gemini 3.5 Flash',
        'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
        'gemini-3.6-flash': 'Gemini 3.6 Flash',
        'gemini-3.8-flash': 'Gemini 3.8 Flash',
    };
    return known[modelId] ?? modelId;
}

export interface ChangelogEntry {
    version: string;
    date: string;
    items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '1.0.8',
        date: 'Octubre de 2026',
        items: [
            'Muéstrale tu pantalla: el botón nuevo del chat (o Ctrl+Shift+2 desde cualquier lugar) adjunta una captura para que le preguntes por lo que ves.',
            'Las capturas ya no incluyen la ventana de ALYA y salen a la resolución real de la pantalla.',
            'Cerebros de respaldo: si el modelo principal está saturado, responde otro automáticamente sin perder el hilo.',
            'Si aun así ninguno responde, ALYA lo explica en palabras normales, sin mensajes técnicos.',
            'Corregido: a veces respondía con el nombre de una herramienta ("estado_sistema()") en vez de usarla.',
        ],
    },
    {
        version: '1.0.7',
        date: 'Octubre de 2026',
        items: [
            'Interfaz nueva: historial de conversaciones, avatar que muestra lo que ALYA está haciendo, fondo y tarjetas con resultados.',
            'Puedes mandarle imágenes: adjuntar, pegar con Ctrl+V o arrastrarlas a la ventana.',
            'Voz con tono ajustable y expresión automática según lo que dice.',
            'Respuestas en vivo: el texto aparece mientras lo escribe y empieza a hablar con la primera frase.',
            'Puedes interrumpirla: Esc, el botón "Callar", empezar a hablarle o (opcional) solo con tu voz.',
            'El botón de voz la calla en el momento y recuerda si la dejaste silenciada (Ctrl+M).',
            'Piensa más a fondo las preguntas difíciles y se adapta a cómo la usas.',
            'Reconoce la canción que suena en Spotify, YouTube u otra app, sin depender del micrófono.',
            'Guarda canciones en tus favoritos de Spotify sin configurar la API.',
            'Guía paso a paso para conectar Spotify.',
            'Protección de credenciales: no muestra ni lee archivos sensibles y oculta cualquier clave.',
            'El estado del sistema ahora coincide con el Administrador de tareas.',
            'Icono y avatar nuevos; las notificaciones y la barra de tareas dicen "ALYA".',
        ],
    },
    {
        version: '1.0.6',
        date: 'Agosto de 2026',
        items: [
            'Credenciales de Spotify configurables desde el panel de Configuración.',
            'Control de volumen de la voz.',
        ],
    },
    {
        version: '1.0.3',
        date: 'Agosto de 2026',
        items: ['Corregido un error que impedía abrir la versión instalada.'],
    },
    {
        version: '1.0.0',
        date: 'Agosto de 2026',
        items: ['Primera versión: conversación por texto y voz, control del PC, memoria, rutinas e integraciones de música y streaming.'],
    },
];

export interface InfoSection {
    title: string;
    items: string[];
}

// Resumen de privacidad: qué guarda ALYA y qué sale de tu PC. Describe lo
// que el programa hace de verdad — si cambia el código, hay que revisarlo.
export const PRIVACY: InfoSection[] = [
    {
        title: 'Lo que se queda en tu PC',
        items: [
            'Tus conversaciones, lo que ALYA recuerda de ti y cómo la usas, tus rutinas, recordatorios y ajustes. Todo en la carpeta de datos de ALYA.',
            'Tus claves (Gemini, AudD, Spotify). ALYA nunca las muestra en el chat ni las dice en voz alta.',
            'La voz se genera en tu propio equipo, sin internet.',
            'ALYA no tiene servidores propios: quien la desarrolló no recibe nada de lo que haces con ella.',
        ],
    },
    {
        title: 'Lo que se envía a Google (Gemini)',
        items: [
            'Lo que escribes o dices, las imágenes que adjuntas y, cuando le pides ver tu pantalla, una captura de ese momento.',
            'Lo que ALYA recuerda de ti y un resumen de cómo la usas, para que pueda adaptarse.',
            'El resultado de las acciones que hace por ti (por ejemplo, los nombres de los archivos que encontró).',
            'Se usa tu propia clave de Gemini: aplican las condiciones de Google para esa clave.',
        ],
    },
    {
        title: 'Otros servicios, solo si los usas',
        items: [
            'AudD: unos segundos del audio que suena, cuando pides identificar una canción.',
            'Spotify: las búsquedas y órdenes de reproducción, con tu cuenta.',
            'Pollinations: la descripción de la imagen, cuando le pides generar una.',
            'Kick, Twitch y YouTube: se lee el chat en vivo del canal que configures.',
            'GitHub: se consulta si hay una versión nueva de ALYA.',
        ],
    },
    {
        title: 'Lo que nunca sale',
        items: [
            'Contraseñas, claves y archivos de credenciales: ALYA no los abre, y si alguna clave aparece en un resultado se tacha antes de enviarse.',
        ],
    },
    {
        title: 'Cómo borrar tus datos',
        items: [
            'Dile "olvida que…" para borrar un recuerdo, o borra conversaciones desde el historial.',
            'Apaga "Adaptarse a mí" en Configuración para que deje de aprender cómo la usas.',
            'Para borrar todo, elimina la carpeta de datos de ALYA (el botón de abajo la abre).',
        ],
    },
];

export interface LicenseEntry {
    name: string;
    license: string;
    /** Para qué lo usa ALYA. */
    use: string;
    /** Nombre del paquete instalado, para leer su versión real. */
    packageName?: string;
}

export const LICENSES: LicenseEntry[] = [
    { name: 'Electron', license: 'MIT', use: 'La base de la aplicación' },
    { name: 'Google Gen AI SDK', license: 'Apache-2.0', use: 'Conexión con Gemini', packageName: '@google/genai' },
    { name: 'Piper', license: 'MIT', use: 'Voz neuronal local' },
    { name: 'ONNX Runtime', license: 'MIT', use: 'Motor que ejecuta el modelo de voz' },
    { name: 'eSpeak NG', license: 'GPL-3.0', use: 'Pronunciación (parte de Piper)' },
    { name: 'systeminformation', license: 'MIT', use: 'Estado del sistema', packageName: 'systeminformation' },
    { name: 'electron-updater', license: 'MIT', use: 'Actualizaciones', packageName: 'electron-updater' },
    { name: 'ws', license: 'MIT', use: 'Chat en vivo', packageName: 'ws' },
    { name: 'dotenv', license: 'BSD-2-Clause', use: 'Lectura de tus claves', packageName: 'dotenv' },
    { name: 'auto-launch', license: 'MIT', use: 'Inicio con Windows', packageName: 'auto-launch' },
];