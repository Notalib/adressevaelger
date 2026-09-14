/**
 * options.endpoint options.token
 */
export class AdresseSearchAPI {
  apiUrl = "https://adressevaelger.dk";
  token = "";

  constructor(options) {
    if (!options || !options.token) {
      throw new Error(
        'AdresseSearchAPI must be initialized with a valid configuration. `{token: "xxx"} is the minimum required.`',
      );
    }
    this.token = options.token;
    // Configure custom API URL
    if (options.apiUrl) {
      this.apiUrl = options.apiUrl;
    }
  }

  async search(endpoint, query, options = {}) {
    if (!endpoint || !query) {
      throw new Error("search() requires both endpoint and query parameters.");
    }
    const response = await fetch(
      `${this.apiUrl}/${endpoint}/soeg?token=${encodeURIComponent(this.token)}&tekst=${encodeURIComponent(query)}${this.formatParams(options)}`,
    );
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();
    if (data.status === "fejl") {
      throw new Error(`Search error: ${data.beskrivelse}`);
    }
    return data.fund;
  }

  async get(endpoint, id) {
    if (!endpoint || !id) {
      throw new Error("get() requires both endpoint and id parameters.");
    }
    const response = await fetch(
      `${this.apiUrl}/${endpoint}/${encodeURIComponent(id)}?token=${encodeURIComponent(this.token)}`,
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (data.status === "fejl") {
      throw new Error(data.beskrivelse);
    }
    return data;
  }

  formatParams(options) {
    let queryStr = "";
    const append = (name, value) => {
      queryStr += `&${name}=${encodeURIComponent(value)}`;
    };
    if (options.medtagForeloebige) {
      append("medtagForeloebige", "true");
    }
    if (options.maksimum) {
      append("maksimum", options.maksimum);
    }
    if (options.kommuneKode) {
      append("kommuneKode", options.kommuneKode);
    }
    if (options.vejnavn) {
      append("vejnavn", options.vejnavn);
    }
    if (options.postnummer) {
      append("postnummer", options.postnummer);
    }
    return queryStr;
  }
}
