import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const PROJECTS_FILE = path.join(app.getPath('userData'), 'proyectos.json');

export interface Project {
    nombre: string;
    progreso: number; // 0-100
    estado: string; // texto libre: "BUILD OK", "En pausa", "Bug pendiente", etc.
}

export function loadProjects(): Project[] {
    try {
        const raw = fs.readFileSync(PROJECTS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveProjects(projects: Project[]): void {
    fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true });
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf8');
}

/** Crea o actualiza un proyecto (por nombre, sin distinguir mayúsculas). */
export function upsertProject(nombre: string, progreso?: number, estado?: string): Project {
    const projects = loadProjects();
    const normalizedName = nombre.toLowerCase().trim();
    const existing = projects.find((p) => p.nombre.toLowerCase().trim() === normalizedName);

    if (existing) {
        if (progreso !== undefined) existing.progreso = Math.max(0, Math.min(100, progreso));
        if (estado !== undefined) existing.estado = estado;
        saveProjects(projects);
        return existing;
    }

    const nuevo: Project = {
        nombre,
        progreso: progreso !== undefined ? Math.max(0, Math.min(100, progreso)) : 0,
        estado: estado ?? 'Sin estado',
    };
    projects.push(nuevo);
    saveProjects(projects);
    return nuevo;
}

export function deleteProject(nombre: string): boolean {
    const projects = loadProjects();
    const normalizedName = nombre.toLowerCase().trim();
    const filtered = projects.filter((p) => p.nombre.toLowerCase().trim() !== normalizedName);

    if (filtered.length === projects.length) return false;
    saveProjects(filtered);
    return true;
}