# ALYA

ALYA es un asistente personal de IA para Windows, inspirado en JARVIS. Vive
en la bandeja del sistema y combina un cerebro conversacional (Gemini) con
control real del PC, voz neuronal local, visión de pantalla, memoria
persistente, y varias integraciones opcionales para streaming y música.

## Funciones principales

- **Conversación por texto o voz**, con memoria que persiste entre sesiones
- **Control del sistema**: abrir/cerrar apps y juegos, archivos, carpetas,
  volumen, comandos de terminal — siempre con confirmación explícita para
  cualquier acción sensible
- **Visión**: puede ver y describir lo que hay en pantalla
- **Rutinas y recordatorios** automatizados
- **Integraciones opcionales**: Spotify, música de YouTube, chat en vivo de
  Kick/Twitch/YouTube, identificación de canciones, overlay para OBS
- **Auto-actualización**: instala nuevas versiones sola, sin intervención

## Empezar

### Requisitos
- Windows 10/11
- [Node.js](https://nodejs.org) 18 o superior

### Instalación

```bash
git clone <url-del-repositorio>
cd ALYA
npm install
```

### Lo único obligatorio: una API key de Gemini

ALYA necesita una clave de la API de Gemini para pensar — es gratuita.

1. Entra a [aistudio.google.com](https://aistudio.google.com), genera una
   API key.
2. Crea un archivo llamado `.env` en la raíz del proyecto con:

```
GEMINI_API_KEY=tu_key_aquí
```

3. Listo, ya se puede correr:

```bash
npm start
```

Todo lo demás (voz, Spotify, chat en vivo, identificación de canciones,
etc.) es completamente opcional y se puede configurar después — ALYA
funciona bien sin ninguno de esos extras, cada uno solo se activa si le
das su propia clave/configuración en el `.env`

## Generar el instalador

```bash
npm run dist
```

Genera `dist/ALYA Setup.exe` — una vez instalada, arranca sola con
Windows.

### Publicar actualizaciones (opcional, para quien mantiene el proyecto)

```bash
npm run publish
```

Sube automáticamente una nueva versión a GitHub Releases. Cada instalación
existente de ALYA revisa sola si hay algo nuevo y se actualiza.

## Estructura del proyecto

```
ALYA/
├── src/            código fuente (TypeScript) — edita acá
├── out/            generado por el build, no editar a mano
├── piper/          motor de voz (no incluido, ver abajo)
└── build/          ícono y avatar de la app
```

## Voz (opcional)

ALYA puede hablar con una voz neuronal local (Piper) en vez de la voz
robótica por defecto de Windows. Los archivos del modelo no vienen
incluidos por su tamaño:

1. Descarga y descomprime en `ALYA/piper/`:
   https://github.com/rhasspy/piper/releases
2. Descarga un modelo de voz en español en `ALYA/piper/voices/`, por
   ejemplo desde https://huggingface.co/rhasspy/piper-voices

Sin esto, ALYA sigue funcionando normal, usando la voz de Windows.

## Licencia

Proyecto personal, sin licencia pública por ahora.