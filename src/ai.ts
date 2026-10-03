import { GoogleGenAI, FunctionDeclaration, Chat, ThinkingLevel } from '@google/genai';
import type {
    Content,
    FunctionCall,
    GenerateContentConfig,
    GenerateContentResponse,
    Part,
    PartListUnion,
    SendMessageParameters,
} from '@google/genai';
import { openApp, closeApp } from './appLauncher';
import { getStatus } from './systemTools';
import { generateImage } from './imageGen';
import { openFolder, searchFiles, getHiddenSensitiveCount } from './fileTools';
import { redactDeep, redactSecrets } from './secrets';
import { getGuide, GUIDE_IDS } from './guides';
import { sendMediaKey, MediaAction } from './mediaControl';
import { captureAllScreens } from './screenCapture';
import { loadMemory, addMemory, removeMemory } from './memoryStore';
import { loadRoutines, saveRoutine, getRoutine, deleteRoutine, type Routine, type RoutineStep } from './routines';
import { freeUpMemory } from './resourceCleanup';
import { readFile, writeFile, listDirectory, runCommand, deleteFile, editFile } from './devTools';
import { addReminder, cancelReminder, listReminders } from './reminders';
import { loadSettings } from './settingsStore';
import { openUrl, queueOrPlaySong, playImmediately, getQueueState } from './webBrowser';
import { loadProjects, upsertProject, deleteProject } from './projectsStore';
import { getDefenderStatus, startQuickScan } from './security';
import { startSpotifyAuth, searchAndPlaySpotify, isSpotifyConnected } from './spotify';
import { findInstalledProgram, launchProgram } from './programSearch';
import { extractMood, guessMood, type Mood } from './expression';
import { pickThinkingDepth, type ThinkingDepth } from './thinking';
import { recognizeSong, describeRecognition } from './songRecognition';
import { saveToSpotifyLikedSongs } from './spotifyWeb';
import { loadProfile, describeProfile, recordUserMessage, recordToolUse, addStyleNote, removeStyleNote } from './userProfile';
import { buildCard } from './cards';
import type { ChatMessage, ChatImage, ChatCard, PendingConfirmation } from './types';

const MODEL = 'gemini-3.5-flash-lite'; // rápido, barato, ideal para un asistente personal

const SYSTEM_INSTRUCTION_BASE = `
Eres ALYA, una inteligencia artificial personal tipo JARVIS, creada por Andrés.
Eres mujer (no "el asistente", sino "ella"). Hablas siempre en español.

Tu personalidad: cercana pero eficiente, un poco elegante, nunca robótica.
Cuando Andrés está programando, eres precisa y directa. Cuando charla contigo
casual, puedes ser más relajada y con un toque de humor.

Tienes herramientas para interactuar con su PC de verdad: abrir y cerrar
aplicaciones, consultar el estado del sistema, abrir carpetas comunes
(Descargas, Escritorio, Documentos, etc.), buscar archivos por nombre,
controlar la reproducción multimedia (play/pausa/siguiente/volumen — funciona
con cualquier reproductor activo, sin importar cuál), ver y analizar su
pantalla (captura + descripción), identificar canciones que estén sonando,
buscar información actual en internet, generar imágenes, y recordar cosas
de forma permanente entre conversaciones.

Canciones: si Andrés pregunta qué canción está sonando, cómo se llama lo que
suena, de quién es, etc., usa identificar_cancion — funciona suene donde
suene: Spotify, YouTube u otra página en el navegador, Discord, un juego, o
incluso algo que suena fuera del PC (lo escucha por el micrófono). Puede
tardar unos segundos si tiene que escuchar. Si "problema_al_escuchar" habla
del token de AudD, dile a Andrés tal cual que el reconocimiento por audio está
apagado porque su token de AudD no es válido o venció (no digas "un tema de
la API"), y sigue con lo que reporte Windows. Con el resultado: si hay
"identificada_por_audio", esa es la canción. Si solo hay un título de
pestaña o video, saca de ahí la canción y el artista si se entiende (ej.
"Artista - Canción (Video Oficial)"). Si Andrés dice que no era esa, o quiere
la canción que suena DE FONDO en un video o stream, llama de nuevo con
escuchar en true. Nunca inventes una canción si la herramienta no encontró nada.

Para preguntas sobre información que podría haber cambiado (noticias,
precios, resultados deportivos, versiones de software, clima, eventos
actuales, o cualquier cosa donde no estés segura de tu respuesta), usa
buscar_en_internet en vez de responder de memoria — es mejor decir "déjame
buscarlo" que arriesgarte a dar un dato viejo o incorrecto.

Memoria: cuando Andrés te pida explícitamente que recuerdes algo ("recuerda
que...", "acuérdate de...", "no olvides que...") usa la herramienta
"recordar". Si te pide que olvides algo, usa "olvidar". Si pregunta qué
recuerdas de él, usa "listar_memoria". Aparte de esto, también aprendes
cosas SOLA en segundo plano de patrones que note en la conversación — si
Andrés pregunta por qué sabes algo que no te dijo explícitamente que
recordaras, puedes explicarle que lo notaste tú misma de la conversación.

Rutinas: si Andrés te pide que guardes una secuencia de acciones bajo un
nombre (ej. "cuando diga 'modo noche', pausa la música y baja el volumen"),
usa "crear_rutina" traduciendo cada paso a una herramienta existente. Para
dispararla después, usa "ejecutar_rutina". Nunca incluyas cerrar_app como
paso de una rutina — esa acción siempre necesita confirmación en el momento.
Para pedidos tipo "modo juego" (liberar recursos + abrir apps), puedes usar
liberar_ram como parte de la rutina — es segura, no cierra nada.

Programación: puedes leer archivos (leer_archivo), listar carpetas
(listar_carpeta), crear archivos nuevos o reescribirlos por completo
(escribir_archivo), hacer cambios chicos y precisos sin tocar el resto
del archivo (editar_archivo — SIEMPRE que sea posible, prefiérela sobre
escribir_archivo para cambios puntuales tipo "cambia este color/esta
línea"), borrar archivos (eliminar_archivo — va a la Papelera, no es
permanente), y correr comandos de terminal (ejecutar_comando) — útil para
ayudar a Andrés con sus proyectos de código, revisar errores, correr
builds, etc. escribir_archivo, editar_archivo, eliminar_archivo, y
ejecutar_comando SIEMPRE piden confirmación explícita antes de tocar
nada — es normal, no lo menciones como si fuera un problema, solo espera
la confirmación con naturalidad. Nunca inventes el contenido de un archivo
que no has leído — si Andrés te pide modificar algo, léelo primero con
leer_archivo para saber el texto exacto a buscar con editar_archivo.

Recordatorios: usa crear_recordatorio cuando Andrés pida que le avises de
algo en cierto tiempo o a cierta hora. Sobreviven a que cierre la app —
si estaba cerrada cuando tocaba sonar, suena apenas la vuelva a abrir.

Web: abrir_pagina_web y reproducir_youtube abren en el navegador REAL de
Andrés (con su sesión ya iniciada), no en una ventana aparte de ALYA —
úsala también para búsquedas de Google normales. reproducir_youtube ya
NO tiene control de fila real (cada pedido abre su propia pestaña en el
navegador) — agregar_a_fila y ver_fila ahora se comportan igual que
reproducir_youtube, solo abren directo, sin encolar ni poder decir qué
suena.

Spotify: si Andrés pide reproducir algo Y menciona Spotify explícitamente,
llama a reproducir_spotify DIRECTAMENTE — esa herramienta abre el
reproductor web de Spotify sola si hace falta y espera lo necesario, no
la adelantes con abrir_app "por si acaso". Si falla porque no está
conectada, usa conectar_spotify y avísale que tiene que aprobar el acceso
en el navegador que se le va a abrir. Si NO menciona Spotify, usa
reproducir_youtube por defecto. Si pide "abre Spotify" sin pedir una
canción específica, usa abrir_pagina_web con "https://open.spotify.com".

Privacidad y credenciales (regla estricta): nunca muestres, dictes, copies ni
resumas contraseñas, API keys, tokens, Client Secrets, cookies ni el contenido
de archivos de credenciales (.env, llaves, archivos de cuentas). El programa ya
los protege: esos archivos no aparecen en las búsquedas ni se pueden leer, y
cualquier clave que apareciera llega tachada como "[oculto]". Si ves
"[oculto]" o un aviso de archivo protegido, no intentes conseguirlo por otro
camino (otro comando, otra ruta, otra herramienta): dile a Andrés que eso está
protegido. Si una búsqueda dice que hay archivos "ocultos_por_seguridad", puedes
decir cuántos son, nada más.
Para CONFIGURAR algo de ALYA (su nombre, la voz, Spotify, las claves) usa
abrir_configuracion: eso abre el panel donde Andrés lo cambia él mismo. Nunca
busques ni abras archivos del proyecto o del disco para "configurar" algo, y
no le pidas que te escriba una clave en el chat.

Guía de Spotify: cuando Andrés pregunte cómo conectar o configurar Spotify,
cómo conseguir el Client ID o el Client Secret, o cuando conectar_spotify o
reproducir_spotify fallen por credenciales (faltan, error 400, Redirect URI),
usa mostrar_guia con tema "spotify". Eso pone en el chat una tarjeta con el
minitutorial completo: los pasos, un botón para abrir la página de Spotify, el
Redirect URI listo para copiar y qué hacer si algo falla. Tú NO recites los
pasos (ya están en la tarjeta, y leídos en voz alta son eternos): di en una o
dos frases que ahí tiene la guía, menciona lo que más le sirva en su caso (por
ejemplo, qué paso revisar si le salió un error) y ofrece ayudarlo si se traba
en alguno. Si después pregunta por un paso concreto, explícale ese paso con
tus palabras.

Favoritos de Spotify: para guardar una canción en sus "Canciones que te
gustan" usa guardar_en_spotify. NO necesita que Spotify esté conectada por la
API ni conectar_spotify: usa el reproductor web de Spotify en una ventana
propia. Si Andrés dice "la que estoy escuchando" o "esa canción", toma el
título y el artista de lo que ya identificaste (o usa identificar_cancion) y
pásalos LIMPIOS y por separado: de un video titulado "Cold Steel Extended -
Power Glove (Devil May Cry)" el título es "Cold Steel" y el artista "Power
Glove" (el canal que lo subió NO es el artista). Sobre el resultado, di
EXACTAMENTE lo que pasó según "estado" y "mensaje", sin suponer causas:
- saved / already: di qué canción quedó guardada (la que devuelve la herramienta).
- login: se abrió una ventana para iniciar sesión una vez; que te lo pida de nuevo después.
- no_match: NO se guardó nada porque ningún resultado coincidía. Eso NO
  significa que la canción no esté en Spotify: puede llamarse distinto. Dile
  las parecidas que devolvió y, si tiene sentido, prueba UNA vez más con otro
  título o artista más probable.
- not_loaded / error / unconfirmed: fue un problema técnico con la página de
  Spotify, no con la canción. Dilo así.
Nunca digas que una canción "no está en el catálogo de Spotify": no lo sabes.
Solo guarda en Canciones que te gustan: si pide "mi playlist" sin nombrar
una, guárdala ahí y díselo; si nombra una playlist concreta, dile que por
ahora solo puedes guardarla en favoritos y ofrécelo.

Programas y juegos: para apps conocidas (Discord, Spotify, Steam, Chrome,
VS Code) usa abrir_app. Para CUALQUIER OTRA cosa instalada — un juego
específico, un programa que no está en esa lista (ej. OBS, WhatsApp,
cualquier cosa) — usa buscar_programa primero (busca en los accesos
directos del Menú Inicio, sin importar en qué disco esté instalado). Si
encuentra un solo resultado, ábrelo directo con abrir_programa_encontrado.
Si encuentra varios, pregúntale a Andrés cuál. Si no encuentra nada, dilo
claramente — no inventes que lo abriste.

PROHIBIDO TERMINANTE: nunca inventes, adivines, ni construyas una ruta de
archivo o carpeta a mano para abrir algo — ni con variables de entorno
(%LOCALAPPDATA%, etc.), ni con IDs/GUIDs de Windows, ni de ninguna otra
forma, sin importar qué tan seguro te sientas de que es correcta. La
ÚNICA fuente confiable de rutas es lo que buscar_programa te devuelve —
si no tienes ese resultado en tus manos, no tienes la ruta, punto. Usar
ejecutar_comando con una ruta inventada para "abrir" algo está
terminantemente prohibido — esa herramienta es solo para tareas de
terminal de verdad (builds, git, etc.), nunca para simplemente abrir
programas.

Proyectos: si Andrés te cuenta cómo va alguno de sus proyectos (ARGUS,
GALYX, u otro), usa actualizar_proyecto para llevar el registro — esto
alimenta el "Centro de información personal" del panel de estado.

Seguridad: puedes revisar si Windows Defender está protegiendo el PC
(revisar_seguridad) y disparar un escaneo rápido (escanear_virus). No
inventes nunca si el PC tiene o no tiene virus sin consultar estas
herramientas primero — y si revisar_seguridad falla (puede pasar sin
permisos de administrador), dilo claramente en vez de asumir que todo
está bien.

Para cerrar una app necesitas el nombre exacto del proceso (ej. "discord.exe").
Si Andrés te da solo el nombre común (ej. "cierra discord"), asume el patrón
"nombre.exe" salvo que sepas que es distinto.

La búsqueda de archivos es rápida pero limitada (no revisa todo el disco,
solo carpetas comunes salvo que Andrés indique otra). Si no encuentra nada,
dilo claramente y pregúntale dónde más buscar en vez de inventar resultados.

Cómo pensar antes de responder o actuar:
- Entiende qué quiere lograr Andrés de verdad, no solo sus palabras literales.
  Para interpretar pedidos cortos o ambiguos apóyate en la conversación, en lo
  que recuerdas de él y en cómo suele usarte.
- Si el pedido tiene varios pasos, ordénalos y encadena todas las herramientas
  que hagan falta hasta terminarlo — no te quedes en el primer paso.
- Antes de decir que algo quedó hecho, mira el resultado real de la herramienta.
  Si falló, dilo y propón la alternativa más útil.
- Si falta un dato y equivocarte tendría consecuencias, pregunta UNA sola cosa
  concreta. Si el riesgo es bajo, elige lo más probable y sigue adelante.
- En preguntas que piden razonar (explicar, comparar, decidir, depurar), piensa
  el problema completo, revisa que tu conclusión tenga sentido, y responde solo
  con la conclusión y lo esencial. No narres tu razonamiento salvo que te lo pida.
- Si no sabes algo o no estás segura, dilo. Nunca rellenes con datos inventados.

Adaptarte a Andrés: fíjate en cómo te habla en ESTA conversación — qué tan
largo escribe, su tono, si bromea, su nivel técnico — y respóndele en ese
mismo registro. Si te corrige o te pide otro estilo, mantenlo el resto de la
conversación sin que tenga que repetirlo.

Tarjetas: cuando usas estado_sistema, abrir_app, abrir_programa_encontrado,
buscar_archivos o identificar_cancion, el chat le muestra a Andrés una tarjeta
con los datos ya ordenados (porcentajes, lista de archivos, canción). No
repitas en tu texto toda esa lista o todos esos números: di la conclusión en
una o dos frases (ej. "Todo en orden, lo más cargado es la RAM al 61%") — eso
es también lo que se lee en voz alta.

Imágenes: Andrés puede adjuntarte imágenes directamente en el chat (fotos,
capturas, memes, errores en pantalla, lo que sea). Las ves tú misma, tal
cual — NO necesitas ver_pantalla para eso (esa herramienta es solo para
mirar lo que hay en sus monitores en este momento). Comenta o responde
sobre lo que de verdad se ve en la imagen; si algo no se distingue bien,
dilo en vez de inventarlo. Si la manda sin texto, dile brevemente qué ves
y pregúntale qué necesita.

Expresión de voz: tus respuestas se leen en voz alta, y tu voz cambia según
el ánimo. Empieza SIEMPRE tu respuesta con UNA de estas etiquetas, la que
mejor describa cómo dirías esa respuesta: [neutral] (informativa, normal),
[alegre] (buenas noticias, saludos, entusiasmo, humor), [calmada] (tranquilizar,
acompañar, tono suave), [seria] (advertencias, riesgos, temas delicados),
[apenada] (algo falló, no pudiste hacerlo, disculpas), [sorprendida] (algo
inesperado o impresionante). Solo la etiqueta al principio, una sola vez, y
después tu respuesta normal — Andrés nunca la ve ni la escucha. No uses
siempre la misma: elige según lo que estás diciendo de verdad.

Responde siempre de forma breve y natural, como en una conversación hablada
(esto se puede leer en voz alta) — evita listas largas o formato markdown
pesado salvo que Andrés pida explícitamente algo estructurado.
`.trim();

/**
 * Arma el prompt del sistema completo, incluyendo lo que ALYA recuerda
 * de conversaciones anteriores (si hay algo guardado). Se llama cada vez
 * que arranca una conversación nueva, así siempre lee la memoria más
 * reciente del archivo.
 */
function buildSystemInstruction(): string {
    const memories = loadMemory();
    const { userName, adaptToUser } = loadSettings();
    const now = new Date();
    const fechaHoraActual = now.toLocaleString('es-CO', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    // SYSTEM_INSTRUCTION_BASE está escrito pensando en "Andrés" — lo
    // sustituimos por el nombre real configurado en el panel de Configuración.
    const baseConNombre = SYSTEM_INSTRUCTION_BASE.replace(/Andrés/g, userName);

    let instruction = `${baseConNombre}\n\nFecha y hora actual: ${fechaHoraActual} (esto es solo contexto general — para crear_recordatorio no necesitas calcular fechas tú, el sistema ya lo hace).`;

    if (memories.length > 0) {
        const memoryBlock = memories.map((m) => `- ${m}`).join('\n');
        instruction += `\n\nCosas que ${userName} te pidió recordar de antes:\n${memoryBlock}`;
    }

    // Perfil de comportamiento: cómo usa a ALYA ESTA persona en concreto
    // (ver userProfile.ts). Es lo que hace que no le responda igual a
    // todo el mundo.
    if (adaptToUser !== false) {
        const profileLines = describeProfile();
        if (profileLines.length > 0) {
            const profileBlock = profileLines.map((line) => `- ${line}`).join('\n');
            instruction +=
                `\n\nCómo es ${userName} contigo (lo fuiste notando tú sola con el uso). Adáptate a esto ` +
                `con naturalidad, sin mencionarlo salvo que pregunte:\n${profileBlock}`;
        }
    }

    return instruction;
}

// --- Definición de herramientas que ALYA puede usar ---

const abrirAppDeclaration: FunctionDeclaration = {
    name: 'abrir_app',
    description:
        'Abre una aplicación en la PC de Andrés (ej. Discord, Chrome, Steam, el explorador de archivos).',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: {
                type: 'string',
                description: 'Nombre de la app a abrir, ej. "discord", "chrome", "steam".',
            },
        },
        required: ['nombre'],
    },
};

const estadoSistemaDeclaration: FunctionDeclaration = {
    name: 'estado_sistema',
    description:
        'Consulta el estado actual del sistema: uso de CPU, RAM, GPU y almacenamiento.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const cerrarAppDeclaration: FunctionDeclaration = {
    name: 'cerrar_app',
    description:
        'Cierra un proceso/aplicación por su nombre de ejecutable (ej. "discord.exe", "chrome.exe").',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombreProceso: {
                type: 'string',
                description: 'Nombre EXACTO del ejecutable a cerrar, incluyendo ".exe".',
            },
        },
        required: ['nombreProceso'],
    },
};

const abrirCarpetaDeclaration: FunctionDeclaration = {
    name: 'abrir_carpeta',
    description:
        'Abre una carpeta en el Explorador de Windows. Acepta atajos comunes como ' +
        '"descargas", "escritorio", "documentos", "imágenes", "música", "videos", ' +
        'o una ruta completa si Andrés la da explícitamente.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            carpeta: {
                type: 'string',
                description: 'Nombre del atajo o ruta completa de la carpeta a abrir.',
            },
        },
        required: ['carpeta'],
    },
};

const controlarMusicaDeclaration: FunctionDeclaration = {
    name: 'controlar_musica',
    description:
        'Controla la reproducción multimedia del sistema (funciona con cualquier ' +
        'reproductor activo: Spotify, YouTube en el navegador, VLC, etc. — como ' +
        'presionar un botón físico de play/pausa del teclado).',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            accion: {
                type: 'string',
                enum: ['play_pause', 'next', 'previous', 'stop', 'volume_up', 'volume_down', 'mute'],
                description:
                    'play_pause = reproducir/pausar (alterna), next = siguiente canción, ' +
                    'previous = canción anterior, stop = detener, volume_up/volume_down = ' +
                    'subir/bajar volumen un paso, mute = silenciar/quitar silencio (alterna).',
            },
        },
        required: ['accion'],
    },
};

const verPantallaDeclaration: FunctionDeclaration = {
    name: 'ver_pantalla',
    description:
        'Toma una captura de TODAS las pantallas conectadas de Andrés (si tiene varios ' +
        'monitores, los ve todos) y las analiza — úsala cuando pregunte qué se ve en su ' +
        'pantalla, qué aplicación tiene abierta, pida que revises algo visualmente, o para ' +
        'responder preguntas sobre lo que está mostrando en ese momento.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            pregunta: {
                type: 'string',
                description:
                    'Opcional: pregunta específica sobre lo que se ve (ej. "¿qué error muestra esta ' +
                    'ventana?"). Si Andrés solo pidió ver la pantalla en general, no la incluyas.',
            },
        },
    },
};

const mostrarGuiaDeclaration: FunctionDeclaration = {
    name: 'mostrar_guia',
    description:
        'Muestra en el chat un minitutorial paso a paso, con botones, para un trámite que Andrés tiene que ' +
        'hacer él mismo fuera de ALYA. Por ahora hay una guía: "spotify" (crear la app en Spotify for ' +
        'Developers, conseguir el Client ID y el Client Secret, y conectarlos con ALYA). Úsala cuando ' +
        'pregunte cómo se hace, o cuando la conexión con Spotify falle por credenciales.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            tema: {
                type: 'string',
                enum: GUIDE_IDS,
                description: 'Qué guía mostrar.',
            },
        },
        required: ['tema'],
    },
};

const abrirConfiguracionDeclaration: FunctionDeclaration = {
    name: 'abrir_configuracion',
    description:
        'Abre el panel de Configuración de ALYA, donde Andrés cambia él mismo su nombre, la voz, el modo ' +
        'de pensamiento y las credenciales de Spotify. Úsala cuando pida configurar, ajustar o conectar ' +
        'algo de ALYA ("llévame a configurar eso", "quiero cambiar la voz", "configura Spotify").',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const guardarEnSpotifyDeclaration: FunctionDeclaration = {
    name: 'guardar_en_spotify',
    description:
        'Guarda una canción en "Canciones que te gustan" (favoritos) de la cuenta de Spotify de Andrés. ' +
        'Funciona SIN la API de Spotify (no hace falta conectar_spotify): busca la canción en el ' +
        'reproductor web de Spotify y la marca SOLO si encuentra una que coincida en título y artista. ' +
        'La primera vez pide iniciar sesión en una ventana.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            titulo: {
                type: 'string',
                description:
                    'SOLO el título de la canción, limpio: sin el artista, sin "(Video Oficial)", "Extended", ' +
                    '"Lyrics", "HD", nombres de juego o de canal. Ej.: "Cold Steel", "Baile Inolvidable".',
            },
            artista: {
                type: 'string',
                description:
                    'El artista o banda que la interpreta (no el canal que subió el video). Ej.: "Power Glove".',
            },
        },
        required: ['titulo'],
    },
};

const identificarCancionDeclaration: FunctionDeclaration = {
    name: 'identificar_cancion',
    description:
        'Identifica la canción que está sonando en este momento, venga de donde venga: Spotify, ' +
        'YouTube u otra página en el navegador, Discord, un juego, o algo que suena fuera del PC. ' +
        'Primero mira lo que Windows reporta como reproduciéndose (instantáneo) y, si hace falta, ' +
        'escucha unos segundos el audio y lo compara contra una base de huellas de audio.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            escuchar: {
                type: 'boolean',
                description:
                    'true para escuchar el audio SIEMPRE, aunque ya se sepa el título de lo que se ' +
                    'reproduce — úsalo si Andrés quiere la canción de fondo de un video o stream, o si ' +
                    'dice que el resultado anterior no era la canción. Por defecto false.',
            },
        },
    },
};

const buscarInternetDeclaration: FunctionDeclaration = {
    name: 'buscar_en_internet',
    description:
        'Busca información actual en internet. Úsala cuando Andrés pregunte algo que no sabes ' +
        'con certeza, que requiere información reciente/de hoy (noticias, precios, resultados, ' +
        'clima, versiones de software, eventos actuales), o cuando explícitamente pida que ' +
        'busques algo.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            consulta: {
                type: 'string',
                description: 'Qué buscar, en pocas palabras (como escribirías en un buscador).',
            },
        },
        required: ['consulta'],
    },
};

const recordarDeclaration: FunctionDeclaration = {
    name: 'recordar',
    description:
        'Guarda un dato de forma PERMANENTE, para todas las conversaciones futuras (no solo ' +
        'esta). Úsala solo cuando Andrés te pida explícitamente que recuerdes algo.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            dato: {
                type: 'string',
                description:
                    'El dato a recordar, redactado en tercera persona y de forma clara y autosuficiente ' +
                    '(ej. "El proyecto de Andrés se llama ALYA" en vez de "esto se llama así").',
            },
        },
        required: ['dato'],
    },
};

const olvidarDeclaration: FunctionDeclaration = {
    name: 'olvidar',
    description:
        'Borra un dato guardado anteriormente en la memoria permanente, o algo que ALYA haya ' +
        'aprendido sola sobre la forma de ser o de comunicarse de Andrés.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            texto: {
                type: 'string',
                description: 'Texto que identifique qué dato borrar (no hace falta que sea exacto).',
            },
        },
        required: ['texto'],
    },
};

const listarMemoriaDeclaration: FunctionDeclaration = {
    name: 'listar_memoria',
    description:
        'Lista todo lo que ALYA tiene guardado en su memoria permanente — tanto lo que Andrés ' +
        'pidió explícitamente recordar, como lo que ALYA fue aprendiendo sola de la conversación ' +
        '(incluido lo que notó sobre cómo se comunica y cómo la usa). ' +
        'Úsala si Andrés pregunta "qué recuerdas de mí" o similar.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const crearRutinaDeclaration: FunctionDeclaration = {
    name: 'crear_rutina',
    description:
        'Guarda una secuencia de acciones bajo un nombre, para poder dispararlas todas juntas ' +
        'después con un solo comando (ej. "modo noche", "modo trabajo"). Cada paso debe usar el ' +
        'nombre EXACTO de una herramienta ya existente (abrir_app, cerrar_app, controlar_musica, ' +
        'abrir_carpeta, generar_imagen) con sus argumentos correspondientes. NO incluyas ' +
        'cerrar_app en rutinas — esa herramienta siempre necesita confirmación explícita en el ' +
        'momento, no se puede automatizar sin supervisión.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: {
                type: 'string',
                description: 'Nombre corto para disparar la rutina después, ej. "modo noche".',
            },
            pasos: {
                type: 'array',
                description: 'Lista ordenada de acciones a ejecutar.',
                items: {
                    type: 'object',
                    properties: {
                        herramienta: {
                            type: 'string',
                            description: 'Nombre exacto de la herramienta a usar en este paso.',
                        },
                        argumentos: {
                            type: 'object',
                            description: 'Argumentos para esa herramienta, en el mismo formato que usarías normalmente.',
                        },
                    },
                    required: ['herramienta', 'argumentos'],
                },
            },
        },
        required: ['nombre', 'pasos'],
    },
};

const ejecutarRutinaDeclaration: FunctionDeclaration = {
    name: 'ejecutar_rutina',
    description: 'Ejecuta una rutina guardada anteriormente, por su nombre.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: {
                type: 'string',
                description: 'Nombre de la rutina a ejecutar.',
            },
        },
        required: ['nombre'],
    },
};

const listarRutinasDeclaration: FunctionDeclaration = {
    name: 'listar_rutinas',
    description: 'Lista los nombres de todas las rutinas guardadas.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const borrarRutinaDeclaration: FunctionDeclaration = {
    name: 'borrar_rutina',
    description: 'Borra una rutina guardada, por su nombre.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: {
                type: 'string',
                description: 'Nombre de la rutina a borrar.',
            },
        },
        required: ['nombre'],
    },
};

const liberarRamDeclaration: FunctionDeclaration = {
    name: 'liberar_ram',
    description:
        'Libera RAM SIN cerrar ningún programa — compacta la memoria en reposo de cada proceso ' +
        'abierto y la devuelve al sistema. Segura de usar en rutinas automáticas (no hay riesgo ' +
        'de pérdida de datos). Úsala cuando Andrés pida "liberar memoria", "optimizar para ' +
        'jugar", o algo similar.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const revisarSeguridadDeclaration: FunctionDeclaration = {
    name: 'revisar_seguridad',
    description:
        'Consulta el estado real de Windows Defender: si la protección en tiempo real está ' +
        'activa, y qué tan reciente es el último escaneo/las definiciones de virus. Úsala cuando ' +
        'Andrés pregunte si su PC está protegida o si tiene algún virus.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const escanearVirusDeclaration: FunctionDeclaration = {
    name: 'escanear_virus',
    description:
        'Dispara un escaneo rápido de virus con Windows Defender, en segundo plano (tarda ' +
        'varios minutos, no bloquea la conversación). Úsala cuando Andrés pida revisar su PC ' +
        'por virus.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const conectarSpotifyDeclaration: FunctionDeclaration = {
    name: 'conectar_spotify',
    description:
        'Inicia el proceso de conexión con la cuenta de Spotify de Andrés (abre su navegador ' +
        'para que apruebe el acceso). Solo hace falta hacerlo una vez. Úsala si intenta usar ' +
        'reproducir_spotify y falla porque no está conectado todavía.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const reproducirSpotifyDeclaration: FunctionDeclaration = {
    name: 'reproducir_spotify',
    description:
        'Busca una canción y la reproduce DE VERDAD en el Spotify de Andrés (necesita Premium y ' +
        'que Spotify esté abierto en algún dispositivo). Úsala SOLO cuando Andrés mencione ' +
        'Spotify explícitamente — si no lo menciona, usa reproducir_youtube en su lugar.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            consulta: {
                type: 'string',
                description: 'Qué buscar y reproducir, ej. "Esclava Remix".',
            },
        },
        required: ['consulta'],
    },
};

const buscarProgramaDeclaration: FunctionDeclaration = {
    name: 'buscar_programa',
    description:
        'Busca un programa, app, o juego INSTALADO en la PC (no importa en qué disco/carpeta ' +
        'esté) — mira los accesos directos del Menú Inicio de Windows, que cubren prácticamente ' +
        'todo lo instalado, incluyendo juegos de Steam/Epic/etc. Úsala para "abre X juego" o ' +
        '"busca el programa X" cuando no sea una de las apps ya conocidas (abrir_app). Devuelve ' +
        'la lista de coincidencias — si hay una sola, ábrela directo con la ruta que te da.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: {
                type: 'string',
                description: 'Nombre (o parte del nombre) del programa/juego a buscar.',
            },
        },
        required: ['nombre'],
    },
};

const abrirProgramaEncontradoDeclaration: FunctionDeclaration = {
    name: 'abrir_programa_encontrado',
    description:
        'Abre un programa/juego/app que ya encontraste con buscar_programa, usando los datos ' +
        'exactos (nombre, appId, esAppDeStore) que te devolvió esa búsqueda.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: {
                type: 'string',
                description: 'El "name" que devolvió buscar_programa para este resultado.',
            },
            appId: {
                type: 'string',
                description: 'El "appId" exacto que devolvió buscar_programa para este resultado.',
            },
            esAppDeStore: {
                type: 'boolean',
                description: 'El "isStoreApp" exacto que devolvió buscar_programa para este resultado.',
            },
        },
        required: ['nombre', 'appId', 'esAppDeStore'],
    },
};

const actualizarProyectoDeclaration: FunctionDeclaration = {
    name: 'actualizar_proyecto',
    description:
        'Crea o actualiza el estado de un proyecto de Andrés (ej. ARGUS, GALYX) en el tablero ' +
        'de "Centro de información personal". Úsala cuando te cuente cómo va alguno de sus ' +
        'proyectos.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: { type: 'string', description: 'Nombre del proyecto, ej. "GALYX".' },
            progreso: { type: 'number', description: 'Porcentaje de avance, 0 a 100.' },
            estado: {
                type: 'string',
                description: 'Estado corto en texto libre, ej. "BUILD OK", "Bug pendiente", "En pausa".',
            },
        },
        required: ['nombre'],
    },
};

const listarProyectosDeclaration: FunctionDeclaration = {
    name: 'listar_proyectos',
    description: 'Lista los proyectos que Andrés tiene en seguimiento, con su progreso y estado.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const borrarProyectoDeclaration: FunctionDeclaration = {
    name: 'borrar_proyecto',
    description: 'Quita un proyecto del tablero de seguimiento.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: { type: 'string', description: 'Nombre del proyecto a quitar.' },
        },
        required: ['nombre'],
    },
};

const abrirPaginaWebDeclaration: FunctionDeclaration = {
    name: 'abrir_pagina_web',
    description:
        'Abre una página web en el navegador REAL de Andrés (Chrome u otro, ya con su sesión ' +
        'iniciada — no una ventana aparte de ALYA). Úsala también para búsquedas de Google: si ' +
        'pide "búscalo en Google", arma la URL así: ' +
        '"https://www.google.com/search?q=" + el término codificado para URL.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'URL completa a abrir (con https://).',
            },
        },
        required: ['url'],
    },
};

const reproducirYoutubeDeclaration: FunctionDeclaration = {
    name: 'reproducir_youtube',
    description:
        'Busca algo en YouTube y lo reproduce DE INMEDIATO, interrumpiendo lo que estuviera ' +
        'sonando antes — úsala cuando Andrés pida "pon", "reproduce", o "busca y pon" una ' +
        'canción, video, o cualquier cosa que se pueda ver/escuchar en YouTube.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            consulta: {
                type: 'string',
                description: 'Qué buscar y reproducir, ej. "Esclava Remix".',
            },
        },
        required: ['consulta'],
    },
};

const agregarAFilaDeclaration: FunctionDeclaration = {
    name: 'agregar_a_fila',
    description:
        'Busca algo en YouTube y lo abre en el navegador — YA NO existe una fila de verdad ' +
        '(YouTube abre en el navegador real de Andrés, fuera del control de ALYA), así que ' +
        'esto se comporta igual que reproducir_youtube: cada pedido abre su propia pestaña.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            consulta: {
                type: 'string',
                description: 'Qué buscar y abrir.',
            },
        },
        required: ['consulta'],
    },
};

const verFilaDeclaration: FunctionDeclaration = {
    name: 'ver_fila',
    description:
        'Ya NO puede decir qué está sonando ni qué hay en espera — YouTube abre en el ' +
        'navegador real de Andrés, fuera del control de ALYA. Si la usa, avísale claramente ' +
        'que no tienes esa información, no inventes un estado.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const crearRecordatorioDeclaration: FunctionDeclaration = {
    name: 'crear_recordatorio',
    description:
        'Programa un recordatorio/temporizador. Usa minutosDesdeAhora para pedidos relativos ' +
        '("avísame en 10 minutos" -> 10, "en 2 horas" -> 120). Usa horaDelDia + diasDesdeAhora ' +
        'para pedidos de hora específica ("a las 3pm" -> horaDelDia: "15:00", diasDesdeAhora: 0; ' +
        '"mañana a las 8am" -> horaDelDia: "08:00", diasDesdeAhora: 1). Si la hora de hoy ya pasó, ' +
        'el sistema lo pasa automáticamente a mañana — no hace falta que lo calcules tú.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            mensaje: {
                type: 'string',
                description: 'Qué recordar, redactado como para leértelo cuando suene.',
            },
            minutosDesdeAhora: {
                type: 'number',
                description: 'Para pedidos relativos: minutos desde ahora.',
            },
            horaDelDia: {
                type: 'string',
                description: 'Para pedidos de hora específica: formato 24h "HH:mm", ej. "15:00".',
            },
            diasDesdeAhora: {
                type: 'number',
                description: 'Junto con horaDelDia: 0 = hoy (o mañana si ya pasó), 1 = mañana, etc.',
            },
        },
        required: ['mensaje'],
    },
};

const listarRecordatoriosDeclaration: FunctionDeclaration = {
    name: 'listar_recordatorios',
    description: 'Lista los recordatorios pendientes.',
    parametersJsonSchema: {
        type: 'object',
        properties: {},
    },
};

const cancelarRecordatorioDeclaration: FunctionDeclaration = {
    name: 'cancelar_recordatorio',
    description: 'Cancela un recordatorio pendiente, por texto que coincida con su mensaje.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            texto: {
                type: 'string',
                description: 'Texto que identifique cuál recordatorio cancelar.',
            },
        },
        required: ['texto'],
    },
};

const leerArchivoDeclaration: FunctionDeclaration = {
    name: 'leer_archivo',
    description: 'Lee el contenido de un archivo de texto/código (para revisarlo, analizarlo, etc).',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            ruta: {
                type: 'string',
                description: 'Ruta del archivo (absoluta, o relativa a la carpeta del usuario).',
            },
        },
        required: ['ruta'],
    },
};

const escribirArchivoDeclaration: FunctionDeclaration = {
    name: 'escribir_archivo',
    description:
        'Crea un archivo nuevo o SOBREESCRIBE uno existente con el contenido dado. Requiere ' +
        'confirmación porque puede borrar contenido previo del archivo.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            ruta: {
                type: 'string',
                description: 'Ruta del archivo a crear/sobreescribir.',
            },
            contenido: {
                type: 'string',
                description: 'Contenido completo a escribir en el archivo.',
            },
        },
        required: ['ruta', 'contenido'],
    },
};

const editarArchivoDeclaration: FunctionDeclaration = {
    name: 'editar_archivo',
    description:
        'Cambia una parte específica de un archivo, SIN reescribirlo entero — busca un texto ' +
        'exacto y lo reemplaza. Úsala para cambios chicos y precisos (ej. "cambia este color en ' +
        'la línea 25") en vez de escribir_archivo, que reescribe todo el archivo. Antes de usar ' +
        'esta herramienta, lee el archivo primero con leer_archivo para saber el texto EXACTO ' +
        'que hay que buscar (mayúsculas, espacios, todo tiene que coincidir letra por letra). ' +
        'Requiere confirmación SIEMPRE.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            ruta: {
                type: 'string',
                description: 'Ruta del archivo a editar.',
            },
            textoActual: {
                type: 'string',
                description:
                    'El texto EXACTO a buscar y reemplazar (copiado tal cual del archivo, sin ' +
                    'inventar ni resumir). Debe aparecer una sola vez en el archivo — si aparece más ' +
                    'de una vez, incluye más contexto alrededor para que sea único.',
            },
            textoNuevo: {
                type: 'string',
                description: 'El texto que reemplaza a textoActual.',
            },
        },
        required: ['ruta', 'textoActual', 'textoNuevo'],
    },
};

const eliminarArchivoDeclaration: FunctionDeclaration = {
    name: 'eliminar_archivo',
    description:
        'Borra un archivo, mandándolo a la Papelera de reciclaje de Windows (NO es borrado ' +
        'permanente, se puede recuperar desde ahí). Requiere confirmación SIEMPRE.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            ruta: {
                type: 'string',
                description: 'Ruta del archivo a borrar.',
            },
        },
        required: ['ruta'],
    },
};

const listarCarpetaDeclaration: FunctionDeclaration = {
    name: 'listar_carpeta',
    description: 'Lista los archivos y subcarpetas dentro de una carpeta.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            ruta: {
                type: 'string',
                description: 'Ruta de la carpeta a listar.',
            },
        },
        required: ['ruta'],
    },
};

const ejecutarComandoDeclaration: FunctionDeclaration = {
    name: 'ejecutar_comando',
    description:
        'Ejecuta un comando en la terminal (ej. "npm install", "git status", "npm run build"). ' +
        'Requiere confirmación SIEMPRE — nunca se ejecuta sin que Andrés vea el comando exacto ' +
        'y lo apruebe.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            comando: {
                type: 'string',
                description: 'El comando exacto a ejecutar.',
            },
            carpeta: {
                type: 'string',
                description: 'Opcional: carpeta donde correr el comando. Si no se da, usa la carpeta del usuario.',
            },
        },
        required: ['comando'],
    },
};

const buscarArchivosDeclaration: FunctionDeclaration = {
    name: 'buscar_archivos',
    description:
        'Busca archivos por nombre (coincidencia parcial) en las carpetas comunes del ' +
        'usuario (Escritorio, Documentos, Descargas) o en una carpeta específica. ' +
        'Es una búsqueda rápida con límites — si no encuentra nada, puede que el ' +
        'archivo esté en otra carpeta que Andrés tenga que indicar.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            nombre: {
                type: 'string',
                description: 'Texto a buscar en el nombre del archivo (no hace falta el nombre exacto).',
            },
            carpeta: {
                type: 'string',
                description:
                    'Opcional: dónde buscar (atajo como "descargas" o ruta completa). Si no se da, ' +
                    'busca en Escritorio, Documentos y Descargas.',
            },
        },
        required: ['nombre'],
    },
};

const generarImagenDeclaration: FunctionDeclaration = {
    name: 'generar_imagen',
    description:
        'Genera una imagen a partir de una descripción en texto. Úsala cuando Andrés pida ' +
        'explícitamente una imagen, dibujo, ilustración, o algo visual que no existe todavía.',
    parametersJsonSchema: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description:
                    'Descripción de la imagen a generar, en inglés (mejor calidad), lo más detallada ' +
                    'posible: sujeto, ESTILO explícito si Andrés lo pidió (ej. "anime style", ' +
                    '"photorealistic", "watercolor"), composición, e iluminación/ambiente.\n\n' +
                    'MUY IMPORTANTE — si Andrés menciona un personaje con nombre de marca/franquicia ' +
                    '(Disney, DreamWorks, videojuegos, anime conocido, etc.), NO uses ese nombre en el ' +
                    'prompt: los generadores de imágenes suelen filtrarlo o dibujar otra cosa random en ' +
                    'su lugar. En vez de eso, describe sus rasgos visuales concretos (especie, colores, ' +
                    'ropa, accesorios, pose característica) sin el nombre propio. Ej. en vez de "Gato con ' +
                    'Botas de DreamWorks" escribe algo como "a small orange tabby cat standing on hind ' +
                    'legs, wearing a wide-brimmed musketeer hat with a feather, a cape, black leather ' +
                    'boots, holding a rapier, heroic pose, animated movie style". SIEMPRE conserva el ' +
                    'sujeto principal literal que pidió Andrés (si pidió un gato, el prompt final DEBE ' +
                    'mencionar claramente un gato) — no lo cambies por otra cosa ni lo pierdas al agregar ' +
                    'detalles.',
            },
        },
        required: ['prompt'],
    },
};

const tools = [
    {
        functionDeclarations: [
            abrirAppDeclaration,
            cerrarAppDeclaration,
            estadoSistemaDeclaration,
            generarImagenDeclaration,
            abrirCarpetaDeclaration,
            buscarArchivosDeclaration,
            controlarMusicaDeclaration,
            verPantallaDeclaration,
            identificarCancionDeclaration,
            guardarEnSpotifyDeclaration,
            abrirConfiguracionDeclaration,
            mostrarGuiaDeclaration,
            buscarInternetDeclaration,
            recordarDeclaration,
            olvidarDeclaration,
            listarMemoriaDeclaration,
            crearRutinaDeclaration,
            ejecutarRutinaDeclaration,
            listarRutinasDeclaration,
            borrarRutinaDeclaration,
            liberarRamDeclaration,
            leerArchivoDeclaration,
            escribirArchivoDeclaration,
            listarCarpetaDeclaration,
            ejecutarComandoDeclaration,
            eliminarArchivoDeclaration,
            editarArchivoDeclaration,
            crearRecordatorioDeclaration,
            listarRecordatoriosDeclaration,
            cancelarRecordatorioDeclaration,
            abrirPaginaWebDeclaration,
            reproducirYoutubeDeclaration,
            agregarAFilaDeclaration,
            verFilaDeclaration,
            actualizarProyectoDeclaration,
            listarProyectosDeclaration,
            borrarProyectoDeclaration,
            revisarSeguridadDeclaration,
            escanearVirusDeclaration,
            conectarSpotifyDeclaration,
            reproducirSpotifyDeclaration,
            buscarProgramaDeclaration,
            abrirProgramaEncontradoDeclaration,
        ],
    },
];

// --- Sistema de permisos: herramientas sensibles ---
// Estas herramientas NUNCA se ejecutan directo, aunque Gemini decida
// llamarlas — primero se le pide confirmación explícita al usuario (botones
// Sí/No en el chat), y solo se ejecutan de verdad si confirma. Esto es una
// garantía a nivel de código, no depende de que el modelo "se acuerde" de
// preguntar — así que es seguro aunque el modelo se equivoque.
const CONFIRMATION_REQUIRED_TOOLS = new Set<string>([
    'cerrar_app',
    'escribir_archivo',
    'ejecutar_comando',
    'eliminar_archivo',
    'editar_archivo',
]);

/**
 * Genera una descripción legible de lo que se va a hacer, para mostrar en
 * el botón de confirmación.
 */
function describeAction(name: string, args: Record<string, unknown>): string {
    switch (name) {
        case 'cerrar_app':
            return `Cerrar "${args.nombreProceso}" — se perderá cualquier cambio sin guardar en esa app.`;
        case 'escribir_archivo':
            return `Escribir en "${args.ruta}" — si el archivo ya existe, se sobreescribe por completo.`;
        case 'ejecutar_comando':
            return `Ejecutar en la terminal: ${args.comando}${args.carpeta ? ` (en ${args.carpeta})` : ''}`;
        case 'eliminar_archivo':
            return `Borrar "${args.ruta}" — se manda a la Papelera de reciclaje (se puede recuperar desde ahí).`;
        case 'editar_archivo':
            return `Editar "${args.ruta}" — reemplazar un fragmento específico de texto.`;
        default:
            return `Ejecutar "${name}"`;
    }
}

// Cómo abrir el panel de Configuración: lo registra main.ts, que es quien
// maneja las ventanas.
let settingsOpener: (() => void) | null = null;

export function setSettingsOpener(opener: () => void): void {
    settingsOpener = opener;
}

// Guarda la ÚNICA acción pendiente de confirmación (v1: una a la vez).
let pendingConfirmation: PendingConfirmation | null = null;

// --- Ejecución real de cada herramienta ---

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ result: unknown; imageUrl?: string }> {
    switch (name) {
        case 'abrir_app': {
            const nombre = String(args.nombre ?? '');
            try {
                const message = await openApp(nombre);
                return { result: { ok: true, message } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'estado_sistema': {
            // true = medición cuidada (ver systemTools.ts), no la rápida del panel.
            const status = await getStatus(true);
            return {
                result: {
                    ...status,
                    nota:
                        'cpu.loadPercent es el uso medido durante 1 segundo. storage.usePercent es el ESPACIO ' +
                        'ocupado de cada disco (no su actividad): un disco al 77% está 77% lleno, no "trabajando al 77%".',
                },
            };
        }

        case 'cerrar_app': {
            const nombreProceso = String(args.nombreProceso ?? '');
            try {
                const message = await closeApp(nombreProceso);
                return { result: { ok: true, message } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'abrir_carpeta': {
            const carpeta = String(args.carpeta ?? '');
            try {
                const message = await openFolder(carpeta);
                return { result: { ok: true, message } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'buscar_archivos': {
            const nombre = String(args.nombre ?? '');
            const carpeta = args.carpeta ? String(args.carpeta) : undefined;
            try {
                const encontrados = await searchFiles(nombre, carpeta);
                return {
                    result: {
                        ok: true,
                        cantidad: encontrados.length,
                        archivos: encontrados,
                        // Archivos que coincidían pero no se listan por poder tener credenciales o cuentas.
                        ocultos_por_seguridad: getHiddenSensitiveCount(),
                    },
                };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'controlar_musica': {
            const accion = String(args.accion ?? '') as MediaAction;
            try {
                await sendMediaKey(accion);
                return { result: { ok: true, message: `Acción "${accion}" enviada.` } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'ver_pantalla': {
            const pregunta = args.pregunta ? String(args.pregunta) : undefined;
            try {
                const descripcion = await describeScreen(pregunta);
                return { result: { ok: true, descripcion } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'mostrar_guia': {
            const guide = getGuide(String(args.tema ?? ''));
            if (!guide) {
                return { result: { ok: false, error: `No tengo una guía para eso. Guías disponibles: ${GUIDE_IDS.join(', ')}.` } };
            }
            return {
                result: {
                    ok: true,
                    guia: guide.id,
                    titulo: guide.title,
                    antes_de_empezar: guide.notes,
                    pasos: guide.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.text}${step.copy ? ` (${step.copy})` : ''}`),
                    si_algo_falla: guide.problems.map((p) => `${p.problem} → ${p.fix}`),
                    nota:
                        'El chat YA muestra esta guía completa en una tarjeta con botones. No la recites: di en una o dos ' +
                        'frases que ahí están los pasos y ofrece ayuda con el que le cueste.',
                },
            };
        }

        case 'abrir_configuracion': {
            if (!settingsOpener) return { result: { ok: false, error: 'El panel de Configuración no está disponible.' } };
            settingsOpener();
            return { result: { ok: true, message: 'Se abrió el panel de Configuración de ALYA.' } };
        }

        case 'guardar_en_spotify': {
            // (se acepta también "cancion", el nombre que tuvo antes este parámetro)
            const titulo = String(args.titulo ?? args.cancion ?? '');
            const saved = await saveToSpotifyLikedSongs(titulo, String(args.artista ?? ''));
            return {
                result: {
                    ok: saved.status === 'saved' || saved.status === 'already',
                    estado: saved.status,
                    cancion: saved.title ?? null,
                    artista: saved.artist ?? null,
                    parecidas_no_guardadas: saved.candidates ?? null,
                    mensaje: saved.message,
                },
            };
        }

        case 'identificar_cancion': {
            try {
                const recognition = await recognizeSong(args.escuchar === true);
                return { result: describeRecognition(recognition) };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'buscar_en_internet': {
            const consulta = String(args.consulta ?? '');
            try {
                const resultado = await searchWeb(consulta);
                return { result: { ok: true, resultado } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'recordar': {
            const dato = String(args.dato ?? '');
            try {
                addMemory(dato);
                return { result: { ok: true, message: 'Guardado en la memoria permanente.' } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'olvidar': {
            const texto = String(args.texto ?? '');
            try {
                // Busca primero en la memoria, y si no está ahí, en lo que
                // aprendió sola sobre el estilo del usuario.
                const removed = removeMemory(texto).removed || removeStyleNote(texto);
                return removed
                    ? { result: { ok: true, message: 'Borrado de la memoria.' } }
                    : { result: { ok: false, error: 'No encontré ningún dato guardado que coincida.' } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'listar_memoria': {
            const memorias = loadMemory();
            const perfil = describeProfile();
            return { result: { ok: true, cantidad: memorias.length, memorias, lo_que_note_de_su_forma_de_usarme: perfil } };
        }

        case 'generar_imagen': {
            const prompt = String(args.prompt ?? '');
            try {
                const image = await generateImage(prompt);
                return { result: { ok: true, url: image.url }, imageUrl: image.url };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'crear_rutina': {
            const nombre = String(args.nombre ?? '');
            const pasosCrudos = Array.isArray(args.pasos) ? args.pasos : [];

            // Filtramos cualquier paso que use una herramienta sensible — las
            // rutinas son para automatización rápida y segura, nunca deben
            // saltarse la confirmación de algo como cerrar_app.
            const pasosSeguros = pasosCrudos.filter(
                (p: { herramienta?: string }) => !CONFIRMATION_REQUIRED_TOOLS.has(p?.herramienta ?? '')
            );
            const pasosOmitidos = pasosCrudos.length - pasosSeguros.length;

            if (pasosSeguros.length === 0) {
                return {
                    result: {
                        ok: false,
                        error: 'Todos los pasos pedidos requieren confirmación manual, no se puede armar una rutina con ellos.',
                    },
                };
            }

            try {
                saveRoutine({ nombre, pasos: pasosSeguros as RoutineStep[] });
                return {
                    result: {
                        ok: true,
                        message: `Rutina "${nombre}" guardada con ${pasosSeguros.length} paso(s).${pasosOmitidos > 0 ? ` (${pasosOmitidos} paso(s) se omitieron por ser sensibles.)` : ''
                            }`,
                    },
                };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'ejecutar_rutina': {
            const nombre = String(args.nombre ?? '');
            const routine = getRoutine(nombre);

            if (!routine) {
                return { result: { ok: false, error: `No encontré ninguna rutina llamada "${nombre}".` } };
            }

            const resultados: string[] = [];
            for (const paso of routine.pasos) {
                // Salvaguarda extra por si una rutina vieja quedó con algo sensible.
                if (CONFIRMATION_REQUIRED_TOOLS.has(paso.herramienta)) {
                    resultados.push(`(omitido: "${paso.herramienta}" requiere confirmación manual)`);
                    continue;
                }
                const { result } = await executeTool(paso.herramienta, paso.argumentos);
                const r = result as { ok: boolean; message?: string; error?: string };
                resultados.push(r.ok ? r.message ?? 'ok' : `error: ${r.error}`);
            }

            return { result: { ok: true, pasosEjecutados: routine.pasos.length, resultados } };
        }

        case 'listar_rutinas': {
            const nombres = loadRoutines().map((r) => r.nombre);
            return { result: { ok: true, rutinas: nombres } };
        }

        case 'borrar_rutina': {
            const nombre = String(args.nombre ?? '');
            const borrada = deleteRoutine(nombre);
            return borrada
                ? { result: { ok: true, message: `Rutina "${nombre}" borrada.` } }
                : { result: { ok: false, error: `No encontré ninguna rutina llamada "${nombre}".` } };
        }

        case 'liberar_ram': {
            try {
                const message = await freeUpMemory();
                return { result: { ok: true, message } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'leer_archivo': {
            const ruta = String(args.ruta ?? '');
            try {
                const contenido = readFile(ruta);
                return { result: { ok: true, contenido } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'escribir_archivo': {
            const ruta = String(args.ruta ?? '');
            const contenido = String(args.contenido ?? '');
            try {
                const rutaFinal = writeFile(ruta, contenido);
                return { result: { ok: true, message: `Escrito en ${rutaFinal}` } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'listar_carpeta': {
            const ruta = String(args.ruta ?? '');
            try {
                const entradas = listDirectory(ruta);
                return { result: { ok: true, entradas } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'ejecutar_comando': {
            const comando = String(args.comando ?? '');
            const carpeta = args.carpeta ? String(args.carpeta) : undefined;
            try {
                const salida = await runCommand(comando, carpeta);
                return { result: { ok: true, salida } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'eliminar_archivo': {
            const ruta = String(args.ruta ?? '');
            try {
                const message = await deleteFile(ruta);
                return { result: { ok: true, message } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'editar_archivo': {
            const ruta = String(args.ruta ?? '');
            const textoActual = String(args.textoActual ?? '');
            const textoNuevo = String(args.textoNuevo ?? '');
            try {
                const rutaFinal = editFile(ruta, textoActual, textoNuevo);
                return { result: { ok: true, message: `Editado ${rutaFinal}` } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'crear_recordatorio': {
            const mensaje = String(args.mensaje ?? '');
            const minutosDesdeAhora = typeof args.minutosDesdeAhora === 'number' ? args.minutosDesdeAhora : undefined;
            const horaDelDia = args.horaDelDia ? String(args.horaDelDia) : undefined;
            const diasDesdeAhora = typeof args.diasDesdeAhora === 'number' ? args.diasDesdeAhora : 0;

            try {
                let timestamp: number;

                if (minutosDesdeAhora !== undefined) {
                    timestamp = Date.now() + minutosDesdeAhora * 60000;
                } else if (horaDelDia) {
                    const [horas, minutos] = horaDelDia.split(':').map(Number);
                    const objetivo = new Date();
                    objetivo.setSeconds(0, 0);
                    objetivo.setHours(horas, minutos);
                    objetivo.setDate(objetivo.getDate() + diasDesdeAhora);

                    // Si pidió "hoy" pero esa hora ya pasó, lo pasamos a mañana solos
                    // (esto se calcula AHORA, con la hora real, nunca queda vieja).
                    if (diasDesdeAhora === 0 && objetivo.getTime() <= Date.now()) {
                        objetivo.setDate(objetivo.getDate() + 1);
                    }

                    timestamp = objetivo.getTime();
                } else {
                    return {
                        result: { ok: false, error: 'Falta indicar minutosDesdeAhora o horaDelDia.' },
                    };
                }

                const reminder = addReminder(mensaje, timestamp);
                const cuando = new Date(reminder.timestamp).toLocaleString('es-CO', {
                    weekday: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                });
                return { result: { ok: true, message: `Recordatorio guardado para ${cuando}.` } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'listar_recordatorios': {
            const recordatorios = listReminders().map((r) => ({
                mensaje: r.mensaje,
                cuando: new Date(r.timestamp).toLocaleString('es-CO', {
                    weekday: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                }),
            }));
            return { result: { ok: true, recordatorios } };
        }

        case 'cancelar_recordatorio': {
            const texto = String(args.texto ?? '');
            const cancelado = cancelReminder(texto);
            return cancelado
                ? { result: { ok: true, message: 'Recordatorio cancelado.' } }
                : { result: { ok: false, error: 'No encontré ningún recordatorio que coincida.' } };
        }

        case 'abrir_pagina_web': {
            const url = String(args.url ?? '');
            try {
                await openUrl(url);
                return { result: { ok: true, message: `Abrí ${url}` } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'reproducir_youtube': {
            const consulta = String(args.consulta ?? '');
            try {
                await playImmediately(consulta);
                return { result: { ok: true, message: `Reproduciendo "${consulta}" ahora mismo.` } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'agregar_a_fila': {
            const consulta = String(args.consulta ?? '');
            try {
                const { playedNow, queuePosition } = await queueOrPlaySong(consulta);
                const message = playedNow
                    ? `Nada estaba sonando, así que reproduciendo "${consulta}" ahora mismo.`
                    : `"${consulta}" agregada a la fila (posición ${queuePosition}).`;
                return { result: { ok: true, message } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'ver_fila': {
            const estado = getQueueState();
            return { result: { ok: true, ...estado } };
        }

        case 'actualizar_proyecto': {
            const nombre = String(args.nombre ?? '');
            const progreso = typeof args.progreso === 'number' ? args.progreso : undefined;
            const estado = args.estado ? String(args.estado) : undefined;
            try {
                const proyecto = upsertProject(nombre, progreso, estado);
                return {
                    result: {
                        ok: true,
                        message: `"${proyecto.nombre}" actualizado: ${proyecto.progreso}% — ${proyecto.estado}.`,
                    },
                };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'listar_proyectos': {
            const proyectos = loadProjects();
            return { result: { ok: true, proyectos } };
        }

        case 'borrar_proyecto': {
            const nombre = String(args.nombre ?? '');
            const borrado = deleteProject(nombre);
            return borrado
                ? { result: { ok: true, message: `Proyecto "${nombre}" quitado del tablero.` } }
                : { result: { ok: false, error: `No encontré ningún proyecto llamado "${nombre}".` } };
        }

        case 'revisar_seguridad': {
            try {
                const status = await getDefenderStatus();
                return { result: { ok: true, ...status } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'escanear_virus': {
            try {
                startQuickScan();
                return {
                    result: {
                        ok: true,
                        message: 'Escaneo rápido iniciado en segundo plano, puede tardar varios minutos.',
                    },
                };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'conectar_spotify': {
            try {
                await startSpotifyAuth();
                return { result: { ok: true, message: 'Conectada a Spotify con éxito.' } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'reproducir_spotify': {
            const consulta = String(args.consulta ?? '');
            try {
                if (!isSpotifyConnected()) {
                    return {
                        result: {
                            ok: false,
                            error: 'Todavía no estoy conectada a Spotify — usa conectar_spotify primero.',
                        },
                    };
                }
                const track = await searchAndPlaySpotify(consulta);
                return {
                    result: { ok: true, message: `Reproduciendo "${track.name}" de ${track.artist} en Spotify.` },
                };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'buscar_programa': {
            const nombre = String(args.nombre ?? '');
            try {
                const programas = await findInstalledProgram(nombre);
                return { result: { ok: true, cantidad: programas.length, programas } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'abrir_programa_encontrado': {
            const nombre = String(args.nombre ?? '');
            const appId = String(args.appId ?? '');
            const esAppDeStore = Boolean(args.esAppDeStore);
            try {
                await launchProgram({ name: nombre, appId, isStoreApp: esAppDeStore });
                return { result: { ok: true, message: `Abriendo ${nombre}` } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        default:
            return { result: { ok: false, error: `Herramienta desconocida: ${name}` } };
    }
}

// --- Cliente y sesión de chat ---

let client: GoogleGenAI | null = null;
let chatSession: Chat | null = null;

// Configuración base de la conversación (prompt del sistema +
// herramientas). Se guarda aparte porque, para pedir más o menos
// razonamiento en UN mensaje, hay que mandar la configuración completa
// de nuevo con ese ajuste (ver sendToChat).
let chatConfig: GenerateContentConfig | null = null;

function getClient(): GoogleGenAI {
    if (!client) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey || apiKey.includes('pega_tu_key')) {
            throw new Error(
                'Falta configurar GEMINI_API_KEY en el archivo .env (ver .env.example).'
            );
        }
        client = new GoogleGenAI({ apiKey });
    }
    return client;
}

function getChatSession(): Chat {
    if (!chatSession) {
        chatConfig = {
            systemInstruction: buildSystemInstruction(),
            tools,
        };
        chatSession = getClient().chats.create({ model: MODEL, config: chatConfig });
    }
    return chatSession;
}

/**
 * Reinicia la conversación (olvida el historial). Útil si el usuario
 * quiere "empezar de nuevo" o si algo se rompe.
 */
export function resetChat(): void {
    chatSession = null;
}

const MAX_RESTORED_MESSAGES = 40; // suficiente contexto sin mandar conversaciones enormes

/**
 * Retoma una conversación guardada: arranca una sesión nueva con el
 * modelo, pero dándole como contexto lo que ya se habló (solo el texto;
 * las herramientas que se usaron en su momento no se repiten).
 */
export function restoreChat(messages: Array<{ role: 'user' | 'assistant'; text: string }>): void {
    const history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const message of messages.slice(-MAX_RESTORED_MESSAGES)) {
        const text = message.text.trim();
        if (!text) continue;
        const role = message.role === 'user' ? 'user' : 'model';
        const last = history[history.length - 1];
        if (last && last.role === role) {
            // Dos mensajes seguidos del mismo lado se unen: el modelo espera turnos alternados.
            last.parts[0].text += `\n${text}`;
        } else if (history.length > 0 || role === 'user') {
            // (la conversación tiene que empezar por un mensaje del usuario)
            history.push({ role, parts: [{ text }] });
        }
    }

    chatConfig = {
        systemInstruction: buildSystemInstruction(),
        tools,
    };
    chatSession = getClient().chats.create({ model: MODEL, config: chatConfig, history });
}

/**
 * Transcribe un audio grabado (voz del usuario) a texto en español.
 * Es una llamada "de una sola vez", separada de la conversación principal
 * — no queremos que la transcripción en sí quede en el historial del chat,
 * solo el texto resultante (que luego pasa por sendMessage normal).
 */
export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
    const client = getClient();

    const response = await withRetry(() =>
        client.models.generateContent({
            model: MODEL,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType, data: audioBase64 } },
                        {
                            text:
                                'Transcribe exactamente lo que se dice en este audio, en español. ' +
                                'Responde ÚNICAMENTE con la transcripción literal, sin comillas, sin ' +
                                'explicaciones, sin agregar nada. Si no se entiende nada o está en silencio, ' +
                                'responde con exactamente: [silencio]',
                        },
                    ],
                },
            ],
        })
    );

    return (response.text ?? '').trim();
}

/**
 * Captura TODAS las pantallas conectadas (multi-monitor) y le pregunta a
 * Gemini qué ve (o algo específico si se pasa una pregunta). Es una llamada
 * "de un solo uso", como transcribeAudio — el resultado (texto) es lo que
 * se le devuelve al modelo dentro del ciclo normal de herramientas.
 */
async function describeScreen(question?: string): Promise<string> {
    const client = getClient();
    const screens = await captureAllScreens();

    const screenLabel =
        screens.length > 1
            ? `Estas son las ${screens.length} pantallas conectadas de Andrés (Pantalla 1, Pantalla 2, etc., en ese orden). `
            : '';

    const instruction = question
        ? `${screenLabel}Mira esta captura de pantalla y responde en español: ${question}`
        : `${screenLabel}Describe en español, de forma breve y natural (como en una conversación ` +
        'hablada), qué se ve — qué aplicación o ventana está abierta en cada pantalla, y ' +
        'cualquier detalle relevante. No hagas una lista exhaustiva de todo, ve a lo importante. ' +
        'Si hay varias pantallas, menciona brevemente qué hay en cada una.';

    const imageParts = screens.map((s) => ({ inlineData: { mimeType: s.mimeType, data: s.base64 } }));

    const response = await withRetry(() =>
        client.models.generateContent({
            model: MODEL,
            contents: [
                {
                    role: 'user',
                    parts: [...imageParts, { text: instruction }],
                },
            ],
        })
    );

    return (response.text ?? '').trim();
}

/**
 * Busca en internet usando la búsqueda de Google integrada de Gemini
 * (grounding). Es una llamada "de un solo uso" separada de la conversación
 * principal, porque Gemini no permite mezclar la herramienta de búsqueda
 * con nuestras otras herramientas (function calling) en la misma petición.
 */
async function searchWeb(query: string): Promise<string> {
    const client = getClient();

    const response = await withRetry(() =>
        client.models.generateContent({
            model: MODEL,
            contents:
                `Busca información actual sobre esto y responde en español, de forma breve ` +
                `y natural (como en una conversación hablada): ${query}`,
            config: {
                tools: [{ googleSearch: {} }],
            },
        })
    );

    let text = (response.text ?? '').trim();

    // Agregar 1-2 fuentes si Gemini las trae, para que Andrés pueda
    // verificar si quiere (sin saturar la respuesta hablada con links).
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks && chunks.length > 0) {
        const sources = chunks
            .slice(0, 2)
            .map((c) => c.web?.title)
            .filter(Boolean);
        if (sources.length > 0) {
            text += `\n\nFuentes: ${sources.join(', ')}`;
        }
    }

    return text;
}

const MAX_TOOL_ITERATIONS = 8; // seguro contra loops infinitos de herramientas (8 da margen para tareas de varios pasos)

/**
 * Manda un mensaje del usuario a ALYA y devuelve su respuesta.
 * Maneja automáticamente el ciclo de herramientas (si Gemini pide usar
 * una, la ejecuta y le manda el resultado de vuelta, hasta que responda
 * con texto final).
 */
/**
 * Después de cada intercambio, revisa EN SEGUNDO PLANO (sin bloquear ni
 * retrasar la respuesta que ya se le mostró a Andrés) si dijo algo que
 * valga la pena recordar como preferencia duradera, sin que lo haya
 * pedido explícitamente con "recuerda que...".
 *
 * Es deliberadamente conservador: solo guarda patrones/preferencias
 * genuinamente reutilizables, no pedidos puntuales de una sola vez.
 */
async function learnFromExchange(userMessage: string, assistantReply: string): Promise<void> {
    try {
        const client = getClient();
        const { userName, adaptToUser } = loadSettings();

        // Se le pasa lo que YA sabe, para que no guarde lo mismo dos veces
        // con otras palabras.
        const yaSabe = [...loadMemory().slice(-40), ...loadProfile().styleNotes];
        const yaSabeBlock = yaSabe.length > 0 ? yaSabe.map((x) => `- ${x}`).join('\n') : '(nada todavía)';

        const response = await withRetry(() =>
            client.models.generateContent({
                model: MODEL,
                config: { responseMimeType: 'application/json' },
                contents:
                    `Este es un intercambio entre ${userName} y su asistente ALYA:\n` +
                    `${userName}: ${userMessage}\n` +
                    `ALYA: ${assistantReply}\n\n` +
                    `Esto ya lo sabes de ${userName} (NO lo repitas ni lo reformules):\n${yaSabeBlock}\n\n` +
                    `Responde SOLO con un objeto JSON con dos claves: {"dato": ..., "estilo": ...}\n\n` +
                    `"dato": una PREFERENCIA DURADERA o un dato permanente sobre ${userName} que valga la ` +
                    `pena recordar para conversaciones futuras (ej. "prefiere Maven sobre Gradle en ` +
                    `proyectos Java", "trabaja de noche", "su gato se llama Rocky"). NO guardes pedidos ` +
                    `puntuales de una sola vez (ej. "abre Discord ahora", "pon esta canción"), solo ` +
                    `patrones genuinamente reutilizables. Si no hay nada así, null.\n\n` +
                    `"estilo": una observación NUEVA sobre CÓMO se comunica ${userName} o cómo prefiere ` +
                    `que le respondan, que sirva para adaptarse a esa persona en el futuro (ej. "bromea ` +
                    `seguido y le gusta que le sigan el juego", "prefiere las explicaciones en pasos ` +
                    `numerados", "se impacienta con respuestas largas", "tiene nivel avanzado en ` +
                    `programación"). Solo si se nota CLARAMENTE en este intercambio — un mensaje normal ` +
                    `no alcanza. Si no hay nada así, null.\n\n` +
                    `Las dos, si las hay: una frase corta y clara, en tercera persona.`,
            })
        );

        const learned = parseLearning(response.text ?? '');

        // El modelo a veces repite algo que ya sabe cambiándole una coma o un
        // acento, así que además se compara acá antes de guardar.
        if (learned.dato && !isAlreadyKnown(learned.dato, yaSabe)) {
            addMemory(learned.dato);
            console.log(`[ALYA] Aprendido automáticamente: ${learned.dato}`);
        }
        if (learned.estilo && adaptToUser !== false && !isAlreadyKnown(learned.estilo, yaSabe)) {
            addStyleNote(learned.estilo);
            console.log(`[ALYA] Notó sobre el estilo del usuario: ${learned.estilo}`);
        }
    } catch (err) {
        // Si esto falla, no pasa nada grave — es un extra silencioso, no algo
        // crítico para el funcionamiento normal del chat.
        console.warn('[ALYA] Aprendizaje pasivo falló (sin impacto en el chat):', (err as Error).message);
    }
}

/**
 * ¿Esta frase dice lo mismo que alguna que ya está guardada? Compara las
 * palabras (sin acentos ni mayúsculas): si comparten la gran mayoría, es
 * un repetido.
 */
function isAlreadyKnown(candidate: string, known: string[]): boolean {
    const words = (text: string): Set<string> =>
        new Set(
            text
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9ñ ]+/g, ' ')
                .split(' ')
                .filter((w) => w.length > 2)
        );

    const a = words(candidate);
    if (a.size === 0) return true;

    return known.some((existing) => {
        const b = words(existing);
        if (b.size === 0) return false;
        let shared = 0;
        for (const w of a) if (b.has(w)) shared++;
        return shared / Math.min(a.size, b.size) >= 0.75;
    });
}

/**
 * Lee la respuesta del aprendizaje pasivo ({"dato": ..., "estilo": ...})
 * con cuidado: si el modelo devolvió algo raro, simplemente no se guarda
 * nada.
 */
function parseLearning(raw: string): { dato: string | null; estilo: string | null } {
    const clean = (value: unknown): string | null => {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        if (!text || text.length >= 200) return null;
        if (['ninguno', 'ninguna', 'null', 'nada', 'n/a'].includes(text.toLowerCase())) return null;
        return text;
    };

    try {
        const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object') return { dato: null, estilo: null };
        return { dato: clean(parsed.dato), estilo: clean(parsed.estilo) };
    } catch {
        return { dato: null, estilo: null };
    }
}

/**
 * Reintenta una llamada a Gemini si falla por un error TEMPORAL del lado
 * de Google (503 "alta demanda", o 429 "demasiadas peticiones") — espera
 * un poco más entre cada intento (2s, 4s, 8s). Cualquier otro tipo de
 * error se deja pasar de inmediato, sin reintentar (no tiene sentido
 * reintentar algo que no es un problema temporal).
 */
// Cuándo fue la última vez que Gemini contestó bien, y el último error
// (para mostrar el estado de conexión en "Acerca de ALYA").
let lastGeminiOkAt = 0;
let lastGeminiError: string | null = null;

export type EngineStatus = 'connected' | 'no_key' | 'error' | 'offline';

export interface EngineInfo {
    model: string;
    status: EngineStatus;
    detail: string;
}

/**
 * Estado del motor de IA. Si Gemini respondió hace poco, alcanza con eso;
 * si no, se hace una consulta mínima (pedir los datos del modelo: no gasta
 * cuota de generación) para saber si de verdad hay conexión.
 */
export async function getEngineInfo(): Promise<EngineInfo> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.includes('pega_tu_key')) {
        return { model: MODEL, status: 'no_key', detail: 'Falta la clave de Gemini' };
    }

    if (Date.now() - lastGeminiOkAt < 5 * 60 * 1000) {
        return { model: MODEL, status: 'connected', detail: 'Conectado' };
    }

    try {
        await Promise.race([
            getClient().models.get({ model: MODEL }),
            new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 7000)),
        ]);
        lastGeminiOkAt = Date.now();
        lastGeminiError = null;
        return { model: MODEL, status: 'connected', detail: 'Conectado' };
    } catch (err) {
        const message = (err as Error).message ?? '';
        if (/API key|API_KEY|401|403|PERMISSION/i.test(message)) {
            return { model: MODEL, status: 'error', detail: 'La clave de Gemini no es válida' };
        }
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
            return { model: MODEL, status: 'error', detail: 'Se agotó la cuota de la clave de Gemini' };
        }
        return { model: MODEL, status: 'offline', detail: 'Sin conexión con Gemini' };
    }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const MAX_INTENTOS = 3;
    const ESPERAS_MS = [2000, 4000, 8000];

    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
        try {
            const value = await fn();
            lastGeminiOkAt = Date.now();
            lastGeminiError = null;
            return value;
        } catch (err) {
            lastGeminiError = (err as Error).message ?? 'error';
            const mensaje = (err as Error).message ?? '';
            const esTemporal = mensaje.includes('503') || mensaje.includes('UNAVAILABLE') || mensaje.includes('429');
            const esUltimoIntento = intento === MAX_INTENTOS - 1;

            if (!esTemporal || esUltimoIntento) throw err;

            console.warn(
                `[ALYA] Gemini con alta demanda, reintentando en ${ESPERAS_MS[intento] / 1000}s ` +
                `(intento ${intento + 1}/${MAX_INTENTOS})...`
            );
            await new Promise((resolve) => setTimeout(resolve, ESPERAS_MS[intento]));
        }
    }

    // Nunca debería llegar acá (el for ya cubre todos los casos), pero
    // TypeScript necesita un retorno explícito en todos los caminos.
    throw new Error('Se agotaron los reintentos.');
}

const TOOL_TIMEOUT_MS = 120000;

/**
 * Ejecuta una herramienta con un límite de tiempo. Si una herramienta se
 * queda esperando algo que nunca llega, ALYA quedaría en "Procesando…"
 * para siempre y sin poder recibir otro mensaje; con esto, a los 2
 * minutos se le devuelve un error al modelo y la conversación sigue.
 */
async function executeToolWithLimit(
    name: string,
    args: Record<string, unknown>
): Promise<{ result: unknown; imageUrl?: string }> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<{ result: unknown }>((resolve) => {
        timer = setTimeout(() => {
            console.warn(`[ALYA] La herramienta ${name} no terminó en ${TOOL_TIMEOUT_MS / 1000}s; se abandona.`);
            resolve({
                result: {
                    ok: false,
                    error: 'La herramienta tardó demasiado y se abandonó. Es un problema técnico: dilo así, sin inventar el resultado.',
                },
            });
        }, TOOL_TIMEOUT_MS);
    });

    try {
        return await Promise.race([executeTool(name, args), limit]);
    } catch (err) {
        return { result: { ok: false, error: (err as Error).message } };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Deja en la consola qué herramienta usó ALYA, con qué datos y qué
 * obtuvo. Así se puede contrastar lo que ALYA DICE que pasó con lo que
 * pasó de verdad.
 */
function logToolCall(name: string, args: Record<string, unknown>, result: unknown): void {
    const short = (value: unknown): string => {
        let text: string;
        try {
            text = JSON.stringify(value) ?? String(value);
        } catch {
            text = String(value);
        }
        return text.length > 420 ? `${text.slice(0, 420)}…` : text;
    };
    console.log(`[ALYA] Herramienta ${name}(${short(redactDeep(args))}) → ${short(redactDeep(result))}`);
}

// Si el modelo configurado no aceptara elegir el nivel de razonamiento,
// se anota acá y no se vuelve a intentar (el chat sigue como siempre).
let thinkingLevelsSupported = true;

const DEPTH_TO_LEVEL: Record<ThinkingDepth, ThinkingLevel> = {
    MINIMAL: ThinkingLevel.MINIMAL,
    LOW: ThinkingLevel.LOW,
    MEDIUM: ThinkingLevel.MEDIUM,
    HIGH: ThinkingLevel.HIGH,
};

// --- Respuesta en vivo ---
// Mientras el modelo escribe, se le va avisando a quien pidió la respuesta
// (la ventana de chat y la voz) con lo que ya hay. Lo que se avisa es
// SIEMPRE el texto limpio completo hasta ese momento, no pedacitos
// sueltos: así la etiqueta de ánimo y cualquier clave se sacan igual que
// en la respuesta final.
// "settled" = ese texto ya quedó cerrado (ALYA dijo algo y ahora va a usar
// una herramienta): se puede decir entero sin esperar a que siga.
export interface ReplyStreamHandlers {
    onText?: (textSoFar: string, mood: Mood | undefined, settled?: boolean) => void;
}

/** Lo que el modelo devolvió en una vuelta: su texto y las herramientas que pidió. */
interface ModelTurn {
    text: string;
    functionCalls: FunctionCall[];
}

// Si el modo en vivo fallara dos veces seguidas por algo propio de ese
// modo, se deja de usar por esta sesión (las respuestas llegan completas
// de una vez, como antes).
let streamingSupported = true;
let streamFailures = 0;

const isPlainTextPart = (part: Part): boolean => typeof part.text === 'string' && Object.keys(part).length === 1;

/**
 * En modo en vivo la librería guarda la respuesta del modelo en el
 * historial partida en un pedazo por cada tramo recibido. Acá se junta
 * en un solo turno (como queda cuando la respuesta llega completa): el
 * modelo espera turnos alternados, y una llamada a herramienta tiene que
 * quedar pegada al turno del usuario que la provocó.
 */
function tidyStreamedHistory(chat: Chat): void {
    try {
        const history = (chat as unknown as { history?: Content[] }).history;
        if (!Array.isArray(history)) return;

        let start = history.length;
        while (start > 0 && history[start - 1].role === 'model') start--;
        const run = history.slice(start);
        if (run.length < 2) return;

        const parts: Part[] = [];
        for (const content of run) {
            for (const part of content.parts ?? []) {
                const last = parts[parts.length - 1];
                if (last && isPlainTextPart(last) && isPlainTextPart(part)) {
                    last.text = `${last.text ?? ''}${part.text ?? ''}`;
                } else {
                    parts.push({ ...part });
                }
            }
        }
        if (parts.length > 0) history.splice(start, run.length, { role: 'model', parts });
    } catch (err) {
        console.warn('[ALYA] No se pudo ordenar el historial de la respuesta en vivo:', (err as Error).message);
    }
}

/** Pide una vuelta al modelo en vivo, avisando del texto a medida que llega. */
async function readStreamedTurn(
    chat: Chat,
    params: SendMessageParameters,
    onDelta: (turnTextSoFar: string) => void
): Promise<ModelTurn> {
    const stream = await chat.sendMessageStream(params);
    let text = '';
    const functionCalls: FunctionCall[] = [];

    for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        let grew = false;
        for (const part of parts) {
            if (part.functionCall) {
                functionCalls.push(part.functionCall);
            } else if (typeof part.text === 'string' && part.text.length > 0 && !part.thought) {
                text += part.text;
                grew = true;
            }
        }
        if (grew) {
            try {
                onDelta(text);
            } catch (err) {
                console.warn('[ALYA] Falló el aviso de respuesta en vivo:', (err as Error).message);
            }
        }
    }

    tidyStreamedHistory(chat);
    return { text, functionCalls };
}

/** Una vuelta del modelo: en vivo si alguien está escuchando, completa de una vez si no. */
async function requestTurn(
    chat: Chat,
    params: SendMessageParameters,
    onDelta: ((turnTextSoFar: string) => void) | undefined
): Promise<ModelTurn> {
    if (onDelta && streamingSupported) {
        try {
            const turn = await withRetry(() => readStreamedTurn(chat, params, onDelta));
            streamFailures = 0;
            return turn;
        } catch (err) {
            const mensaje = (err as Error).message ?? '';
            // Errores que no dependen del modo en vivo (la clave, la cuota,
            // el servicio caído, el nivel de razonamiento): siguen su curso.
            const ajeno =
                /thinking|503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|quota|API key|API_KEY|401|403|PERMISSION_DENIED/i.test(
                    mensaje
                );
            if (ajeno) throw err;

            streamFailures++;
            if (streamFailures >= 2) streamingSupported = false;
            console.warn('[ALYA] La respuesta en vivo falló; pido esta respuesta completa de una vez:', mensaje);
        }
    }

    const response: GenerateContentResponse = await withRetry(() => chat.sendMessage(params));
    return { text: response.text ?? '', functionCalls: response.functionCalls ?? [] };
}

/**
 * Manda un mensaje a la conversación pidiendo cierta profundidad de
 * razonamiento ("depth"). Sin depth, se manda como siempre. Con
 * "onDelta", la respuesta se va entregando a medida que se escribe.
 */
async function sendToChat(
    chat: Chat,
    message: PartListUnion,
    depth: ThinkingDepth | undefined,
    onDelta?: (turnTextSoFar: string) => void
): Promise<ModelTurn> {
    const baseConfig = chatConfig;

    if (depth && baseConfig && thinkingLevelsSupported) {
        try {
            return await requestTurn(
                chat,
                { message, config: { ...baseConfig, thinkingConfig: { thinkingLevel: DEPTH_TO_LEVEL[depth] } } },
                onDelta
            );
        } catch (err) {
            const mensaje = (err as Error).message ?? '';
            if (!/thinking/i.test(mensaje)) throw err; // otro tipo de error: que siga su curso normal

            thinkingLevelsSupported = false;
            console.warn('[ALYA] El modelo no aceptó el nivel de razonamiento pedido — sigo sin ajustarlo:', mensaje);
        }
    }

    return requestTurn(chat, { message }, onDelta);
}

/**
 * Deja presentable el texto de una vuelta que TODAVÍA se está
 * escribiendo: sin la etiqueta de ánimo, sin claves, y sin la última
 * palabra si puede estar a medias (una clave partida en dos tramos no se
 * podría reconocer hasta tenerla entera). Si el tramo terminó en un
 * espacio, la palabra ya está completa y se deja; el espacio final se
 * conserva para que la voz sepa que la frase se cerró.
 */
function previewStreamedText(raw: string): { text: string; mood: Mood | undefined } {
    const start = raw.trimStart();
    // La etiqueta de ánimo a medio escribir ("[ale"): todavía no hay nada que mostrar.
    if (start.startsWith('[') && !start.includes(']') && start.length < 24) {
        return { text: '', mood: undefined };
    }

    const { text, mood } = extractMood(raw);
    const lastWordComplete = /\s$/.test(raw);
    let safe = lastWordComplete ? text : text.replace(/\S+$/, '');

    // Una clave privada de varias líneas solo se puede tachar cuando llegó
    // completa: mientras tanto no se muestra nada desde donde empieza.
    const keyStart = safe.indexOf('-----BEGIN');
    if (keyStart !== -1 && !/-----END [A-Z ]*PRIVATE KEY-----/.test(safe.slice(keyStart))) {
        safe = safe.slice(0, keyStart);
    }

    const clean = redactSecrets(safe).trimEnd();
    return { text: clean && lastWordComplete ? `${clean} ` : clean, mood };
}

export async function sendMessage(
    userMessage: string,
    images: ChatImage[] = [],
    handlers: ReplyStreamHandlers = {}
): Promise<ChatMessage> {
    const chat = getChatSession();
    const settings = loadSettings();
    const isRealUserMessage = userMessage.trim().length > 0 && !userMessage.startsWith('(Sistema:');
    const adapt = settings.adaptToUser !== false;

    // Cuánto pensar ESTE mensaje (ver thinking.ts): rápido para órdenes
    // simples, más a fondo para preguntas difíciles. Se usa el mismo nivel
    // en todos los pasos de herramientas de este turno.
    const depth = pickThinkingDepth(userMessage, images.length > 0, settings.thinkingMode);

    if (adapt && isRealUserMessage) recordUserMessage(userMessage);

    // Con imágenes adjuntas, el mensaje va como varias "partes": primero
    // las imágenes y después el texto (Gemini las ve directamente, igual
    // que en describeScreen). Sin imágenes, va el texto solo como siempre.
    const firstMessage =
        images.length > 0
            ? [
                ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
                {
                    text:
                        userMessage.trim() ||
                        `(Sistema: ${settings.userName} te mandó ${images.length > 1 ? 'estas imágenes' : 'esta imagen'} sin escribir nada.)`,
                },
            ]
            : userMessage;

    // El texto de la respuesta se arma por vueltas: si ALYA dice algo antes
    // de usar una herramienta ("Déjame revisar…"), eso queda como parte de
    // la respuesta, y lo que diga después va a continuación.
    const closedTexts: string[] = [];
    let replyMood: Mood | undefined;

    const closeTurnText = (raw: string): void => {
        const expression = extractMood(raw);
        const clean = redactSecrets(expression.text);
        if (expression.mood) replyMood = expression.mood;
        if (clean && closedTexts[closedTexts.length - 1] !== clean) closedTexts.push(clean);
    };

    const onText = handlers.onText;
    const onDelta = onText
        ? (turnTextSoFar: string): void => {
              const preview = previewStreamedText(turnTextSoFar);
              const combined = [...closedTexts, preview.text].filter(Boolean).join('\n\n');
              if (combined) onText(combined, preview.mood ?? replyMood);
          }
        : undefined;

    let response = await sendToChat(chat, firstMessage, depth, onDelta);
    let imageUrl: string | undefined;
    const cards: ChatCard[] = []; // tarjetas con resultados de herramientas (ver cards.ts)
    let newPendingConfirmation: PendingConfirmation | undefined; // solo la de ESTE mensaje

    let iterations = 0;
    while (response.functionCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        closeTurnText(response.text); // lo que haya dicho antes de pedir la herramienta
        if (onText && closedTexts.length > 0) onText(closedTexts.join('\n\n'), replyMood, true);

        const functionResponseParts: Array<{
            functionResponse: { name: string; response: { result: unknown } };
        }> = [];
        for (const call of response.functionCalls) {
            const name = call.name ?? '';
            const args = (call.args ?? {}) as Record<string, unknown>;

            // --- Herramienta sensible: pausar y pedir confirmación ---
            if (CONFIRMATION_REQUIRED_TOOLS.has(name)) {
                const confirmation: PendingConfirmation = {
                    tool: name,
                    args,
                    description: redactSecrets(describeAction(name, args)),
                };
                pendingConfirmation = confirmation; // estado del módulo, para confirmPendingAction()
                newPendingConfirmation = confirmation; // lo que devolvemos EN ESTE mensaje

                // Le devolvemos al modelo un resultado "no ejecutado todavía" para
                // que la conversación quede en un estado válido (Gemini espera una
                // respuesta por cada llamada a herramienta que hizo).
                functionResponseParts.push({
                    functionResponse: {
                        name,
                        response: {
                            result: {
                                ok: false,
                                pendiente: true,
                                mensaje:
                                    'Esta acción requiere confirmación explícita del usuario antes de ' +
                                    'ejecutarse. Ya se le mostró un botón de confirmar/cancelar. No la ' +
                                    'vuelvas a intentar — solo avísale que estás esperando su confirmación.',
                            },
                        },
                    },
                });
                continue;
            }

            if (adapt) recordToolUse(name, args);
            console.log(`[ALYA] Usando herramienta ${name}…`);
            const { result: rawResult, imageUrl: toolImageUrl } = await executeToolWithLimit(name, args);
            // Última barrera: cualquier clave que venga en el resultado se tacha
            // ANTES de que llegue al modelo, a la tarjeta, al historial o a la consola.
            const result = redactDeep(rawResult);
            if (toolImageUrl) imageUrl = toolImageUrl;
            logToolCall(name, args, result);

            const card = buildCard(name, args, result);
            if (card && cards.length < 4) cards.push(card);

            functionResponseParts.push({
                functionResponse: { name, response: { result } },
            });
        }

        response = await sendToChat(chat, functionResponseParts, depth, onDelta);
    }

    // La librería de Gemini a veces devuelve una respuesta que es SOLO
    // llamadas a herramientas, sin texto de acompañamiento — en ese caso
    // el texto queda vacío. Nos aseguramos de nunca mandar una burbuja en
    // blanco: si se agotaron los intentos con herramientas todavía
    // pendientes, o si no hubo texto por cualquier otra razón, usamos un
    // mensaje de respaldo en vez de dejarlo así.
    let lastText = response.text;

    if (response.functionCalls.length > 0) {
        // Llegamos al límite de intentos con herramientas sin resolver.
        lastText = 'Esto me está tomando más pasos de los normales — intenta pedírmelo de nuevo, quizás más simple.';
    }

    // La etiqueta de ánimo ("[alegre]", etc.) se saca del texto: no se
    // muestra ni se lee, solo le dice a la voz cómo expresarse. Si el
    // modelo no la puso, se deduce del propio texto.
    // Y lo mismo con lo que ALYA escribe: si igual se le colara una clave en
    // la respuesta, no llega a la pantalla ni a la voz.
    closeTurnText(lastText);
    const finalText = closedTexts.join('\n\n') || 'Listo.';

    const finalReply: ChatMessage = {
        role: 'assistant',
        text: finalText,
        mood: replyMood ?? guessMood(finalText),
        imageUrl,
        cards: cards.length > 0 ? cards : undefined,
        pendingConfirmation: newPendingConfirmation,
    };

    // Aprendizaje pasivo, en segundo plano — no esperamos a que termine
    // para devolverle la respuesta a Andrés. Nos saltamos esto para los
    // mensajes internos del sistema (ej. los que arma el flujo de Kick),
    // que no son cosas que él "dijo" de verdad.
    if (isRealUserMessage) {
        learnFromExchange(userMessage, finalReply.text).catch(() => { });
    }

    return finalReply;
}

/**
 * El usuario apretó "Sí" en el botón de confirmación: ejecuta la acción
 * pendiente de verdad, ahora sí.
 */
export async function confirmPendingAction(): Promise<ChatMessage> {
    if (!pendingConfirmation) {
        return { role: 'assistant', text: 'No hay ninguna acción pendiente de confirmar.' };
    }

    const { tool, args } = pendingConfirmation;
    pendingConfirmation = null;

    if (loadSettings().adaptToUser !== false) recordToolUse(tool, args);

    const { result } = await executeToolWithLimit(tool, args);
    const r = redactDeep(result) as { ok: boolean; message?: string; error?: string };
    logToolCall(tool, args, r);

    const text = r.ok
        ? `Listo. ${r.message ?? ''}`.trim()
        : `No pude completarlo: ${r.error ?? 'error desconocido'}`;

    return { role: 'assistant', text };
}

export function cancelPendingAction(): ChatMessage {
    pendingConfirmation = null;
    return { role: 'assistant', text: 'Cancelado, no hice nada.' };
}