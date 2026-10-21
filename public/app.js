const app = Vue.createApp({
    data() {
        return {
            city: "",
            weatherData: null,
            error: "",
            loading: false,
            comparisonCity: "",
            comparisonData: null,
            comparisonError: "",
            comparing: false
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
            if (!cityName || this.loading || this.comparing) {
                return;
            }

            this.loading = true;
            this.error = "";
            this.weatherData = null;
            this.comparisonData = null;
            this.comparisonError = "";

            try {
                // Ask our server for the weather in this city.
                const response = await fetch("/api/weather?city=" + encodeURIComponent(cityName));
                this.weatherData = await this.readJsonResponse(response);
            } catch (requestError) {
                this.error = requestError.message;
            } finally {
                this.loading = false;
            }
        },
        formatCityName(city) {
            return [city.name, city.state, city.country].filter(Boolean).join(", ");
        },
        async readJsonResponse(response) {
            // The server API should send JSON, not a web page.
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
        async compareCities() {
            const secondCity = this.comparisonCity.trim();
            if (!this.weatherData || !secondCity || this.comparing || this.loading) {
                return;
            }

            this.comparing = true;
            this.comparisonError = "";
            this.comparisonData = null;

            // Add each city separately, so a comma in a country code stays in the name.
            const cityParams = new URLSearchParams();
            cityParams.append("cities", this.cityLabel);
            cityParams.append("cities", secondCity);

            try {
                const response = await fetch("/api/compare?" + cityParams.toString());
                this.comparisonData = await this.readJsonResponse(response);
            } catch (requestError) {
                this.comparisonError = requestError.message;
            } finally {
                this.comparing = false;
            }
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
            // Match OpenWeather's code to an icon in weather-icons.svg.
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
        }
    }
});

app.mount("#app");
