// Printable ranking report (admin only). Builds the whole report from /api/admin/ranking-report
// with plain inline SVG so it prints reliably to PDF without external libraries.

const SVG_NS_ATTR = 'xmlns="http://www.w3.org/2000/svg"';
const RED = '#C41E3A';

document.addEventListener('DOMContentLoaded', async function() {
    const container = document.getElementById('report');

    try {
        const response = await fetch('/api/admin/ranking-report');
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/login';
            return;
        }
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        const data = await response.json();
        container.innerHTML = renderReport(data);

        if (new URLSearchParams(window.location.search).get('print') === '1') {
            setTimeout(() => window.print(), 400);
        }
    } catch (error) {
        console.error('Error loading ranking report:', error);
        container.innerHTML = '<div class="error">No se pudo generar el informe. Inténtalo de nuevo.</div>';
    }
});

// ---------- Helpers ----------

function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// SQLite CURRENT_TIMESTAMP values are UTC without timezone ('YYYY-MM-DD HH:MM:SS')
function parseDate(raw) {
    if (!raw) return null;
    const text = String(raw);
    const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)
        ? new Date(text.replace(' ', 'T') + 'Z')
        : new Date(text);
    return isNaN(date.getTime()) ? null : date;
}

function fmtDateTime(raw) {
    const date = raw instanceof Date ? raw : parseDate(raw);
    if (!date) return '-';
    return date.toLocaleString('es-ES', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function fmtDay(date) {
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

function fmtNum(value, decimals = 2) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return Number(value).toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(Number(seconds))) return '-';
    const total = Number(seconds);
    if (total < 60) return `${Number(total.toFixed(total < 10 ? 2 : 1)).toLocaleString('es-ES')} s`;
    if (total < 3600) {
        const minutes = Math.floor(total / 60);
        return `${minutes} min ${Math.round(total - minutes * 60)} s`;
    }
    const hours = Math.floor(total / 3600);
    return `${hours} h ${String(Math.round((total - hours * 3600) / 60)).padStart(2, '0')} min`;
}

function median(sorted) {
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function niceTicks(min, max, count) {
    if (min === max) {
        const delta = Math.abs(min) * 0.05 || 1;
        min -= delta;
        max += delta;
    }
    const rawStep = (max - min) / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= rawStep) || rawStep;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
    return ticks;
}

// ---------- Report ----------

function renderReport(data) {
    const ranking = data.ranking || [];
    const values = ranking.map(r => r.best_objective_value).sort((a, b) => a - b);
    const best = values.length ? values[0] : null;
    const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
    const med = median(values);
    const worst = values.length ? values[values.length - 1] : null;
    const participation = data.registeredUsers ? (ranking.length / data.registeredUsers) * 100 : null;
    const subs = data.submissions || {};
    const generatedAt = parseDate(data.generatedAt) || new Date();
    const endDate = data.endDate ? new Date(data.endDate) : null;
    const finished = endDate && !isNaN(endDate.getTime()) && endDate <= generatedAt;
    const instanceName = data.instanceName || (data.instance && data.instance.name) || '-';
    const gap = (v) => (best ? ((v - best) / best) * 100 : 0);

    let html = `
        <header class="report-header">
            <div>
                <h1>TopTSP · Ranking</h1>
                <div class="subtitle">Algoritmos de Búsqueda II · Universidad Rey Juan Carlos</div>
            </div>
            <div class="meta">
                <div><strong>Instancia:</strong> ${escapeHtml(instanceName)}${data.instance ? ` (${data.instance.dimension} nodos)` : ''}</div>
                <div><strong>Generado:</strong> ${fmtDateTime(generatedAt)}</div>
                ${endDate && !isNaN(endDate.getTime()) ? `<div><strong>${finished ? 'Cerrada' : 'Cierre'}:</strong> ${fmtDateTime(endDate)}</div>` : ''}
            </div>
        </header>
    `;

    if (data.frozen) {
        html += `<div class="warning no-print">⚠️ El ranking público está <strong>congelado</strong>, pero este informe muestra los datos actuales en tiempo real. Tenlo en cuenta antes de publicarlo.</div>`;
    }

    if (ranking.length === 0) {
        html += `<h2>Ranking</h2><p>Todavía no hay soluciones válidas en la competición.</p>`;
        html += reportFooter();
        return html;
    }

    // Statistics
    html += `
        <h2>Estadísticas</h2>
        <div class="stats">
            ${statCard('Mejor solución', fmtNum(best), escapeHtml(ranking[0].user), true)}
            ${statCard('Participantes', ranking.length, data.registeredUsers ? `de ${data.registeredUsers} inscritos (${fmtNum(participation, 0)}%)` : '')}
            ${statCard('Envíos totales', subs.total || 0, `${subs.valid || 0} válidos`)}
            ${statCard('Mejoras del récord', (data.improvements || []).length, 'veces que se batió la mejor')}
            ${statCard('Media', fmtNum(mean), `gap ${fmtNum(gap(mean))}%`)}
            ${statCard('Mediana', fmtNum(med), `gap ${fmtNum(gap(med))}%`)}
            ${statCard('Peor (de las mejores)', fmtNum(worst), `gap ${fmtNum(gap(worst))}%`)}
            ${statCard('Periodo de envíos', subs.firstAt ? fmtDay(parseDate(subs.firstAt)) + ' – ' + fmtDay(parseDate(subs.lastAt)) : '-', `${(subs.perDay || []).length} días con actividad`)}
        </div>
        <p class="note">Las estadísticas de media, mediana y peor se calculan sobre la mejor solución de cada participante. El gap es la diferencia porcentual respecto a la mejor solución.</p>
    `;

    // Best solution + progression
    const progressEnd = finished ? endDate : generatedAt;
    html += `
        <div class="two-col">
            <div class="avoid-break">
                <h2>Mejor solución</h2>
                <div class="figure">${routeSvg(data.instance, data.bestSolution)}</div>
                ${data.bestSolution ? `
                <dl class="best-info" style="margin-top:0.5rem">
                    <dt>Usuario</dt><dd>${escapeHtml(data.bestSolution.user)}</dd>
                    <dt>Función objetivo</dt><dd>${fmtNum(data.bestSolution.objectiveValue)}</dd>
                    <dt>Método</dt><dd>${escapeHtml(data.bestSolution.method || '-')}</dd>
                    <dt>Tiempo</dt><dd>${fmtTime(data.bestSolution.timeSeconds)}</dd>
                </dl>` : ''}
            </div>
            <div class="avoid-break">
                <h2>Progreso de la mejor solución</h2>
                <div class="figure">${progressSvg(data.improvements || [], progressEnd)}</div>
                <div class="caption">Evolución en el tiempo del mejor valor de la función objetivo de toda la competición.</div>
                <h2>Envíos por día</h2>
                <div class="figure">${perDaySvg(subs.perDay || [])}</div>
            </div>
        </div>
    `;

    // Full ranking
    html += `
        <h2>Clasificación</h2>
        <table>
            <thead>
                <tr>
                    <th class="num">#</th>
                    <th>Usuario</th>
                    <th class="num">F. Objetivo</th>
                    <th class="num">Gap</th>
                    <th>Método</th>
                    <th class="num">Envíos</th>
                    <th class="num">Tiempo</th>
                    <th>Última mejora</th>
                </tr>
            </thead>
            <tbody>
                ${ranking.map((r, i) => `
                    <tr class="${i < 3 ? 'podium-' + (i + 1) : ''}">
                        <td class="num">${i + 1}${i === 0 ? ' 🥇' : i === 1 ? ' 🥈' : i === 2 ? ' 🥉' : ''}</td>
                        <td>${escapeHtml(r.user)}</td>
                        <td class="num">${fmtNum(r.best_objective_value)}</td>
                        <td class="num">${fmtNum(gap(r.best_objective_value))}%</td>
                        <td class="method">${escapeHtml(r.best_method || '-')}</td>
                        <td class="num">${r.total_submissions}</td>
                        <td class="num">${fmtTime(r.best_time_seconds)}</td>
                        <td>${fmtDateTime(r.last_improvement)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    // Record history
    const improvements = data.improvements || [];
    if (improvements.length > 0) {
        const maxRows = 25;
        const shown = improvements.slice(-maxRows).reverse();
        html += `
            <h2>Historial de récords</h2>
            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Usuario</th>
                        <th class="num">F. Objetivo</th>
                        <th>Método</th>
                    </tr>
                </thead>
                <tbody>
                    ${shown.map(imp => `
                        <tr>
                            <td>${fmtDateTime(imp.date)}</td>
                            <td>${escapeHtml(imp.user)}</td>
                            <td class="num">${fmtNum(imp.value)}</td>
                            <td class="method">${escapeHtml(imp.method || '-')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${improvements.length > maxRows ? `<p class="note">Se muestran los ${maxRows} récords más recientes de ${improvements.length}.</p>` : ''}
        `;
    }

    html += reportFooter();
    return html;
}

function statCard(label, value, hint, highlight) {
    return `
        <div class="stat">
            <div class="label">${label}</div>
            <div class="value${highlight ? ' highlight' : ''}">${value}</div>
            ${hint ? `<div class="hint">${hint}</div>` : ''}
        </div>
    `;
}

function reportFooter() {
    return `<footer class="report-footer">TopTSP · Plataforma para Competiciones en el TSP · Universidad Rey Juan Carlos</footer>`;
}

// ---------- Charts ----------

function routeSvg(instance, bestSolution) {
    const coords = instance && Array.isArray(instance.coordinates) ? instance.coordinates : [];
    if (coords.length === 0) {
        return '<p class="caption">Instancia sin coordenadas para dibujar.</p>';
    }

    const xs = coords.map(c => c.x);
    const ys = coords.map(c => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;

    // Keep the aspect ratio of the instance inside a bounded box
    const maxW = 400, maxH = 340, pad = 12;
    const scale = Math.min((maxW - 2 * pad) / spanX, (maxH - 2 * pad) / spanY);
    const w = spanX * scale + 2 * pad;
    const h = spanY * scale + 2 * pad;
    const px = x => pad + (x - minX) * scale;
    const py = y => h - pad - (y - minY) * scale;

    const byId = new Map(coords.map(c => [c.id, c]));
    const radius = coords.length > 500 ? 1 : coords.length > 150 ? 1.8 : 2.8;

    let path = '';
    if (bestSolution && Array.isArray(bestSolution.route) && bestSolution.route.length > 0) {
        const points = bestSolution.route.map(id => byId.get(id)).filter(Boolean);
        if (points.length > 0) {
            points.push(points[0]);
            const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join('');
            path = `<path d="${d}" fill="none" stroke="${RED}" stroke-width="1.4" stroke-linejoin="round"/>`;
        }
    }

    const dots = coords.map(c => `<circle cx="${px(c.x).toFixed(1)}" cy="${py(c.y).toFixed(1)}" r="${radius}" fill="#1f2328"/>`).join('');

    return `<svg ${SVG_NS_ATTR} viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="Ruta de la mejor solución">${path}${dots}</svg>`;
}

function progressSvg(improvements, endDate) {
    if (improvements.length === 0) {
        return '<p class="caption">Sin datos de progreso.</p>';
    }

    const points = improvements
        .map(i => ({ t: parseDate(i.date), v: i.value }))
        .filter(p => p.t);
    if (points.length === 0) {
        return '<p class="caption">Sin datos de progreso.</p>';
    }

    const W = 400, H = 220;
    const m = { top: 12, right: 14, bottom: 30, left: 58 };
    const t0 = points[0].t.getTime();
    let t1 = Math.max(endDate ? endDate.getTime() : 0, points[points.length - 1].t.getTime());
    if (t1 === t0) t1 = t0 + 60 * 60 * 1000;

    const vals = points.map(p => p.v);
    const yTicks = niceTicks(Math.min(...vals), Math.max(...vals), 4);
    const yMin = yTicks[0], yMax = yTicks[yTicks.length - 1];

    const x = t => m.left + ((t - t0) / (t1 - t0)) * (W - m.left - m.right);
    const y = v => H - m.bottom - ((v - yMin) / (yMax - yMin)) * (H - m.top - m.bottom);

    // Step line: value holds until the next improvement, then drops
    let d = `M${x(t0).toFixed(1)},${y(points[0].v).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
        d += `H${x(points[i].t.getTime()).toFixed(1)}V${y(points[i].v).toFixed(1)}`;
    }
    d += `H${x(t1).toFixed(1)}`;

    const grid = yTicks.map(v => `
        <line x1="${m.left}" x2="${W - m.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e3e5e8"/>
        <text x="${m.left - 6}" y="${(y(v) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#5f6670">${fmtNum(v, v % 1 ? 1 : 0)}</text>
    `).join('');

    const xTickCount = 4;
    let xLabels = '';
    for (let i = 0; i <= xTickCount; i++) {
        const t = t0 + ((t1 - t0) * i) / xTickCount;
        const anchor = i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle';
        xLabels += `<text x="${x(t).toFixed(1)}" y="${H - m.bottom + 14}" font-size="9" text-anchor="${anchor}" fill="#5f6670">${fmtDay(new Date(t))}</text>`;
    }

    const markers = points.map(p => `<circle cx="${x(p.t.getTime()).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" fill="${RED}"/>`).join('');

    return `
        <svg ${SVG_NS_ATTR} viewBox="0 0 ${W} ${H}" role="img" aria-label="Progreso de la mejor solución">
            ${grid}
            <line x1="${m.left}" x2="${W - m.right}" y1="${H - m.bottom}" y2="${H - m.bottom}" stroke="#9aa0a6"/>
            ${xLabels}
            <path d="${d}" fill="none" stroke="${RED}" stroke-width="2"/>
            ${markers}
        </svg>
    `;
}

function perDaySvg(perDay) {
    if (perDay.length === 0) {
        return '<p class="caption">Sin envíos.</p>';
    }

    // Fill missing days so the time axis is continuous
    const days = [];
    const counts = new Map(perDay.map(d => [d.day, d.count]));
    const start = new Date(perDay[0].day + 'T00:00:00Z');
    const end = new Date(perDay[perDay.length - 1].day + 'T00:00:00Z');
    for (let t = start.getTime(); t <= end.getTime() && days.length < 400; t += 86400000) {
        const key = new Date(t).toISOString().slice(0, 10);
        days.push({ day: key, count: counts.get(key) || 0 });
    }

    const W = 400, H = 150;
    const m = { top: 10, right: 14, bottom: 26, left: 58 };
    const maxCount = Math.max(...days.map(d => d.count));
    const yTicks = niceTicks(0, maxCount, 3).filter(v => v >= 0 && Number.isInteger(v));
    const yMax = yTicks[yTicks.length - 1] || 1;
    const plotW = W - m.left - m.right;
    const band = plotW / days.length;
    const barW = Math.max(1, band * 0.75);
    const y = v => H - m.bottom - (v / yMax) * (H - m.top - m.bottom);

    const grid = yTicks.map(v => `
        <line x1="${m.left}" x2="${W - m.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e3e5e8"/>
        <text x="${m.left - 6}" y="${(y(v) + 3).toFixed(1)}" font-size="9" text-anchor="end" fill="#5f6670">${v}</text>
    `).join('');

    const bars = days.map((d, i) => d.count > 0
        ? `<rect x="${(m.left + i * band + (band - barW) / 2).toFixed(1)}" y="${y(d.count).toFixed(1)}" width="${barW.toFixed(1)}" height="${(H - m.bottom - y(d.count)).toFixed(1)}" fill="${RED}" rx="1"><title>${d.day}: ${d.count}</title></rect>`
        : '').join('');

    const labelEvery = Math.max(1, Math.ceil(days.length / 6));
    const labels = days.map((d, i) => (i % labelEvery === 0 || i === days.length - 1) && !(i !== days.length - 1 && days.length - 1 - i < labelEvery / 2)
        ? `<text x="${(m.left + i * band + band / 2).toFixed(1)}" y="${H - m.bottom + 14}" font-size="9" text-anchor="middle" fill="#5f6670">${fmtDay(new Date(d.day + 'T12:00:00Z'))}</text>`
        : '').join('');

    return `
        <svg ${SVG_NS_ATTR} viewBox="0 0 ${W} ${H}" role="img" aria-label="Envíos válidos por día">
            ${grid}
            ${bars}
            <line x1="${m.left}" x2="${W - m.right}" y1="${H - m.bottom}" y2="${H - m.bottom}" stroke="#9aa0a6"/>
            ${labels}
        </svg>
    `;
}
