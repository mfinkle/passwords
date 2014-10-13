/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Ci = Components.interfaces, Cc = Components.classes, Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm")
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("chrome://passwords/content/PasswordStrength.jsm");

let debug = Cu.import("resource://gre/modules/AndroidLog.jsm", {}).AndroidLog.d.bind(null, "PasswordGenerator");

const AMO_ICON = "chrome://browser/skin/images/amo-logo.png";

function copyString(string) {
  try {
    let clipboard = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
    clipboard.copyString(string);
  } catch (e) {}
}

function init() {
  window.addEventListener("popstate", onPopState, false);

  debug("init")
  Passwords.init();
  showList();

  //document.getElementById("header-button").addEventListener("click", openLink, false);
}


function uninit() {
}

function onPopState(aEvent) {
  // Called when back/forward is used to change the state of the page
  if (aEvent.state) {
    // Show the detail page for an addon
    Passwords.showDetails(Passwords._getElementForLogin(aEvent.state.id));
  } else {
    // Clear any previous detail addon
    let detailItem = document.querySelector("#login-details > .login-item");
    detailItem.login = null;

    showList();
  }
}

function showList() {
  // Hide the detail page and show the list
  let details = document.querySelector("#login-details");
  details.style.display = "none";
  let list = document.querySelector("#logins-list");
  list.style.display = "block";
}

var Passwords = {
  _createItem: function _createItem(login) {
    let outer = document.createElement("div");
    outer.setAttribute("loginID", login.guid);
    outer.className = "login-item list-item";
    outer.addEventListener("click", function() {
      this.showDetails(outer);
      history.pushState({ id: login.guid }, document.title);
    }.bind(this), true);

    let img = document.createElement("img");
    img.className = "icon";
    img.setAttribute("src", login.hostname + "/favicon.ico");
    outer.appendChild(img);

    let inner = document.createElement("div");
    inner.className = "inner";

    let details = document.createElement("div");
    details.className = "details";
    inner.appendChild(details);

    let titlePart = document.createElement("div");
    titlePart.textContent = login.hostname;
    titlePart.className = "hostname";
    details.appendChild(titlePart);

    let versionPart = document.createElement("div");
    versionPart.textContent = login.httpRealm;
    versionPart.className = "realm";
    details.appendChild(versionPart);

    let descPart = document.createElement("div");
    descPart.textContent = login.username;
    descPart.className = "username";
    inner.appendChild(descPart);

    outer.appendChild(inner);
    return outer;
  },

  _createItemForLogin: function _createItemForLogin(login) {
    let item = this._createItem(login);
    item.login = login;

    return item;
  },

  _getElementForLogin: function(key) {
    let list = document.getElementById("logins-list");
    let element = list.querySelector("div[loginID=" + key.quote() + "]");
    return element;
  },

  init: function init() {
    let logins;
    try {
      logins = Services.logins.getAllLogins();
    } catch(e) {
      //master password was not entered
      debug(e);
      logins = [];
      return;
    }

    logins.forEach(login => login.QueryInterface(Ci.nsILoginMetaInfo));

    debug("num logins: " + logins.length);
    debug("sorting...")
    logins.sort(function(a, b) {
      return a.hostname.localeCompare(b.hostname);
    });

    // Clear all content before filling the logins
    let list = document.getElementById("logins-list");
    list.innerHTML = "";
    for (let i = 0; i < logins.length; i++) {
      debug("login: " + logins[i].hostname)
      let item = this._createItemForLogin(logins[i]);
      list.appendChild(item);
    }

    document.getElementById("copyusername-btn").addEventListener("click", Passwords.copyUsername.bind(this), false);
    document.getElementById("copypassword-btn").addEventListener("click", Passwords.copyPassword.bind(this), false);
  },

  showDetails: function showDetails(listItem) {
    let detailItem = document.querySelector("#login-details > .login-item");
    let login = detailItem.login = listItem.login;

    let favicon = document.querySelector("#login-details > .login-item .icon");
    favicon.setAttribute("src", login.hostname + "/favicon.ico");

    detailItem.querySelector(".hostname").textContent = login.hostname;
    detailItem.querySelector(".realm").textContent = login.httpRealm;
    detailItem.querySelector(".username").textContent = login.username;

    let matchedURL = login.hostname.match(/^((?:[a-z]+:\/\/)?(?:[^\/]+@)?)(.+?)(?::\d+)?(?:\/|$)/);
    let userInputs = [];
    if (matchedURL) {
      let [, , domain] = matchedURL;
      userInputs = domain.split(".").filter((part) => part.length > 3);
    }

    detailItem.querySelector(".password-score").textContent = "Score: " + PasswordStrength.test(login.password, userInputs).score;

    let lastChanged = new Date(login.timePasswordChanged);
    let days = Math.round((Date.now() - lastChanged) / 1000 / 60 / 60/ 24);

    detailItem.querySelector(".password-age").textContent = "Age: " + days + " days";

    let list = document.querySelector("#logins-list");
    list.style.display = "none";
    let details = document.querySelector("#login-details");
    details.style.display = "block";
  },

  copyUsername: function copyUsername() {
    let detailItem = document.querySelector("#login-details > .login-item");
    let login = detailItem.login;
    if (!login) {
      return;
    }
    copyString(login.username);
  },

  copyPassword: function copyPassword() {
    let detailItem = document.querySelector("#login-details > .login-item");
    let login = detailItem.login;
    if (!login) {
      return;
    }
    copyString(login.password);
  }
}

window.addEventListener("load", init, false);
window.addEventListener("unload", uninit, false);
