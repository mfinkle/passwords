/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let Ci = Components.interfaces, Cc = Components.classes, Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm")
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("chrome://passwords/content/PasswordStrength.jsm");

let debug = Cu.import("resource://gre/modules/AndroidLog.jsm", {}).AndroidLog.d.bind(null, "PasswordAudit");

const AMO_ICON = "chrome://browser/skin/images/amo-logo.png";

function init() {
  Passwords.init();
}


function uninit() {
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

    let hostPart = document.createElement("div");
    hostPart.textContent = login.hostname;
    hostPart.className = "hostname";
    details.appendChild(hostPart);

    let realmPart = document.createElement("div");
    realmPart.textContent = login.httpRealm;
    realmPart.className = "realm";
    details.appendChild(realmPart);

    let userPart = document.createElement("div");
    userPart.textContent = login.username;
    userPart.className = "username";
    inner.appendChild(userPart);

    outer.appendChild(inner);
    return outer;
  },

  _createItemForAudit: function _createItemForAudit(audit) {
    let item = this._createItem(audit.login);
    item.login = audit.login;
    item.result = audit.result;

    let summary = document.createElement("div");
    summary.className = "summary";

    let summaryHTML = "<div class='summary-row'>Score: " + audit.result.score + "</div>";

    let matches = audit.result.match_sequence;
    for (let match of matches) {
      let row = "<div class='summary-row'>";
      if (match.pattern == "dictionary") {
        if (match.dictionary_name == "user_inputs") {
          row += "Part is from host domain";
        } else if (match.dictionary_name == "passwords") {
          row += "Part is a common passwords";
        } else if (match.dictionary_name == "english") {
          row += "Part is a common english word";
        }
      }

      if (match.pattern == "year") {
        row += "Part is a recent year";
      }

      if (match.pattern == "repeat") {
        row += "Part is repeating letters or numbers";
      }

      if (match.pattern == "date") {
        row += "Part is a date";
      }

      if (match.pattern == "sequence") {
        row += "Part is a sequence of letters or numbers";
      }
      row += "</div>";
      summaryHTML += row;
    }
    summary.innerHTML = summaryHTML;
    item.querySelector(".inner").appendChild(summary);

    return item;
  },

  _createItemForAge: function _createItemForAge(result) {
    let item = this._createItem(result.login);
    item.login = result.login;
    item.age = result.age;

    let summary = document.createElement("div");
    summary.className = "summary";

    let summaryHTML = "<div class='summary-row'>Age: " + result.age + " days</div>";
    summary.innerHTML = summaryHTML;
    item.querySelector(".inner").appendChild(summary);

    return item;
  },

  _createItemForDup: function _createItemForDup(login, group) {
    let item = this._createItem(login);
    item.login = login;
    item.group = group;

    let summary = document.createElement("div");
    summary.className = "summary";

    let summaryHTML = "<div class='summary-row'>Group: " + group + "</div>";
    summary.innerHTML = summaryHTML;
    item.querySelector(".inner").appendChild(summary);

    return item;
  },

  init: function init() {
    let logins;
    try {
      logins = Services.logins.getAllLogins();
    } catch(e) {
      // Master password was not entered
      debug(e);
      return;
    }

    // Final audit arrays
    let weakLogins = [];
    let oldLogins = [];
    let dupLogins = [];
    let passwords = {};

    logins.forEach(login => {
      // XPCOM foo to get the login to deal with meta info properties.
      login.QueryInterface(Ci.nsILoginMetaInfo);

      // Create a dictionary from the hostname and domain parts.
      let matchedURL = login.hostname.match(/^((?:[a-z]+:\/\/)?(?:[^\/]+@)?)(.+?)(?::\d+)?(?:\/|$)/);
      let userInputs = [];
      if (matchedURL) {
        let [, , domain] = matchedURL;
        userInputs = domain.split(".").filter((part) => part.length > 3);
      }

      let result = PasswordStrength.test(login.password, userInputs);
      if (result.score < 3) {
        weakLogins.push({ login: login, result: result });
      }

      // Look for passwords that have not be updated in over 90 days.
      let lastChanged = new Date(login.timePasswordChanged);
      let days = Math.round((Date.now() - lastChanged) / 1000 / 60 / 60 / 24);
      if (days > 30) {
        oldLogins.push({ login: login, age: days });
      }

      // Use the password set to help discover duplicate passwords, used by multiple logins.
      if (login.password in passwords) {
        passwords[login.password].push(login);
      } else {
        passwords[login.password] = [login];
      }
    });

    // Spin through the set of passwords, looking for multiple logins.
    let groupIndex = 1;
    for (let password in passwords) {
      if (passwords[password].length > 1) {
        // Assign the duplicate a 'group' so we can track the duplicate logins together.
        let group = groupIndex++;
        dupLogins.push({ logins: passwords[password], group: group });
      }
    }

    // Sort the weak logins
    weakLogins.sort(function(a, b) {
      if (a.result.score > b.result.score) {
        return 1;
      }
      if (a.result.score < b.result.score) {
        return -1;
      }
      return 0;
    });

    // Sort the old logins
    oldLogins.sort(function(a, b) {
      if (a.age > b.age) {
        return 1;
      }
      if (a.age < b.age) {
        return -1;
      }
      return 0;
    });

    // Clear all content before filling the logins
    document.querySelector("#weak-header > div > .count").textContent = weakLogins.length;
    let weakList = document.getElementById("weak-list");
    weakList.innerHTML = "";
    for (let audit of weakLogins) {
      let item = this._createItemForAudit(audit);
      weakList.appendChild(item);
    }

    // Clear all content before filling the logins
    document.querySelector("#dup-header > div > .count").textContent = dupLogins.length;
    let dupList = document.getElementById("dup-list");
    dupList.innerHTML = "";
    for (let result of dupLogins) {
      let logins = result.logins;
      for (let login of logins) {
        let item = this._createItemForDup(login, result.group);
        dupList.appendChild(item);
      }
    }

    // Clear all content before filling the logins
    document.querySelector("#old-header > div > .count").textContent = oldLogins.length;
    let oldList = document.getElementById("old-list");
    oldList.innerHTML = "";
    for (let result of oldLogins) {
      let item = this._createItemForAge(result);
      oldList.appendChild(item);
    }
  }
}

window.addEventListener("load", init, false);
window.addEventListener("unload", uninit, false);
