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

// Fall back to a plain class outside browser-like environments (SSR, Node,
// Jest/Vitest without jsdom) so importing this module doesn't throw just
// because HTMLElement isn't defined there.
const HTMLElementBase =
  typeof HTMLElement !== "undefined" ? HTMLElement : class {};

// Web component version of DAR search UI
export class AdresseSearchInput extends HTMLElementBase {
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
  /** Index of the option the arrow keys are on, or -1 for the text itself. */
  activeIndex = -1;
  /** Whether the popover is showing; its contents outlive it being hidden. */
  listOpen = false;
  /** Cancels the search that is in flight, if there is one. */
  searchController;
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
    this.cancelSearch();
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
    // Whatever is in flight was for what the user typed, not for what they
    // have just picked: without this, its results reopen the list over the
    // chosen address a moment later.
    this.cancelSearch();
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
    // Written with setAttribute rather than the IDL properties: element.role
    // and element.ariaExpanded reflect, but element.ariaControls and
    // element.ariaAutocomplete exist in no engine (measured on chromium, webkit
    // and firefox), so the two assignments that used them set a plain
    // JavaScript property and never reached the accessibility tree.
    this.inputElement.setAttribute("role", "combobox");
    this.inputElement.setAttribute("aria-autocomplete", "list");
    this.inputElement.setAttribute("aria-controls", `${this.elementId}-list`);
    this.inputElement.setAttribute("aria-expanded", "false");
    this.inputElement.placeholder = this.placeholder;
    this.inputElement.disabled = this.disabled;
    this.inputElement.addEventListener("input", this.inputHandler.bind(this));
    this.inputElement.addEventListener(
      "keyup",
      this.inputKeyHandler.bind(this),
    );
    this.inputElement.addEventListener(
      "keydown",
      this.keyDownHandler.bind(this),
    );
    this.inputElement.addEventListener(
      "focusout",
      this.focusOutHandler.bind(this),
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
    // The list scrolls at max-height: 50vh, and Firefox puts scrollable
    // containers in the tab order on their own. An explicit -1 keeps it
    // reachable by script and out of the tab sequence.
    this.listElement.tabIndex = -1;
    // Pressing the mouse on an option would otherwise take focus off the
    // input, dismissing the popover before the click that selects had landed.
    this.listElement.addEventListener("mousedown", (event) =>
      event.preventDefault(),
    );
    // The popover also closes on its own, when the user presses Escape or
    // clicks outside it. beforetoggle is where that is noticed, so the
    // combobox state follows a light dismiss as well as our own calls.
    this.listElement.addEventListener("beforetoggle", (event) => {
      // Hiding a popover leaves its contents in the DOM, so whether the list
      // is open is not a question the options can answer.
      this.listOpen = event.newState === "open";
      if (!this.listOpen) {
        this.setActive(-1);
        this.inputElement?.setAttribute("aria-expanded", "false");
      }
    });
    this.append(this.listElement);
  }

  renderListItems(items) {
    this.listElement.hidePopover();
    this.listElement.innerHTML = "";
    // A search with no hits used to open an empty popover.
    if (items.length === 0) {
      return;
    }
    items.forEach((item, index) => {
      this.listElement.append(this.createListItem(item, index));
    });
    this.listElement.showPopover();
    this.setActive(-1);
    this.inputElement.setAttribute("aria-expanded", "true");
  }

  createListItem(item, index) {
    const liElement = document.createElement("li");
    liElement.id = `${this.elementId}-option-${index}`;
    // Suggestions are moved through with the arrow keys, not with Tab: a search
    // returns up to 100 of them, and at tabindex="0" every one is a tab stop
    // between the field and the next control.
    liElement.tabIndex = -1;
    liElement.role = "option";
    liElement.innerText = item.titel;
    liElement.dataset.item = JSON.stringify(item);
    liElement.addEventListener("click", this.selectHandler.bind(this));
    return liElement;
  }

  /** The rendered options, in order; empty when nothing has been searched. */
  optionElements() {
    return [...this.listElement.querySelectorAll("li")];
  }

  /**
   * Point the combobox at one option, or at the text itself with -1. Nothing
   * is focused: the input keeps DOM focus throughout, and aria-activedescendant
   * is what tells a screen reader where the arrow keys have got to.
   */
  setActive(index) {
    const options = this.optionElements();
    this.activeIndex = index;
    options.forEach((option, position) => {
      const isActive = position === index;
      option.classList.toggle("dawa-selected", isActive);
      if (isActive) {
        option.setAttribute("aria-selected", "true");
      } else {
        option.removeAttribute("aria-selected");
      }
    });
    const active = options[index];
    if (!this.inputElement) {
      return;
    }
    if (active) {
      this.inputElement.setAttribute("aria-activedescendant", active.id);
      // Nothing in the list is focused any more, so the list will not scroll
      // itself to keep up with the arrow keys.
      active.scrollIntoView({ block: "nearest" });
    } else {
      this.inputElement.removeAttribute("aria-activedescendant");
    }
  }

  /**
   * Move the active option one step. What was typed is part of the ring, at
   * -1: arrowing past either end of the list comes back to it.
   */
  moveActive(direction) {
    const options = this.optionElements();
    if (options.length === 0) {
      return;
    }
    const positions = options.length + 1;
    const from = this.activeIndex + 1;
    this.setActive(((from + direction + positions) % positions) - 1);
  }

  /**
   * Abandon the search that is in flight, if there is one. Nothing it returns
   * will be rendered, and the request itself is cancelled rather than left to
   * occupy a connection until the gateway gives up on it.
   */
  cancelSearch() {
    this.searchController?.abort();
    this.searchController = undefined;
  }

  /** Supersede any search in flight and take the token for the new one. */
  startSearch() {
    this.cancelSearch();
    this.searchController = new AbortController();
    return this.searchController.signal;
  }

  async refreshList(value) {
    const signal = this.startSearch();
    try {
      const data = await this.api.search(this.searchType, value, this.options, {
        signal,
      });
      // A response can arrive after it stopped being the one we wanted: the
      // user typed another character, or picked an address. The abort covers
      // the request; this covers the moment between it resolving and getting
      // here.
      if (signal.aborted) {
        return;
      }
      this.renderListItems(data);
    } catch (err) {
      // Our own cancellation is not a failure to report to the caller.
      if (signal.aborted) {
        return;
      }
      this.errorHandler(
        new Error(`Failed to load search items: ${err.message}`),
      );
    }
  }

  inputHandler(event) {
    // What was typed before this keystroke is no longer what to search for, an
    // emptied field included. Left running, the timer fires a moment from now
    // and searches for whatever the field holds then — which, after a
    // backspace, is nothing, and search() rejects on its own argument guard
    // rather than asking the API anything.
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    if (event.target.value === "") {
      this.cancelSearch();
      this.listElement.hidePopover();
      return;
    }
    // Read now rather than when the timer fires: selectProcessor assigns to
    // value directly, without an input event, so the two can differ.
    const query = event.target.value;
    this.debounceTimer = setTimeout(() => this.refreshList(query), 300);
  }

  inputKeyHandler(event) {
    switch (event.key) {
      case "ArrowUp":
        this.moveActive(-1);
        break;
      case "ArrowDown":
        this.moveActive(1);
        break;
      case "Enter": {
        const active = this.optionElements()[this.activeIndex];
        if (active) {
          this.listElement.hidePopover();
          this.selectProcessor(JSON.parse(active.dataset.item));
        }
        break;
      }
      case "Escape":
        this.listElement.hidePopover();
        break;
      default:
      // Nothing
    }
  }

  /**
   * An <input type="search"> empties itself when Escape is pressed, which
   * would throw away what the user typed just to close the suggestions.
   * Navigation runs on keyup, too late to prevent that, so the default is
   * cancelled here while the list is open; inputKeyHandler still closes it.
   */
  keyDownHandler(event) {
    if (event.key === "Escape" && this.listOpen) {
      event.preventDefault();
    }
    // Enter belongs to the component while an option is active. DOM focus is
    // in the text field now, so an enclosing <form> would otherwise submit on
    // implicit submission — before keyup gets to select anything.
    if (event.key === "Enter" && this.activeIndex >= 0) {
      event.preventDefault();
    }
  }

  /**
   * Close when focus leaves the component. Options cannot take focus — the
   * list cancels mousedown and none of it is tabbable — so this fires when the
   * user tabs or clicks away, and not while they are working in the list.
   */
  focusOutHandler(event) {
    if (!this.contains(event.relatedTarget)) {
      this.listElement.hidePopover();
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
