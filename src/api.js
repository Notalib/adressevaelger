/** Longest error body worth carrying: enough for a sentence, not a page. */
const MAX_DETAIL_LENGTH = 200;

/**
 * What the service said went wrong. Its error bodies are plain text —
 * "maksimum skal være <= 200 (500)", "upstream request timeout" — but a proxy
 * in front of it may answer with JSON or with a page of HTML, so this takes
 * whichever it finds and keeps it to a readable length.
 *
 * @param {Response} response
 * @returns {Promise<string>} the message, or "" when there is nothing to read
 */
async function errorDetail(response) {
  let body;
  try {
    body = await response.text();
  } catch {
    // A body that cannot be read tells us nothing the status has not already.
    return "";
  }
  let message = body.trim();
  try {
    const parsed = JSON.parse(message);
    message = String(parsed?.beskrivelse ?? parsed?.message ?? message);
  } catch {
    // Not JSON. A proxy that answers with a page puts the useful part in its
    // <title> — "502 Bad Gateway" — and the rest is markup nobody wants in a
    // console line.
    if (message.startsWith("<")) {
      const title = message.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      message = title ?? message.replace(/<[^>]*>/g, " ");
    }
  }
  message = message.replace(/\s+/g, " ").trim();
  return message.length > MAX_DETAIL_LENGTH
    ? `${message.slice(0, MAX_DETAIL_LENGTH)}…`
    : message;
}

/**
 * An error carrying what the service said, beside the message.
 *
 * @typedef {Error & {status?: number, detail?: string}} SearchError
 */

/**
 * The request itself failed. Carries the status and the service's own words
 * separately from the message, so that a caller can tell a 504 worth retrying
 * from a 400 about their own configuration without parsing English.
 *
 * @param {number} status
 * @param {string} detail
 * @returns {SearchError}
 */
function requestFailed(status, detail) {
  const error = /** @type {SearchError} */ (
    new Error(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`)
  );
  error.status = status;
  error.detail = detail;
  return error;
}

/**
 * The request succeeded and the service refused it — an expired token, say,
 * which comes back as 200 with a "fejl" envelope. No status is set: there is
 * no failing status to report, and saying 200 on a failed search would make
 * the field useless to branch on.
 *
 * @param {string} detail
 * @returns {SearchError}
 */
function serviceRefused(detail) {
  const error = /** @type {SearchError} */ (
    new Error(detail || "the search service refused the request")
  );
  error.detail = detail;
  return error;
}

/**
 * Which of the service's two search endpoints to ask. Follows
 * `adgangsadresserOnly`.
 *
 * @typedef {"adresser" | "husnumre"} SearchEndpoint
 */

/**
 * One row of the suggestion list. `type` decides what picking it does: a
 * vejnavn or navngivenvejpostnummer narrows the search, an adresse or a
 * husnummer ends it.
 *
 * @typedef {Object} Suggestion
 * @property {"vejnavn" | "navngivenvejpostnummer" | "husnummer" | "adresse"} type
 * @property {string} titel what the option shows
 * @property {string} [id] present on the rows that can be looked up
 */

/**
 * The record behind a suggestion, as the service returns it. Its shape is the
 * API's rather than this package's, so it is left open.
 *
 * @typedef {Record<string, unknown>} Address
 */

/**
 * Search parameters. The same names the picker takes, and what
 * `formatParams` turns into a query string.
 *
 * @typedef {Object} SearchParameters
 * @property {string} [kommuneKode] restrict to one municipality
 * @property {number} [maksimum] maximum hits; the service returns 100 when
 *   unset and rejects anything over 200
 * @property {boolean} [medtagForeloebige] include foreløbige addresses
 */

/**
 * The search service, without any user interface.
 */
export class AdresseSearchAPI {
  apiUrl = "https://adressevaelger.dk";
  token = "";

  /**
   * @param {{token: string, apiUrl?: string}} options a token is the minimum
   */
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

  /**
   * Suggestions for what has been typed.
   *
   * @param {SearchEndpoint} endpoint
   * @param {string} query
   * @param {SearchParameters} [options] search parameters, as documented in GUIDE.md
   * @param {{signal?: AbortSignal}} [request] pass a signal to cancel a search
   *   that has been superseded; the returned promise then rejects with the
   *   signal's reason, as fetch does.
   * @returns {Promise<Suggestion[]>}
   */
  async search(endpoint, query, options = {}, { signal } = {}) {
    if (!endpoint || !query) {
      throw new Error("search() requires both endpoint and query parameters.");
    }
    const response = await fetch(
      `${this.apiUrl}/${endpoint}/soeg?token=${encodeURIComponent(this.token)}&tekst=${encodeURIComponent(query)}${this.formatParams(options)}`,
      { signal },
    );
    if (!response.ok) {
      throw requestFailed(response.status, await errorDetail(response));
    }
    const data = await response.json();
    if (data.status === "fejl") {
      throw serviceRefused(data.beskrivelse);
    }
    return data.fund;
  }

  /**
   * The full record behind a suggestion.
   *
   * @param {SearchEndpoint} endpoint
   * @param {string} id
   * @returns {Promise<Address>}
   */
  async get(endpoint, id) {
    if (!endpoint || !id) {
      throw new Error("get() requires both endpoint and id parameters.");
    }
    const response = await fetch(
      `${this.apiUrl}/${endpoint}/${encodeURIComponent(id)}?token=${encodeURIComponent(this.token)}`,
    );
    if (!response.ok) {
      throw requestFailed(response.status, await errorDetail(response));
    }
    const data = await response.json();
    if (data.status === "fejl") {
      throw serviceRefused(data.beskrivelse);
    }
    return data;
  }

  /** @private */
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
    // No vejnavn or postnummer: the service only reads them for a search
    // without tekst, and every search here sends tekst, so they changed the
    // request and never the results (measured on both endpoints).
    return queryStr;
  }
}
