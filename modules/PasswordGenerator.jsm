// -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["PasswordGenerator"];

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");

let debug = Cu.import("resource://gre/modules/AndroidLog.jsm", {}).AndroidLog.d.bind(null, "PasswordGenerator");

/*
 * TODO: Deal with other options:
 *       - Use a better random generator?
 *       - Deal with ambiguous characters like 'Oo0' or 'il1' ?
 */

var PasswordGenerator = {
  characterSets: function characterSets(options) {
    return _characterSets(options);
  },

  domainHash: function domainHash(master, domain, options) {
    return _domainHash(master, domain, options);
  }
};

// Returns a random character from a string
function getRandomChar(string) {
  return string[Math.floor(Math.random() * string.length)];
}

// Returns the MD5 hash of a string.
function computeHash(string) {
  let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Ci.nsIScriptableUnicodeConverter);
  converter.charset = "UTF-8";

  // Data is an array of bytes.
  let result = {};
  let data = converter.convertToByteArray(string, result);

  let hasher = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
  hasher.init(hasher.MD5);
  hasher.update(data, data.length);

  // We're passing true to get the base64 hash and not binary.
  return hasher.finish(true);
}

// Returns a password based on randomizing different character sets.
function _characterSets(options) {
  // Subset minimums can't exceed the desired password length.
  if ((options.digit + options.uppercase + options.symbol) > options.length) {
    debug("Invalid request");
    return null;
  }

  // Create a set of character we can use as candidates for the password.
  let CharacterSets = {
    uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lowercase: "abcdefghijklmnopqrstuvwxyz",
    digits: "1234567890",
    symbol: "!@#$%^&*()+=<>|"
  }

  // Remove unwanted characters from candidate sets.
  if (options.exclude) {
    let exclude = new RegExp("[" + options.exclude.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "]", "gi");
    CharacterSets.uppercase = CharacterSets.uppercase.replace(exclude, "");
    CharacterSets.lowercase = CharacterSets.lowercase.replace(exclude, "");
    CharacterSets.digits = CharacterSets.digits.replace(exclude, "");
    CharacterSets.symbol = CharacterSets.symbol.replace(exclude, "");
  }

  // Initial password is built from random lowercase letters.
  let password = [];
  for (let i = 0; i < options.length; ++i) {
    password.push(getRandomChar(CharacterSets.lowercase));
  }

  // For each additional type of character, push a list of candidates for replacement operations.
  let replacements = [];
  for (let i = 0; i < options.uppercase; ++i) {
    replacements.push(CharacterSets.uppercase);
  }
  for (let i = 0; i < options.digit; ++i) {
    replacements.push(CharacterSets.digits);
  }
  for (let i = 0; i < options.symbol; ++i) {
    replacements.push(CharacterSets.symbol);
  }

  // Remember which indexes in the password have been replaced.
  let replaced = {};

  // Perform the replacement operations.
  while (replacements.length > 0) {
    let index;
    do {
      index = Math.floor(Math.random() * password.length);
    } while (index in replaced);

    // Found an index that has not already been changed.
    replaced[index] = true;
    let set = replacements.pop();
    password[index] = getRandomChar(set);
  }

  // Do a final truncate
  return password.join("").substring(0, options.length);
}

// Returns a password based on the SuperGenPass method
function _domainHash(master, domain, options) {
  function check(pwd) {
    // 1. Password must start with a lowercase letter [a-z].
    // 2. Password must contain at least one uppercase letter [A-Z].
    // 3. Password must contain at least one numeral [0-9].
    let lowerStart = pwd.search(/[a-z]/) === 0;
    let hasDigits = pwd.search(/[0-9]/) > 0;
    let hasUpper = pwd.search(/[A-Z]/) > 0;
    return lowerStart && hasDigits && hasUpper;
  }

  let password = master + ":" + domain;

  let i = 0;
  while (i < 10 || !check(password.substring(0, options.length))) {
    password = computeHash(password);

    // Replace non-alphanumeric characters and padding in the Base-64 alphabet to
    // comply with most password policies.
    password.replace(/\+/g, "9").replace(/\//g, "8").replace(/\=/g, "A");

    i++;
    if (i > 1000) {
      debug("Too many iterations");
      return null;
    }
  }

  // Do a final truncate
  return password.substring(0, options.length);
}
