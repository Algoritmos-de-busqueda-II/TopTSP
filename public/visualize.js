let tspData = null;
let svg = null;
let g = null;
let zoom = null;
let userRoute = null; // Store the user's solution route

document.addEventListener('DOMContentLoaded', async function() {
    svg = d3.select("#tsp-canvas");

    // Create main group for zoom/pan
    g = svg.append("g");

    // Setup zoom behavior
    zoom = d3.zoom()
        .scaleExtent([0.1, 10])
        .on("zoom", function(event) {
            g.attr("transform", event.transform);
        });

    svg.call(zoom);

    // Check if we have a userId parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const userId = urlParams.get('userId');

    if (userId) {
        await loadAndVisualizeUserSolution(userId);
    } else {
        await loadAndVisualizeInstance();
    }
});

async function loadAndVisualizeInstance() {
    const loadingMessage = document.getElementById('loading-message');
    const noInstanceMessage = document.getElementById('no-instance-message');
    const visualizationContainer = document.getElementById('visualization-container');

    try {
        // Check if instance exists
        const instanceResponse = await fetch('/api/current-instance');
        const instanceData = await instanceResponse.json();

        if (!instanceData.hasInstance) {
            loadingMessage.classList.add('hidden');
            noInstanceMessage.classList.remove('hidden');
            return;
        }

        // Get the instance details including coordinates
        const detailsResponse = await fetch('/api/current-instance-coords');

        if (!detailsResponse.ok) {
            throw new Error('No se pudo cargar los detalles de la instancia');
        }

        const detailsData = await detailsResponse.json();

        if (!detailsData.hasInstance) {
            loadingMessage.classList.add('hidden');
            noInstanceMessage.classList.remove('hidden');
            return;
        }

        tspData = detailsData.instance;

        // Fetch best objective value from ranking
        let bestObjectiveValue = '-';
        try {
            const rankingResponse = await fetch('/api/ranking');
            if (rankingResponse.ok) {
                const rankingData = await rankingResponse.json();
                if (rankingData.stats && rankingData.stats.bestSolution !== null) {
                    bestObjectiveValue = rankingData.stats.bestSolution.toFixed(2);
                } else if (rankingData.ranking && rankingData.ranking.length > 0) {
                    bestObjectiveValue = rankingData.ranking[0].best_objective_value.toFixed(2);
                }
            }
        } catch (e) {
            console.error('Error fetching best objective value:', e);
        }

        // Update display info
        document.getElementById('instance-name-display').textContent = tspData.name || 'Sin nombre';
        // Restore middle label and value to show number of cities
        const middleLabel = document.querySelectorAll('.visualization-info .grid .text-center p strong')[1];
        if (middleLabel) {
            middleLabel.textContent = 'Número de Ciudades';
        }
        document.getElementById('dimension-display').textContent = tspData.dimension || '-';
        document.getElementById('type-display').textContent = bestObjectiveValue;
        document.getElementById('type-label').textContent = 'Mejor F.O.';
        document.getElementById('instance-title').textContent = `Visualización: ${tspData.name || 'Instancia TSP'}`;

        // Parse coordinates
        let coordinates = [];
        try {
            coordinates = JSON.parse(tspData.coordinates || '[]');
        } catch (e) {
            console.error('Error parsing coordinates:', e);
            throw new Error('Error al procesar las coordenadas de la instancia');
        }

        if (coordinates.length === 0) {
            throw new Error('No se encontraron coordenadas para visualizar');
        }

        // Show visualization
        loadingMessage.classList.add('hidden');
        visualizationContainer.classList.remove('hidden');

        // Render the TSP instance
        renderTSPInstance(coordinates);

    } catch (error) {
        console.error('Error loading TSP instance:', error);
        loadingMessage.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
    }
}

async function loadAndVisualizeUserSolution(userId) {
    const loadingMessage = document.getElementById('loading-message');
    const noInstanceMessage = document.getElementById('no-instance-message');
    const visualizationContainer = document.getElementById('visualization-container');

    try {
        // First, load the instance coordinates
        const instanceResponse = await fetch('/api/current-instance');
        const instanceData = await instanceResponse.json();

        if (!instanceData.hasInstance) {
            loadingMessage.classList.add('hidden');
            noInstanceMessage.classList.remove('hidden');
            return;
        }

        const detailsResponse = await fetch('/api/current-instance-coords');
        if (!detailsResponse.ok) {
            throw new Error('No se pudo cargar los detalles de la instancia');
        }

        const detailsData = await detailsResponse.json();
        if (!detailsData.hasInstance) {
            loadingMessage.classList.add('hidden');
            noInstanceMessage.classList.remove('hidden');
            return;
        }

        tspData = detailsData.instance;

        // Now load the user's solution
        const solutionResponse = await fetch(`/api/user-solution/${userId}`);
        if (!solutionResponse.ok) {
            throw new Error('No se pudo cargar la solución del usuario');
        }

        const solutionData = await solutionResponse.json();
        userRoute = solutionData.route;

        // Additionally, fetch user's submissions history to render progression chart
        try {
            const subsResp = await fetch(`/api/user-submissions/${userId}`);
            if (subsResp.ok) {
                const subsData = await subsResp.json();
                if (subsData && Array.isArray(subsData.submissions) && subsData.submissions.length > 0) {
                    renderProgressionChart(subsData.submissions, solutionData.email);
                }
            }
        } catch (e) {
            console.error('Error fetching user submissions:', e);
        }

        // Update display info
        const displayEmail = solutionData.email.split('@')[0];
        document.getElementById('instance-name-display').textContent = solutionData.instanceName || tspData.name || 'Sin nombre';
        // Show method in the middle column instead of 'Número de Ciudades'
        document.getElementById('dimension-display').textContent = solutionData.method || '';
        document.getElementById('type-display').textContent = solutionData.objectiveValue.toFixed(2);
        document.getElementById('type-label').textContent = 'F.O.';
        // Change the center label to 'Método'
        const middleLabel = document.querySelectorAll('.visualization-info .grid .text-center p strong')[1];
        if (middleLabel) {
            middleLabel.textContent = 'Método';
        }
        document.getElementById('instance-title').textContent = `Solución de ${displayEmail}`;

        // Parse coordinates
        let coordinates = [];
        try {
            coordinates = JSON.parse(tspData.coordinates || '[]');
        } catch (e) {
            console.error('Error parsing coordinates:', e);
            throw new Error('Error al procesar las coordenadas de la instancia');
        }

        if (coordinates.length === 0) {
            throw new Error('No se encontraron coordenadas para visualizar');
        }

        // Show visualization
        loadingMessage.classList.add('hidden');
        visualizationContainer.classList.remove('hidden');

        // Render the TSP instance with the user's route
        renderTSPInstance(coordinates);

    } catch (error) {
        console.error('Error loading user solution:', error);
        loadingMessage.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
    }
}

function renderProgressionChart(submissions, email) {
    // Show the progression card
    const card = document.getElementById('progression-card');
    const chartDiv = document.getElementById('progression-chart');
    if (!card || !chartDiv) return;
    card.classList.remove('hidden');

    // Prepare data: ensure submitted_at parsed as Date, objective_value as number
    const parsed = submissions.map(s => ({
        submitted_at: new Date(s.submitted_at),
        objective_value: Number(s.objective_value),
        method: s.method || ''
    }));

    // Sort by date in case
    parsed.sort((a, b) => a.submitted_at - b.submitted_at);

    const x = parsed.map(p => p.submitted_at);
    const y = parsed.map(p => p.objective_value);
    const methods = parsed.map(p => p.method);

    // Compute best-so-far series
    const best = [];
    let currentBest = Infinity;
    const improvementX = [];
    const improvementY = [];
    const improvementMethods = [];

    for (let i = 0; i < y.length; i++) {
        if (y[i] < currentBest) {
            currentBest = y[i];
            improvementX.push(x[i]);
            improvementY.push(y[i]);
            improvementMethods.push(methods[i] || '');
        }
        best.push(currentBest === Infinity ? null : currentBest);
    }

    // Line trace for best-so-far (single visible line)
    const traceLine = {
        x,
        y: best,
        mode: 'lines',
        name: 'Mejor solución',
        line: { dash: 'dash', color: 'green' },
        hoverinfo: 'skip',
        showlegend: true
    };

    // Markers trace for actual improvements (hover shows value and method)
    // Show in legend as 'Envío'
    const traceMarkers = {
        x: improvementX,
        y: improvementY,
        mode: 'markers',
        name: 'Envío',
        marker: { size: 8, color: 'green' },
        hovertemplate: 'Valor: %{y:.2f}<br>Método: %{customdata}<extra></extra>',
        customdata: improvementMethods,
        showlegend: true
    };

    const data = [traceLine, traceMarkers];

    const layout = {
        // No title as requested - keep chart minimal
        xaxis: { title: 'Fecha de envío' },
        yaxis: { title: 'Función Objetivo' },
        template: 'plotly_white',
        hovermode: 'closest',
        margin: { t: 20, r: 20, l: 60, b: 80 }
    };

    Plotly.newPlot(chartDiv, data, layout, {responsive: true, displayModeBar: false});
}

function renderTSPInstance(coordinates) {
    // Clear existing content
    g.selectAll("*").remove();

    // Calculate bounds for auto-scaling
    const xValues = coordinates.map(d => d.x);
    const yValues = coordinates.map(d => d.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    // Get actual SVG dimensions
    const svgNode = document.getElementById('tsp-canvas');
    const containerWidth = svgNode.parentElement.getBoundingClientRect().width;
    const svgWidth = Math.min(containerWidth, 800);
    const svgHeight = 600;

    // Add padding
    const padding = 50;
    const width = svgWidth - 2 * padding;
    const height = svgHeight - 2 * padding;

    // Create scales
    const xScale = d3.scaleLinear()
        .domain([minX, maxX])
        .range([padding, width + padding]);

    const yScale = d3.scaleLinear()
        .domain([minY, maxY])
        .range([height + padding, padding]); // Flip Y axis

    // If we have a user route, draw the path lines first (so they appear behind the cities)
    if (userRoute && userRoute.length > 0) {
        // Create a line generator
        const lineGenerator = d3.line()
            .x(d => xScale(d.x))
            .y(d => yScale(d.y));

        // Build the path data according to the route
        const pathData = userRoute.map(cityId => {
            return coordinates.find(coord => coord.id === cityId);
        });

        // Add the first city again to close the loop
        pathData.push(pathData[0]);

        // Draw the path
        g.append("path")
            .datum(pathData)
            .attr("class", "solution-path")
            .attr("fill", "none")
            .attr("stroke", "#4CAF50")
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.7)
            .attr("d", lineGenerator);
    }

    // Draw cities as circles
    const cities = g.selectAll(".city")
        .data(coordinates)
        .enter()
        .append("g")
        .attr("class", "city")
        .attr("transform", d => `translate(${xScale(d.x)}, ${yScale(d.y)})`);

    // Add circles for cities
    cities.append("circle")
        .attr("r", 5)
        .attr("fill", "#2196F3")
        .attr("stroke", "#1976D2")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr("r", 8)
                .attr("fill", "#FF5722");

            // Show tooltip
            showTooltip(event, d);
        })
        .on("mouseout", function(event, d) {
            d3.select(this)
                .transition()
                .duration(200)
                .attr("r", 5)
                .attr("fill", "#2196F3");

            hideTooltip();
        });

    // Add labels
    cities.append("text")
        .attr("class", "city-label")
        .attr("dx", 8)
        .attr("dy", 4)
        .text(d => d.id)
        .style("font-size", "12px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        .style("pointer-events", "none");

    // Create tooltip
    const tooltip = d3.select("body").append("div")
        .attr("id", "tooltip")
        .style("position", "absolute")
        .style("visibility", "hidden")
        .style("background", "rgba(0, 0, 0, 0.8)")
        .style("color", "white")
        .style("padding", "8px")
        .style("border-radius", "4px")
        .style("font-size", "12px")
        .style("z-index", "1000");

    // Auto-fit the visualization
    const bounds = g.node().getBBox();
    const svgElement = document.getElementById('tsp-canvas');
    const containerWidthFit = svgElement.parentElement.getBoundingClientRect().width;
    const fullWidth = Math.min(containerWidthFit, 800);
    const fullHeight = 600;
    const midX = bounds.x + bounds.width / 2;
    const midY = bounds.y + bounds.height / 2;
    const scale = 0.8 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
    const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];

    svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
}

function showTooltip(event, d) {
    const tooltip = d3.select("#tooltip");
    tooltip.style("visibility", "visible")
        .html(`<strong>Ciudad ${d.id}</strong><br>X: ${d.x.toFixed(2)}<br>Y: ${d.y.toFixed(2)}`)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 10) + "px");
}

function hideTooltip() {
    d3.select("#tooltip").style("visibility", "hidden");
}

function toggleLabels() {
    const showLabels = document.getElementById('show-labels').checked;
    g.selectAll('.city-label')
        .style('display', showLabels ? 'block' : 'none');
}

function updatePointSize() {
    const size = document.getElementById('point-size').value;
    g.selectAll('.city circle')
        .attr('r', size);
}

function resetZoom() {
    if (svg && zoom) {
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity);
    }
}