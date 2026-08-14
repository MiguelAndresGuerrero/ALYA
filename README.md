# ALYA — Asistente IA personal

ALYA es un asistente personal tipo JARVIS: piensa (Gemini), habla y escucha
(voz neuronal local), ve tu pantalla, controla tu PC, recuerda cosas entre
sesiones, y hasta reacciona al chat en vivo de tu stream. Vive en la
bandeja del sistema de Windows, siempre disponible.

## Qué puede hacer

**Conversación y cerebro**
- Chat de texto o por voz (micrófono + atajo global `Ctrl+Shift+1`)
- Memoria permanente — recuerda lo que le pidas explícitamente, y también
  aprende preferencias sola en segundo plano de la conversación
- Búsqueda en internet para preguntas que necesitan info actual
- Ve y describe tu(s) pantalla(s) (captura + análisis, multi-monitor)

**Control del PC**
- Abrir/cerrar apps, abrir carpetas comunes, buscar archivos
- Control multimedia (play/pausa/siguiente/volumen — cualquier reproductor)
- Liberar RAM de forma segura (sin cerrar nada)
- Revisar el estado de Windows Defender y disparar escaneos

**Programación**
- Leer, crear, editar (quirúrgicamente, sin reescribir todo el archivo),
  y borrar archivos (va a la Papelera, no es permanente)
- Correr comandos de terminal

**Rutinas y recordatorios**
- Guardar secuencias de acciones bajo un nombre ("modo noche", "modo
  juego") y dispararlas con un comando
- Recordatorios/temporizadores que sobreviven a cerrar la app

**Streaming**
- Identificar canciones sonando (tipo Shazam, con AudD)
- Buscar y reproducir música en YouTube, con fila de reproducción propia
- Reacciona a comandos `/play` en tu chat de Kick en vivo
- Overlay para OBS mostrando "sonando ahora"

**Centro de información personal**
- Panel de estado: CPU, RAM, procesos, latencia de red, y tablero de tus
  otros proyectos (ARGUS, GALYX, etc.)

**Seguridad**
- Acciones sensibles (cerrar apps, escribir/editar/borrar archivos, correr
  comandos) SIEMPRE piden confirmación explícita con un botón — nunca se
  ejecutan solas, sin importar lo que decida el modelo

**Personalización**
- Panel de Configuración: tu nombre, la voz (femenina/masculina, ritmo,
  expresividad) — todo desde la interfaz, sin tocar código

## Estructura del proyecto

```
ALYA/
├── src/                    ← código fuente (TypeScript), edita AQUÍ
│   ├── main.ts               Proceso principal: tray, ventanas, ciclo de vida
│   ├── ai.ts                   El cerebro: Gemini + todas las herramientas
│   ├── voice.ts                  Texto a voz (Piper + respaldo SAPI)
│   ├── chat.html                   Ventana de chat
│   ├── status.html                   Panel de estado / centro de información
│   ├── settings.html                   Panel de configuración
├── out/                    ← generado por el build, NO editar a mano
├── piper/                  ← motor de voz (NO incluido en el repo, ver abajo)
├── build/
│   ├── icon.ico
│   └── avatar.png
└── scripts/copy-assets.js
```

## Requisitos

- Windows 10/11
- Node.js 18+ (https://nodejs.org) — solo si vas a correr en modo desarrollo

## Modo desarrollo

```bash
cd ALYA
npm install
npm start
```

Compila TypeScript y abre ALYA. Cada cambio en `src/` requiere volver a
correr esto (o `npm run build` para solo compilar).

## Generar el instalador (.exe)

```bash
npm run dist
```

Genera `dist/ALYA Setup.exe`. Una vez instalada, ALYA arranca sola con
Windows — no hace falta VS Code ni `npm start` nunca más.

**Importante**: la app instalada busca su `.env` en
`%APPDATA%\ALYA\.env` (NO en la carpeta del proyecto) — hay que crearlo
ahí a mano después de instalar, con el mismo contenido que el `.env` de
desarrollo. Es así a propósito: un instalador no debe llevar tus claves
secretas empaquetadas adentro.

## El archivo `.env`

```
GEMINI_API_KEY=tu_key_de_gemini            (obligatoria — aistudio.google.com, gratis)
AUDD_API_TOKEN=tu_token_de_audd            (opcional — identificar canciones, dashboard.audd.io)
KICK_CHATROOM_ID=tu_chatroom_id            (opcional — reaccionar al chat de Kick)

ANTHROPIC_API_KEY=                         (para cuando subas a la versión de pago)
OPENAI_API_KEY=                            (ídem)
```

## Piper (voz) — no incluido en el repo

`piper/` no viene en el código fuente (son binarios pesados). Para tenerlo:

1. Descarga y descomprime en `ALYA/piper/`:
   https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip
2. Descarga el modelo de voz en `ALYA/piper/voices/`:
   - https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx?download=true
   - https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json?download=true

Sin esto, ALYA sigue funcionando pero usa la voz robótica de Windows (SAPI)
como respaldo automático.

## Reglas de oro

- Edita solo `src/` — nunca `out/` (se regenera y se borra cada build).
- Cada cambio de código necesita `npm start` / `npm run build` de nuevo.
- Nunca subas tu `.env` real a ningún lado — está en `.gitignore` a propósito.

## Roadmap / lo que queda pendiente

- Sistema de agentes especializados (ej. un bot de Discord con identidad
  propia — decidimos no hacerlo por los riesgos de automatizar cuentas
  personales, pero un bot legítimo sigue siendo una opción)
- Herramientas específicas de Minecraft (logs, mods)
- Subir a la versión de pago (Claude + DALL-E) en vez de Gemini + Pollinations
