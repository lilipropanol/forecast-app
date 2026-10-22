let weatherMap = null;
let weatherMarker = null;

const app = Vue.createApp({
    data() {
        return {
            city: "",
            weatherData: null,
            error: "",
            loading: false,
            pinRequestInProgress: false,
            pinLoading: false,
            mapLoading: false,
            mapError: "",
            mapLayers: {
                precipitation: true,
                temperature: true
            }
        };
    },
    computed: {
        cityLabel() {
            return this.weatherData ? this.formatCityName(this.weatherData.city) : "";
        }
    },
    methods: {
        async searchWeather() {
            const cityName = this.city.trim();
            if (!cityName || this.loading || this.pinRequestInProgress) {
                return;
            }

            this.removeMap();
            this.loading = true;
            this.error = "";
            this.weatherData = null;
            this.mapLoading = false;
            this.mapError = "";

            try {
                // ask the server for this city's weather
                const response = await fetch("/api/weather?city=" + encodeURIComponent(cityName));
                this.weatherData = await this.readJsonResponse(response);
            } catch (requestError) {
                this.error = requestError.message;
            } finally {
                this.loading = false;
                if (this.weatherData) {
                    await this.$nextTick();
                    await this.showWeatherMap();
                }
            }
        },
        async searchAtPoint(lat, lon) {
            if (this.loading || this.pinRequestInProgress) return;

            this.pinRequestInProgress = true;
            this.mapError = "";
            let loadingStartedAt = 0;
            const loadingTimer = window.setTimeout(() => {
                this.pinLoading = true;
                loadingStartedAt = Date.now();
            }, 180);

            try {
                const query = new URLSearchParams({
                    lat: String(lat),
                    lon: String(lon)
                });
                const response = await fetch("/api/weather-at?" + query);
                this.weatherData = await this.readJsonResponse(response);

                if (weatherMarker) {
                    weatherMarker.setLngLat([lon, lat]);
                }
            } catch (requestError) {
                this.mapError = "Could not load a forecast for that point. " + requestError.message;
            } finally {
                window.clearTimeout(loadingTimer);
                if (loadingStartedAt) {
                    const remainingTime = 250 - (Date.now() - loadingStartedAt);
                    if (remainingTime > 0) {
                        await new Promise((resolve) => window.setTimeout(resolve, remainingTime));
                    }
                }
                this.pinLoading = false;
                this.pinRequestInProgress = false;
            }
        },
        formatCityName(city) {
            return [city.name, city.state, city.country].filter(Boolean).join(", ");
        },
        async readJsonResponse(response) {
            // make sure the server sent json
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("application/json")) {
                throw new Error(
                    "The server returned a web page instead of JSON. Start or restart the app with `npm start` from the project folder, then reload this page."
                );
            }
            const responseData = await response.json();
            if (!response.ok) {
                throw new Error(responseData.error || "The weather request failed. Please try again.");
            }
            return responseData;
        },
        removeMap() {
            if (weatherMap) {
                weatherMap.remove();
                weatherMap = null;
                weatherMarker = null;
            }
        },
        setMapLayerVisibility(layerId, isVisible) {
            if (weatherMap && weatherMap.getLayer(layerId)) {
                weatherMap.setLayoutProperty(
                    layerId,
                    "visibility",
                    isVisible ? "visible" : "none"
                );
            }
        },
        async showWeatherMap() {
            if (!window.mapboxgl) {
                this.mapError = "The map library could not be loaded.";
                return;
            }

            const { lat, lon } = this.weatherData.coordinates;
            const mapboxgl = window.mapboxgl;
            this.mapLoading = true;
            this.mapError = "";

            try {
                const response = await fetch("/api/config");
                const config = await this.readJsonResponse(response);
                if (!config.mapboxToken) {
                    throw new Error("The Mapbox token is missing. Add it to .env and restart the server.");
                }
                mapboxgl.accessToken = config.mapboxToken;
            } catch (error) {
                this.mapLoading = false;
                this.mapError = error.message;
                return;
            }

            const map = new mapboxgl.Map({
                container: "weather-map",
                style: "mapbox://styles/mapbox/standard",
                center: [lon, lat],
                zoom: 6.5
            });
            weatherMap = map;

            map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
            weatherMarker = new mapboxgl.Marker({ color: "#326b84" })
                .setLngLat([lon, lat])
                .addTo(map);

            map.on("click", (event) => {
                this.searchAtPoint(event.lngLat.lat, event.lngLat.lng);
            });

            map.once("load", () => {
                if (weatherMap !== map) return;

                map.addSource("temperature", {
                    type: "raster",
                    tiles: ["/api/weather-map/temp_new/{z}/{x}/{y}.png"],
                    tileSize: 256,
                    maxzoom: 18,
                    attribution: "© OpenWeather"
                });
                map.addSource("precipitation", {
                    type: "raster",
                    tiles: ["/api/weather-map/precipitation_new/{z}/{x}/{y}.png"],
                    tileSize: 256,
                    maxzoom: 18,
                    attribution: "© OpenWeather"
                });

                map.addLayer({
                    id: "temperature-layer",
                    type: "raster",
                    source: "temperature",
                    slot: "middle",
                    layout: {
                        visibility: this.mapLayers.temperature ? "visible" : "none"
                    },
                    paint: {
                        "raster-opacity": 0.4,
                        "raster-contrast": 0.3,
                        "raster-saturation": 0.2,
                        "raster-fade-duration": 0
                    }
                });
                map.addLayer({
                    id: "precipitation-layer",
                    type: "raster",
                    source: "precipitation",
                    slot: "middle",
                    layout: {
                        visibility: this.mapLayers.precipitation ? "visible" : "none"
                    },
                    paint: {
                        "raster-opacity": 0.78,
                        "raster-contrast": 0.3,
                        "raster-saturation": 0.2,
                        "raster-fade-duration": 0
                    }
                });
                this.mapLoading = false;
            });

            map.on("error", (event) => {
                if (weatherMap !== map) return;
                if (
                    !map.isStyleLoaded() ||
                    event.sourceId === "precipitation" ||
                    event.sourceId === "temperature"
                ) {
                    this.mapLoading = false;
                    this.mapError = "The map or a weather layer could not be loaded.";
                }
            });
        },
        formatDate(dateString, short = false) {
            const date = new Date(dateString + "T12:00:00Z");
            return new Intl.DateTimeFormat("en-IE", {
                weekday: short ? "short" : "long",
                day: "numeric",
                month: "short",
                timeZone: "UTC"
            }).format(date);
        },
        weatherIcon(iconCode) {
            // match the weather code to one of our icons
            const code = String(iconCode || "");
            const group = code.slice(0, 2);
            const night = code.endsWith("n");

            if (group === "01") return night ? "moon" : "sun";
            if (group === "02" || group === "03") {
                return night ? "partly-cloudy-night" : "partly-cloudy-day";
            }
            if (group === "04") return "cloud";
            if (group === "09" || group === "10") return "rain";
            if (group === "11") return "storm";
            if (group === "13") return "snow";
            if (group === "50") return "mist";
            return "cloud";
        },
        formatNumber(value) {
            if (!Number.isFinite(value)) {
                return "—";
            }
            const cleanValue = Math.abs(value) < 0.05 ? 0 : value;
            return new Intl.NumberFormat("en-IE", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 1
            }).format(cleanValue);
        },
        formatTemperature(value) {
            return this.formatNumber(value) + "°C";
        },
        formatRainfall(value) {
            if (!Number.isFinite(value)) {
                return "—";
            }
            if (value === 0) {
                return "0";
            }
            if (value < 0.05) {
                return "<0.1";
            }
            return this.formatNumber(value);
        },
        formatForecastTime(timestamp, timezoneOffset) {
            const localDate = new Date((timestamp + timezoneOffset) * 1000);
            const day = new Intl.DateTimeFormat("en-IE", {
                weekday: "short",
                timeZone: "UTC"
            }).format(localDate);
            const time = new Intl.DateTimeFormat("en-IE", {
                hour: "numeric",
                hourCycle: "h12",
                timeZone: "UTC"
            }).format(localDate);
            return day + " at " + time;
        }
    }
});

app.mount("#app");
