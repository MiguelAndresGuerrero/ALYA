import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const REMINDERS_FILE = path.join(app.getPath('userData'), 'recordatorios.json');

// setTimeout de Node se desborda si el retraso pasa de ~24.8 días (límite
// de un entero de 32 bits). Usamos un margen bien por debajo de eso y
// encadenamos tramos si un recordatorio queda más lejos que esto.
const MAX_TIMEOUT_MS = 2_000_000_000;

export interface Reminder {
    id: string;
    mensaje: string;
    timestamp: number; // epoch ms — cuándo debe sonar
}

const activeTimers = new Map<string, NodeJS.Timeout>();
let onFireCallback: ((reminder: Reminder) => void) | null = null;

function loadReminders(): Reminder[] {
    try {
        const raw = fs.readFileSync(REMINDERS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveReminders(reminders: Reminder[]): void {
    fs.mkdirSync(path.dirname(REMINDERS_FILE), { recursive: true });
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf8');
}

function fireReminder(reminder: Reminder): void {
    activeTimers.delete(reminder.id);

    // Seguro contra doble disparo: si ya no está en la lista guardada
    // (porque otra ruta de código ya lo disparó y removió), no hacemos nada.
    const current = loadReminders();
    if (!current.some((r) => r.id === reminder.id)) return;

    const remaining = current.filter((r) => r.id !== reminder.id);
    saveReminders(remaining);
    onFireCallback?.(reminder);
}

function scheduleTimer(reminder: Reminder): void {
    const delay = reminder.timestamp - Date.now();
    const chunk = Math.max(Math.min(delay, MAX_TIMEOUT_MS), 0);

    const timer = setTimeout(() => {
        const stillRemaining = reminder.timestamp - Date.now();
        if (stillRemaining > 0) {
            scheduleTimer(reminder); // todavía falta mucho, reprogramamos otro tramo
        } else {
            fireReminder(reminder);
        }
    }, chunk);

    activeTimers.set(reminder.id, timer);
}

/**
 * Arranca el sistema de recordatorios — llamar UNA vez al iniciar la app.
 * Carga los recordatorios guardados: los que ya deberían haber sonado
 * (porque la app estuvo cerrada) se disparan de inmediato; el resto se
 * programa normalmente.
 */
export function startReminderScheduler(onFire: (reminder: Reminder) => void): void {
    onFireCallback = onFire;
    const reminders = loadReminders();
    const now = Date.now();

    for (const reminder of reminders) {
        if (reminder.timestamp <= now) {
            fireReminder(reminder);
        } else {
            scheduleTimer(reminder);
        }
    }
}

export function addReminder(mensaje: string, timestamp: number): Reminder {
    const reminder: Reminder = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        mensaje,
        timestamp,
    };

    const reminders = loadReminders();
    reminders.push(reminder);
    saveReminders(reminders);
    scheduleTimer(reminder);

    return reminder;
}

/** Cancela por ID exacto, o por coincidencia parcial en el mensaje. */
export function cancelReminder(idOrText: string): boolean {
    const reminders = loadReminders();
    const idx = reminders.findIndex(
        (r) => r.id === idOrText || r.mensaje.toLowerCase().includes(idOrText.toLowerCase())
    );

    if (idx === -1) return false;

    const [removed] = reminders.splice(idx, 1);
    saveReminders(reminders);

    const timer = activeTimers.get(removed.id);
    if (timer) {
        clearTimeout(timer);
        activeTimers.delete(removed.id);
    }

    return true;
}

export function listReminders(): Reminder[] {
    return loadReminders();
}