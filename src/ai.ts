import { GoogleGenAI, FunctionDeclaration, Chat } from '@google/genai';
import { openApp, closeApp } from './appLauncher';
import { getStatus } from './systemTools';
import { generateImage } from './imageGen';
import { openFolder, searchFiles } from './fileTools';
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
import type { ChatMessage, PendingConfirmation } from './types';

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
    const { userName } = loadSettings();
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
        instruction += `\n\nCosas que Andrés te pidió recordar de antes:\n${memoryBlock}`;
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
    description: 'Borra un dato guardado anteriormente en la memoria permanente.',
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
        'pidió explícitamente recordar, como lo que ALYA fue aprendiendo sola de la conversación. ' +
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
            const status = await getStatus();
            return { result: status };
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
                return { result: { ok: true, cantidad: encontrados.length, archivos: encontrados } };
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
                const { removed } = removeMemory(texto);
                return removed
                    ? { result: { ok: true, message: 'Borrado de la memoria.' } }
                    : { result: { ok: false, error: 'No encontré ningún dato guardado que coincida.' } };
            } catch (err) {
                return { result: { ok: false, error: (err as Error).message } };
            }
        }

        case 'listar_memoria': {
            const memorias = loadMemory();
            return { result: { ok: true, cantidad: memorias.length, memorias } };
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
        chatSession = getClient().chats.create({
            model: MODEL,
            config: {
                systemInstruction: buildSystemInstruction(),
                tools,
            },
        });
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

const MAX_TOOL_ITERATIONS = 5; // seguro contra loops infinitos de herramientas

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
        const response = await withRetry(() =>
            client.models.generateContent({
                model: MODEL,
                contents:
                    `Este es un intercambio entre Andrés y su asistente ALYA:\n` +
                    `Andrés: ${userMessage}\n` +
                    `ALYA: ${assistantReply}\n\n` +
                    `¿Hay algo aquí que sea una PREFERENCIA DURADERA o un dato permanente sobre Andrés ` +
                    `que valga la pena recordar para conversaciones futuras (ej. "prefiere Maven sobre ` +
                    `Gradle en proyectos Java", "trabaja de noche", "su gato se llama Rocky")? NO guardes ` +
                    `pedidos puntuales de una sola vez (ej. "abre Discord ahora", "pon esta canción"), ` +
                    `solo patrones genuinamente reutilizables en el futuro. Si hay algo así, responde ` +
                    `ÚNICAMENTE con esa frase en tercera persona, corta y clara, nada más. Si no hay ` +
                    `nada así, responde exactamente: ninguno`,
            })
        );

        const learned = (response.text ?? '').trim();
        if (learned && learned.toLowerCase() !== 'ninguno' && learned.length < 200) {
            addMemory(learned);
            console.log(`[ALYA] Aprendido automáticamente: ${learned}`);
        }
    } catch (err) {
        // Si esto falla, no pasa nada grave — es un extra silencioso, no algo
        // crítico para el funcionamiento normal del chat.
        console.warn('[ALYA] Aprendizaje pasivo falló (sin impacto en el chat):', (err as Error).message);
    }
}

/**
 * Reintenta una llamada a Gemini si falla por un error TEMPORAL del lado
 * de Google (503 "alta demanda", o 429 "demasiadas peticiones") — espera
 * un poco más entre cada intento (2s, 4s, 8s). Cualquier otro tipo de
 * error se deja pasar de inmediato, sin reintentar (no tiene sentido
 * reintentar algo que no es un problema temporal).
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const MAX_INTENTOS = 3;
    const ESPERAS_MS = [2000, 4000, 8000];

    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
        try {
            return await fn();
        } catch (err) {
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

export async function sendMessage(userMessage: string): Promise<ChatMessage> {
    const chat = getChatSession();

    let response = await withRetry(() => chat.sendMessage({ message: userMessage }));
    let imageUrl: string | undefined;
    let newPendingConfirmation: PendingConfirmation | undefined; // solo la de ESTE mensaje

    let iterations = 0;
    while (response.functionCalls && response.functionCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

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
                    description: describeAction(name, args),
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

            const { result, imageUrl: toolImageUrl } = await executeTool(name, args);
            if (toolImageUrl) imageUrl = toolImageUrl;

            functionResponseParts.push({
                functionResponse: { name, response: { result } },
            });
        }

        response = await withRetry(() => chat.sendMessage({ message: functionResponseParts }));
    }

    // La librería de Gemini a veces devuelve una respuesta que es SOLO
    // llamadas a herramientas, sin texto de acompañamiento — en ese caso
    // response.text queda vacío. Nos aseguramos de nunca mandar una
    // burbuja en blanco: si se agotaron los intentos con herramientas
    // todavía pendientes, o si el texto vino vacío por cualquier otra
    // razón, usamos un mensaje de respaldo en vez de dejarlo así.
    let finalText = response.text ?? '';

    if (response.functionCalls && response.functionCalls.length > 0) {
        // Llegamos al límite de intentos con herramientas sin resolver.
        finalText = 'Esto me está tomando más pasos de los normales — intenta pedírmelo de nuevo, quizás más simple.';
    } else if (!finalText.trim()) {
        finalText = 'Listo.';
    }

    const finalReply: ChatMessage = {
        role: 'assistant',
        text: finalText,
        imageUrl,
        pendingConfirmation: newPendingConfirmation,
    };

    // Aprendizaje pasivo, en segundo plano — no esperamos a que termine
    // para devolverle la respuesta a Andrés. Nos saltamos esto para los
    // mensajes internos del sistema (ej. los que arma el flujo de Kick),
    // que no son cosas que él "dijo" de verdad.
    if (!userMessage.startsWith('(Sistema:')) {
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

    const { result } = await executeTool(tool, args);
    const r = result as { ok: boolean; message?: string; error?: string };

    const text = r.ok
        ? `Listo. ${r.message ?? ''}`.trim()
        : `No pude completarlo: ${r.error ?? 'error desconocido'}`;

    return { role: 'assistant', text };
}

export function cancelPendingAction(): ChatMessage {
    pendingConfirmation = null;
    return { role: 'assistant', text: 'Cancelado, no hice nada.' };
}