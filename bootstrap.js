const { classes: Cc, interfaces: Ci, manager: Cm, utils: Cu, results: Cr } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Prompt",
                                  "resource://gre/modules/Prompt.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "PasswordGenerator",
                                  "chrome://passwords/content/PasswordGenerator.jsm");

let debug = Cu.import("resource://gre/modules/AndroidLog.jsm", {}).AndroidLog.d.bind(null, "Passwords");

const PEEK_XHDPI = "data:image/png;base64,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";

function showToast(window, msg) {
  window.NativeWindow.toast.show(msg, "short");
}

function copyString(string) {
  try {
    let clipboard = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
    clipboard.copyString(string);
  } catch (e) {}
}

var NativeUI = {
  menu: {
    root: null,
    generateSets: null,
    generateDomain: null,
    peek: null,
    audit: null
  },

  createUI: function createUI(window) {
    let self = this;
    this.menu.root = window.NativeWindow.menu.add({
      name: "Password Tools",
      parent: window.NativeWindow.menu.toolsMenuID
    });
    this.menu.generateSets = window.NativeWindow.menu.add({
      name: "Generate from Sets",
      callback: function() { self.characterSets(window); },
      parent: this.menu.root
    });
    this.menu.generateDomain = window.NativeWindow.menu.add({
      name: "Generate from Domain",
      callback: function() { self.domainHash(window); },
      parent: this.menu.root
    });
    this.menu.peek = window.NativeWindow.menu.add({
      name: "Peek",
      callback: function() { self.peekPassword(window); },
      parent: this.menu.root
    });
    this.menu.audit = window.NativeWindow.menu.add({
      name: "Audit",
      callback: function() { self.audit(window); },
      parent: this.menu.root
    });

    let filter = {
      matches: function(element) {
        if (element.getAttribute("type").toLowerCase() == "password") {
          return true;
        }
        return false;
      }
    };

    window.SelectionHandler.addAction({
      id: "peek_password_action",
      label: "Peek password",
      icon: PEEK_XHDPI,
      order: 6,
      selector: filter,
      action: element => {
        window.SelectionHandler._closeSelection();
        this.peekPassword(window);
      }
    });

    debug("createUI - done")
  },

  _removeMenu: function _removeMenu(window, id) {
    if (id) {
      window.NativeWindow.menu.remove(id);
    }
  },

  removeUI: function removeUI(window) {
    this._removeMenu(window, this.menu.generateSets);
    this._removeMenu(window, this.menu.generateDomain);
    this._removeMenu(window, this.menu.peek);
    this._removeMenu(window, this.menu.audit);
    this._removeMenu(window, this.menu.root);
  },

  characterSets: function characterSets(window) {
    let prompt = new Prompt({
      title: "Generate from Sets",
      buttons: ["OK", "Cancel", "Copy"]
    });

    prompt.addNumber({ id: "length", hint: "Length", value: 16 })
          .addCheckbox({ id: "digit", label: "Digits", checked: true })
          .addNumber({ id: "digit-min", hint: "# of digits", value: 3 })
          .addCheckbox({ id: "uppercase", label: "Uppercase", checked: true })
          .addNumber({ id: "uppercase-min", hint: "# of uppercase", value: 5 })
          .addCheckbox({ id: "symbol", label: "Symbols", checked: true })
          .addNumber({ id: "symbol-min", hint: "# of symbols", value: 3 })
          .addTextbox({ id: "exclude", hint: "Exclude", value: "" });

    prompt.show(function(response) {
      debug(JSON.stringify(response))
      if (response.button == 1) { /* Cancel */
        return;
      }

      let options = {
        length: parseInt(response.length, 10),
        digit: response.digit ? parseInt(response["digit-min"], 10) : 0,
        uppercase: response.uppercase ? parseInt(response["uppercase-min"], 10) : 0,
        symbol: response.symbol ? parseInt(response["symbol-min"], 10) : 0,
        exclude: response.exclude,
      }
      let password = PasswordGenerator.characterSets(options);
      debug("password: " + password);
      if (!password) {
        showToast(window, "Failed to generate password");
        return;
      }

      if (response.button == 0) {
        let activeElement = window.BrowserApp.getFocusedInput(window.BrowserApp.selectedBrowser, true);
        if (activeElement) {
          activeElement.value = password;
        }
      } else {
        copyString(password);
      }

      showToast(window, "Password generated");
    });
  },

  domainHash: function domainHash(window) {
    let documentURL = window.BrowserApp.selectedBrowser.contentDocument.documentURIObject.spec
    let matchedURL = documentURL.match(/^((?:[a-z]+:\/\/)?(?:[^\/]+@)?)(.+?)(?::\d+)?(?:\/|$)/);
    let baseDomain = "";
    if (matchedURL) {
      let domain = "";
      [, , domain] = matchedURL;
      debug("Domain = " + domain)

      try {
        baseDomain = Services.eTLD.getBaseDomainFromHost(domain);
        if (!domain.endsWith(baseDomain)) {
          // getBaseDomainFromHost converts its resultant to ACE.
          let IDNService = Cc["@mozilla.org/network/idn-service;1"].getService(Ci.nsIIDNService);
          baseDomain = IDNService.convertACEtoUTF8(baseDomain);
        }
      } catch (e) {}
    }

    let prompt = new Prompt({
      title: "Generate from Domain",
      buttons: ["OK", "Cancel", "Copy"]
    });

    prompt.addNumber({ id: "length", hint: "Length", value: 16 })
          .addTextbox({ id: "master", hint: "Master Password", value: "" })
          .addTextbox({ id: "domain", hint: "Domain", value: baseDomain });

    prompt.show(function(response) {
      debug(JSON.stringify(response))
      if (response.button == 1) { /* Cancel */
        return;
      }

      let options = {
        length: parseInt(response.length, 10)
      };
      let password = PasswordGenerator.domainHash(response.master, response.domain, options);
      debug("password: " + password);
      if (!password) {
        showToast(window, "Failed to generate password");
        return;
      }

      if (response.button == 0) {
        let activeElement = window.BrowserApp.getFocusedInput(window.BrowserApp.selectedBrowser, true);
        if (activeElement) {
          activeElement.value = password;
        }
      } else {
        copyString(password);
      }

      showToast(window, "Password generated");
    });
  },

  peekPassword: function peekPassword(window) {
    let activeElement = window.BrowserApp.getFocusedInput(window.BrowserApp.selectedBrowser, true);
    if (!activeElement) {
      return;
    }
    if (activeElement.getAttribute("type").toLowerCase() == "password") {
      activeElement.type = "text";
      window.setTimeout(function() {
        activeElement.type = "password";
      }, 5000);
    }
  },

  audit: function audit(window) {

  }
};


function loadIntoWindow(window) {
  if (!window) {
    return;
  }

  // Setup the UI when we get a window
  NativeUI.createUI(window);
}

function unloadFromWindow(window) {
  if (!window) {
    return;
  }

  // Register to remove the UI on shutdown
  NativeUI.removeUI(window);
}

/**
 * bootstrap.js API
 */

var WindowWatcher = {
  start: function() {
    // Load into any existing windows
    let windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      let window = windows.getNext();
      if (window.document.readyState == "complete") {
        loadIntoWindow(window);
      } else {
        this.waitForLoad(window);
      }
    }

    // Load into any new windows
    Services.ww.registerNotification(this);
  },

  stop: function() {
    // Stop listening for new windows
    Services.ww.unregisterNotification(this);

    // Unload from any existing windows
    let windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      let window = windows.getNext();
      unloadFromWindow(window);
    }
  },

  waitForLoad: function(window) {
    window.addEventListener("load", function onLoad() {
      window.removeEventListener("load", onLoad, false);
      let { documentElement } = window.document;
      if (documentElement.getAttribute("windowtype") == "navigator:browser") {
        loadIntoWindow(window);
      }
    }, false);
  },

  observe: function(subject, topic, data) {
    if (topic == "domwindowopened") {
      this.waitForLoad(subject);
    }
  }
};

function startup(data, reason) {
  WindowWatcher.start();
}

function shutdown(data, reason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (reason == APP_SHUTDOWN) {
    return;
  }

  WindowWatcher.stop();
}

function install(data, reason) {
}

function uninstall(data, reason) {
}
