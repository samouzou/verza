import assert from "node:assert/strict";
import {
  ensureStoredEmailHtml,
  looksLikeEmailHtml,
  plaintextToEmailHtml,
} from "../src/lib/emailHtml.js";

assert.equal(looksLikeEmailHtml("Hi there"), false);
assert.equal(looksLikeEmailHtml("<p>Hi there</p>"), true);

const fromPlain = plaintextToEmailHtml("Hi Alex,\n\nLoved your latest video.");
assert.equal(fromPlain, "<p>Hi Alex,</p><p>Loved your latest video.</p>");
assert.equal(looksLikeEmailHtml(fromPlain), true);

const converted = ensureStoredEmailHtml("Hello\n\nSecond paragraph");
assert.match(converted, /<p>Hello<\/p>/);
assert.match(converted, /<p>Second paragraph<\/p>/);

const alreadyHtml = ensureStoredEmailHtml("<p>Hi <strong>Alex</strong></p>");
assert.equal(alreadyHtml, "<p>Hi <strong>Alex</strong></p>");

const fenced = ensureStoredEmailHtml("```html\n<p>From an agent</p>\n```");
assert.equal(fenced, "<p>From an agent</p>");

const strippedScript = ensureStoredEmailHtml('<p>Hi</p><script>alert(1)</script>');
assert.equal(strippedScript.includes("script"), false);
assert.match(strippedScript, /<p>Hi<\/p>/);

const badLink = ensureStoredEmailHtml('<p><a href="javascript:alert(1)">x</a>ok</p>');
assert.equal(badLink.includes("javascript"), false);

assert.equal(ensureStoredEmailHtml("   "), "");

console.log("email HTML unit checks passed");
