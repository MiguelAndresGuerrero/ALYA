import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const SETTINGS_FILE = path.join(app.getPath('userData'), 'configuracion.json');

export interface AlyaSettings {
    userName: string;
    lengthScale: number; // ritmo: más alto = más pausada
    noiseScale: number; // entonación: más alto = menos plana
    noiseW: number; // variación en duración de sonidos
    volume: number; // volumen de la voz, 0-100
}

const DEFAULT_SETTINGS: AlyaSettings = {
    userName: 'Andrés',
    lengthScale: 1.15,
    noiseScale: 0.85,
    noiseW: 1.0,
    volume: 100,
};

export function loadSettings(): AlyaSettings {
    try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveSettings(settings: AlyaSettings): void {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}