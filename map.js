// Import Mapbox and D3 as ESM modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1Ijoic2hsMDk0IiwiYSI6ImNtN2swN2thajAyN3IyaXExYWc3YnU2ajIifQ.hnuIJGjPzwbXCieNUoNSHA';
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute   = Array.from({ length: 1440 }, () => []);
// Initialize the Mapbox map
const map = new mapboxgl.Map({
  container: 'map', // The ID of the container element
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// Helper: project station coordinates to SVG pixel coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Helper: format minutes-since-midnight into a short time string (e.g. "2:30 PM")
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Helper: compute station traffic (arrivals, departures, total) using d3.rollup
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// ----------------------------------------------------------------------------
// Efficient Trip Filtering Using Pre-Sorted Buckets
// ----------------------------------------------------------------------------
// Instead of scanning all trips, this function quickly retrieves trips that
// started (or ended) within 60 minutes of the selected time.
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    // No filtering, return all trips (flatten all buckets)
    return tripsByMinute.flat();
  }

  // Compute the window: 60 minutes before and after the selected minute
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // If the window crosses midnight
  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight  = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}
function computeStationTraffic(stations, timeFilter = -1) {
  // Efficiently retrieve trips within the time window
  const filteredDepartures = filterByMinute(departuresByMinute, timeFilter);
  const departures = d3.rollup(
    filteredDepartures,
    v => v.length,
    d => d.start_station_id
  );

  const filteredArrivals = filterByMinute(arrivalsByMinute, timeFilter);
  const arrivals = d3.rollup(
    filteredArrivals,
    v => v.length,
    d => d.end_station_id
  );

  // Update each station with computed arrivals, departures, and total traffic
  return stations.map(station => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

map.on('load', async () => {
  // Add bike lanes (Boston and Cambridge) as GeoJSON sources and layers
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({
    id: 'bike-lanes_cam',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'green',
      'line-width': 3,
      'line-opacity': 0.4
    }
  });

  // Load station data from JSON
  let jsonData;
  try {
    const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }
  let stations = jsonData.data.stations;
  
  // Select the SVG overlay appended to the Mapbox container
  const svg = d3.select('#map').select('svg');
  
  // Create circles for each station (using station.short_name as the key)
  const circles = svg.selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));
  // Function to update circle positions based on the current map projection
  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);
  
  // Load trips CSV and parse date strings immediately into Date objects
  const trips = await d3.csv(
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv",
    trip => {
      // Convert date strings to Date objects
      trip.started_at = new Date(trip.started_at);
      trip.ended_at   = new Date(trip.ended_at);
      // Determine minutes since midnight
      const startMinute = minutesSinceMidnight(trip.started_at);
      const endMinute   = minutesSinceMidnight(trip.ended_at);
      // Add trip to the appropriate buckets
      departuresByMinute[startMinute].push(trip);
      arrivalsByMinute[endMinute].push(trip);
      return trip;
    }
  );
  
  // Compute initial station traffic using all trips
  stations = computeStationTraffic(stations);
  
  // Create a radius scale to size circles based on total traffic
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);
  
  // Update circles to reflect computed traffic and attach a title for tooltips
  svg.selectAll("circle")
    .attr("r", d => radiusScale(d.totalTraffic))
    .each(function(d) {
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });
  
  // Select slider and time display elements (note: do not include '#' in getElementById)
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');
  
  // Function to update the displayed time and trigger the scatterplot update
  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }
  
  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // Initialize on load
  
  // Function to update the scatterplot (i.e. circle sizes) based on the time filter
  function updateScatterPlot(timeFilter) {
    // Recompute station traffic with the filtered trips
    const filteredStations = computeStationTraffic(jsonData.data.stations, timeFilter);
    
    // Dynamically adjust the radius scale range: larger circles when filtering
    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }
    
    // Update the circles using the filtered station data
    circles
      .data(filteredStations, d => d.short_name)
      .join('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));
  }
});
  
  
