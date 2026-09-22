import { AdresseSearchAPI } from "./api.js";
import { texts } from "./texts.js";
// The rules this version has in common with the legacy one, as text. The same
// file is imported by style.css, so dist/adressevaelger.css carries them for
// the legacy picker and the component brings its own copy along.
import sharedStyles from "./shared.css";
// And the rules that are this version's alone. Both are the same for every
// instance, so both go into the page once.
import componentStyles from "./web-component.css";

// One copy of each per document, however many components there are, and
// whatever they are named. The ids also cover a second copy of the bundle on
// the page.
const styleSheets = [
  ["adressevaelger-shared-styles", sharedStyles],
  ["adressevaelger-web-component-styles", componentStyles],
];

let instanceCount = 0;

const defaultPlaceholder = "Søg adresse";

// Ids name this instance's own elements, are pointed at from aria-controls and
// aria-activedescendant, and go into its anchor name, so they have to be
// unique and usable as CSS identifiers. The counter guarantees uniqueness
// within this module; the lookup additionally covers a second copy of the
// bundle on the same page starting its own count.
function nextElementId() {
  let id;
  do {
    id = `adr-${++instanceCount}`;
  } while (document.getElementById(id));
  return id;
}

// The list is a popover, placed against its field with CSS anchor
// positioning. Both are needed for the list to end up anywhere sensible: a
// popover the engine cannot anchor opens in the middle of the screen. Where
// either is missing — Safari and iOS 16 and older, Chrome before 125, Firefox
// before 148 — the list is an ordinary absolutely positioned box below the
// field instead, which is how the legacy picker has always done it.
//
// Measured once: what a browser supports does not change under it.
const usesPopover =
  typeof HTMLElement !== "undefined" &&
  "showPopover" in HTMLElement.prototype &&
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("position-anchor: --a") &&
  CSS.supports("top: anchor(bottom)");

// Fall back to a plain class outside browser-like environments (SSR, Node,
// Jest/Vitest without jsdom) so importing this module doesn't throw just
// because HTMLElement isn't defined there.
// Cast so that the class is typed as the HTMLElement it is in a browser; the
// stand-in exists only where there is no DOM, and nothing calls it there.
const HTMLElementBase = /** @type {typeof HTMLElement} */ (
  typeof HTMLElement !== "undefined" ? HTMLElement : class {}
);

// Web component version of DAR search UI
export class AdresseSearchInput extends HTMLElementBase {
  static observedAttributes = [
    "label",
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
  /** Ties this component's list to this component's field, and no other. */
  anchorName = `--input-${this.elementId}`;
  disabled = false;
  placeholder = defaultPlaceholder;
  /** Text of the visible label, or null for none. */
  labelText = null;
  searchType = "adresser";
  options = {
    kommuneKode: null,
    maksimum: null,
    medtagForeloebige: null,
  };
  debounceTimer;
  /** Index of the option the arrow keys are on, or -1 for the text itself. */
  activeIndex = -1;
  /** Cancels the search that is in flight, if there is one. */
  searchController;
  /** Bumped whenever the failure on screen changes, to drop a stale write. */
  errorToken = 0;
  inputElement;
  labelElement;
  listElement;
  statusElement;
  errorElement;
  api;
  token;
  constructor() {
    super();
  }

  connectedCallback() {
    // Only when the author gave none: overwriting theirs broke every
    // getElementById, #id rule and <label for> that pointed at the element.
    if (!this.id) {
      this.id = this.elementId;
    }
    this.attachStyle();
    this.renderList();
  }

  disconnectedCallback() {
    this.cancelSearch();
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.statusElement?.remove();
    this.statusElement = undefined;
    this.errorElement?.remove();
    this.errorElement = undefined;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    // A removed attribute arrives here as null, and every case has to undo
    // itself for it: before, removing disabled, adgangsadresser-only or
    // medtag-foreloebige left each of them switched on.
    switch (name) {
      case "token":
        this.token = newValue;
        break;
      case "adgangsadresser-only":
        this.searchType = newValue !== null ? "husnumre" : "adresser";
        break;
      case "label":
        this.labelText = newValue;
        break;
      case "placeholder":
        this.placeholder = newValue ?? defaultPlaceholder;
        break;
      case "kommune-kode":
        this.options.kommuneKode = newValue;
        break;
      case "maksimum":
        this.options.maksimum = newValue !== null ? Number(newValue) : null;
        break;
      case "medtag-foreloebige":
        // Present means on, as for any boolean attribute; "false" has always
        // been accepted as off, and still is.
        this.options.medtagForeloebige =
          newValue !== null && newValue !== "false";
        break;
      case "api-url":
        this.options.apiUrl = newValue;
        break;
      case "disabled":
        // By presence, as on <input> itself: disabled="disabled", which is
        // what Angular's [attr.disabled] writes, was ignored when only "" was.
        this.disabled = newValue !== null;
        break;
      default:
      // Nothing
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
      this.closeList();
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
      this.errorHandler(
        new Error(`Failed to fetch items: ${err.message}`, { cause: err }),
      );
    }
  }

  /**
   * The stylesheets, once per document. They are not removed when the last
   * component goes: they belong to the page rather than to an instance, and
   * the next component to be connected would only put them back.
   */
  attachStyle() {
    for (const [id, text] of styleSheets) {
      if (document.getElementById(id)) {
        continue;
      }
      const style = document.createElement("style");
      style.id = id;
      style.textContent = text;
      document.head.append(style);
    }
  }

  renderInput() {
    // The field is made once and updated in place after that. Replacing it on
    // every attribute change emptied what the user had typed, took their
    // focus, and dropped any listener the page had put on it; a form disabling
    // its fields while it saves did all three.
    if (!this.inputElement) {
      this.createInput();
    }
    this.inputElement.placeholder = this.placeholder;
    this.inputElement.disabled = this.disabled;
    this.renderLabel();
  }

  // The placeholder was all that named the field, and a placeholder is not a
  // label: it goes as soon as the user types, and some screen readers read it
  // only as a hint. The field's id is generated, so a page cannot point a
  // <label for> at it; the label attribute has the component do it instead.
  renderLabel() {
    if (this.labelText === null) {
      this.labelElement?.remove();
      this.labelElement = undefined;
      return;
    }
    if (!this.labelElement) {
      this.labelElement = document.createElement("label");
      this.labelElement.id = `${this.elementId}-label`;
      this.labelElement.htmlFor = `${this.elementId}-input`;
    }
    this.labelElement.textContent = this.labelText;
    if (this.labelElement.nextElementSibling !== this.inputElement) {
      this.inputElement.before(this.labelElement);
    }
  }

  createInput() {
    this.inputElement = document.createElement("input");
    this.inputElement.id = `${this.elementId}-input`;
    this.inputElement.className = "adr-wc-input";
    // The one thing that differs between instances: this field's own anchor
    // name, which its list positions itself against.
    this.inputElement.style.setProperty("anchor-name", this.anchorName);
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
    // Without this the browser opens its own history dropdown over the
    // suggestions, and takes the keys meant for them: in firefox, once the
    // field has been submitted in a form, Enter is consumed by that dropdown
    // and never reaches the listbox.
    this.inputElement.setAttribute("autocomplete", "off");
    this.inputElement.addEventListener("input", this.inputHandler.bind(this));
    this.inputElement.addEventListener(
      "keydown",
      this.inputKeyHandler.bind(this),
    );
    this.inputElement.addEventListener(
      "focusout",
      this.focusOutHandler.bind(this),
    );
    // Prepended, not appended: when the first attribute is set after
    // connectedCallback, the status, alert and list are already children, and
    // appending would put the field below its own error line.
    this.prepend(this.inputElement);
  }

  renderList() {
    if (this.listElement) {
      this.listElement.remove();
    }
    // A list appearing, emptying or failing is a change the user did not make
    // and cannot see unless they are looking at it. Both regions are in the
    // document from the start: a live region added and filled in one go is not
    // announced. The count goes to a polite status; a failed search is
    // assertive, and on screen as well, because it is the one the user has to
    // act on.
    this.statusElement?.remove();
    this.statusElement = document.createElement("div");
    this.statusElement.id = `${this.elementId}-status`;
    this.statusElement.className = "adr-status";
    this.statusElement.role = "status";
    this.errorElement?.remove();
    this.errorElement = document.createElement("p");
    this.errorElement.id = `${this.elementId}-error`;
    this.errorElement.className = "adr-error";
    this.errorElement.role = "alert";
    this.append(this.statusElement, this.errorElement);
    this.listElement = document.createElement("ul");
    this.listElement.id = `${this.elementId}-list`;
    this.listElement.className = "adr-suggestions adr-wc-list";
    this.listElement.style.setProperty("position-anchor", this.anchorName);
    if (usesPopover) {
      this.listElement.popover = "auto";
    } else {
      this.listElement.classList.add("adr-wc-inline");
      this.listElement.hidden = true;
    }
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
    // A popover also closes on its own, when the user presses Escape or clicks
    // outside it. beforetoggle is where that is noticed, so the combobox state
    // follows a light dismiss as well as our own calls. Without the API there
    // is nothing to dismiss the list but us, and closeList does this itself.
    if (usesPopover) {
      this.listElement.addEventListener("beforetoggle", (event) => {
        if (event.newState !== "open") {
          this.afterClose();
        }
      });
    }
    this.append(this.listElement);
  }

  /**
   * Open the list. With the Popover API it goes into the top layer, which no
   * ancestor can clip and nothing on the page can cover. Without it, the list
   * is shown where it sits and placed by hand.
   */
  openList() {
    if (usesPopover) {
      this.listElement.showPopover();
      return;
    }
    this.listElement.hidden = false;
    this.placeList();
  }

  /** Close it, and put the component back the way a closed list leaves it. */
  closeList() {
    if (!this.listElement) {
      return;
    }
    if (usesPopover) {
      // beforetoggle runs afterClose, for our own calls and a light dismiss
      // alike.
      this.listElement.hidePopover();
      return;
    }
    if (this.listElement.hidden) {
      return;
    }
    this.listElement.hidden = true;
    this.listElement.classList.remove("adr-wc-above");
    this.afterClose();
  }

  /**
   * What a closed list leaves behind. Hiding it keeps its contents, which
   * would let the arrow keys walk a list nobody can see and Enter select from
   * it, so the options go: "the list holds options only while it is open"
   * holds for this version too, as it always has for the legacy one, and every
   * check can ask the options rather than track a flag.
   */
  afterClose() {
    this.setActive(-1);
    this.inputElement?.setAttribute("aria-expanded", "false");
    this.listElement.replaceChildren();
  }

  /**
   * Above the field rather than below it, when the list would otherwise run
   * off the bottom of the window and there is room above. This is what
   * position-try-fallbacks does for the popover; without anchor positioning
   * there is nothing that can do it in CSS alone.
   */
  placeList() {
    const field = this.inputElement.getBoundingClientRect();
    const height = this.listElement.getBoundingClientRect().height;
    const fitsBelow = field.bottom + height <= window.innerHeight;
    this.listElement.classList.toggle(
      "adr-wc-above",
      !fitsBelow && height <= field.top,
    );
  }

  /** Say something through the polite live region. */
  announce(message) {
    if (this.statusElement) {
      this.statusElement.textContent = message;
    }
  }

  /** Put a failure on screen, and in front of a screen reader. */
  showError(message) {
    if (!this.errorElement) {
      return;
    }
    // A failure and a result count at the same time would talk over each
    // other, and the count is the stale one.
    this.announce("");
    // The alert stays in the document, empty, rather than being hidden and
    // unhidden: a live region that appears and fills in one task is the case
    // screen readers miss, VoiceOver most reliably. What is announced is the
    // text changing, so a second identical failure has to be cleared first and
    // written in the next task, or it passes in silence.
    this.errorElement.textContent = "";
    const token = ++this.errorToken;
    setTimeout(() => {
      if (token === this.errorToken && this.errorElement?.isConnected) {
        this.errorElement.textContent = message;
      }
    });
  }

  clearError() {
    if (!this.errorElement) {
      return;
    }
    // Also cancels a failure that has not been written yet.
    this.errorToken++;
    this.errorElement.textContent = "";
  }

  renderListItems(items) {
    this.closeList();
    this.listElement.innerHTML = "";
    // A search that returns anything at all clears a failure the user was
    // shown for the last one.
    this.clearError();
    // A search with no hits used to open an empty popover.
    if (items.length === 0) {
      this.announce(texts.noResults);
      return;
    }
    this.announce(texts.results(items.length));
    items.forEach((item, index) => {
      this.listElement.append(this.createListItem(item, index));
    });
    this.openList();
    this.setActive(-1);
    this.inputElement.setAttribute("aria-expanded", "true");
  }

  createListItem(item, index) {
    const liElement = document.createElement("li");
    liElement.id = `${this.elementId}-option-${index}`;
    liElement.className = "adr-suggestion";
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
        new Error(`Failed to load search items: ${err.message}`, {
          cause: err,
        }),
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
      this.closeList();
      this.clearError();
      this.announce("");
      return;
    }
    // Read now rather than when the timer fires: selectProcessor assigns to
    // value directly, without an input event, so the two can differ.
    const query = event.target.value;
    this.debounceTimer = setTimeout(() => this.refreshList(query), 300);
  }

  /**
   * Navigation runs on keydown. On keyup it ignored auto-repeat, so holding an
   * arrow key moved exactly one option out of a hundred, and it was too late
   * to cancel what these keys do by default — the caret jumping to the end of
   * the text, an <input type="search"> emptying itself on Escape, and an
   * enclosing <form> submitting on Enter.
   *
   * Each default is only cancelled where the key is the component's: with the
   * list open, or with an option active. Enter with nothing active still
   * submits the form, and Escape with the list closed still reaches the field
   * and any dialog around it.
   *
   * Whether the list is open is read from the options themselves, which the
   * popover empties as it closes, rather than from a flag that has to be kept
   * in step with it.
   */
  inputKeyHandler(event) {
    const isOpen = this.optionElements().length > 0;
    switch (event.key) {
      case "ArrowUp":
        if (!isOpen) {
          break;
        }
        event.preventDefault();
        this.moveActive(-1);
        break;
      case "ArrowDown":
        if (!isOpen) {
          break;
        }
        event.preventDefault();
        this.moveActive(1);
        break;
      case "Enter": {
        const active = this.optionElements()[this.activeIndex];
        if (active) {
          event.preventDefault();
          this.closeList();
          this.selectProcessor(JSON.parse(active.dataset.item));
        }
        break;
      }
      case "Escape":
        if (isOpen) {
          event.preventDefault();
        }
        this.closeList();
        break;
      default:
      // Nothing
    }
  }

  /**
   * Close when focus leaves the component. Options cannot take focus — the
   * list cancels mousedown and none of it is tabbable — so this fires when the
   * user tabs or clicks away, and not while they are working in the list.
   */
  focusOutHandler(event) {
    if (!this.contains(event.relatedTarget)) {
      this.closeList();
    }
  }

  errorHandler(err) {
    console.error(err);
    // The suggestions are for a query that is no longer what the field says,
    // and the popover sits over the error line: leaving it open hides the
    // message from a sighted user and offers a screen-reader user options that
    // do not match what they typed.
    this.closeList();
    // The user gets a sentence they can act on; the detail stays in the event
    // and the console for whoever is debugging.
    this.showError(texts.searchFailed);
    this.dispatchEvent(
      new CustomEvent("address:error", {
        bubbles: true,
        composed: true,
        // status and detail come from the API's own answer, so that an
        // integrator can tell a 504 worth retrying from a 400 about their
        // configuration without reading the message.
        detail: {
          message: err.message,
          status: err.cause?.status,
          detail: err.cause?.detail,
        },
      }),
    );
  }
}
