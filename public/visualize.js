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

        // Update display info
        document.getElementById('instance-name-display').textContent = tspData.name || 'Sin nombre';
        document.getElementById('dimension-display').textContent = tspData.dimension || '-';
        document.getElementById('type-display').textContent = tspData.type || 'TSP';
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

        // Update display info
        const displayEmail = solutionData.email.split('@')[0];
        document.getElementById('instance-name-display').textContent = tspData.name || 'Sin nombre';
        document.getElementById('dimension-display').textContent = tspData.dimension || '-';
        document.getElementById('type-display').textContent = solutionData.objectiveValue.toFixed(2);
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

    // Add padding
    const padding = 50;
    const width = 800 - 2 * padding;
    const height = 600 - 2 * padding;

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
    const fullWidth = svg.attr("width");
    const fullHeight = svg.attr("height");
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