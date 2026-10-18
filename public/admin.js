document.addEventListener('DOMContentLoaded', async function() {
    // Check authentication and admin privileges
    const user = await checkAuthStatus();
    if (!user) {
        window.location.href = '/login';
        return;
    }
    
    if (!user.is_admin) {
        window.location.href = '/user';
        return;
    }
    
    // Initialize forms and load current status
    await loadRankingStatus();
    await loadCurrentTSPInstance();
    await loadSystemSettings();
    loadUsers({ silent: true });
    loadCompetitionHistory();
    // Setup solution validator UI and handlers
    setupSolutionValidator();
    
    // Create users form handler
    const createUsersForm = document.getElementById('create-users-form');
    createUsersForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('alert-container');
        
        const formData = new FormData(createUsersForm);
        const emails = formData.get('emails').trim();
        
        if (!emails) {
            showAlert('alert-container', 'Por favor, introduce al menos un correo electrónico.', 'danger');
            return;
        }
        
        const submitBtn = createUsersForm.querySelector('button[type="submit"]');
        setLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/admin/create-users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ emails })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                let message = `${data.created} usuarios creados exitosamente.`;
                if (data.errors.length > 0) {
                    message += `<br><br><strong>Errores:</strong><ul>`;
                    data.errors.forEach(error => {
                        message += `<li>${error}</li>`;
                    });
                    message += `</ul>`;
                }
                
                showAlert('alert-container', message, data.errors.length > 0 ? 'warning' : 'success');
                createUsersForm.reset();
            } else {
                showAlert('alert-container', data.error || 'Error al crear usuarios', 'danger');
            }
        } catch (error) {
            console.error('Create users error:', error);
            showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
        } finally {
            setLoading(submitBtn, false);
        }
    });
    
    // TSP form handler
    const tspForm = document.getElementById('tsp-form');
    tspForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('alert-container');
        
        const formData = new FormData(tspForm);
        const tspData = formData.get('tspData').trim();
        
        if (!tspData) {
            showAlert('alert-container', 'Por favor, introduce los datos TSP.', 'danger');
            return;
        }
        
        const submitBtn = tspForm.querySelector('button[type="submit"]');
        
        // Check if there's an existing instance and ask for confirmation
        const instanceInfo = await getCurrentTSPInstance();
        let replaceExisting = false;
        
        if (instanceInfo.hasInstance) {
            const confirmed = confirm(
                `¿Estás seguro de que quieres reemplazar la instancia actual "${instanceInfo.instance.name}"?\n\n` +
                `⚠️ ADVERTENCIA: Esto eliminará permanentemente:\n` +
                `• Todas las soluciones enviadas\n` +
                `• Todo el ranking actual\n` +
                `• Toda la información de progreso de los usuarios\n\n` +
                `Las posiciones finales se guardarán en la Clasificación General.\n\n` +
                `Esta acción NO se puede deshacer.`
            );
            
            if (!confirmed) {
                return;
            }
            replaceExisting = true;
        }
        
        setLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/admin/upload-tsp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tspData, replaceExisting })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                const message = data.cleared 
                    ? `Instancia TSP subida exitosamente. Ranking anterior archivado en la Clasificación General.`
                    : `Instancia TSP subida exitosamente (ID: ${data.instanceId}).`;
                
                showAlert('alert-container', message, 'success');
                tspForm.reset();
                await loadCurrentTSPInstance(); // Reload instance info
                await loadSystemSettings(); // Configuration is reset with the new instance
                await loadRankingStatus();
                loadCompetitionHistory();
            } else {
                showAlert('alert-container', data.error || 'Error al subir la instancia TSP', 'danger');
            }
        } catch (error) {
            console.error('TSP upload error:', error);
            showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
        } finally {
            setLoading(submitBtn, false);
        }
    });
});

async function loadRankingStatus() {
    try {
        const response = await fetch('/api/ranking');
        if (response.ok) {
            const data = await response.json();
            updateRankingUI(data.frozen);
        }
    } catch (error) {
        console.error('Error loading ranking status:', error);
    }
}

function updateRankingUI(frozen) {
    const statusElement = document.getElementById('ranking-status');
    const toggleBtn = document.getElementById('toggle-ranking-btn');
    
    if (frozen) {
        statusElement.innerHTML = '<span class="status-indicator status-frozen"></span><span>Ranking congelado</span>';
        toggleBtn.textContent = 'Descongelar Ranking';
        toggleBtn.className = 'btn btn-success';
    } else {
        statusElement.innerHTML = '<span class="status-indicator status-online"></span><span>Ranking visible</span>';
        toggleBtn.textContent = 'Congelar Ranking';
        toggleBtn.className = 'btn btn-secondary';
    }
}

async function toggleRanking() {
    clearAlerts('alert-container');
    
    const toggleBtn = document.getElementById('toggle-ranking-btn');
    const currentlyFrozen = toggleBtn.textContent.includes('Descongelar');
    
    setLoading(toggleBtn, true);
    
    try {
        const response = await fetch('/api/admin/toggle-ranking', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ frozen: !currentlyFrozen })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            updateRankingUI(!currentlyFrozen);
            showAlert('alert-container', 
                `Ranking ${!currentlyFrozen ? 'congelado' : 'descongelado'} exitosamente.`, 'success');
        } else {
            showAlert('alert-container', data.error || 'Error al cambiar el estado del ranking', 'danger');
        }
    } catch (error) {
        console.error('Toggle ranking error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    } finally {
        setLoading(toggleBtn, false);
    }
}

async function exportCSV() {
    clearAlerts('alert-container');

    try {
        showAlert('alert-container', 'Preparando exportación...', 'info');

        const response = await fetch('/api/admin/export-csv');

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'topcsv-export.csv';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showAlert('alert-container', 'Archivo CSV descargado exitosamente.', 'success');
        } else {
            const data = await response.json();
            showAlert('alert-container', data.error || 'Error al exportar datos', 'danger');
        }
    } catch (error) {
        console.error('Export error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

let competitionPaused = false;

function updatePauseUI(paused) {
    competitionPaused = paused;
    const status = document.getElementById('paused-status');
    const btn = document.getElementById('toggle-pause-btn');
    if (!status || !btn) return;

    if (paused) {
        status.innerHTML = '<span class="status-indicator status-frozen"></span><span><strong>Competición pausada:</strong> no se pueden enviar soluciones</span>';
        btn.textContent = '▶️ Reanudar Competición';
        btn.className = 'btn btn-success';
    } else {
        status.innerHTML = '<span class="status-indicator status-online"></span><span>Competición activa: los alumnos pueden enviar soluciones</span>';
        btn.textContent = '⏸️ Pausar Competición';
        btn.className = 'btn btn-warning';
    }
}

async function togglePause() {
    const pause = !competitionPaused;
    if (pause && !confirm('¿Pausar la competición? Los alumnos no podrán enviar soluciones hasta que la reanudes.')) {
        return;
    }

    const btn = document.getElementById('toggle-pause-btn');
    setLoading(btn, true);
    try {
        const response = await fetch('/api/admin/set-paused', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paused: pause })
        });
        const data = await response.json();
        if (response.ok) {
            updatePauseUI(data.paused);
            showAlert('alert-container', data.paused ? 'Competición pausada.' : 'Competición reanudada.', 'success');
        } else {
            showAlert('alert-container', data.error || 'Error al cambiar el estado de la competición', 'danger');
        }
    } catch (error) {
        console.error('Toggle pause error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    } finally {
        setLoading(btn, false);
        updatePauseUI(competitionPaused);
    }
}

async function loadCompetitionHistory() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    try {
        const response = await fetch('/api/admin/competition-history');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const competitions = data.competitions || [];

        if (competitions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">Todavía no hay competiciones archivadas</td></tr>';
            return;
        }

        tbody.innerHTML = competitions.map(c => {
            // archived_at is SQLite CURRENT_TIMESTAMP (UTC without timezone)
            const date = new Date(String(c.archived_at).replace(' ', 'T') + 'Z');
            return `
                <tr>
                    <td>${escapeHtml(c.instance_name)}</td>
                    <td>${isNaN(date.getTime()) ? '-' : formatDate(date)}</td>
                    <td>${c.participants}</td>
                    <td>${formatObjectiveValue(c.best_value)}</td>
                    <td>
                        <button class="btn btn-sm btn-danger" onclick="deleteCompetition(${c.id}, ${escapeHtml(JSON.stringify(String(c.instance_name)))})">
                            🗑️ Eliminar
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Load competition history error:', error);
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Error al cargar el histórico</td></tr>';
    }
}

async function deleteCompetition(id, name) {
    if (!confirm(`¿Eliminar la competición "${name}" del histórico?\n\nDejará de contar en la Clasificación General. Esta acción NO se puede deshacer.`)) {
        return;
    }

    try {
        const response = await fetch('/api/admin/delete-competition', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await response.json();
        if (response.ok) {
            showAlert('alert-container', 'Competición eliminada del histórico.', 'success');
            loadCompetitionHistory();
        } else {
            showAlert('alert-container', data.error || 'Error al eliminar la competición', 'danger');
        }
    } catch (error) {
        console.error('Delete competition error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

function printRanking() {
    // The report page opens the print dialog itself once it has rendered
    const win = window.open('/ranking-report?print=1', '_blank');
    if (!win) {
        window.location.href = '/ranking-report?print=1';
    }
}

async function exportRankingCSV() {
    clearAlerts('alert-container');

    try {
        const response = await fetch('/api/admin/export-ranking-csv');

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ranking-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showAlert('alert-container', 'Ranking exportado en CSV.', 'success');
        } else {
            const data = await response.json();
            showAlert('alert-container', data.error || 'Error al exportar el ranking', 'danger');
        }
    } catch (error) {
        console.error('Export ranking error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

async function backupDatabase() {
    clearAlerts('alert-container');

    if (!confirm('¿Estás seguro de que deseas crear un backup de la base de datos?\n\nEsto creará una copia completa de la base de datos con el timestamp actual.')) {
        return;
    }

    try {
        showAlert('alert-container', 'Creando backup de la base de datos...', 'info');

        const response = await fetch('/api/admin/backup-database', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok) {
            showAlert('alert-container', `Backup creado exitosamente: <strong>${data.filename}</strong><br>Ubicación: ${data.path}`, 'success');
        } else {
            showAlert('alert-container', data.error || 'Error al crear backup', 'danger');
        }
    } catch (error) {
        console.error('Backup error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

async function restoreDatabase() {
    clearAlerts('alert-container');

    const fileInput = document.getElementById('restore-file');
    const file = fileInput.files[0];

    if (!file) {
        showAlert('alert-container', 'Por favor, selecciona un archivo de backup (.db) para restaurar.', 'danger');
        return;
    }

    if (!file.name.endsWith('.db')) {
        showAlert('alert-container', 'El archivo debe ser una base de datos (.db).', 'danger');
        return;
    }

    const confirmed = confirm(
        '⚠️ ADVERTENCIA CRÍTICA: ¿Estás seguro de que quieres restaurar la base de datos?\n\n' +
        'Esta acción:\n' +
        '• Reemplazará COMPLETAMENTE la base de datos actual\n' +
        '• Se creará un backup de seguridad automáticamente\n' +
        '• Se perderán todos los datos actuales si no has hecho backup\n\n' +
        'Esta acción NO se puede deshacer fácilmente.\n\n' +
        '¿Continuar con la restauración?'
    );

    if (!confirmed) {
        return;
    }

    try {
        showAlert('alert-container', 'Restaurando base de datos... Por favor espera.', 'info');

        const formData = new FormData();
        formData.append('backup', file);

        const response = await fetch('/api/admin/restore-database', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            showAlert('alert-container',
                `✅ Base de datos restaurada exitosamente.<br>` +
                `Backup de seguridad creado: <strong>${data.safetyBackup}</strong><br><br>` +
                `<strong>IMPORTANTE:</strong> Recarga la página para ver los cambios.`,
                'success');
            fileInput.value = ''; // Clear the file input

            // Optionally reload the page after a delay
            setTimeout(() => {
                if (confirm('¿Quieres recargar la página ahora para ver los cambios?')) {
                    window.location.reload();
                }
            }, 2000);
        } else {
            showAlert('alert-container', data.error || 'Error al restaurar la base de datos', 'danger');
        }
    } catch (error) {
        console.error('Restore error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

function loadExample() {
    document.getElementById('instance-name').value = 'Ejemplo-4-ciudades';
    document.getElementById('nodes').value = '4';
    document.getElementById('distance-matrix').value = JSON.stringify([
        [0, 10, 15, 20],
        [10, 0, 35, 25],
        [15, 35, 0, 30],
        [20, 25, 30, 0]
    ], null, 2);
}

function validateDistanceMatrix(matrix, expectedSize) {
    if (!Array.isArray(matrix)) {
        return { valid: false, error: 'La matriz debe ser un array.' };
    }
    
    if (matrix.length !== expectedSize) {
        return { valid: false, error: `La matriz debe tener ${expectedSize} filas.` };
    }
    
    for (let i = 0; i < matrix.length; i++) {
        if (!Array.isArray(matrix[i])) {
            return { valid: false, error: `La fila ${i + 1} no es un array.` };
        }
        
        if (matrix[i].length !== expectedSize) {
            return { valid: false, error: `La fila ${i + 1} debe tener ${expectedSize} columnas.` };
        }
        
        // Check diagonal is zero
        if (matrix[i][i] !== 0) {
            return { valid: false, error: `La diagonal principal debe ser cero (posición [${i+1}][${i+1}]).` };
        }
        
        // Check symmetry and non-negative values
        for (let j = 0; j < matrix[i].length; j++) {
            if (typeof matrix[i][j] !== 'number' || matrix[i][j] < 0) {
                return { valid: false, error: `Valor inválido en posición [${i+1}][${j+1}]: debe ser un número no negativo.` };
            }
            
            if (matrix[i][j] !== matrix[j][i]) {
                return { valid: false, error: `La matriz no es simétrica: [${i+1}][${j+1}] ≠ [${j+1}][${i+1}].` };
            }
        }
    }
    
    return { valid: true };
}

function validateTSPSolution(solution) {
    // Split by comma but keep empty tokens to detect format errors like ",," or leading/trailing commas
    const tokens = solution.split(',').map(n => n.trim());

    if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) {
        return { valid: false, error: 'La solución está vacía' };
    }

    // Detect empty tokens (format error: consecutive commas, leading or trailing comma)
    const emptyIndices = [];
    tokens.forEach((t, i) => { if (t === '') emptyIndices.push(i + 1); }); // 1-based positions
    if (emptyIndices.length) {
        return { valid: false, error: `Formato inválido: tokens vacíos en posiciones ${emptyIndices.join(', ')} (comas consecutivas o coma inicial/final)` };
    }

    // Convert to integers
    const intNumbers = [];
    for (const num of tokens) {
        const parsed = parseInt(num, 10);
        if (isNaN(parsed) || parsed <= 0) {
            return { valid: false, error: `"${num}" no es un número válido` };
        }
        intNumbers.push(parsed);
    }
    
    // Check for duplicates
    const uniqueNumbers = new Set(intNumbers);
    if (uniqueNumbers.size !== intNumbers.length) {
        return { valid: false, error: 'La solución contiene números duplicados' };
    }
    
    // Check if numbers are consecutive starting from 1
    const maxNumber = Math.max(...intNumbers);
    const expectedNumbers = new Set();
    for (let i = 1; i <= maxNumber; i++) {
        expectedNumbers.add(i);
    }
    
    for (const num of intNumbers) {
        if (!expectedNumbers.has(num)) {
            return { valid: false, error: `Número ${num} fuera del rango esperado (1-${maxNumber})` };
        }
    }
    
    // Check if all numbers from 1 to maxNumber are present
    if (intNumbers.length !== maxNumber) {
        return { valid: false, error: 'Faltan números en la secuencia' };
    }
    
    return { valid: true, numbers: intNumbers };
}

// New: validate solution against current instance dimension and render helpful diagnostics
function setupSolutionValidator() {
    const textarea = document.getElementById('solution-textarea');
    const resultDiv = document.getElementById('solution-validator-result');
    const clearBtn = document.getElementById('clear-solution-btn');

    if (!textarea || !resultDiv) return;

    let requestSeq = 0;

    async function validateAndRender() {
        const seq = ++requestSeq;
        const text = textarea.value || '';
        const instanceInfo = await getCurrentTSPInstance();
        const dimension = instanceInfo.hasInstance && instanceInfo.instance && instanceInfo.instance.dimension ? instanceInfo.instance.dimension : null;

        // Keep empty tokens so we can detect format problems like ",," or leading/trailing commas
        const parsedRaw = text.split(',').map(s => s.trim());
        if (parsedRaw.length === 0 || (parsedRaw.length === 1 && parsedRaw[0] === '')) {
            resultDiv.innerHTML = '<div class="alert alert-info">Introduce la solución para validar.</div>';
            return;
        }

        // Detect empty tokens -> format error
        const emptyPositions = parsedRaw.map((t, i) => t === '' ? i + 1 : -1).filter(i => i !== -1);
        if (emptyPositions.length) {
            resultDiv.innerHTML = `<div class="alert alert-danger"><strong>Formato inválido:</strong> tokens vacíos en posiciones ${emptyPositions.join(', ')} (coma inicial, coma final o comas consecutivas).</div>`;
            return;
        }

        const nums = [];
        const invalidTokens = [];
        for (const tok of parsedRaw) {
            const n = parseInt(tok, 10);
            if (Number.isNaN(n)) invalidTokens.push(tok);
            else nums.push(n);
        }

        if (invalidTokens.length) {
            resultDiv.innerHTML = `<div class="alert alert-danger">Tokens no numéricos: <strong>${invalidTokens.join(', ')}</strong></div>`;
            return;
        }

        const counts = new Map();
        for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
        const duplicates = [...counts.entries()].filter(([k,v]) => v>1).map(([k]) => k);

        let outOfRange = [];
        let missing = [];

        if (dimension) {
            for (const n of nums) {
                if (n < 1 || n > dimension) outOfRange.push(n);
            }

            // compute missing numbers from 1..dimension
            const present = new Set(nums);
            for (let i = 1; i <= dimension; i++) {
                if (!present.has(i)) missing.push(i);
            }
        } else {
            // no instance loaded: infer expected as 1..max(nums)
            const maxNum = Math.max(...nums);
            const present = new Set(nums);
            for (let i = 1; i <= maxNum; i++) if (!present.has(i)) missing.push(i);
            // outOfRange not applicable
        }

        // Build result HTML
        // Build a clearer, more actionable summary
        const red = 'color:#C41E3A;font-weight:700';
        const green = 'color:#28a745;font-weight:700';
        const amber = 'color:#e0a800;font-weight:700';

        let html = '<div class="validator-summary">';

        // Nodos detectados vs esperados (más explícito)
        if (dimension) {
            if (nums.length === dimension) {
                html += `<div><strong>Nodos detectados:</strong> <span style="${green}">${nums.length}</span> (esperado: ${dimension})</div>`;
            } else if (nums.length < dimension) {
                const diff = dimension - nums.length;
                html += `<div><strong>Nodos detectados:</strong> <span style="${red}">${nums.length} — deberían ser ${dimension} (faltan ${diff})</span></div>`;
            } else {
                const diff = nums.length - dimension;
                html += `<div><strong>Nodos detectados:</strong> <span style="${red}">${nums.length} — deberían ser ${dimension} (sobran ${diff})</span></div>`;
            }
        } else {
            html += `<div><strong>Nodos detectados:</strong> ${nums.length}</div>`;
        }

        // Nodos únicos y duplicados (más legible)
        const uniqueCount = new Set(nums).size;
        if (dimension) {
            if (uniqueCount === dimension) {
                html += `<div><strong>Nodos únicos:</strong> <span style="${green}">${uniqueCount}</span> (esperado: ${dimension})</div>`;
            } else if (uniqueCount < dimension) {
                const diff = dimension - uniqueCount;
                html += `<div><strong>Nodos únicos:</strong> <span style="${red}">${uniqueCount} — deberían ser ${dimension} (faltan ${diff})</span></div>`;
            } else {
                const diff = uniqueCount - dimension;
                html += `<div><strong>Nodos únicos:</strong> <span style="${red}">${uniqueCount} — deberían ser ${dimension} (sobran ${diff})</span></div>`;
            }
        } else {
            if (uniqueCount === nums.length) {
                html += `<div><strong>Nodos únicos:</strong> <span style="${green}">${uniqueCount}</span></div>`;
            } else {
                const dupCount = nums.length - uniqueCount;
                html += `<div><strong>Nodos únicos:</strong> <span style="${amber}">${uniqueCount}</span> — <span style="${red}">${dupCount} duplicado(s)</span></div>`;
            }
        }

        // Mostrar duplicados con conteo
        if (duplicates.length) {
            html += `<div style="margin-top:.6rem"><strong style="${red}">Nodos duplicados (${duplicates.length}):</strong> <span style="${red}">${duplicates.join(', ')}</span></div>`;
        } else {
            html += `<div style="margin-top:.6rem"><strong>Nodos duplicados:</strong> <span style="${green}">Ninguno</span></div>`;
        }

        // Fuera de rango
        if (outOfRange.length) {
            html += `<div style="margin-top:.6rem"><strong style="${red}">Fuera de rango (${outOfRange.length}):</strong> <span style="${red}">${outOfRange.join(', ')}</span></div>`;
        }

        // Missing: más explícito
        if (missing.length === 0) {
            html += `<div style="margin-top:.6rem"><strong>Faltan:</strong> <span style="${green}">0</span></div>`;
        } else {
            const showMissing = missing.slice(0, 200);
            const more = missing.length > showMissing.length ? ` (+${missing.length - showMissing.length} más)` : '';
            html += `<div style="margin-top:.6rem"><strong style="${red}">Faltan ${missing.length} nodo(s):</strong> <span style="${red}">${showMissing.join(', ')}${more}</span></div>`;
        }

        html += '</div>';
        resultDiv.innerHTML = html;

        // If the solution is feasible, show its quality (objective value and gap to best submitted)
        const feasible = dimension && nums.length === dimension && !duplicates.length && !outOfRange.length && !missing.length;
        if (!feasible) return;

        const qualityDiv = document.createElement('div');
        qualityDiv.className = 'validator-summary';
        qualityDiv.style.marginTop = '.8rem';
        qualityDiv.innerHTML = '<div><strong>Calidad:</strong> calculando...</div>';
        resultDiv.appendChild(qualityDiv);

        try {
            const response = await fetch('/api/admin/evaluate-solution', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ solution: nums.join(',') })
            });
            const data = await response.json();
            if (seq !== requestSeq) return;

            if (!response.ok) {
                qualityDiv.innerHTML = `<div><strong>Calidad:</strong> <span style="${red}">${data.error || 'No se pudo evaluar la solución'}</span></div>`;
                return;
            }

            let qhtml = `<div><strong>Solución factible.</strong> Valor objetivo (distancia total): <span style="${green}">${data.objectiveValue.toLocaleString('es-ES')}</span></div>`;
            if (data.bestValue !== null && data.bestValue > 0) {
                const gap = (data.objectiveValue - data.bestValue) / data.bestValue * 100;
                const gapStyle = gap <= 0 ? green : amber;
                const gapText = gap < 0 ? `${gap.toFixed(2)}% (mejora la mejor enviada)` : `${gap.toFixed(2)}%`;
                qhtml += `<div><strong>Mejor solución enviada:</strong> ${data.bestValue.toLocaleString('es-ES')} — <strong>Desviación:</strong> <span style="${gapStyle}">${gapText}</span></div>`;
            } else {
                qhtml += '<div><strong>Mejor solución enviada:</strong> todavía no hay soluciones para esta instancia</div>';
            }
            qualityDiv.innerHTML = qhtml;
        } catch (error) {
            if (seq !== requestSeq) return;
            qualityDiv.innerHTML = `<div><strong>Calidad:</strong> <span style="${red}">Error de conexión al evaluar la solución</span></div>`;
        }
    }

    // real-time validation as user types (debounce)
    let timer = null;
    textarea.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(validateAndRender, 250);
    });
    clearBtn && clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        textarea.value = '';
        requestSeq++;
        document.getElementById('solution-validator-result').innerHTML = '';
    });
}

async function loadCurrentTSPInstance() {
    const loadingElement = document.getElementById('instance-loading');
    const existsElement = document.getElementById('instance-exists');
    const noInstanceElement = document.getElementById('no-instance');
    const uploadBtnText = document.getElementById('upload-btn-text');
    
    try {
        const response = await fetch('/api/admin/current-tsp');
        if (response.ok) {
            const data = await response.json();
            
            loadingElement.classList.add('hidden');
            
            if (data.hasInstance) {
                const instance = data.instance;
                document.getElementById('current-instance-info').innerHTML = 
                    `<strong>${instance.name}</strong> (${instance.dimension} nodos)<br>` +
                    `<small>Creada: ${formatDate(instance.created_at)}</small>`;
                
                existsElement.classList.remove('hidden');
                noInstanceElement.classList.add('hidden');
                uploadBtnText.textContent = 'Reemplazar Instancia TSP';
            } else {
                existsElement.classList.add('hidden');
                noInstanceElement.classList.remove('hidden');
                uploadBtnText.textContent = 'Subir Instancia TSP';
            }
        } else {
            loadingElement.innerHTML = '<div class="alert alert-danger">Error al cargar información de instancia</div>';
        }
    } catch (error) {
        console.error('Error loading TSP instance:', error);
        loadingElement.innerHTML = '<div class="alert alert-danger">Error de conexión</div>';
    }
}

async function getCurrentTSPInstance() {
    try {
        const response = await fetch('/api/admin/current-tsp');
        if (response.ok) {
            return await response.json();
        }
        return { hasInstance: false };
    } catch (error) {
        console.error('Error getting TSP instance:', error);
        return { hasInstance: false };
    }
}

async function resetRanking() {
    clearAlerts('alert-container');
    
    const confirmed = confirm(
        '¿Estás completamente seguro de que quieres REINICIAR el ranking?\n\n' +
        '⚠️ ADVERTENCIA CRÍTICA: Esta acción eliminará permanentemente:\n' +
        '• Todas las soluciones enviadas por todos los usuarios\n' +
        '• Todo el ranking y estadísticas\n' +
        '• Todo el historial de progreso\n\n' +
        'Los usuarios tendrán que volver a empezar desde cero.\n' +
        'Esta acción NO se puede deshacer.\n\n' +
        '¿Continuar?'
    );
    
    if (!confirmed) {
        return;
    }
    
    // Double confirmation for such a destructive action
    const doubleConfirmed = confirm(
        'CONFIRMACIÓN FINAL:\n\n' +
        '¿Estás ABSOLUTAMENTE seguro?\n' +
        'Se perderán TODOS los datos de la competición actual.'
    );
    
    if (!doubleConfirmed) {
        return;
    }
    
    const resetBtn = document.getElementById('reset-ranking-btn');
    setLoading(resetBtn, true);
    
    try {
        const response = await fetch('/api/admin/reset-ranking', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('alert-container', 
                '✅ Ranking reiniciado exitosamente. Todas las soluciones han sido eliminadas.', 'success');
        } else {
            showAlert('alert-container', data.error || 'Error al reiniciar el ranking', 'danger');
        }
    } catch (error) {
        console.error('Reset ranking error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    } finally {
        setLoading(resetBtn, false);
    }
}

async function loadSystemSettings() {
    try {
        const response = await fetch('/api/system-settings');
        if (response.ok) {
            const settings = await response.json();
            
            // Load current instance name
            const instanceNameInput = document.getElementById('instance-name-input');
            if (instanceNameInput) {
                instanceNameInput.value = settings.instance_name || 'Berlin 52';
            }
            
            // Load current end date
            const endDateInput = document.getElementById('end-date-input');
            if (endDateInput && settings.competition_end_date) {
                const endDate = new Date(settings.competition_end_date);
                endDateInput.value = endDate.toISOString().slice(0, -1); // Remove Z for datetime-local
            } else if (endDateInput) {
                endDateInput.value = '';
            }

            updatePauseUI(settings.competition_paused === 'true');
        }
    } catch (error) {
        console.error('Error loading system settings:', error);
    }
}

async function setInstanceName() {
    const instanceNameInput = document.getElementById('instance-name-input');
    const instanceName = instanceNameInput.value.trim();
    
    if (!instanceName) {
        showAlert('alert-container', 'Por favor, introduce un nombre para la instancia.', 'danger');
        return;
    }
    
    clearAlerts('alert-container');
    
    try {
        const response = await fetch('/api/admin/set-instance-name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ instanceName })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('alert-container', 'Nombre de instancia actualizado exitosamente.', 'success');
        } else {
            showAlert('alert-container', data.error || 'Error al actualizar el nombre', 'danger');
        }
    } catch (error) {
        console.error('Set instance name error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

async function setEndDate() {
    const endDateInput = document.getElementById('end-date-input');
    const endDate = endDateInput.value;
    
    if (!endDate) {
        showAlert('alert-container', 'Por favor, selecciona una fecha y hora.', 'danger');
        return;
    }
    
    clearAlerts('alert-container');
    
    try {
        const response = await fetch('/api/admin/set-end-date', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ endDate })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('alert-container', 'Fecha de cierre establecida exitosamente.', 'success');
        } else {
            showAlert('alert-container', data.error || 'Error al establecer la fecha', 'danger');
        }
    } catch (error) {
        console.error('Set end date error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

async function clearEndDate() {
    clearAlerts('alert-container');
    
    try {
        const response = await fetch('/api/admin/set-end-date', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ endDate: '' })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('end-date-input').value = '';
            showAlert('alert-container', 'Fecha de cierre eliminada exitosamente.', 'success');
        } else {
            showAlert('alert-container', data.error || 'Error al eliminar la fecha', 'danger');
        }
    } catch (error) {
        console.error('Clear end date error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

let allUsers = []; // Last list loaded from the server, filtered client-side by email

async function loadUsers(options = {}) {
    if (!options.silent) clearAlerts('alert-container');
    
    try {
        const response = await fetch('/api/admin/users');
        if (response.ok) {
            allUsers = await response.json();
            filterUsers();
            if (!options.silent) {
                showAlert('alert-container', `${allUsers.length} usuarios cargados.`, 'success');
            }
        } else {
            const data = await response.json();
            showAlert('alert-container', data.error || 'Error al cargar usuarios', 'danger');
        }
    } catch (error) {
        console.error('Load users error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

function filterUsers() {
    const input = document.getElementById('users-search');
    const query = input ? input.value.trim().toLowerCase() : '';
    const users = query
        ? allUsers.filter(user => String(user.email || '').toLowerCase().includes(query))
        : allUsers;

    const count = document.getElementById('users-count');
    if (count) {
        count.textContent = query
            ? `${users.length} de ${allUsers.length} usuarios`
            : `${allUsers.length} usuarios`;
    }

    populateUsersTable(users, query);
}

function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function populateUsersTable(users, query = '') {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="5" class="text-center">${query ? 'Ningún usuario coincide con la búsqueda' : 'No hay usuarios registrados'}</td>`;
        tbody.appendChild(row);
        return;
    }
    
    users.forEach(user => {
        const row = document.createElement('tr');
        
        const isActive = !user.first_login;
        const status = isActive ? 
            '<span class="badge badge-success">Activo</span>' : 
            '<span class="badge badge-secondary">Inactivo</span>';
        
        const bestSolution = user.best_objective_value ? 
            formatObjectiveValue(user.best_objective_value) : 
            '-';
        
        const lastUpdate = user.last_improvement ? 
            formatDate(user.last_improvement) : 
            '-';

        // Email goes inside a JS string inside an HTML attribute
        const emailArg = escapeHtml(JSON.stringify(String(user.email)));
        
        row.innerHTML = `
            <td>${escapeHtml(user.email)}</td>
            <td>${status}</td>
            <td>${bestSolution}</td>
            <td>${lastUpdate}</td>
            <td>
                <div class="btn-group">
                    <button class="btn btn-sm btn-warning" onclick="resetUserPassword(${user.id}, ${emailArg})">
                        🔑 Reset
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id}, ${emailArg})">
                        🗑️ Eliminar
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });

    fitUsersTableHeight();
}

// Limit the users table to header + 5 rows; the rest scrolls inside the container
function fitUsersTableHeight() {
    const container = document.getElementById('users-table-container');
    const table = document.getElementById('users-table');
    if (!container || !table) return;

    const rows = table.tBodies[0].rows;
    if (rows.length <= 5) {
        container.style.maxHeight = '';
        return;
    }

    let height = table.tHead.offsetHeight;
    for (let i = 0; i < 5; i++) height += rows[i].offsetHeight;
    if (height > 0) container.style.maxHeight = `${height + 2}px`;
}

async function resetUserPassword(userId, email) {
    if (!confirm(`¿Estás seguro de que quieres reiniciar la contraseña de este usuario? La nueva contraseña será su correo electrónico: "${email}".`)) {
        return;
    }
    clearAlerts('alert-container');
    try {
        const response = await fetch('/api/admin/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId, email })
        });
        const data = await response.json();
        if (response.ok) {
            showAlert('alert-container', `Contraseña reiniciada exitosamente. Nueva contraseña: "${email}"`, 'success');
            await loadUsers(); // Reload users table
        } else {
            showAlert('alert-container', data.error || 'Error al reiniciar contraseña', 'danger');
        }
    } catch (error) {
        console.error('Reset password error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

async function deleteUser(userId, email) {
    if (!confirm(`¿Estás seguro de que quieres ELIMINAR PERMANENTEMENTE la cuenta de "${email}"?\n\nEsta acción eliminará:\n• La cuenta del usuario\n• Todas sus soluciones\n• Su historial completo\n\nEsta acción NO se puede deshacer.`)) {
        return;
    }
    
    clearAlerts('alert-container');
    
    try {
        const response = await fetch('/api/admin/delete-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('alert-container', `Usuario "${email}" eliminado exitosamente.`, 'success');
            await loadUsers(); // Reload users table
        } else {
            showAlert('alert-container', data.error || 'Error al eliminar usuario', 'danger');
        }
    } catch (error) {
        console.error('Delete user error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

async function fullSystemReset() {
    clearAlerts('alert-container');

    const confirmed = confirm(
        '⚠️ ADVERTENCIA CRÍTICA: ¿Reiniciar COMPLETAMENTE el sistema?\n\n' +
        'Esta acción eliminará permanentemente:\n' +
        '• Todos los usuarios (excepto los administradores)\n' +
        '• Todas las soluciones y el ranking\n' +
        '• Todas las instancias TSP subidas\n' +
        '• Toda la configuración de la competición\n\n' +
        'Se dejará configurada la instancia Berlin52 por defecto.\n' +
        'Esta acción NO se puede deshacer.\n\n' +
        '¿Continuar?'
    );

    if (!confirmed) {
        return;
    }

    const typedConfirmation = prompt(
        'CONFIRMACIÓN FINAL:\n\n' +
        'Escribe REINICIAR (en mayúsculas) para confirmar el reinicio completo del sistema.'
    );

    if (typedConfirmation !== 'REINICIAR') {
        showAlert('alert-container', 'Reinicio cancelado: la confirmación no coincide.', 'info');
        return;
    }

    const resetBtn = document.getElementById('full-reset-btn');
    setLoading(resetBtn, true);

    try {
        showAlert('alert-container', 'Reiniciando el sistema completo... Por favor espera.', 'info');

        const response = await fetch('/api/admin/full-reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok) {
            showAlert('alert-container',
                '✅ Sistema reiniciado exitosamente. Usuarios, soluciones y ranking eliminados. ' +
                'Instancia Berlin52 configurada por defecto.<br>' +
                `Backup de seguridad creado: <strong>${data.safetyBackup}</strong><br><br>` +
                '<strong>IMPORTANTE:</strong> Recarga la página para ver los cambios.',
                'success');

            setTimeout(() => {
                if (confirm('¿Quieres recargar la página ahora para ver los cambios?')) {
                    window.location.reload();
                }
            }, 2000);
        } else {
            showAlert('alert-container', data.error || 'Error al reiniciar el sistema', 'danger');
        }
    } catch (error) {
        console.error('Full system reset error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    } finally {
        setLoading(resetBtn, false);
    }
}