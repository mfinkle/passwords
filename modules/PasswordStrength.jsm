// -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["PasswordStrength"];

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

let debug = Cu.import("resource://gre/modules/AndroidLog.jsm", {}).AndroidLog.d.bind(null, "PasswordStrength");

/*
 * Mostly a port of zxcvbn
 * https://github.com/dropbox/zxcvbn
 */

var PasswordStrength = {
  test: function(password, userInputs) {
    return zxcvbn(password, userInputs);
  }
};


// Lazily-loaded dictionary scripts:
[
  ["passwords_list", "chrome://passwords/content/common_passwords.js"],
  ["english_list", "chrome://passwords/content/common_english.js"],
].forEach((entry) => {
  let [name, script] = entry;
  XPCOMUtils.defineLazyGetter(this, name, function() {
    let sandbox = {};
    Services.scriptloader.loadSubScript(script, sandbox);
    return sandbox[name];
  });
});

/*
 * =============================================================================
 * Code from matching.js
 * =============================================================================
 */

function empty(obj) {
  let results = [];
  for (let k in obj) {
    results.push(k);
  }
  return results.length === 0;
}

function extend(lst, lst2) {
  return lst.push.apply(lst, lst2);
}

function translate(string, chr_map) {
  let results = [];
  for (let chr of string.split("")) {
    results.push(chr_map[chr] || chr);
  }
  return results.join("");
}

// -----------------------------------------------------------------------------
// omnimatch -- combine everything ---------------------------------------------
// -----------------------------------------------------------------------------

function omnimatch(password, matchers) {
  let matches = [];
  for (let matcher of matchers) {
    extend(matches, matcher(password));
  }
  return matches.sort(function(match1, match2) {
    return (match1.i - match2.i) || (match1.j - match2.j);
  });
}

// -----------------------------------------------------------------------------
// dictionary match (common passwords, english, last names, etc) ---------------
// -----------------------------------------------------------------------------

function dictionary_match(password, ranked_dict) {
  let result = [];
  let len = password.length;
  let password_lower = password.toLowerCase();
  for (let i = 0; i < len; ++i) {
    for (let j = i; j < len; ++j) {
      let word = password_lower.slice(i, j + 1);
      if (word in ranked_dict) {
        let rank = ranked_dict[word];
        result.push({
          pattern: "dictionary",
          i: i,
          j: j,
          token: password.slice(i, j + 1),
          matched_word: word,
          rank: rank
        });
      }
    }
  }
  return result;
}

function build_ranked_dict(unranked_list) {
  let result = {};
  let i = 1;
  for (let word of unranked_list) {
    result[word] = i;
    i += 1;
  }
  return result;
}

function build_dict_matcher(dict_name, ranked_dict) {
  return function(password) {
    let matches = dictionary_match(password, ranked_dict);
    for (let match of matches) {
      match.dictionary_name = dict_name;
    }
    return matches;
  };
}

// -----------------------------------------------------------------------------
// repeats (aaa) and sequences (abcdef) ----------------------------------------
// -----------------------------------------------------------------------------

function repeat_match(password) {
  let result = [];
  let i = 0;
  while (i < password.length) {
    let j = i + 1;
    while (true) {
      let [prev_char, cur_char] = password.slice(j - 1, j + 1)
      if (password.charAt(j - 1) === password.charAt(j)) {
        j += 1;
      } else {
        // don't consider length 1 or 2 chains.
        if (j - i > 2) {
          result.push({
            pattern: "repeat",
            i: i,
            j: j - 1,
            token: password.slice(i, j),
            repeated_char: password.charAt(i)
          });
        }
        break;
      }
    }
    i = j;
  }
  return result;
}

var SEQUENCES = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "01234567890"
};

function sequence_match(password) {
  let result = [];
  let i = 0;
  while (i < password.length) {
    let j = i + 1;
    let seq = null; // either lower, upper, or digits
    let seq_name;
    let seq_direction; //1 for ascending seq abcd, -1 for dcba
    for (let seq_candidate_name in SEQUENCES) {
      let seq_candidate = SEQUENCES[seq_candidate_name];
      let i_n = seq_candidate.indexOf(password.charAt(i));
      let j_n = seq_candidate.indexOf(password.charAt(j));
      if (i_n > -1 && j_n > -1) {
        let direction = j_n - i_n;
        if (direction === 1 || direction === (-1)) {
          seq = seq_candidate;
          seq_name = seq_candidate_name;
          seq_direction = direction;
          break;
        }
      }
    }
    if (seq) {
      while (true) {
        let [prev_char, cur_char] = password.slice(j - 1, j + 1);
        let prev_n = seq.indexOf(prev_char);
        let cur_n = seq.indexOf(cur_char);
        if (cur_n - prev_n === seq_direction) {
          j += 1;
        } else {
          if (j - i > 2) {
            // don't consider length 1 or 2 chains.
            result.push({
              pattern: "sequence",
              i: i,
              j: j - 1,
              token: password.slice(i, j),
              sequence_name: seq_name,
              sequence_space: seq.length,
              ascending: seq_direction === 1
            });
          }
          break;
        }
      }
    }
    i = j;
  }
  return result;
}

// -----------------------------------------------------------------------------
// digits, years, dates --------------------------------------------------------
// -----------------------------------------------------------------------------

function findall(password, rx) {
  let matches = [];
  while (true) {
    let match = password.match(rx);
    if (!match) {
      break;
    }
    match.i = match.index;
    match.j = match.index + match[0].length - 1;
    matches.push(match);
    password = password.replace(match[0], " ".repeat(match[0].length));
  }
  return matches;
}

var digits_rx = /\d{3,}/;

function digits_match(password) {
  let results = [];
  let matches = findall(password, digits_rx);
  for (let match of matches) {
    results.push({
      pattern: "digits",
      i: match.i,
      j: match.j,
      token: password.slice(match.i, match.j + 1)
    });
  }
  return results;
}

// 4-digit years only. 2-digit years have the same entropy as 2-digit brute force.
var year_rx = /19\d\d|200\d|201\d/;

function year_match(password) {
  let results = [];
  let matches = findall(password, year_rx);
  for (let match of matches) {
    results.push({
      pattern: "year",
      i: match.i,
      j: match.j,
      token: password.slice(match.i, match.j + 1)
    });
  }
  return results;
}

function date_match(password) {
  // match dates with separators 1/1/1911 and dates without 111997
  return date_without_sep_match(password).concat(date_sep_match(password));
}

function date_without_sep_match(password) {
  let date_matches = [];
  // 1197 is length-4, 01011997 is length 8
  for (let digit_match of findall(password, /\d{4,8}/)) {
    let [i, j] = [digit_match.i, digit_match.j];
    let token = password.slice(i, j + 1);
    let end = token.length;

    // parse year alternatives
    let candidates_round_1 = [];
    if (token.length <= 6) {
      // 2-digit year prefix
      candidates_round_1.push({
        daymonth: token.slice(2),
        year: token.slice(0, 2),
        i: i,
        j: j
      });
      // 2-digit year suffix
      candidates_round_1.push({
        daymonth: token.slice(0, end - 2),
        year: token.slice(end - 2),
        i: i,
        j: j
      });
    }
    if (token.length >= 6) {
      // 4-digit year prefix
      candidates_round_1.push({
        daymonth: token.slice(4),
        year: token.slice(0, 4),
        i: i,
        j: j
      });
      // 4-digit year suffix
      candidates_round_1.push({
        daymonth: token.slice(0, end - 4),
        year: token.slice(end - 4),
        i: i,
        j: j
      });
    }

    // parse day/month alternatives
    let candidates_round_2 = [];
    for (let candidate of candidates_round_1) {
      switch (candidate.daymonth.length) {
        case 2:
          // ex. 1 1 97
          candidates_round_2.push({
            day: candidate.daymonth[0],
            month: candidate.daymonth[1],
            year: candidate.year,
            i: candidate.i,
            j: candidate.j
          });
          break;
        case 3:
          // ex. 11 1 97 or 1 11 97
          candidates_round_2.push({
            day: candidate.daymonth.slice(0, 2),
            month: candidate.daymonth[2],
            year: candidate.year,
            i: candidate.i,
            j: candidate.j
          });
          candidates_round_2.push({
            day: candidate.daymonth[0],
            month: candidate.daymonth.slice(1, 3),
            year: candidate.year,
            i: candidate.i,
            j: candidate.j
          });
          break;
        case 4:
          // ex. 11 11 97
          candidates_round_2.push({
            day: candidate.daymonth.slice(0, 2),
            month: candidate.daymonth.slice(2, 4),
            year: candidate.year,
            i: candidate.i,
            j: candidate.j
          });
      }
    }

    // final loop: reject invalid dates
    for (let candidate of candidates_round_2) {
      let [valid, [day, month, year]] = check_date(parseInt(candidate.day), parseInt(candidate.month), parseInt(candidate.year));
      if (!valid) {
        continue;
      }
      date_matches.push({
        pattern: "date",
        i: candidate.i,
        j: candidate.j,
        token: password.slice(i, j + 1),
        separator: "",
        day: day,
        month: month,
        year: year
      });
    }
  }
  return date_matches;
}

var date_rx_year_suffix = /(\d{1,2})(\s|-|\/|\\|_|\.)(\d{1,2})\2(19\d{2}|200\d|201\d|\d{2})/;
var date_rx_year_prefix = /(19\d{2}|200\d|201\d|\d{2})(\s|-|\/|\\|_|\.)(\d{1,2})\2(\d{1,2})/;

function date_sep_match(password) {
  let matches = [];
  for (let match of findall(password, date_rx_year_suffix)) {
    [match.day, match.month, match.year] = [1, 3, 4].map((k) => parseInt(match[k]));
    match.sep = match[2];
    matches.push(match);
  }

  for (let match of findall(password, date_rx_year_prefix)) {
    [match.day, match.month, match.year] = [4, 3, 1].map((k) => parseInt(match[k]));
    match.sep = match[2];
    matches.push(match);
  }

  let results = [];
  for (let match of matches) {
    let [valid, [day, month, year]] = check_date(match.day, match.month, match.year);
    if (!valid) {
      continue;
    }
    results.push({
      pattern: "date",
      i: match.i,
      j: match.j,
      token: password.slice(match.i, match.j + 1),
      separator: match.sep,
      day: day,
      month: month,
      year: year
    });
  }
  return results;
}

function check_date(day, month, year) {
  // tolerate both day-month and month-day order
  if ((12 <= month && month <= 31) && day <= 12) {
    [day, month] = [month, day];
  }
  if (day > 31 || month > 12) {
    return [false, []];
  }
  if (!((1900 <= year && year <= 2019))) {
    return [false, []];
  }
  return [true, [day, month, year]];
}

/*
 * =============================================================================
 * Code from scoring.js
 * =============================================================================
 */

function nCk(n, k) {
  // http://blog.plover.com/math/choose.html
  if (k > n) {
    return 0;
  }
  if (k === 0) {
    return 1;
  }
  let r = 1;
  for (let d = 1; d <= k; d++) {
    r *= n;
    r /= d;
    n -= 1;
  }
  return r;
}

function lg(n) {
  return Math.log(n) / Math.log(2);
}

// -----------------------------------------------------------------------------
// minimum entropy search ------------------------------------------------------
// -----------------------------------------------------------------------------
//
// takes a list of overlapping matches, returns the non-overlapping sublist with
// minimum entropy. O(nm) dp alg for length-n password with m candidate matches.
// -----------------------------------------------------------------------------

function minimum_entropy_match_sequence(password, matches) {
  let bruteforce_cardinality = calc_bruteforce_cardinality(password); // e.g. 26 for lowercase
  let up_to_k = []; // minimum entropy up to k.
  let backpointers = []; // for the optimal sequence of matches up to k, holds the final match (match.j == k). null means the sequence ends w/ a brute-force character.

  for (let k = 0, len = password.length; k < len; k++) {
    // starting scenario to try and beat: adding a brute-force character to the minimum entropy sequence at k-1.
    up_to_k[k] = (up_to_k[k - 1] || 0) + lg(bruteforce_cardinality);
    backpointers[k] = null;
    for (let match of matches) {
      if (!(match.j === k)) {
        continue;
      }
      let [i, j] = [match.i, match.j];
      // see if best entropy up to i-1 + entropy of this match is less than the current minimum at j.
      let candidate_entropy = (up_to_k[i - 1] || 0) + calc_entropy(match);
      if (candidate_entropy < up_to_k[j]) {
        up_to_k[j] = candidate_entropy;
        backpointers[j] = match;
      }
    }
  }

  // walk backwards and decode the best sequence
  let match_sequence = [];
  let k = password.length - 1;
  while (k >= 0) {
    let match = backpointers[k];
    if (match) {
      match_sequence.push(match);
      k = match.i - 1;
    } else {
      k -= 1;
    }
  }
  match_sequence.reverse();

  // fill in the blanks between pattern matches with bruteforce "matches"
  // that way the match sequence fully covers the password: match1.j == match2.i - 1 for every adjacent match1, match2.
  function make_bruteforce_match(i, j) {
    return {
      pattern: "bruteforce",
      i: i,
      j: j,
      token: password.slice(i, j + 1),
      entropy: lg(Math.pow(bruteforce_cardinality, j - i + 1)),
      cardinality: bruteforce_cardinality
    };
  }

  k = 0;
  let match_sequence_copy = [];
  for (let match of match_sequence) {
    let [i, j] = [match.i, match.j];
    if (i - k > 0) {
      match_sequence_copy.push(make_bruteforce_match(k, i - 1));
    }
    k = j + 1;
    match_sequence_copy.push(match);
  }

  if (k < password.length) {
    match_sequence_copy.push(make_bruteforce_match(k, password.length - 1));
  }

  match_sequence = match_sequence_copy;
  let min_entropy = up_to_k[password.length - 1] || 0; // or 0 corner case is for an empty password ''
  let crack_time = entropy_to_crack_time(min_entropy);

  // final result object
  return {
    password: password,
    entropy: round_to_x_digits(min_entropy, 3),
    match_sequence: match_sequence,
    crack_time: round_to_x_digits(crack_time, 3),
    crack_time_display: display_time(crack_time),
    score: crack_time_to_score(crack_time)
  };
}

function round_to_x_digits(n, x) {
  return Math.round(n * Math.pow(10, x)) / Math.pow(10, x);
}

// -----------------------------------------------------------------------------
// threat model -- stolen hash catastrophe scenario ----------------------------
// -----------------------------------------------------------------------------
//
// assumes:
// * passwords are stored as salted hashes, different random salt per user.
//   (making rainbow attacks infeasable.)
// * hashes and salts were stolen. attacker is guessing passwords at max rate.
// * attacker has several CPUs at their disposal.
// -----------------------------------------------------------------------------

// for a hash function like bcrypt/scrypt/PBKDF2, 10ms per guess is a safe lower bound.
// (usually a guess would take longer -- this assumes fast hardware and a small work factor.)
// adjust for your site accordingly if you use another hash function, possibly by
// several orders of magnitude!
var SINGLE_GUESS = .010;
var NUM_ATTACKERS = 100; // number of cores guessing in parallel.
var SECONDS_PER_GUESS = SINGLE_GUESS / NUM_ATTACKERS;

function entropy_to_crack_time(entropy) {
  // average, not total
  return .5 * Math.pow(2, entropy) * SECONDS_PER_GUESS;
}

function crack_time_to_score(seconds) {
  if (seconds < Math.pow(10, 2)) {
    return 0;
  }
  if (seconds < Math.pow(10, 4)) {
    return 1;
  }
  if (seconds < Math.pow(10, 6)) {
    return 2;
  }
  if (seconds < Math.pow(10, 8)) {
    return 3;
  }
  return 4;
}

// -----------------------------------------------------------------------------
// entropy calcs -- one function per match pattern -----------------------------
// -----------------------------------------------------------------------------

function calc_entropy(match) {
  if (match.entropy != null) {
    // a match's entropy doesn't change. cache it.
    return match.entropy;
  }

  let entropy_func;
  switch (match.pattern) {
    case "repeat":
      entropy_func = repeat_entropy;
      break;
    case "sequence":
      entropy_func = sequence_entropy;
      break;
    case "digits":
      entropy_func = digits_entropy;
      break;
    case "year":
      entropy_func = year_entropy;
      break;
    case "date":
      entropy_func = date_entropy;
      break;
    case "dictionary":
      entropy_func = dictionary_entropy;
      break;
  }

  if (!entropy_func) {
    return match.entropy = 0;
  }
  return match.entropy = entropy_func(match);
}

function repeat_entropy(match) {
  let cardinality = calc_bruteforce_cardinality(match.token);
  return lg(cardinality * match.token.length);
}

function sequence_entropy(match) {
  let base_entropy;
  let first_chr = match.token.charAt(0);
  if (first_chr === "a" || first_chr === "1") {
    base_entropy = 1;
  } else {
    if (first_chr.match(/\d/)) {
      base_entropy = lg(10); // digits
    } else if (first_chr.match(/[a-z]/)) {
      base_entropy = lg(26); // lower
    } else {
      base_entropy = lg(26) + 1; // extra bit for uppercase
    }
  }
  if (!match.ascending) {
    base_entropy += 1; // extra bit for descending instead of ascending
  }
  return base_entropy + lg(match.token.length);
}

function digits_entropy(match) {
  return lg(Math.pow(10, match.token.length));
}

var NUM_YEARS = 119; // years match against 1900 - 2019
var NUM_MONTHS = 12;
var NUM_DAYS = 31;

function year_entropy(match) {
  return lg(NUM_YEARS);
}

function date_entropy(match) {
  let entropy;
  if (match.year < 100) {
    entropy = lg(NUM_DAYS * NUM_MONTHS * 100); //two-digit year
  } else {
    entropy = lg(NUM_DAYS * NUM_MONTHS * NUM_YEARS); // four-digit year
  }
  if (match.separator) {
    entropy += 2; // add two bits for separator selection [/,-,.,etc]
  }
  return entropy;
}

function dictionary_entropy(match) {
  match.base_entropy = lg(match.rank);
  match.uppercase_entropy = extra_uppercase_entropy(match);
  match.l33t_entropy = extra_l33t_entropy(match);
  return match.base_entropy + match.uppercase_entropy + match.l33t_entropy;
}

var START_UPPER = /^[A-Z][^A-Z]+$/;
var END_UPPER = /^[^A-Z]+[A-Z]$/;
var ALL_UPPER = /^[^a-z]+$/;
var ALL_LOWER = /^[^A-Z]+$/;

function extra_uppercase_entropy(match) {
  let word = match.token;
  if (word.match(ALL_LOWER)) {
    return 0;
  }
  for (let regex of [START_UPPER, END_UPPER, ALL_UPPER]) {
    if (word.match(regex)) {
      return 1;
    }
  }
  let U = word.split("").filter((chr) => chr.match(/[A-Z]/)).length;
  let L = word.split("").filter((chr) => chr.match(/[a-z]/)).length;
  let possibilities = 0;
  for (let i = 0, limit = Math.min(U, L); i <= limit; ++i) {
    possibilities += nCk(U + L, i);
  }
  return lg(possibilities);
}

function extra_l33t_entropy(match) {
  return 0;
}

// -----------------------------------------------------------------------------
// utilities --------------------------------------------------------------------
// -----------------------------------------------------------------------------

function calc_bruteforce_cardinality(password) {
  let [lower, upper, digits, symbols, unicode] = [false, false, false, false, false];
  for (let chr of password.split("")) {
    let ord = chr.charCodeAt(0);
    if ((0x30 <= ord && ord <= 0x39)) {
      digits = true;
    } else if ((0x41 <= ord && ord <= 0x5a)) {
      upper = true;
    } else if ((0x61 <= ord && ord <= 0x7a)) {
      lower = true;
    } else if (ord <= 0x7f) {
      symbols = true;
    } else {
      unicode = true;
    }
  }
  let c = 0;
  if (digits) {
    c += 10;
  }
  if (upper) {
    c += 26;
  }
  if (lower) {
    c += 26;
  }
  if (symbols) {
    c += 33;
  }
  if (unicode) {
    c += 100;
  }
  return c;
}

function display_time(seconds) {
  let minute = 60;
  let hour = minute * 60;
  let day = hour * 24;
  let month = day * 31;
  let year = month * 12;
  let century = year * 100;

  if (seconds < minute) {
    return "instant";
  } else if (seconds < hour) {
    return "" + (1 + Math.ceil(seconds / minute)) + " minutes";
  } else if (seconds < day) {
    return "" + (1 + Math.ceil(seconds / hour)) + " hours";
  } else if (seconds < month) {
    return "" + (1 + Math.ceil(seconds / day)) + " days";
  } else if (seconds < year) {
    return "" + (1 + Math.ceil(seconds / month)) + " months";
  } else if (seconds < century) {
    return "" + (1 + Math.ceil(seconds / year)) + " years";
  } else {
    return "centuries";
  }
}

/*
 * ============================================================================
 * Code from init.js
 * ============================================================================
 */

// initialize matcher lists
var DICTIONARY_MATCHERS = [build_dict_matcher("passwords", build_ranked_dict(passwords_list)), build_dict_matcher("english", build_ranked_dict(english_list))]
var MATCHERS = DICTIONARY_MATCHERS.concat([digits_match, year_match, date_match, repeat_match, sequence_match]);

function time() {
  return (new Date()).getTime();
}

function zxcvbn(password, user_inputs) {
  if (user_inputs == null) {
    user_inputs = [];
  }
  let start = time();
  let matches = omnimatch(password, MATCHERS.concat([
    build_dict_matcher("user_inputs", build_ranked_dict(user_inputs.map(function(input) {
      return input.toLowerCase();
    })))
  ]));
  let result = minimum_entropy_match_sequence(password, matches);
  result.calc_time = time() - start;
  return result;
}
