import { AdresseSearchAPI } from "./api.js";

let instanceCount = 0;

// Ids are interpolated into a stylesheet and into anchor-name, so they have to
// be unique and usable as CSS identifiers. The counter guarantees uniqueness
// within this module; the lookup additionally covers a second copy of the
// bundle on the same page starting its own count.
function nextElementId() {
  let id;
  do {
    id = `adr-${++instanceCount}`;
  } while (document.getElementById(id));
  return id;
}

// Web component version of DAR search UI
export class AdresseSearchInput extends HTMLElement {
  static observedAttributes = [
    "placeholder",
    "disabled",
    "adgangsadresser-only",
    "kommune-kode",
    "maksimum",
    "medtag-foreloebige",
    "token",
    "api-url",
  ];
  elementId = nextElementId();
  disabled = false;
  placeholder = "Søg adresse";
  searchType = "adresser";
  options = {
    kommuneKode: null,
    maksimum: null,
    medtagForeloebige: null,
  };
  debounceTimer;
  inputElement;
  listElement;
  styleElement;
  api;
  token;
  style = `
    #${this.elementId} {
      --highlight-color: lightblue;
      max-width: 30rem;
      width: 100%;
      display: block;
    }
    #${this.elementId}-input {
      anchor-name: --input-${this.elementId};
      width: 100%;
      display: block;
    }
    #${this.elementId}-list {
      margin: 0;
      inset: auto;
      position-anchor: --input-${this.elementId};
      position: fixed;
      left: anchor(left);
      top: anchor(bottom);
      right: auto;

      position-try-fallbacks: flip-block;
      max-height: 50vh;
      overflow: auto;

      li {
        cursor: pointer;
      }
      li:hover {
        background-color: var(--highlight-color);
      }
    }
  `;

  constructor() {
    super();
  }

  connectedCallback() {
    this.id = this.elementId;
    this.attachStyle();
    this.renderList();
  }

  disconnectedCallback() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.styleElement?.remove();
    this.styleElement = undefined;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    switch (name) {
      case "token":
        this.token = newValue;
        break;
      case "adgangsadresser-only":
        this.searchType = "husnumre";
        break;
      case "placeholder":
        this.placeholder = newValue;
        break;
      case "kommune-kode":
        this.options.kommuneKode = newValue;
        break;
      case "maksimum":
        this.options.maksimum = Number(newValue);
        break;
      case "medtag-foreloebige":
        this.options.medtagForeloebige = newValue !== "false" ? true : false;
        break;
      case "api-url":
        this.options.apiUrl = newValue;
        break;
      default:
      // Nothing
    }
    if (name === "disabled" && newValue === "") {
      this.disabled = true;
    }
    this.setAPI();
    this.renderInput();
  }

  setAPI() {
    if (!this.token) {
      return;
    }
    const opt = this.options.apiUrl
      ? { apiUrl: this.options.apiUrl, token: this.token }
      : { token: this.token };
    this.api = new AdresseSearchAPI(opt);
  }

  async selectHandler(event) {
    const item = JSON.parse(event.target.dataset.item);
    this.selectProcessor(item);
  }

  async selectProcessor(item) {
    if (
      item.type === "vejnavn" ||
      item.type === "navngivenvejpostnummer" ||
      (item.type === "husnummer" && this.searchType === "adresser")
    ) {
      this.inputElement.value = item.titel;
      await this.refreshList(item.titel);
    } else {
      await this.selectItem(item);
      this.listElement.hidePopover();
    }
  }

  async selectItem(item) {
    try {
      const data = await this.api.get(this.searchType, item.id);
      this.inputElement.value = item.titel;
      this.dispatchEvent(
        new CustomEvent("address:select", {
          bubbles: true,
          composed: true,
          detail: data,
        }),
      );
    } catch (err) {
      this.errorHandler(new Error(`Failed to fetch items: ${err.message}`));
    }
  }

  attachStyle() {
    if (this.styleElement) {
      return;
    }
    this.styleElement = document.createElement("style");
    this.styleElement.textContent = this.style;
    document.head.append(this.styleElement);
  }

  renderInput() {
    if (this.inputElement) {
      this.inputElement.remove();
    }
    this.inputElement = document.createElement("input");
    this.inputElement.id = `${this.elementId}-input`;
    this.inputElement.type = "search";
    this.inputElement.role = "combobox";
    this.inputElement.ariaAutocomplete = "list";
    this.inputElement.ariaControls = `${this.elementId}-list`;
    this.inputElement.placeholder = this.placeholder;
    this.inputElement.disabled = this.disabled;
    this.inputElement.addEventListener("input", this.inputHandler.bind(this));
    this.inputElement.addEventListener(
      "keyup",
      this.inputKeyHandler.bind(this),
    );
    this.append(this.inputElement);
  }

  renderList() {
    if (this.listElement) {
      this.listElement.remove();
    }
    this.listElement = document.createElement("ul");
    this.listElement.id = `${this.elementId}-list`;
    this.listElement.popover = "auto";
    this.listElement.role = "listbox";
    this.listElement.ariaLabel = "Søgeresultater";
    this.listElement.addEventListener("keyup", this.listKeyHandler.bind(this));
    this.append(this.listElement);
  }

  renderListItems(items) {
    this.listElement.hidePopover();
    this.listElement.innerHTML = "";
    items.forEach((item) => {
      this.listElement.append(this.createListItem(item));
    });
    this.listElement.showPopover();
  }

  createListItem(item) {
    const liElement = document.createElement("li");
    liElement.tabIndex = 0;
    liElement.role = "option";
    liElement.innerText = item.titel;
    liElement.dataset.item = JSON.stringify(item);
    liElement.addEventListener("click", this.selectHandler.bind(this));
    return liElement;
  }

  moveFocus(direction) {
    const next = this.listElement.querySelector(":focus").nextElementSibling;
    const previous =
      this.listElement.querySelector(":focus").previousElementSibling;
    if (direction === 1 && next) {
      next.focus();
    } else if (direction === -1 && previous) {
      previous.focus();
    }
  }

  async refreshList(value) {
    try {
      const data = await this.api.search(this.searchType, value, this.options);
      this.renderListItems(data);
    } catch (err) {
      this.errorHandler(
        new Error(`Failed to load search items: ${err.message}`),
      );
    }
  }

  inputHandler(event) {
    if (event.target.value === "") {
      this.listElement.hidePopover();
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      await this.refreshList(event.target.value);
    }, 300);
  }

  inputKeyHandler(event) {
    if (event.key === "ArrowDown") {
      this.listElement.childNodes[0].focus();
    }
  }

  listKeyHandler(event) {
    switch (event.key) {
      case "ArrowUp":
        this.moveFocus(-1);
        break;
      case "ArrowDown":
        this.moveFocus(1);
        break;
      case "Enter":
        this.listElement.hidePopover();
        this.selectProcessor(JSON.parse(event.target.dataset.item));
        break;
      default:
      // Nothing
    }
  }

  errorHandler(err) {
    console.error(err);
    this.dispatchEvent(
      new CustomEvent("address:error", {
        bubbles: true,
        composed: true,
        detail: { message: err.message },
      }),
    );
  }
}
