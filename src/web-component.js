import { AdresseSearchAPI } from "./api.js";
import { texts } from "./texts.js";

let instanceCount = 0;

const defaultPlaceholder = "Søg adresse";

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
  styleElement;
  api;
  token;
  // Not `style`: a class field is an own property of the instance, and under
  // that name it hid the CSSStyleDeclaration every element inherits, so any
  // write to element.style on this one threw.
  //
  // The element itself is found through its list rather than by id: the id is
  // the author's when they gave one, and the list is there from the moment the
  // stylesheet is. The specificity is the same as the #id it replaces.
  styleText = `
    :has(> #${this.elementId}-list) {
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
    #${this.elementId}-status {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      border: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    #${this.elementId}-error {
      margin: 0.3em 0 0 0;
      color: #b00020;
      font-size: 0.875em;
    }
    /* The alert stays in the document rather than being hidden between
       failures, so that a screen reader has a live region to notice changing.
       Empty, it should take up nothing. */
    #${this.elementId}-error:empty {
      margin: 0;
    }
    #${this.elementId}-list {
      margin: 0;
      /* A <ul> keeps its 40px marker indent even once the bullets are gone. */
      padding: 0;
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
        list-style: none;
        cursor: pointer;
        /* A bare line of text is 18px at the default font size, under the
           24px WCAG 2.5.8 asks of a target, and the options are stacked with
           no spacing between them, so the spacing exception does not apply.
           The padding matches the legacy rows; min-height keeps the floor
           when the page's font is small enough for 0.4em not to reach it. */
        padding: 0.4em 0.6em;
        min-height: 24px;
        box-sizing: border-box;
      }
      li:hover {
        background-color: var(--highlight-color);
      }
      /* The active option used to be the focused element, so the browser drew
         its own focus ring on it. With focus kept in the text field nothing
         did, and this version styled nothing for the active option at all:
         arrowing through the list changed nothing on screen. The outline is
         inset so that the list's overflow cannot clip it. */
      li.dawa-selected {
        background-color: var(--highlight-color);
        outline: 2px solid #005a9c;
        outline-offset: -2px;
      }
    }
    /* Forced colours drop the background, which leaves the outline to carry
       the indicator; Highlight is what the user has chosen for exactly this. */
    @media (forced-colors: active) {
      #${this.elementId}-list li.dawa-selected {
        outline-color: Highlight;
      }
    }
  `;

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
    this.styleElement?.remove();
    this.styleElement = undefined;
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
      this.errorHandler(
        new Error(`Failed to fetch items: ${err.message}`, { cause: err }),
      );
    }
  }

  attachStyle() {
    if (this.styleElement) {
      return;
    }
    this.styleElement = document.createElement("style");
    this.styleElement.textContent = this.styleText;
    document.head.append(this.styleElement);
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
    this.statusElement.role = "status";
    this.errorElement?.remove();
    this.errorElement = document.createElement("p");
    this.errorElement.id = `${this.elementId}-error`;
    this.errorElement.role = "alert";
    this.append(this.statusElement, this.errorElement);
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
      if (event.newState === "open") {
        return;
      }
      this.setActive(-1);
      this.inputElement?.setAttribute("aria-expanded", "false");
      // Hiding a popover leaves its contents in the DOM, which would let the
      // arrow keys walk a list nobody can see and Enter select from it.
      // Emptying it here means "the list holds options only while it is open"
      // holds for this version too, as it always has for the legacy one, and
      // every check can simply ask the options rather than track a flag.
      this.listElement.replaceChildren();
    });
    this.append(this.listElement);
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
    this.listElement.hidePopover();
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
        new Error(`Failed to load search items: ${err.message}`, { cause: err }),
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
          this.listElement.hidePopover();
          this.selectProcessor(JSON.parse(active.dataset.item));
        }
        break;
      }
      case "Escape":
        if (isOpen) {
          event.preventDefault();
        }
        this.listElement.hidePopover();
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
      this.listElement.hidePopover();
    }
  }

  errorHandler(err) {
    console.error(err);
    // The suggestions are for a query that is no longer what the field says,
    // and the popover sits over the error line: leaving it open hides the
    // message from a sighted user and offers a screen-reader user options that
    // do not match what they typed.
    this.listElement?.hidePopover();
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
