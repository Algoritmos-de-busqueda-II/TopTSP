document.addEventListener('DOMContentLoaded', async function() {
    const solutionForm = document.getElementById('solution-form');
    const passwordForm = document.getElementById('password-form');
    
    // Check authentication and load user data
    const user = await checkAuthStatus();
    if (!user) {
        window.location.href = '/login';
        return;
    }
    
    // Update UI with user info
    document.getElementById('user-email').textContent = user.email;
    
    // Show admin link if user is admin
    if (user.is_admin) {
        document.getElementById('admin-link').classList.remove('hidden');
    }
    
    // Verificar si hay una instancia actual disponible
    await checkInstanceAvailability();

    // Cargar estadísticas del usuario e historial de soluciones
    await loadUserStats();
    await loadSolutionHistory();
    
    // Manejador del formulario de soluciones
    solutionForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('alert-container');
        
        const formData = new FormData(solutionForm);
        const solution = formData.get('solution').trim();
        const method = formData.get('method').trim();
        
        if (!solution) {
            showToast('Por favor, introduce una solución válida.', 'warning', 'Solución vacía');
            return;
        }
        
        // Validar formato de la solución
        const validation = validateTSPSolution(solution);
        if (!validation.valid) {
            showToast(validation.error, 'error', 'Solución inválida');
            return;
        }
        
        const submitBtn = solutionForm.querySelector('button[type="submit"]');
        setLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/submit-solution', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ solution, method })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                if (data.improved) {
                    showToast(
                        `Has mejorado tu mejor solución con un valor de ${formatObjectiveValue(data.objectiveValue)}. ¡Sigue así!`,
                        'success',
                        '¡Excelente trabajo!'
                    );
                } else {
                    showToast(
                        `Solución registrada con valor ${formatObjectiveValue(data.objectiveValue)}. No ha mejorado tu mejor resultado anterior.`,
                        'info',
                        'Solución enviada'
                    );
                }
                
                // Limpiar el formulario
                solutionForm.reset();
                
                // Recargar estadísticas del usuario e historial de soluciones
                await loadUserStats();
                await loadSolutionHistory();
            } else {
                showToast(data.error || 'No se pudo procesar tu solución. Inténtalo de nuevo.', 'error', 'Error al enviar');
            }
        } catch (error) {
            console.error('Solution submission error:', error);
            showToast('No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.', 'error', 'Error de conexión');
        } finally {
            setLoading(submitBtn, false);
        }
    });
    
    // Manejador del formulario de contraseña
    passwordForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('alert-container');
        
        const formData = new FormData(passwordForm);
        const newPassword = formData.get('newPassword');
        const confirmPassword = formData.get('confirmPassword');
        
        if (!newPassword || !confirmPassword) {
            showToast('Por favor, completa todos los campos de contraseña.', 'warning', 'Campos incompletos');
            return;
        }
        
        if (newPassword.length < 6) {
            showToast('La contraseña debe tener al menos 6 caracteres para mayor seguridad.', 'warning', 'Contraseña demasiado corta');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showToast('Las contraseñas introducidas no coinciden. Por favor, verifica e inténtalo de nuevo.', 'error', 'Error de confirmación');
            return;
        }
        
        const submitBtn = passwordForm.querySelector('button[type="submit"]');
        setLoading(submitBtn, true);
        
        try {
            const response = await fetch('/api/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ newPassword })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showToast('Tu contraseña ha sido actualizada correctamente.', 'success', 'Contraseña cambiada');
                passwordForm.reset();
                setTimeout(() => {
                    hidePasswordModal();
                }, 1500);
            } else {
                showToast(data.error || 'No se pudo cambiar la contraseña. Inténtalo de nuevo.', 'error', 'Error al cambiar contraseña');
            }
        } catch (error) {
            console.error('Password change error:', error);
            showToast('No se pudo conectar con el servidor. Verifica tu conexión e inténtalo de nuevo.', 'error', 'Error de conexión');
        } finally {
            setLoading(submitBtn, false);
        }
    });
});

async function loadUserStats() {
    try {
        const response = await fetch('/api/ranking');
        if (response.ok) {
            const data = await response.json();
            
            if (!data.frozen && data.ranking.length > 0) {
                // Find current user in ranking
                const user = await checkAuthStatus();
                if (user) {
                    const userRanking = data.ranking.find(r => r.email === user.email);
                    
                    if (userRanking) {
                        document.getElementById('best-value').textContent = formatObjectiveValue(userRanking.best_objective_value);
                        document.getElementById('total-submissions').textContent = userRanking.total_submissions || '0';
                        document.getElementById('last-improvement').textContent = formatDate(userRanking.last_improvement);
                        document.getElementById('solution-stats').classList.remove('hidden');
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error loading user stats:', error);
    }
}

async function loadSolutionHistory() {
    const loadingElement = document.getElementById('solution-history-loading');
    const containerElement = document.getElementById('solution-history-container');
    const emptyElement = document.getElementById('solution-history-empty');
    const tbody = document.getElementById('solution-history-tbody');
    
    try {
        const response = await fetch('/api/user/solutions');
        if (response.ok) {
            const data = await response.json();
            
            loadingElement.classList.add('hidden');
            
            if (data.solutions.length === 0) {
                containerElement.classList.add('hidden');
                emptyElement.classList.remove('hidden');
            } else {
                emptyElement.classList.add('hidden');
                containerElement.classList.remove('hidden');
                
                // Populate table
                tbody.innerHTML = '';
                data.solutions.forEach(solution => {
                    const row = document.createElement('tr');
                    
                    // Highlight best solution
                    if (solution.is_best) {
                        row.classList.add('rank-1');
                    }
                    
                    row.innerHTML = `
                        <td>${solution.solution}</td>
                        <td><strong>${formatObjectiveValue(solution.objective_value)}</strong></td>
                        <td>${solution.method || '-'}</td>
                        <td>
                            <span class="status-indicator ${solution.is_valid ? 'status-online' : 'status-offline'}"></span>
                            ${solution.is_valid ? 'Válida' : 'Inválida'}
                        </td>
                        <td>${formatDate(solution.submitted_at)}</td>
                    `;
                    
                    tbody.appendChild(row);
                });
            }
        } else {
            loadingElement.innerHTML = '<p class="alert alert-danger">Error al cargar el historial</p>';
        }
    } catch (error) {
        console.error('Error loading solution history:', error);
        loadingElement.innerHTML = '<p class="alert alert-danger">Error de conexión</p>';
    }
}

function showPasswordModal() {
    const modal = document.getElementById('password-modal');
    document.body.style.overflow = 'hidden';
    modal.classList.remove('hidden');
    
    // Clear form
    const form = document.getElementById('password-form');
    form.reset();
    clearAlerts('password-alert-container');
}

function hidePasswordModal() {
    const modal = document.getElementById('password-modal');
    document.body.style.overflow = '';
    modal.classList.add('hidden');
}

async function checkInstanceAvailability() {
    try {
        const response = await fetch('/api/current-instance');
        if (response.ok) {
            const data = await response.json();

            const formContainer = document.getElementById('solution-form-container');
            const noInstanceMessage = document.getElementById('no-instance-message');

            if (data.hasInstance) {
                // Instance available - show form
                formContainer.style.display = '';
                noInstanceMessage.style.display = 'none';
            } else {
                // No instance - hide form and show message
                formContainer.style.display = 'none';
                noInstanceMessage.style.display = '';
            }
        }
    } catch (error) {
        console.error('Error checking instance availability:', error);
    }
}