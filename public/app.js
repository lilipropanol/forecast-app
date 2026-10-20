const app = Vue.createApp({
  data() {
    return {
      city: "",
      result: null,
      error: "",
      loading: false,
      comparisonCity: "",
      comparisonResult: null,
      comparisonError: "",
      comparing: false
    };
  },
  computed: {
    cityLabel() {
      return this.result ? this.formatCityName(this.result.city) : "";
    }
  },
  methods: {
    async searchWeather() {
      const searchCity = this.city.trim();
      if (!searchCity || this.loading || this.comparing) {
        return;
      }

      this.loading = true;
      this.error = "";
      this.result = null;
      this.comparisonResult = null;
      this.comparisonError = "";

      try {
        const response = await fetch("/api/weather?city=" + encodeURIComponent(searchCity));
        this.result = await this.readJsonResponse(response);
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
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          "The server returned a web page instead of JSON. Start or restart the app with `npm start` from the project folder, then reload this page."
        );
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "The weather request failed. Please try again.");
      }
      return data;
    },
    async compareCities() {
      const secondCity = this.comparisonCity.trim();
      if (!this.result || !secondCity || this.comparing || this.loading) {
        return;
      }

      this.comparing = true;
      this.comparisonError = "";
      this.comparisonResult = null;

      const params = new URLSearchParams();
      params.append("cities", this.cityLabel);
      params.append("cities", secondCity);

      try {
        const response = await fetch("/api/compare?" + params.toString());
        this.comparisonResult = await this.readJsonResponse(response);
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
