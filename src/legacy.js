import { AdresseSearchAPI } from "./api.js";
import { texts } from "./texts.js";

// A picker is wired to an element the caller owns, and a plain class gets no
// notification when that element is removed. One shared observer releases any
// picker whose input has left the document, so that closing a dialog is enough
// to drop its listeners even when the caller never calls destroy().
const livePickers = new Set();
let detachObserver;

function releaseOnDetach(picker) {
  livePickers.add(picker);
  if (detachObserver) {
    return;
  }
  detachObserver = new MutationObserver(() => {
    for (const candidate of livePickers) {
      if (!candidate.wasConnected) {
        // Set up before its input was inserted: not detached, not yet attached.
        candidate.wasConnected = candidate.inputElement.isConnected;
      } else if (!candidate.inputElement.isConnected) {
        candidate.destroy();
      }
    }
  });
  detachObserver.observe(document, { childList: true, subtree: true });
}

function stopWatching(picker) {
  livePickers.delete(picker);
  if (livePickers.size === 0 && detachObserver) {
    detachObserver.disconnect();
    detachObserver = undefined;
  }
}

let pickerCount = 0;

// The listbox and its options are addressed by id from aria-controls and
// aria-activedescendant, so those ids have to be unique on the page. The
// counter guarantees uniqueness within this module; the lookup additionally
// covers a second copy of the bundle on the same page starting its own count.
function nextListId() {
  let id;
  do {
    id = `adressevaelger-list-${++pickerCount}`;
  } while (document.getElementById(id));
  return id;
}

export function adressevaelger(element, options) {
  return new AdresseSearchUI(element, options);
}

export class AdresseSearchUI {
  searchType = "adresser";
  debounceTimer;
  options;
  wrapperElement;
  inputElement;
  listElement;
  api;
  abortController = new AbortController();
  wasConnected = false;
  listId = nextListId();
  /** Index of the option the arrow keys are on, or -1 for the text itself. */
  activeIndex = -1;
  /** Cancels the search that is in flight, if there is one. */
  searchController;

  constructor(element, options) {
    this.options = options;
    this.searchType = options.adgangsadresserOnly ? "husnumre" : "adresser";
    this.inputElement = element;
    this.listElement = document.createElement("div");
    this.wrapperElement = this.inputElement.parentNode;
    this.wrapperElement.append(this.listElement);
    // A list appearing, emptying or failing is a change the user did not make
    // and cannot see unless they are looking at it. Both regions are in the
    // document from the start: a live region added and filled in one go is not
    // announced. The count goes to a polite status; a failed search is
    // assertive, and on screen as well, because it is the one the user has to
    // act on.
    this.statusElement = document.createElement("div");
    this.statusElement.className = "adressevaelger-status";
    this.statusElement.role = "status";
    this.errorElement = document.createElement("p");
    this.errorElement.className = "adressevaelger-error";
    this.errorElement.role = "alert";
    this.errorElement.hidden = true;
    this.wrapperElement.append(this.statusElement, this.errorElement);
    // The caller owns the input, so the combobox semantics have to be applied
    // to it from here. Written with setAttribute rather than the IDL
    // properties: element.ariaControls and element.ariaAutocomplete exist in no
    // engine (measured on chromium, webkit and firefox), so assigning to them
    // sets a plain JavaScript property and never reaches the accessibility
    // tree.
    this.inputElement.setAttribute("role", "combobox");
    this.inputElement.setAttribute("aria-autocomplete", "list");
    this.inputElement.setAttribute("aria-controls", this.listId);
    this.inputElement.setAttribute("aria-expanded", "false");
    // Without this the browser opens its own history dropdown over the
    // suggestions, and takes the keys meant for them: in firefox, once the
    // field has been submitted in a form, Enter is consumed by that dropdown
    // and never reaches the listbox. Set unconditionally, as
    // dawa-autocomplete2 did on the caller's input, so that a site following
    // the migration guide does not lose the behaviour it already had.
    this.inputElement.setAttribute("autocomplete", "off");
    const { signal } = this.abortController;
    this.inputElement.addEventListener("input", this.inputHandler.bind(this), {
      signal,
    });
    this.wrapperElement.addEventListener(
      "keydown",
      this.listKeyHandler.bind(this),
      { signal },
    );
    this.wrapperElement.addEventListener(
      "focusout",
      this.focusOutHandler.bind(this),
      { signal },
    );
    document.addEventListener("click", this.outsideClickHandler.bind(this), {
      signal,
    });
    const opt = this.options.apiUrl
      ? { token: options.token, apiUrl: this.options.apiUrl }
      : { token: options.token };
    this.api = new AdresseSearchAPI(opt);
    this.wasConnected = this.inputElement.isConnected;
    releaseOnDetach(this);
  }

  /**
   * Remove every listener, cancel any pending search and drop the suggestion
   * list. Called automatically when the input leaves the document, and safe to
   * call again.
   */
  destroy() {
    this.abortController.abort();
    this.cancelSearch();
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    // Before the list goes: the input is the caller's, and it would be left
    // claiming to be expanded around an element that no longer exists.
    this.closeList();
    this.listElement.remove();
    this.statusElement.remove();
    this.errorElement.remove();
    stopWatching(this);
  }

  inputHandler(event) {
    // What was typed before this keystroke is no longer what to search for, an
    // emptied field included. Left running, the timer fires half a second from
    // now and searches for whatever the field holds then — which, after a
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
    this.debounceTimer = setTimeout(() => this.refreshList(query), 500);
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

  async refreshList(queryText) {
    const signal = this.startSearch();
    try {
      const data = await this.api.search(
        this.searchType,
        queryText,
        this.options,
        { signal },
      );
      // A response can arrive after it stopped being the one we wanted: the
      // user typed another character, or picked an address. The abort covers
      // the request; this covers the moment between it resolving and getting
      // here.
      if (signal.aborted) {
        return;
      }
      this.renderDOMList(this.listElement, data);
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

  renderDOMList(parentElement, items) {
    // A search that returns anything at all clears a failure the user was
    // shown for the last one.
    this.clearError();
    // A search with no hits used to append an empty list, which drew an empty
    // box and left the combobox pointing at a popup with nothing in it.
    if (items.length === 0) {
      this.closeList();
      this.announce(texts.noResults);
      return;
    }
    this.announce(texts.results(items.length));
    const ulEl = document.createElement("ul");
    ulEl.id = this.listId;
    ulEl.className = "adressevaelger-suggestions";
    ulEl.role = "listbox";
    ulEl.ariaLabel = "Søgeresultater";
    // Firefox puts scrollable containers in the tab order on their own, so the
    // list would become a tab stop as soon as it has a height to scroll within.
    // An explicit -1 keeps it reachable by script and out of the tab sequence.
    ulEl.tabIndex = -1;
    // Pressing the mouse on an option would otherwise take focus off the
    // input, collapsing the list before the click that selects had landed.
    ulEl.addEventListener("mousedown", (event) => event.preventDefault());
    items.forEach((item, index) => {
      this.renderDOMListItem(ulEl, item, index);
    });
    parentElement.querySelector("ul")?.remove();
    parentElement.append(ulEl);
    this.activeIndex = -1;
    this.inputElement.removeAttribute("aria-activedescendant");
    this.inputElement.setAttribute("aria-expanded", "true");
  }

  renderDOMListItem(parentElement, item, index) {
    const liEl = document.createElement("li");
    liEl.id = `${this.listId}-option-${index}`;
    liEl.className = "adressevaelger-suggestion";
    liEl.role = "option";
    // Suggestions are moved through with the arrow keys, not with Tab: a search
    // returns up to 100 of them, and at tabindex="0" every one is a tab stop
    // between the field and the next control.
    liEl.tabIndex = -1;
    liEl.dataset.item = JSON.stringify(item);
    liEl.addEventListener("click", (event) => {
      this.selectProcessor(JSON.parse(event.target.dataset.item));
    });
    liEl.innerText = item.titel;
    parentElement.append(liEl);
  }

  /** Say something through the polite live region. */
  announce(message) {
    this.statusElement.textContent = message;
  }

  /** Put a failure on screen, and in front of a screen reader. */
  showError(message) {
    this.errorElement.textContent = message;
    this.errorElement.hidden = false;
    // A failure and a result count at the same time would talk over each
    // other, and the count is the stale one.
    this.statusElement.textContent = "";
  }

  clearError() {
    this.errorElement.textContent = "";
    this.errorElement.hidden = true;
  }

  errorHandler(err) {
    console.error(err);
    // The user gets a sentence they can act on; the detail stays in the event
    // and the console for whoever is debugging.
    this.showError(texts.searchFailed);
    this.inputElement.dispatchEvent(
      new CustomEvent("address:error", {
        bubbles: true,
        composed: true,
        detail: { message: err.message },
      }),
    );
  }

  /**
   * Navigation runs on keydown. On keyup it ignored auto-repeat, so holding an
   * arrow key moved exactly one option out of a hundred, and it was too late
   * to cancel what these keys do by default — the caret jumping to the end of
   * the text, an <input type="search"> emptying itself on Escape, and an
   * enclosing <form> submitting on Enter.
   *
   * Each default is only cancelled where the key is the component's: with a
   * list open, or with an option active. Enter with nothing active still
   * submits the form, and Escape with no list still reaches the field and any
   * dialog around it.
   */
  listKeyHandler(event) {
    const isOpen = this.optionElements().length > 0;
    if (event.key === "ArrowDown") {
      if (!isOpen) {
        return;
      }
      event.preventDefault();
      this.moveActive(1);
    } else if (event.key === "ArrowUp") {
      if (!isOpen) {
        return;
      }
      event.preventDefault();
      this.moveActive(-1);
    } else if (event.key === "Enter") {
      const active = this.optionElements()[this.activeIndex];
      if (active) {
        event.preventDefault();
        this.selectProcessor(JSON.parse(active.dataset.item));
      }
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
      }
      this.closeList();
    }
  }

  /**
   * Close when focus leaves the component. Options cannot take focus — the
   * list cancels mousedown and none of it is tabbable — so this fires when the
   * user tabs or clicks away, and not while they are working in the list.
   */
  focusOutHandler(event) {
    if (!this.wrapperElement.contains(event.relatedTarget)) {
      this.closeList();
    }
  }

  outsideClickHandler(event) {
    if (!this.wrapperElement.contains(event.target)) {
      this.closeList();
    }
  }

  /** The rendered options, in order; empty when the list is closed. */
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
    if (active) {
      this.inputElement.setAttribute("aria-activedescendant", active.id);
      // Nothing in the list is focused any more, so the list will not scroll
      // itself to keep up with the arrow keys.
      active.scrollIntoView({ block: "nearest" });
    } else {
      this.inputElement.removeAttribute("aria-activedescendant");
    }
  }

  /** Drop the suggestions and report the combobox as collapsed. */
  closeList() {
    this.listElement.querySelector("ul")?.remove();
    this.activeIndex = -1;
    this.inputElement.removeAttribute("aria-activedescendant");
    this.inputElement.setAttribute("aria-expanded", "false");
  }

  /**
   * Move the active option one step. What was typed is part of the ring, at
   * -1: arrowing past either end of the list comes back to it, which is where
   * arrowing up off the first option used to return DOM focus.
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

  selectProcessor(item) {
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
      this.refreshList(item.titel);
    } else {
      this.closeList();
      this.selectItem(item);
    }
  }

  async selectItem(item) {
    try {
      const data = await this.api.get(this.searchType, item.id);
      this.inputElement.value = item.titel;
      this.inputElement.dispatchEvent(
        new CustomEvent("address:select", {
          bubbles: true,
          composed: true,
          detail: data,
        }),
      );
      this.options.select(data);
    } catch (err) {
      this.errorHandler(new Error(`Failed to fetch items: ${err.message}`));
    }
  }
}
