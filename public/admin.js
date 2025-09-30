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
                    ? `Instancia TSP subida exitosamente. Ranking y soluciones anteriores eliminados.`
                    : `Instancia TSP subida exitosamente (ID: ${data.instanceId}).`;
                
                showAlert('alert-container', message, 'success');
                tspForm.reset();
                await loadCurrentTSPInstance(); // Reload instance info
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
    // Remove extra whitespace and split by comma
    const numbers = solution.trim().split(',').map(n => n.trim()).filter(n => n);
    
    if (numbers.length === 0) {
        return { valid: false, error: 'La solución está vacía' };
    }
    
    // Convert to integers
    const intNumbers = [];
    for (const num of numbers) {
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
            }
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

async function loadUsers() {
    clearAlerts('alert-container');
    
    try {
        const response = await fetch('/api/admin/users');
        if (response.ok) {
            const users = await response.json();
            populateUsersTable(users);
            showAlert('alert-container', `${users.length} usuarios cargados.`, 'success');
        } else {
            const data = await response.json();
            showAlert('alert-container', data.error || 'Error al cargar usuarios', 'danger');
        }
    } catch (error) {
        console.error('Load users error:', error);
        showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
    }
}

function populateUsersTable(users) {
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = '';
    
    if (users.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="5" class="text-center">No hay usuarios registrados</td>';
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
        
        row.innerHTML = `
            <td>${user.email}</td>
            <td>${status}</td>
            <td>${bestSolution}</td>
            <td>${lastUpdate}</td>
            <td>
                <div class="btn-group">
                    <button class="btn btn-sm btn-warning" onclick="resetUserPassword(${user.id}, '${user.email}')">
                        🔑 Reset
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id}, '${user.email}')">
                        🗑️ Eliminar
                    </button>
                </div>
            </td>
        `;
        
        tbody.appendChild(row);
    });
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