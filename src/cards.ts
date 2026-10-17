import type { ChatCard } from './types';
import { getGuide } from './guides';

// --- Tarjetas inteligentes ---
// Cuando ALYA usa ciertas herramientas, además del texto de su respuesta
// el chat muestra una tarjeta con el resultado ya ordenado (el estado del
// sistema con sus barras, la lista de archivos encontrados, etc.). Acá se
// decide qué tarjeta corresponde al resultado de cada herramienta.
//
// Son datos puros (nada de HTML): la ventana de chat decide cómo dibujarlos.

const MAX_FILES_IN_CARD = 6;

function toPercent(value: unknown): number | null {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Devuelve la tarjeta que corresponde al resultado de una herramienta, o
 * null si esa herramienta no tiene tarjeta (o el resultado no sirve).
 */
export function buildCard(tool: string, args: Record<string, unknown>, result: unknown): ChatCard | null {
    const data = asRecord(result);
    if (!data) return null;

    switch (tool) {
        case 'estado_sistema': {
            const cpu = toPercent(asRecord(data.cpu)?.loadPercent);
            const ram = toPercent(asRecord(data.ram)?.usedPercent);
            if (cpu === null || ram === null) return null;

            const gpus = Array.isArray(data.gpu) ? data.gpu : [];
            const disks = Array.isArray(data.storage) ? data.storage : [];

            return {
                type: 'system',
                cpu,
                cpuModel: String(asRecord(data.cpu)?.model ?? ''),
                ram,
                ramUsedGB: String(asRecord(data.ram)?.usedGB ?? ''),
                ramTotalGB: String(asRecord(data.ram)?.totalGB ?? ''),
                gpus: gpus
                    .map((g) => asRecord(g))
                    .filter((g): g is Record<string, unknown> => g !== null)
                    .map((g) => ({ name: String(g.model ?? 'GPU'), load: toPercent(g.loadPercent) })),
                disks: disks
                    .map((d) => asRecord(d))
                    .filter((d): d is Record<string, unknown> => d !== null)
                    .map((d) => ({
                        mount: String(d.mount ?? ''),
                        use: toPercent(d.usePercent) ?? 0,
                        sizeGB: String(d.sizeGB ?? ''),
                        freeGB: String(d.freeGB ?? ''),
                    })),
            };
        }

        case 'abrir_app':
        case 'abrir_programa_encontrado': {
            const name = String(args.nombre ?? '').trim();
            if (!name) return null;
            const ok = data.ok === true;
            return {
                type: 'app',
                name,
                ok,
                detail: ok ? 'Aplicación iniciada' : String(data.error ?? 'No se pudo abrir'),
            };
        }

        case 'buscar_archivos': {
            const files = Array.isArray(data.archivos) ? data.archivos : [];
            if (data.ok !== true || files.length === 0) return null;
            return {
                type: 'files',
                query: String(args.nombre ?? ''),
                total: files.length,
                files: files
                    .slice(0, MAX_FILES_IN_CARD)
                    .map((f) => asRecord(f))
                    .filter((f): f is Record<string, unknown> => f !== null)
                    .map((f) => ({ name: String(f.name ?? ''), path: String(f.path ?? '') })),
            };
        }

        case 'identificar_cancion': {
            const byAudio = asRecord(data.identificada_por_audio);
            if (byAudio) {
                return {
                    type: 'song',
                    title: String(byAudio.titulo ?? ''),
                    artist: String(byAudio.artista ?? ''),
                    album: byAudio.album ? String(byAudio.album) : null,
                    source: String(data.escuchado_desde ?? 'huella de audio'),
                };
            }
            const sessions = Array.isArray(data.sonando_segun_windows) ? data.sonando_segun_windows : [];
            const first = asRecord(sessions[0]);
            if (!first) return null;
            return {
                type: 'song',
                title: String(first.titulo ?? ''),
                artist: String(first.artista_o_canal ?? ''),
                album: first.album ? String(first.album) : null,
                source: String(first.app ?? ''),
            };
        }

        case 'mostrar_guia': {
            // La tarjeta se arma directo desde guides.ts (no desde lo que
            // recibió el modelo, que es una versión resumida).
            const guide = data.ok === true ? getGuide(String(data.guia ?? '')) : null;
            if (!guide) return null;
            return {
                type: 'guide',
                title: guide.title,
                intro: guide.intro,
                notes: guide.notes,
                steps: guide.steps,
                problems: guide.problems,
                actions: guide.actions,
            };
        }

        case 'buscar_en_internet': {
            const sources = Array.isArray(data.fuentes) ? data.fuentes : [];
            const links = sources
                .map((source) => asRecord(source))
                .filter((source): source is Record<string, unknown> => source !== null)
                .map((source) => ({ title: String(source.titulo ?? '').trim(), url: String(source.url ?? '') }))
                .filter((source) => source.title && /^https:\/\//i.test(source.url));
            if (data.ok !== true || links.length === 0) return null;
            return { type: 'web', query: String(args.consulta ?? ''), sources: links };
        }

        case 'analizar_espacio': {
            if (data.ok !== true) return null;
            const listed = Array.isArray(data.contenido) ? data.contenido : Array.isArray(data.lugares_que_se_pueden_limpiar) ? data.lugares_que_se_pueden_limpiar : [];
            const rows = listed
                .map((item) => asRecord(item))
                .filter((item): item is Record<string, unknown> => item !== null)
                .map((item) => ({
                    name: String(item.nombre ?? ''),
                    path: String(item.ruta ?? ''),
                    size: String(item.tamano ?? ''),
                    bytes: typeof item.bytes === 'number' ? item.bytes : 0,
                }))
                .filter((item) => item.name && item.bytes > 0)
                .slice(0, 8);
            const reference = typeof data.total_bytes === 'number' && data.total_bytes > 0 ? data.total_bytes : Math.max(1, ...rows.map((row) => row.bytes));
            const drives = (Array.isArray(data.discos) ? data.discos : [])
                .map((drive) => asRecord(drive))
                .filter((drive): drive is Record<string, unknown> => drive !== null)
                .map((drive) => ({
                    name: String(drive.disco ?? ''),
                    use: toPercent(drive.usado_porcentaje) ?? 0,
                    free: String(drive.libre ?? ''),
                }));
            if (rows.length === 0 && drives.length === 0) return null;
            return {
                type: 'space',
                title: data.carpeta ? String(data.carpeta) : 'Espacio en disco',
                total: data.total ? String(data.total) : null,
                drives,
                items: rows.map((row) => ({
                    name: row.name,
                    path: row.path,
                    size: row.size,
                    percent: Math.max(0, Math.min(100, Math.round((row.bytes / reference) * 100))),
                })),
            };
        }

        case 'guardar_en_spotify': {
            const title = String(data.cancion ?? '').trim();
            const status = String(data.estado ?? '');
            if (!title || (status !== 'saved' && status !== 'already')) return null;
            return {
                type: 'song',
                title,
                artist: String(data.artista ?? ''),
                album: null,
                source: 'Spotify',
                label: status === 'saved' ? 'Guardada en favoritos' : 'Ya estaba en favoritos',
            };
        }

        default:
            return null;
    }
}