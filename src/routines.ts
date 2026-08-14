import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const ROUTINES_FILE = path.join(app.getPath('userData'), 'rutinas.json');

export interface RoutineStep {
    herramienta: string;
    argumentos: Record<string, unknown>;
}

export interface Routine {
    nombre: string;
    pasos: RoutineStep[];
}

export function loadRoutines(): Routine[] {
    try {
        const raw = fs.readFileSync(ROUTINES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveRoutines(routines: Routine[]): void {
    fs.mkdirSync(path.dirname(ROUTINES_FILE), { recursive: true });
    fs.writeFileSync(ROUTINES_FILE, JSON.stringify(routines, null, 2), 'utf8');
}

/** Guarda una rutina nueva, o reemplaza una que ya existía con el mismo nombre. */
export function saveRoutine(routine: Routine): void {
    const routines = loadRoutines();
    const normalizedName = routine.nombre.toLowerCase().trim();
    const existingIndex = routines.findIndex((r) => r.nombre.toLowerCase().trim() === normalizedName);

    if (existingIndex >= 0) {
        routines[existingIndex] = routine;
    } else {
        routines.push(routine);
    }

    saveRoutines(routines);
}

export function getRoutine(nombre: string): Routine | undefined {
    const routines = loadRoutines();
    const normalizedName = nombre.toLowerCase().trim();
    return routines.find((r) => r.nombre.toLowerCase().trim() === normalizedName);
}

export function deleteRoutine(nombre: string): boolean {
    const routines = loadRoutines();
    const normalizedName = nombre.toLowerCase().trim();
    const filtered = routines.filter((r) => r.nombre.toLowerCase().trim() !== normalizedName);

    if (filtered.length === routines.length) return false; // no existía

    saveRoutines(filtered);
    return true;
}