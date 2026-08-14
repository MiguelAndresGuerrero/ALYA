import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Se guarda en la carpeta de datos de la app (no en el proyecto), así que
// sobrevive a reinstalaciones/actualizaciones del código.
// En Windows suele ser algo como: C:\Users\<tú>\AppData\Roaming\ALYA\memoria.json
const MEMORY_FILE = path.join(app.getPath('userData'), 'memoria.json');

export function loadMemory(): string[] {
    try {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return []; // no existe el archivo todavía, o está corrupto — empezamos de cero
    }
}

function saveMemory(entries: string[]): void {
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

/** Agrega un dato nuevo a la memoria permanente. */
export function addMemory(fact: string): string[] {
    const entries = loadMemory();
    entries.push(fact);
    saveMemory(entries);
    return entries;
}

/**
 * Borra el primer dato que coincida (parcialmente, sin distinguir
 * mayúsculas) con el texto dado.
 */
export function removeMemory(matchText: string): { removed: boolean; entries: string[] } {
    const entries = loadMemory();
    const idx = entries.findIndex((e) => e.toLowerCase().includes(matchText.toLowerCase()));

    if (idx === -1) {
        return { removed: false, entries };
    }

    entries.splice(idx, 1);
    saveMemory(entries);
    return { removed: true, entries };
}