/* Calendar-day scheduling shared by badges, dashboard, calendar and reminders. */
(function (root) {
    'use strict';
    const DAY = 86400000;
    const name = value => String(value || '').trim().toLowerCase();
    function dayNumber(value) {
        const d = new Date(value);
        return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
    }
    function dayDate(day) {
        const d = new Date(day * DAY);
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    function parseCycle(value) {
        const match = String(value || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
        if (!match) return null;
        const active = Number(match[1]), rest = Number(match[2]);
        return Number.isSafeInteger(active + rest) && active > 0 && rest >= 0 ? { active, rest } : null;
    }
    function model(preset, history, now) {
        const today = dayNumber(now);
        const days = history.filter(h => name(h.peptide) === name(preset.peptide))
            .map(h => dayNumber(h.date)).filter(d => Number.isFinite(d) && d <= today).sort((a, b) => a - b);
        const cycle = parseCycle(preset.cycle);
        // A malformed cycle must not silently enable a different frequency schedule.
        const frequency = String(preset.cycle || '').trim() ? 0 : Number(preset.frequency);
        return { today, days, cycle, frequency: Number.isSafeInteger(frequency) && frequency > 0 ? frequency : 0 };
    }
    function cycleStatus(preset, history, now = new Date()) {
        const m = model(preset, history, now), c = m.cycle;
        if (!c) return null;
        const common = { activeDays: c.active, restTotal: c.rest, restDay: null };
        if (!m.days.length) return { ...common, status: 'active' };
        if (m.days.includes(m.today)) return { ...common, status: 'done' };
        const phase = (m.today - m.days[0]) % (c.active + c.rest);
        return phase < c.active ? { ...common, status: 'active' }
            : { ...common, status: 'rest', restDay: phase - c.active + 1 };
    }
    function occurrences(preset, history, { from = new Date(), to = from, now = new Date(), includeOverdue = false } = {}) {
        const m = model(preset, history, now);
        if (!m.days.length || (!m.cycle && !m.frequency)) return [];
        const first = m.days[0], last = m.days[m.days.length - 1];
        const start = Math.max(dayNumber(from), m.today), end = dayNumber(to), out = [];
        if (!Number.isFinite(start) || !Number.isFinite(end)) return out;
        const push = day => out.push({ date: dayDate(day), peptide: preset.peptide, label: preset.label, preset });
        if (m.cycle) {
            // Missed days do not shift the cycle; no catch-up suggestions on rest days.
            for (let day = start; day <= end; day++) {
                if ((day - first) % (m.cycle.active + m.cycle.rest) < m.cycle.active && !m.days.includes(day)) push(day);
            }
        } else {
            const due = last + m.frequency;
            if (includeOverdue && due < start && due <= end) push(due);
            let next = due + Math.max(0, Math.ceil((start - due) / m.frequency)) * m.frequency;
            for (; next <= end; next += m.frequency) push(next);
        }
        return out;
    }
    function next(preset, history, now = new Date()) {
        const m = model(preset, history, now);
        if (!m.days.length || (!m.cycle && !m.frequency)) return null;
        if (!m.cycle) return { date: dayDate(m.days[m.days.length - 1] + m.frequency), peptide: preset.peptide, label: preset.label, preset };
        let day = m.today + (m.days.includes(m.today) ? 1 : 0);
        const phase = (day - m.days[0]) % (m.cycle.active + m.cycle.rest);
        if (phase >= m.cycle.active) day += m.cycle.active + m.cycle.rest - phase;
        return { date: dayDate(day), peptide: preset.peptide, label: preset.label, preset };
    }
    const api = { dayNumber, parseCycle, cycleStatus, occurrences, next };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PepPlanning = api;
})(globalThis);
