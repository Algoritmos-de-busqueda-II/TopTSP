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
    
    // Check if there's a current instance available
    await checkInstanceAvailability();

    // Load user statistics and solution history
    await loadUserStats();
    await loadSolutionHistory();
    
    // Solution form handler
    solutionForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('alert-container');
        
        const formData = new FormData(solutionForm);
        const solution = formData.get('solution').trim();
        const method = formData.get('method').trim();
        
        if (!solution) {
            showAlert('alert-container', 'Por favor, introduce una solución.', 'danger');
            return;
        }
        
        // Validate solution format
        const validation = validateTSPSolution(solution);
        if (!validation.valid) {
            showAlert('alert-container', validation.error, 'danger');
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
                const message = data.improved 
                    ? `¡Excelente! Nueva mejor solución con valor ${formatObjectiveValue(data.objectiveValue)}` 
                    : `Solución enviada (valor: ${formatObjectiveValue(data.objectiveValue)}). No mejoró tu mejor resultado.`;
                
                showAlert('alert-container', message, data.improved ? 'success' : 'info');
                
                // Clear the form
                solutionForm.reset();
                
                // Reload user stats and solution history
                await loadUserStats();
                await loadSolutionHistory();
            } else {
                showAlert('alert-container', data.error || 'Error al enviar la solución', 'danger');
            }
        } catch (error) {
            console.error('Solution submission error:', error);
            showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
        } finally {
            setLoading(submitBtn, false);
        }
    });
    
    // Password form handler
    passwordForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        clearAlerts('alert-container');
        
        const formData = new FormData(passwordForm);
        const newPassword = formData.get('newPassword');
        const confirmPassword = formData.get('confirmPassword');
        
        if (!newPassword || !confirmPassword) {
            showAlert('alert-container', 'Por favor, completa todos los campos.', 'danger');
            return;
        }
        
        if (newPassword.length < 6) {
            showAlert('alert-container', 'La contraseña debe tener al menos 6 caracteres.', 'danger');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showAlert('alert-container', 'Las contraseñas no coinciden.', 'danger');
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
                showAlert('password-alert-container', 'Contraseña cambiada exitosamente.', 'success');
                passwordForm.reset();
                setTimeout(() => {
                    hidePasswordModal();
                    showAlert('alert-container', 'Contraseña cambiada exitosamente.', 'success');
                }, 1500);
            } else {
                showAlert('password-alert-container', data.error || 'Error al cambiar la contraseña', 'danger');
            }
        } catch (error) {
            console.error('Password change error:', error);
            showAlert('alert-container', 'Error de conexión. Por favor, inténtalo de nuevo.', 'danger');
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