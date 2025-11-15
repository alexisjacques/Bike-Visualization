// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

//import d3
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiYWxleGlzamFjcXVlcyIsImEiOiJjbWh6dXNzMzQwdGhsMmpwdDhlMTRrYW5vIn0.wOvYq09ZhmvwkbSj3xY2dQ';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/mapbox/streets-v12', // Map style
    center: [-71.05826923630575, 42.36017173587506], // [longitude, latitude]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18, // Maximum allowed zoom
});

// Helper function to convert lon/lat to pixel coordinates
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Helper function to format minutes since midnight as HH:MM AM/PM
function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Helper function to convert Date object to minutes since midnight
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Function to compute station traffic from stations and trips data
function computeStationTraffic(stations, trips) {
    // Compute departures
    const departures = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.start_station_id,
    );

    // Compute arrivals
    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id,
    );

    // Update each station with traffic data
    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

// Function to filter trips by time
function filterTripsByTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips // If no filter is applied (-1), return all trips
        : trips.filter((trip) => {
            // Convert trip start and end times to minutes since midnight
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);

            // Include trips that started or ended within 60 minutes of the selected time
            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });
}

// Wait for the map to load before adding data
map.on('load', async () => {
    // Create and append SVG element to the map container
    const svg = d3.select('#map').append('svg');
    // Adding the Data Source with addSource
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'Existing_Bike_Network_2022.geojson',
    });

    // Visualizing Data with addLayer
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': '#32D400',  // A bright green using hex code
            'line-width': 5,          // Thicker lines
            'line-opacity': 0.6       // Slightly less transparent
        },
    });

    // Adding Cambridge data source
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'cambridge.json',
    });

    // Visualizing Cambridge data with addLayer
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': '#FF69B4',  // A hot pink using hex code
            'line-width': 5,          // Thicker lines
            'line-opacity': 0.6       // Slightly less transparent
        },
    });

    // Fetch and parse the BlueBikes station data
    let jsonData;
    try {
        const jsonurl = 'bluebikes-stations.json';

        // Await JSON fetch
        jsonData = await d3.json(jsonurl);

        console.log('Loaded JSON Data:', jsonData); // Log to verify structure
    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }

    // Fetch and parse the BlueBikes traffic data with date parsing
    let trips = await d3.csv('bluebikes-traffic-2024-03.csv', (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
    });
    console.log('Loaded Traffic Data:', trips); // Log to verify structure

    // Compute station traffic using the new function
    const stations = computeStationTraffic(jsonData.data.stations, trips);
    console.log('Stations Array:', stations);

    // Create a square root scale for circle radius based on traffic
    const maxTraffic = d3.max(stations, (d) => d.totalTraffic);

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, maxTraffic])
        .range([3, 25]); // Minimum 3px to max 25px based on traffic

    // Create a quantize scale for traffic flow (departures vs arrivals)
    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

    // Append circles to the SVG for each station
    const circles = svg
        .selectAll('circle')
        .data(stations, (d) => d.short_name) // Use station short_name as the key
        .enter()
        .append('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic)) // Radius based on traffic
        .attr('stroke', 'white') // Circle border color
        .attr('stroke-width', 1) // Circle border thickness
        .attr('opacity', 0.8) // Circle opacity
        .style('--departure-ratio', (d) =>
            stationFlow(d.departures / d.totalTraffic),
        ) // Set CSS variable for color mixing
        .each(function (d) {
            // Add <title> for browser tooltips
            const titleText = `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
            d3.select(this)
                .append('title')
                .text(titleText);
        });

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
        circles
            .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
            .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends

    // Get slider and display elements
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('time-display');
    const anyTimeLabel = document.getElementById('any-time');

    // Function to update the scatterplot based on time filter
    function updateScatterPlot(timeFilter) {
        // Get only the trips that match the selected time filter
        const filteredTrips = filterTripsByTime(trips, timeFilter);

        // Recompute station traffic based on the filtered trips
        const filteredStations = computeStationTraffic(jsonData.data.stations, filteredTrips);

        // Adjust the radius scale range based on whether filtering is applied
        timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

        // Update the scatterplot by adjusting the radius of circles
        circles
            .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
            .join('circle')
            .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
            .style('--departure-ratio', (d) =>
                stationFlow(d.departures / d.totalTraffic),
            ); // Update color based on traffic flow
    }

    // Function to update the time display when slider moves
    function updateTimeDisplay() {
        let timeFilter = Number(timeSlider.value); // Get slider value

        if (timeFilter === -1) {
            selectedTime.textContent = ''; // Clear time display
            anyTimeLabel.style.display = 'block'; // Show "(any time)"
        } else {
            selectedTime.textContent = formatTime(timeFilter); // Display formatted time
            anyTimeLabel.style.display = 'none'; // Hide "(any time)"
        }

        // Call updateScatterPlot to reflect the changes on the map
        updateScatterPlot(timeFilter);
    }

    // Bind the slider's input event to update function
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay(); // Initialize display
});

