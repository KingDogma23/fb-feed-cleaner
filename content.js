/**
 * FB Feed Cleaner — content script
 *
 * Facebook injects posts you never asked for into the news feed: suggested
 * posts from pages you don't follow (marked "Follow"), suggested groups
 * ("Join"), and paid placements ("Sponsored" / "Ad"). This removes them.
 *
 * ── Why this works the way it does ──────────────────────────────────────────
 *
 * Earlier versions tried to enumerate posts first (`role="article"`, then
 * `role="feed"` cells) and search inside them. On a real feed both landmarks
 * turned out to be absent: role="feed" matched 0 elements and role="article"
 * matched 2 against dozens of posts. Facebook's class names are obfuscated and
 * change constantly, so there is nothing stable to select a post by.
 *
 * So the search is inverted. Find the *label* — the word "Follow", "Join",
 * "Sponsored" or "Ad", which is the one thing guaranteed to be there — and walk
 * up from it to the block that contains it. Nothing depends on Facebook's
 * markup conventions.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------- config

  /**
   * One rule per checkbox in the popup.
   *
   * `mode` decides how a match is validated, because the labels sit in
   * different places:
   *
   *   header-line — "Follow"/"Join" render inline on the author's own line, as
   *                 a clickable control. Both facts are checked, and together
   *                 they exclude the same words appearing in post text.
   *   header-zone — "Sponsored"/"Ad" render in the meta row *under* the author
   *                 name, are often not clickable, and on some builds are not
   *                 even real text. Only position within the header is checked.
   */
  const RULES = [
    {
      id: "follow",
      setting: "hideFollow",
      labels: ["Follow"],
      mode: "header-line",
      strictable: true,
    },
    {
      id: "join",
      setting: "hideJoin",
      labels: ["Join"],
      mode: "header-line",
      strictable: true,
    },
    {
      // Facebook's own "Suggested for you" line, which sits in the meta row
      // under the author name and is NOT clickable — so the header-line mode
      // used by `follow` can never match it.
      //
      // Added 2026-09-01. Until then this string existed only in
      // SUGGESTED_MARKERS, as the gate for cautious mode, and no rule ever
      // hid anything because of it. A suggested post with no Follow control
      // and no Sponsored label matched nothing and went straight through —
      // confirmed from a live feed, where "Propaganda (Band) | Suggested for
      // you" sat in the unmatched list with the label plainly visible.
      //
      // strictable:false on purpose. Cautious mode exists to hide only posts
      // Facebook itself marks "Suggested for you"; suppressing this rule under
      // it would mean cautious mode hid nothing at all.
      id: "suggested",
      setting: "hideFollow", // the same "Hide suggested posts" checkbox
      counter: "follow", // reported under "suggested posts"
      labels: ["Suggested for you", "Suggested for You", "Suggested post", "Suggested Post"],
      mode: "header-zone",
      strictable: false,
    },
    {
      id: "sponsored",
      setting: "hideSponsored",
      labels: ["Sponsored", "Ad", "Paid partnership", "Suggested Post"],
      mode: "header-zone",
      strictable: false, // an ad is never marked "Suggested for you"
      aria: ["Sponsored", "Ad"], // some builds label the link instead of the text
      byRender: true, // Facebook obfuscates this label; match what it renders
    },
  ];

  const SUGGESTED_MARKERS = [
    "Suggested for you",
    "Suggested for You",
    "Suggested post",
    "Reels and short videos",
    "People you may know",
  ];

  const DEFAULTS = {
    enabled: true,
    hideFollow: true,
    hideJoin: false,
    hideRail: true, // the right-hand "Sponsored" column
    hideSponsored: true,
    // Storage key stays `strict` on purpose: renaming it would silently reset
    // the setting for every existing user. The USER-FACING name is "Cautious
    // mode", changed 2026-09-01 because "Strict" reads as "block harder" and
    // does the exact opposite — it cost an evening hunting a bug that was this
    // checkbox doing precisely what its small print promised.
    strict: false, // also require a "Suggested for you"-style marker
    placeholder: false, // leave a slim bar instead of removing outright
    // On-page status readout. Off by default — it is a diagnostic, not
    // something to put on someone's feed uninvited. Switch it on (or read the
    // popup's Diagnostics box) if filtering ever stops working.
    badge: false,
  };

  // How far down from the top of a post its header reaches, in CSS px. A post
  // header is ~60px; a "Suggested for you" banner above it pushes the author
  // row down to ~90px. 170 covers both with room to spare.
  const HEADER_ZONE_PX = 170;

  // How far the centre of a control may sit from the centre of the author's
  // name and still count as being on the same header row.
  const HEADER_ROW_PX = 26;

  // Nothing this tall is a single post; used to stop the upward walk running
  // away into the whole feed. Floored at an absolute value because
  // window.innerHeight can legitimately read 0 (an unrendered or backgrounded
  // viewport), and a 0-derived cap rejects every element there is.
  const maxPostHeight = () => Math.max(2500, window.innerHeight * 2.5);

  // Text nodes longer than this can't carry a label. Checked before any string
  // work, because this runs over every text node on the page. Generous enough
  // for a packed run: "Sponsored / Paid partnership" is 28 characters, and at
  // the old limit of 20 it was discarded before anything looked at it.
  const MAX_LABEL_LEN = 48;

  // Coalescing window for scans. Kept short: this is the upper bound on how
  // long a suggested post can be visible before it is removed, and anything
  // slower reads as the post flashing up and then vanishing.
  const SCAN_DEBOUNCE_MS = 60;

  // ----------------------------------------------------------------- state

  // From the manifest, so the reported version can never drift from the
  // installed one — this file and manifest.json had already diverged once.
  // A LITERAL, not chrome.runtime.getManifest().
  //
  // getManifest() returns the version of the LOADED extension, not of the code
  // executing. Reload the extension without refreshing the page and this old
  // content script reports the NEW version while running the old logic — the
  // report lies about precisely the thing CLAUDE.md's first gate exists to
  // check. package.sh refuses to build if this disagrees with the manifest.
  const VERSION = "2.6.10";

  /**
   * The build, plus whether this copy is still attached to the extension.
   *
   * VERSION was previously read from chrome.runtime.getManifest(), which
   * returns the version of the LOADED extension rather than of the code
   * executing — so after an extension reload an old content script reports the
   * NEW version while running the old logic, which is precisely the lie the
   * "confirm the running build" gate exists to catch. It is now a literal, and
   * package.sh refuses to build if it disagrees with the manifest.
   *
   * That change did cost something: the old code returned "orphaned" when
   * getManifest() threw, which was a real signal that this copy had lost its
   * extension context. This restores it without restoring the lie — the build
   * is always the truth about the code, and the orphan state is reported
   * alongside it rather than in place of it.
   */
  function buildLabel() {
    return contextAlive() ? VERSION : VERSION + " (orphaned)";
  }

  /**
   * Lifetime totals, persisted to chrome.storage.local.
   *
   * Counts only — no "time saved" figure. Unlike a video ad, a hidden post has
   * no duration to sum, so any minutes number here would be invented. Three
   * real counts beat one plausible fiction.
   */
  const LIFETIME_KEY = "quietLifetime";
  let lifetime = { follow: 0, join: 0, sponsored: 0, since: null };
  // Most posts of each kind hidden at once during THIS page session. Lifetime
  // only ever grows by the amount this exceeds its previous value, which makes
  // re-hiding after unhideAll() free. See hide().
  const sessionPeak = { follow: 0, join: 0, sponsored: 0 };
  let lifetimeDirty = false;

  /**
   * Is this content script still attached to a live extension?
   *
   * Updating or reloading the extension orphans the copy already running in an
   * open tab: chrome.runtime.id goes away and chrome.storage becomes
   * undefined, so anything on a timer keeps throwing until the page is
   * reloaded. Every chrome.* call below is gated on this.
   */
  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id && chrome.storage);
    } catch {
      return false; // touching chrome.runtime can itself throw once orphaned
    }
  }

  function loadLifetime() {
    if (!contextAlive()) return;
    try {
      chrome.storage.local.get({ [LIFETIME_KEY]: null }, (got) => {
        const stored = got && got[LIFETIME_KEY];
        if (stored) lifetime = { ...lifetime, ...stored };
        if (!lifetime.since) {
          lifetime.since = Date.now();
          lifetimeDirty = true;
        }
      });
    } catch {
      /* orphaned between the check and the call */
    }
  }

  const lifetimeTimer = setInterval(() => {
    // Stop the timer outright once orphaned, rather than throwing every 5s for
    // as long as the tab stays open.
    if (!contextAlive()) {
      clearInterval(lifetimeTimer);
      return;
    }
    if (!lifetimeDirty) return;
    lifetimeDirty = false;
    try {
      chrome.storage.local.set({ [LIFETIME_KEY]: lifetime });
    } catch {
      clearInterval(lifetimeTimer);
    }
  }, 5000);

  let settings = { ...DEFAULTS };
  const hidden = new Set(); // elements currently hidden by us
  let sessionCount = 0; // total hides this page load

  // ----------------------------------------------------- self-diagnostics
  // Facebook's markup changes without notice. Rather than fail silently, keep
  // the near-misses and surface them on the badge and in the console.

  const rejections = [];
  let reported = false;

  // Session totals. The per-scan tally cannot answer "has this ever worked?" —
  // with a 1.5s cooldown and a 60ms scan interval, almost every snapshot shows
  // the sweep doing nothing, which reads as broken when it is merely idle.
  const session = { sweeps: 0, sweepMatches: 0, labels: 0, feedCells: 0, scans: 0, samples: [] };

  /**
   * Capture what a post's meta row actually says when the sweep finds no label
   * in it. Six versions of ad detection have been written by inferring this
   * markup; this reads it instead. Text only, truncated, and capped at a few
   * samples — enough to see whether the word is there and in what shape.
   */
  /**
   * Read the word behind an SVG <use> glyph reference.
   *
   * Facebook renders the timestamp/"Sponsored" slot as
   * <svg><use href="#SvgXxx"/></svg>, with the word in a document-level sprite.
   * It has already changed the scheme once — ids went from SvgT* to SvgWml*
   * and plain getElementById lookups stopped resolving — so this tries several
   * routes and REPORTS which one worked, rather than silently finding nothing.
   */
  /** djb2, base36. Short, stable, and good enough to compare drawn shapes. */
  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /**
   * A fingerprint of what a textless sprite actually DRAWS.
   *
   * With no string and no accessible name left, the outline is the only thing
   * that distinguishes "Sponsored" from a timestamp. If Facebook emits the
   * same outline for the same word, every ad on a page shares one hash and no
   * two timestamps do — which is a signal, and cheap to check. Reported only;
   * nothing acts on it yet.
   */
  function glyphShape(def) {
    if (!def) return null;
    const shapes = def.querySelectorAll("path, polygon, rect, circle, ellipse");
    let d = "";
    for (const shape of shapes) {
      d += shape.getAttribute("d") || shape.getAttribute("points") || "";
      if (d.length > 4000) break;
    }
    return { n: shapes.length, len: d.length, hash: hashString(d) };
  }

  /** The id a <use> points at, or "" when it carries no fragment. */
  function refIdOf(use) {
    const raw = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
    return raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : "";
  }

  /** Look an id up, tolerating ids getElementById will not return. */
  function defById(id) {
    let def = null;
    try {
      def = document.getElementById(id);
    } catch {
      /* ids containing characters getElementById dislikes */
    }
    if (def) return def;
    try {
      // Quoted-string escaping, not CSS.escape: identifier escapes do not
      // match inside a quoted attribute selector.
      return document.querySelector(`[id="${id.replace(/["\\]/g, "\\$&")}"]`);
    } catch {
      return null;
    }
  }

  const GLYPH_MAX_HOPS = 6;

  /**
   * Recover the word a glyph reference draws.
   *
   * Facebook CHAINS these references: the meta row holds
   * `<use href="#SvgWml151">`, `#SvgWml151` is an `<svg>` whose only child is
   * another `<use href="#SvgWml152">`, and only `#SvgWml152` is the `<text>`
   * holding the word. Verified live: that chain ends in "Sponsored" on an ad
   * and "23 hours ago" on an ordinary post. Stopping at the first hop finds an
   * empty element and looks exactly like an unreadable glyph, which is what
   * made this look unwinnable.
   *
   * The chain is followed to a bounded depth, with a visited set so a
   * self-referencing sprite cannot spin. Only if it yields nothing do the
   * accessible-name routes run.
   */
  function resolveGlyph(use) {
    const first = refIdOf(use);
    if (!first) return { id: "?", how: "no-fragment", text: "" };

    let id = first;
    let def = null;
    const seen = new Set();

    for (let hop = 0; hop < GLYPH_MAX_HOPS; hop++) {
      if (!id || seen.has(id)) break;
      seen.add(id);

      def = defById(id);
      if (!def) break;

      const text = normalise(def.textContent || "");
      if (text) return { id, how: hop === 0 ? "byId" : `chain+${hop}`, text, def };

      const nested = def.querySelector("use");
      if (!nested) break;
      id = refIdOf(nested);
    }

    // Nothing written anywhere in the chain: fall back to the glyph's
    // accessible name, which is what a screen reader would announce.
    const svg = use.closest("svg");
    if (svg) {
      const label = svg.getAttribute("aria-label");
      if (label) return { id: first, how: "svgAria", text: normalise(label) };

      const by = svg.getAttribute("aria-labelledby");
      if (by) {
        const named = by
          .split(/\s+/)
          .map((ref) => document.getElementById(ref))
          .filter(Boolean)
          .map((n) => n.textContent || "")
          .join(" ");
        const text = normalise(named);
        if (text) return { id: first, how: "svgLabelledBy", text };
      }

      const title = svg.querySelector("title");
      if (title) {
        const text = normalise(title.textContent || "");
        if (text) return { id: first, how: "svgTitle", text };
      }
    }

    const labelled = use.closest("[aria-label]");
    if (labelled) {
      const text = normalise(labelled.getAttribute("aria-label") || "");
      if (text) return { id: first, how: "ancestorAria", text };
    }

    return { id: first, how: def ? "SHAPES-ONLY" : "UNRESOLVED", text: "", def };
  }

  function sampleHeader(card, refTop, band, post) {
    const bits = [];
    for (const el of card.querySelectorAll("*")) {
      if (bits.length >= 12) break;
      const tag = el.tagName.toLowerCase();

      // Collapse SVG subtrees to one entry. Facebook draws avatars as SVG, so
      // their internals (<g>, <image>, <circle>) flooded the sample buffer and
      // the cap landed right before the position where the label sits.
      if (el.closest("svg") && tag !== "svg") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const drop = rect.top - refTop;
      if (drop < -META_ROW_MAX_RISE_PX || drop > band) continue;

      const attr =
        el.getAttribute?.("aria-label") || el.getAttribute?.("alt") || "";

      if (tag === "svg") {
        // What is inside decides everything: <text> carries a string, a bare
        // <use href="#..."> is a glyph reference carrying none — the one form
        // no string matcher can ever hit.
        const use = el.querySelector("use");
        const txt = el.querySelector("text");
        let inner;
        if (txt) {
          inner = `text:"${normalise(txt.textContent).slice(0, 14)}"`;
        } else if (use) {
          const g = resolveGlyph(use);
          if (g.text) {
            inner = `use:${g.id.slice(0, 12)}="${g.text.slice(0, 14)}"(${g.how})`;
          } else {
            // Nothing names it, so the only thing left to report is its shape:
            // how wide the word is painted, and at what type size. "Sponsored"
            // and "4h" are the same mechanism and differ only in that.
            const box = el.getBoundingClientRect();
            const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) || 0);
            const shape = glyphShape(g.def);
            const sig = shape ? ` shape=${shape.n}/${shape.hash}/${shape.len}` : "";
            inner = `use:${g.id.slice(0, 12)}=${g.how} w=${Math.round(box.width)} fs=${fs}${sig}`;
          }
        } else {
          inner = [...el.children].map((c) => c.tagName.toLowerCase()).slice(0, 3).join(",");
        }
        // A glyph svg often carries a name as well as a reference. Report it:
        // printing only the reference is what hid the accessible label from
        // every report so far.
        const named = el.querySelector("title");
        const namedText = named ? normalise(named.textContent || "") : "";
        const by = el.getAttribute("aria-labelledby");
        if (namedText) inner += ` title:"${namedText.slice(0, 14)}"`;
        else if (by) inner += ` labelledby:${by.slice(0, 12)}`;
        bits.push(`<svg${attr ? ` "${attr.slice(0, 16)}"` : ""} ${inner}>`);
        continue;
      }

      if (!["span", "div", "a", "b", "strong", "h1", "h2", "h3", "h4"].includes(tag)) {
        bits.push(`<${tag}${attr ? ` "${attr.slice(0, 16)}"` : ""}>`);
        continue;
      }
      if (attr) bits.push(`<${tag} "${attr.slice(0, 16)}">`);

      const raw = (el.textContent || "").replace(/\s+/g, " ").trim();

      // A container whose children are single letters is the scrambled-label
      // shape: report what it PAINTS, since its stored order is meaningless.
      if (el.children.length) {
        if (el.childElementCount < 4 || el.childElementCount > 40) continue;
        if (raw.replace(INVISIBLES, "").length > 24) continue;
        const painted = renderedText(el, 32);
        if (painted) bits.push(`<${tag} x${el.childElementCount} paints:"${painted.slice(0, 20)}">`);
        continue;
      }

      const shown = visibleText(el);
      if (!raw && !shown) continue;
      bits.push(raw === shown ? raw.slice(0, 24) : `${raw.slice(0, 18)}>${shown.slice(0, 18)}`);
    }
    const marks = [];
    if (post) {
      if (post.querySelector('a[href*="l.facebook.com/l.php"]')) marks.push("outbound");
      if (post.querySelector('[aria-label="Sponsored"], [aria-label="Ad"]')) marks.push("adattr");
      const cta = /^(Sign up|Shop now|Learn more|Download|Book now|Get offer|Install now|Send message|Subscribe|Apply now)$/;
      for (const el of post.querySelectorAll('[role="button"], a[role="link"] span')) {
        if (cta.test(normalise(el.textContent))) { marks.push("cta"); break; }
      }
    }
    const prefix = marks.length ? `[${marks.join(",")}] ` : "";
    return (prefix + bits.join(" | ")).slice(0, 340) || "(nothing in band)";
  }
  let tally = { labels: 0, rejected: 0, reasons: {} };

  function noteRejection(label, why, el) {
    tally.rejected++;
    tally.reasons[why] = (tally.reasons[why] || 0) + 1;
    if (reported || rejections.length >= 25) return;
    rejections.push({ label, why, html: el.outerHTML.slice(0, 90) });
  }

  function report() {
    if (reported) return;
    reported = true;
    if (hidden.size > 0) return; // working — stay quiet
    if (!tally.labels) {
      console.log(
        `[FB Feed Cleaner ${VERSION}] running, but none of the labels it looks for are on the page.`
      );
      return;
    }
    console.log(
      `[FB Feed Cleaner ${VERSION}] found ${tally.labels} label(s), hid none. Why:`
    );
    console.table(rejections);
  }

  /**
   * A small readout pinned to the page. Facebook is the only place this code
   * runs and its markup shifts constantly, so when nothing gets hidden the
   * reason needs to be visible without opening DevTools.
   */
  let badgeEl = null;

  function updateBadge() {
    if (!settings.badge) {
      badgeEl?.remove();
      badgeEl = null;
      return;
    }
    if (!document.body) return;
    if (!badgeEl) {
      badgeEl = document.createElement("div");
      badgeEl.id = "fbfc-badge";
      badgeEl.title = "FB Feed Cleaner status — click to dismiss";
      badgeEl.addEventListener("click", () => {
        badgeEl.remove();
        badgeEl = null;
        settings.badge = false;
      });
      document.body.appendChild(badgeEl);
    }

    let text = `FB Feed Cleaner ${VERSION} · hidden ${hidden.size}`;
    if (!settings.enabled) {
      text += " · switched off";
    } else if (hidden.size === 0) {
      if (!tally.labels) {
        text += ` · none of the labels found on the page`;
      } else {
        const top = Object.entries(tally.reasons).sort((a, b) => b[1] - a[1])[0];
        text += ` · ${tally.labels} labels, all rejected · ${top ? top[0] : "?"}`;
      }
    }
    badgeEl.textContent = text;
    badgeEl.dataset.state = hidden.size || !settings.enabled ? "ok" : "warn";
  }

  // ----------------------------------------------------------------- utils

  // Trimmed from either end of a label.
  const TRIM_CHARS = "\\s\u00b7\u2022\u30fb\\-\u2013\u2014|";
  // Used to split a packed run into segments. Bullets only: hyphens and dashes
  // belong to words ("Ad-hoc meetup" must not yield a segment of "Ad").
  const SPLIT_CHARS = "\u00b7\u2022\u30fb|";

  // Invisible codepoints Facebook embeds INSIDE label text: combining grapheme
  // joiners, zero-width spaces/joiners, soft hyphens, direction marks,
  // variation selectors. The live feed's "Sponsored" arrived as
  // "S\u034Fp\u034Fo\u034Fn..." — it renders as nine plain letters but never
  // string-equals them. CSS-based inspection cannot see these; they can only
  // be stripped from the string itself.
  const INVISIBLES =
    /[\u00AD\u034F\u061C\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFE00-\uFE0F\uFEFF]/g;

  /**
   * Strip invisible codepoints, collapse whitespace, and trim the bullet
   * separators Facebook packs around inline labels — at BOTH ends. Only
   * stripping the leading ones is why "Ad · " never matched "Ad".
   */
  const normalise = (s) =>
    (s || "")
      .replace(INVISIBLES, "")
      .replace(/[\s\u00a0]+/g, " ")
      .replace(new RegExp(`^[${TRIM_CHARS}]+|[${TRIM_CHARS}]+$`, "g"), "")
      .trim();

  /**
   * Does this text carry the rule's label?
   *
   * Facebook packs the label, a separator and a privacy icon into one run of
   * text — "Ad \u00b7 \ud83c\udf10" — so the first segment counts as a match too.
   */
  function matchesLabel(rule, text) {
    if (!text) return null;
    if (rule.labels.includes(text)) return text;
    // Any bullet-delimited segment counts, not just the first: the label can
    // sit mid-run ("Marie Curie UK · Sponsored · 4h"). Segments keep word
    // exactness, so "Adam" or "Ad-hoc" can never yield "Ad".
    for (const seg of text.split(new RegExp(`[${SPLIT_CHARS}]`))) {
      const t = seg.trim();
      if (t && rule.labels.includes(t)) return t;
    }
    return null;
  }

  /**
   * Facebook's inline "· Follow" is a bare <span> with no role, href or
   * tabindex — the click handler sits on some ancestor. So an explicit ARIA
   * role is only one way to qualify; a pointer cursor on the element or a near
   * ancestor counts too. Body prose has neither.
   */
  function isClickable(el) {
    if (el.closest('a, button, [role="button"], [role="link"], [tabindex]')) return true;
    let node = el;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      if (getComputedStyle(node).cursor === "pointer") return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Walk up from a label to the block that represents the whole post.
   *
   * Stop when the parent looks like the feed itself: a list is a run of tall
   * siblings, whereas the parts inside one post (header, body, footer) are a
   * mix of tall and short. The child of that list is the post.
   *
   * The previous rule counted headings and stopped at two, assuming a second
   * heading meant a neighbouring post had been swallowed. Sponsored posts break
   * that: they carry the advertiser's name at the top AND again in the call-to
   * -action card at the bottom, so the walk halted inside the post and produced
   * a container too narrow to be one. A heading count is kept only as a coarse
   * backstop against running away into the whole feed.
   */
  const MIN_POST_HEIGHT_PX = 150; // a feed item is at least this tall
  const FEED_LIST_MIN_ITEMS = 3; // ...and a feed shows several of them

  function looksLikeFeedList(parent) {
    if (parent.children.length < FEED_LIST_MIN_ITEMS) return false;
    let tall = 0;
    for (const child of parent.children) {
      if (child.getBoundingClientRect().height < MIN_POST_HEIGHT_PX) continue;
      if (++tall >= FEED_LIST_MIN_ITEMS) return true;
    }
    return false;
  }

  /**
   * The feed's direct children, located purely by shape. Needed because the
   * de-obfuscation sweep used to be driven off author headings alone: a post
   * whose advertiser name is not a heading was never swept, and if its label
   * was also obfuscated no path could reach it.
   */
  /**
   * The feed's cells, derived from posts we have already identified rather than
   * from any assumption about its shape.
   *
   * The shape-based version — "an element with three or more tall children" —
   * matched nothing at all on a live feed, which the report exposed as
   * "0 heading-less cards". Posts we have found are evidence: whatever element
   * most of them hang off IS the feed, whatever it looks like.
   */
  function feedCellsFrom(knownPosts) {
    const parents = new Map();
    for (const post of knownPosts) {
      // Climb through single-child wrappers first. The live feed nests each
      // post in its own wrapper div, so the immediate parents of 40 identified
      // posts were 40 DISTINCT elements and this vote never reached two —
      // "feed cells seen 1" in the report, meaning the heading-less sweep path
      // was dead and ads with a plain-span author sailed through. An element
      // with exactly one child cannot be a list, so climbing it is always safe.
      let node = post;
      for (let d = 0; d < 8 && node.parentElement && node.parentElement.children.length === 1; d++) {
        node = node.parentElement;
      }
      const parent = node.parentElement;
      if (parent) parents.set(parent, (parents.get(parent) || 0) + 1);
    }

    let feed = null;
    let most = 0;
    for (const [el, n] of parents) {
      if (n > most) {
        most = n;
        feed = el;
      }
    }
    // Two siblings is enough to call it a list; one could be any wrapper.
    return feed && most >= 2 ? [...feed.children] : [];
  }

  const containerCache = new WeakMap();

  // How far a post's top edge may sit above its header and still be the post
  // rather than something enclosing it — header padding, a "Suggested for you"
  // banner, and the like.
  const CONTAINER_TOP_SLACK_PX = 110;

  function postContainerFor(el, anchorEl = el) {
    const cached = containerCache.get(el);
    if (cached && cached.isConnected) return cached;

    const anchorTop = anchorEl.getBoundingClientRect().top;
    let chosen = el;
    let node = el.parentElement;
    const maxHeight = maxPostHeight();

    for (let depth = 0; node && node !== document.body && depth < 20; depth++) {
      const rect = node.getBoundingClientRect();
      // A post begins at its own header. Once an ancestor's top edge sits well
      // above that, it has taken in whatever came before the post.
      if (anchorTop - rect.top > CONTAINER_TOP_SLACK_PX) break;
      if (rect.height > maxHeight) break;
      if (node.matches('[role="main"], [role="feed"], #content')) break;

      chosen = node;
      if (looksLikeFeedList(node.parentElement)) break; // parent is the feed
      node = node.parentElement;
    }
    containerCache.set(el, chosen);
    return chosen;
  }

  /** `root`, or its first descendant, that is a leaf owning real text. */
  function textLeaf(root) {
    const ok = (node) => {
      if (node.children.length) return false; // not a leaf
      const text = normalise(node.textContent);
      if (!text || text.length > 80) return false;
      return !SUGGESTED_MARKERS.includes(text);
    };
    if (ok(root)) return root;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) if (ok(node)) return node;
    return null;
  }

  /**
   * The post's author name, used as the fixed point of the header: a genuine
   * Follow control sits on the same line as the author name, while body text
   * and comments do not.
   */
  function headerAnchor(post) {
    const heading = post.querySelector("h1, h2, h3, h4");
    if (heading) {
      const leaf = textLeaf(heading);
      if (leaf) return leaf;
    }
    const link = post.querySelector("a[href]");
    if (link) {
      const leaf = textLeaf(link);
      if (leaf) return leaf;
    }
    return textLeaf(post);
  }

  /**
   * Why this label doesn't mark a post for hiding, or "" if it does. Reads
   * only — never mutates, so a whole scan's worth of these can run before any
   * DOM writes happen.
   */
  function rejectReason(post, el, rule) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) return "not rendered";

    if (rule.mode === "header-zone") {
      // Two independent ways to qualify, because every single-signal version of
      // this check has failed on some real post:
      //   - the author's name sits immediately above the label, or
      //   - the label sits near the top of a block wide enough to be a post.
      // The first is a strong signal but assumes Facebook marks the author with
      // a heading. The second assumes nothing beyond the feed being a column of
      // cards, so it still works where the first does not.
      if (headingAbove(el)) return "";
      if (sitsInCardHeader(el)) return "";
      return "not in a post header";
    }

    const postRect = post.getBoundingClientRect();
    if (postRect.width < 200) return "container too narrow to be a post";
    if (rect.top - postRect.top > HEADER_ZONE_PX)
      return `below the header (${Math.round(rect.top - postRect.top)}px)`;

    if (rule.mode === "header-line") {
      if (!isClickable(el)) return "not clickable";
      const anchor = headerAnchor(post);
      if (anchor && anchor !== el) {
        // A real "· Follow" renders inline on the same line as the page name,
        // and a pill-style Follow/Join button sits at the far right of that
        // same row. Body text and comments never line up with the author's
        // name — which is how comments are excluded without identifying them.
        const a = anchor.getBoundingClientRect();
        const gap = Math.abs(rect.top + rect.height / 2 - (a.top + a.height / 2));
        if (gap > HEADER_ROW_PX) return `not on the author's line (${Math.round(gap)}px off)`;
      }
    }
    return "";
  }

  /**
   * What this element actually renders on screen, ignoring anything hidden.
   *
   * Facebook deliberately obfuscates the "Sponsored" label: the word is split
   * across many spans with decoy letters interleaved and hidden by CSS, so the
   * DOM text reads something like "SpXonsYored" while the screen reads
   * "Sponsored". Matching raw text cannot see through that; walking the tree
   * and skipping hidden subtrees can.
   */
  /**
   * Could `raw` possibly spell `word` once decoys are removed?
   *
   * A cheap gate in front of renderedText(), which is expensive: it measures
   * every text node. If the raw string does not even contain enough of each
   * letter, no amount of reordering will produce the word.
   */
  function mightSpell(raw, word) {
    if (!raw || raw.length > 120) return false;
    const have = Object.create(null);
    for (const ch of raw.replace(INVISIBLES, "").toLowerCase()) {
      have[ch] = (have[ch] || 0) + 1;
    }
    for (const ch of word.toLowerCase()) {
      if (!have[ch]) return false;
      have[ch]--;
    }
    return true;
  }

  /**
   * The element's text in the order it is PAINTED, not the order it is stored.
   *
   * Facebook now splits a label into one element per letter, shuffles them in
   * the DOM and puts them back in reading order with CSS (flex `order`), so
   * textContent yields "dtSsonrpo" for a row that plainly reads "Sponsored".
   * Every string-based approach fails on that by construction. Each visible
   * text node is measured and the fragments are sorted by line, then by
   * horizontal position, which reconstructs what a person actually sees.
   *
   * Hidden decoy letters are dropped by the same visibility rules visibleText
   * uses, so they never reach the sort.
   */
  function renderedText(el, cap = 48) {
    const parts = [];

    (function walk(node) {
      for (const child of node.childNodes) {
        if (parts.length >= 80) return;

        if (child.nodeType === Node.TEXT_NODE) {
          const value = child.nodeValue;
          if (!value || !value.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          const box = range.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          parts.push({ top: box.top, left: box.left, text: value });
          continue;
        }

        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.getAttribute("aria-hidden") === "true") continue;

        const cs = getComputedStyle(child);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (parseFloat(cs.opacity) === 0) continue;
        if (cs.fontSize === "0px") continue;

        const rect = child.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        walk(child);
      }
    })(el);

    // Group into lines before sorting horizontally: letters on the same line
    // vary by a pixel or two, and a plain top-then-left sort would interleave
    // two lines whose tops differ by less than the rounding step.
    parts.sort((a, b) => {
      const line = Math.round(a.top / 4) - Math.round(b.top / 4);
      return line !== 0 ? line : a.left - b.left;
    });

    return normalise(parts.map((p) => p.text).join("")).slice(0, cap * 2);
  }

  function visibleText(el, cap = 48) {
    let out = "";

    (function walk(node) {
      for (const child of node.childNodes) {
        if (out.length > cap) return;
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.nodeValue;
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.getAttribute("aria-hidden") === "true") continue;

        const cs = getComputedStyle(child);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (parseFloat(cs.opacity) === 0) continue;
        if (cs.fontSize === "0px") continue;

        const rect = child.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        walk(child);
      }
    })(el);

    return normalise(out);
  }

  // Minimum gap between sweeps of the same post, in ms.
  //
  // Third attempt at bounding this, and the first that cannot run out. A clock
  // from first sighting expired while scrolling. A budget of N sweeps was worse
  // still: scans run every 60ms, so all three were spent inside the first fifth
  // of a second and the report came back "examined 0, 7 skipped budget" — the
  // same way v1.0.2 wrote off every post before Facebook had filled it in.
  //
  // A cooldown only rate-limits. Every post stays eligible for as long as it is
  // on the page, however late its label appears, while the work per post per
  // second stays fixed.
  const AD_SWEEP_COOLDOWN_MS = 1500;
  let adSweptAt = new WeakMap();

  /**
   * Find a label in this post's header by what it *renders*, not what its text
   * nodes say. Only used for the ad rule, and only over the header strip, since
   * reconstructing visible text is far too expensive to run page-wide.
   */
  /**
   * Sweep for a label in the meta row beneath one author heading.
   *
   * Measured from the heading, not from the post container. The container is
   * inferred and has been wrong repeatedly; the heading is a real element and
   * the label always renders just below it. Confining the sweep to that narrow
   * band also keeps the expensive visibleText() work small.
   */
  function findLabelInHeader(card, refTop, band, rule) {
    if (!card) return null;
    const top = refTop;
    // Cap the painted-order reconstructions per post: it is the expensive
    // path, and a header has only a handful of plausible label containers.
    let paintedBudget = 12;

    // Every element type, not a curated list. The live feed's charity ads
    // carry a meta row whose sampled text is "Name | bullet | See more" — the
    // rendered "Sponsored" between them is simply not text in a span/div/a.
    // Whatever draws it (SVG <text>, an aria-label on an empty link, an image
    // alt), assuming its tag was the same mistake as assuming its string.
    for (const el of card.querySelectorAll("*")) {
      let rect = el.getBoundingClientRect();
      // A <use> whose reference cannot be resolved draws nothing and so has no
      // box of its own. That is exactly the case worth catching, so measure it
      // by the <svg> that holds it rather than discarding it as invisible.
      if (rect.width === 0 && rect.height === 0 && el.tagName === "use") {
        const owner = el.closest("svg");
        if (owner) rect = owner.getBoundingClientRect();
      }
      if (rect.width === 0 && rect.height === 0) continue;

      const drop = rect.top - top;
      if (drop < -META_ROW_MAX_RISE_PX || drop > band) continue;

      // Attribute-borne labels: aria-label on an otherwise empty control,
      // image alt text, tooltips.
      for (const attr of ["aria-label", "alt", "title"]) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v && v.length <= 64 && matchesLabel(rule, normalise(v))) return el;
      }

      // An <svg> takes its accessible name from a <title> CHILD, not a title
      // attribute — the loop above cannot see it.
      if (el.tagName === "svg") {
        const t = el.querySelector("title");
        const name = t && normalise(t.textContent || "");
        if (name && name.length <= 64 && matchesLabel(rule, name)) return el;
      }

      // Glyph-reference labels. Facebook renders the timestamp/"Sponsored"
      // slot as <svg><use href="#SvgT..."/></svg> — the word lives in a <defs>
      // element elsewhere in the document and the post itself contains NO
      // string. Sampled live: every meta row carried "svg use:#SvgTnnn" in
      // exactly that position. Following the reference recovers the word.
      if (el.tagName === "use" || el.tagName === "USE") {
        const g = resolveGlyph(el);
        if (g.text && g.text.length <= 64 && matchesLabel(rule, g.text)) return el;
      }

      // Text-borne labels. The raw cap is a loose sanity bound only — decoy
      // padding makes a disguised label's RAW text far longer than what it
      // renders, so size is judged on rendered text, the one measure the
      // obfuscation cannot inflate. SVG <text> is reached here too, since
      // textContent spans it.
      const raw = el.textContent;
      if (!raw || raw.length > 400) continue;
      const shown = visibleText(el, 64);
      if (shown && shown.length <= 48 && matchesLabel(rule, shown)) return el;

      // Letters scrambled in the DOM and reordered by CSS. Only attempted when
      // the raw text could actually spell the label, and only on containers
      // small enough to be a label rather than a paragraph — measuring every
      // text node is far too expensive to do speculatively.
      if (paintedBudget > 0 && el.childElementCount >= 2 && el.childElementCount <= 40) {
        for (const label of rule.labels) {
          if (!mightSpell(raw, label)) continue;
          paintedBudget--;
          const painted = renderedText(el, 64);
          if (painted && painted !== shown && painted.length <= 48 &&
              matchesLabel(rule, painted)) {
            tally.byPainted = (tally.byPainted || 0) + 1;
            return el;
          }
          break;
        }
      }
    }
    return null;
  }

  // Author headings with their measurements, refreshed once per scan. Ads are
  // validated against these rather than against a container, because the
  // container is inferred and can be wrong, whereas the heading really is there.
  let headingIndex = [];

  function indexHeadings(root) {
    headingIndex = [];
    for (const el of root.querySelectorAll("h1, h2, h3, h4")) {
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) continue;
      headingIndex.push({ el, rect });
    }
  }

  // A "Sponsored" label sits in the meta row directly beneath the author name.
  const META_ROW_MAX_DROP_PX = 90;
  const META_ROW_MAX_RISE_PX = 14;
  const SAME_COLUMN_PX = 280;

  // A feed post is a full-width card; the parts inside its header are not.
  const CARD_MIN_WIDTH_PX = 400;
  const CARD_TOP_ZONE_PX = 200;

  /**
   * The first ancestor big enough to be a post card. Pure geometry — no roles,
   * no headings, no class names — so it holds up where assumptions about
   * Facebook's markup do not.
   */
  function cardFor(el) {
    let node = el.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 20; depth++) {
      const nr = node.getBoundingClientRect();
      if (nr.width >= CARD_MIN_WIDTH_PX && nr.height >= MIN_POST_HEIGHT_PX) return node;
      node = node.parentElement;
    }
    return null;
  }

  /** Is this label near the top of its card? */
  function sitsInCardHeader(el) {
    const card = cardFor(el);
    if (!card) return false;
    return el.getBoundingClientRect().top - card.getBoundingClientRect().top <=
      CARD_TOP_ZONE_PX;
  }

  /** The author heading this label belongs to, or null. */
  function headingAbove(el) {
    const rect = el.getBoundingClientRect();
    // Proximity alone is not enough. A sponsored post repeats the advertiser's
    // name in a call-to-action card at its foot, and that heading sits just
    // above the NEXT post's header — close enough to be picked up, which bound
    // the label to the wrong post and made it vanish from the results.
    // Confining the search to the label's own card rules that out.
    const card = cardFor(el);
    let best = null;
    let bestGap = Infinity;

    for (const h of headingIndex) {
      if (card && !card.contains(h.el)) continue;
      const drop = rect.top - h.rect.top;
      if (drop < -META_ROW_MAX_RISE_PX || drop > META_ROW_MAX_DROP_PX) continue;
      if (Math.abs(h.rect.left - rect.left) > SAME_COLUMN_PX) continue;
      if (drop < bestGap) {
        bestGap = drop;
        best = h;
      }
    }
    return best;
  }

  /** Does the post's header carry a "Suggested for you"-style marker? */
  // Words that must never be inside anything this hides. The rail sits directly
  // above Contacts and Group chats, so an over-reaching walk would take the
  // user's contact list with it — a far worse outcome than a visible ad.
  const RAIL_PROTECTED = ["Contacts", "Group chats", "Group conversations", "Birthdays"];
  // Measured against the live rail: the heading sits ten nested one-line boxes
  // below the panel, so the walk is bounded by SIZE, not by depth. A block only
  // counts as the panel once it is taller than a text row; it is abandoned if
  // it grows taller than a plausible ad card or wider than the rail itself.
  const RAIL_MAX_DEPTH = 20;
  const RAIL_PANEL_MIN_PX = 80;
  const RAIL_MAX_HEIGHT = 700;
  const RAIL_MAX_WIDTH_FRAC = 0.45;

  /**
   * Hide the right-hand "Sponsored" column.
   *
   * Deliberately separate from the feed logic: this is a titled section, not a
   * post, so it is found by its heading and then bounded hard. Every guard
   * below exists to make hiding the wrong block impossible rather than
   * unlikely.
   *
   * Measures only — it must run in the scan's read phase. Hiding a block here
   * would invalidate layout for every rect still to be read, which is the
   * flicker bug the harness's thrash assertion exists to catch.
   */
  function planRail() {
    const found = [];
    if (!settings.hideRail) return found;

    for (const el of document.querySelectorAll("span, h3, h4, div")) {
      const raw = el.textContent || "";
      if (!raw || raw.length > 120) continue;

      // The rail heading gets the same obfuscation the feed labels do, so it
      // is read the same way: plainly first, then in painted order if the raw
      // string could spell the word once decoys and shuffling are undone.
      let label = normalise(raw);
      if (label !== "Sponsored") {
        if (el.childElementCount < 2 || el.childElementCount > 40) continue;
        if (!mightSpell(raw, "Sponsored")) continue;
        label = renderedText(el, 32);
        if (label !== "Sponsored") continue;
      } else if (el.children.length) {
        continue; // a plain wrapper repeating its child's text
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // The rail lives in the right-hand portion of the page; the feed's own
      // "Sponsored" labels do not.
      // A genuinely narrow window is still a real window, so use its own
      // width; only an implausible reading (0 in an unrendered viewport)
      // falls back, because a 0-derived threshold lets every label through.
      const measured = Math.max(
        window.innerWidth || 0,
        document.documentElement.clientWidth || 0
      );
      const vw = measured > 320 ? measured : 1280;
      if (rect.left < vw * 0.55) continue;

      // Walk up until a block is actually panel-sized, stopping the moment it
      // would swallow anything protected, outgrow an ad card, or spread wider
      // than the rail. An 8-level cap found only the heading's own wrappers.
      let node = el.parentElement;
      let chosen = null;
      for (let d = 0; node && node !== document.body && d < RAIL_MAX_DEPTH; d++) {
        const r = node.getBoundingClientRect();
        if (r.height > RAIL_MAX_HEIGHT) break;
        if (r.width > vw * RAIL_MAX_WIDTH_FRAC) break;
        const text = node.textContent || "";
        if (RAIL_PROTECTED.some((w) => text.includes(w))) break;
        chosen = node;
        if (r.height >= RAIL_PANEL_MIN_PX) break; // a section, not a text row
        node = node.parentElement;
      }

      // Only ever hide something panel-sized. If the walk ran out without
      // finding one, hide nothing — a stray heading is not an ad column.
      if (chosen && !chosen.dataset.fbfcHidden && !found.includes(chosen) &&
          chosen.getBoundingClientRect().height >= RAIL_PANEL_MIN_PX) {
        found.push(chosen);
      }
    }
    return found;
  }

  function headerHasSuggestedMarker(post) {
    const top = post.getBoundingClientRect().top;
    for (const el of post.querySelectorAll("span, h3, h4, div")) {
      const text = normalise(el.textContent);
      if (!text || text.length > 40) continue;
      if (!SUGGESTED_MARKERS.includes(text)) continue;
      if (el.getBoundingClientRect().top - top > HEADER_ZONE_PX) continue;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ hide/unhide

  // What was removed, in the words the store listing uses. Two things were
  // wrong with the string this replaces:
  //
  //   1. It printed the internal rule id — `Hidden suggested post ("follow")`.
  //      "follow" is how the post was RECOGNISED, not what it was, and naming
  //      the mechanism on screen is the same thing the README rule forbids.
  //   2. Its ternary called everything that was not "sponsored" a "suggested
  //      post", so every suggested GROUP was mislabelled. The rule ids are
  //      exactly follow / join / sponsored (see RULES at the top of this file),
  //      and join is a group.
  //
  // The id stays reachable for diagnosis via the title attribute and
  // data-fbfc-reason on the post itself; it just is not shown to the reader.
  const PLACEHOLDER_LABEL = {
    sponsored: "Hidden ad",
    follow: "Hidden suggested post",
    join: "Hidden suggested group",
  };

  function placeholderFor(target, reason) {
    const bar = document.createElement("div");
    bar.className = "fbfc-placeholder";
    bar.textContent = PLACEHOLDER_LABEL[reason] || "Hidden suggestion";
    bar.title = reason;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Show";
    btn.addEventListener("click", () => unhide(target, { manual: true }));
    bar.appendChild(btn);
    return bar;
  }

  // Landmark roles exist once, at page-structure level. A single post never
  // contains one. If the upward walk has climbed far enough to swallow a
  // landmark it has gone past the post, and hiding the result blanks the page.
  //
  // postContainerFor() stops at a real post boundary only via looksLikeFeedList(),
  // which needs >=3 tall siblings — a condition that CANNOT hold on a single-post
  // permalink, which is exactly where a shared link lands. Once hidden the damage
  // is permanent: everything inside a display:none subtree measures zero, so every
  // later scan rejects it as "not rendered" and it never comes back.
  //
  // So hide() refuses rather than trusting the walk. Failing closed is always
  // right here — a missed ad costs the viewer nothing; a blank Facebook costs
  // them the site. refusedOverreach is published in diagnostics() so that if this
  // guard ever starts firing broadly (which would mean hiding nothing at all) it
  // says so out loud instead of silently disabling the extension.
  const LANDMARK_SEL =
    '[role="feed"], [role="main"], [role="banner"], [role="navigation"], [role="complementary"]';
  let refusedOverreach = 0;

  function swallowsPageStructure(target) {
    try {
      return target.matches(LANDMARK_SEL) || !!target.querySelector(LANDMARK_SEL);
    } catch {
      return false; // a selector failure must not block ordinary hiding
    }
  }

  function hide(target, reason) {
    if (hidden.has(target)) return;
    if (swallowsPageStructure(target)) {
      refusedOverreach++;
      return;
    }
    // setAttribute rather than dataset so the write is observable from outside
    // (test/mock-feed.html asserts that no measurement happens after the first
    // write in a scan — that ordering is what keeps the feed from flickering).
    target.setAttribute("data-fbfc-hidden", settings.placeholder ? "placeholder" : "1");
    target.setAttribute("data-fbfc-reason", reason);
    if (settings.placeholder) {
      const bar = placeholderFor(target, reason);
      target.parentElement?.insertBefore(bar, target);
      target._fbfcBar = bar;
    }
    hidden.add(target);
    sessionCount++;
    // Count by page-session HIGH-WATER MARK per reason, never per hide() call.
    //
    // Any settings change calls unhideAll(), which clears `hidden`; the rescan
    // then re-hides the same posts and the all-time totals used to grow by the
    // whole visible page — so toggling a cosmetic checkbox like `badge`
    // inflated "ads hidden" without bound.
    //
    // Marking the element (target._fbfcCounted) was tried first and is NOT
    // enough: React hands back different DOM nodes across a rescan, so the mark
    // dies with the old node. Measured on live Facebook 2026-08-30 — two
    // cosmetic toggles produced 6 counter increments against 1 genuinely new
    // hide, i.e. 5 re-counts. The peak survives because it is keyed on the
    // reason, not on any node.
    if (reason in lifetime) {
      let live = 0;
      for (const t of hidden) {
        if (t.getAttribute("data-fbfc-reason") === reason) live++;
      }
      if (live > sessionPeak[reason]) {
        lifetime[reason] += live - sessionPeak[reason];
        sessionPeak[reason] = live;
        lifetimeDirty = true;
      }
    }
  }

  function unhide(target, { manual = false } = {}) {
    target.removeAttribute("data-fbfc-hidden");
    target.removeAttribute("data-fbfc-reason");
    if (target._fbfcBar) {
      target._fbfcBar.remove();
      delete target._fbfcBar;
    }
    // A manual "Show" must stick, or the next scan hides it straight back.
    if (manual) target.dataset.fbfcSkip = "1";
    hidden.delete(target);
  }

  /**
   * `manual` marks the posts as "the user asked to see this", which survives
   * later scans. A settings change instead wants a clean slate, so it unhides
   * without the flag and lets the next scan decide again.
   */
  function unhideAll({ manual = false } = {}) {
    for (const target of [...hidden]) unhide(target, { manual });
  }

  // ------------------------------------------------------------------ scan

  /**
   * Collect every label on the page. Text nodes rather than elements: the
   * innermost node carrying the text comes for free, and checking
   * `nodeValue.length` is far cheaper than reading `textContent` off thousands
   * of elements on every pass.
   */
  function collectLabels(root, active) {
    const found = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;

    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      if (!raw || raw.length > MAX_LABEL_LEN) continue;
      const text = normalise(raw);
      if (!text) continue;
      let matched = null;
      const rule = active.find((r) => (matched = matchesLabel(r, text)));
      if (!rule || !node.parentElement) continue;
      found.push({ el: node.parentElement, rule, text: matched });
    }

    // Some builds put the word on an aria-label instead of in the text, so the
    // walk above would never see it.
    for (const rule of active) {
      if (!rule.aria) continue;
      const sel = rule.aria.map((a) => `[aria-label="${a}"]`).join(", ");
      for (const el of root.querySelectorAll(sel)) {
        found.push({ el, rule, text: el.getAttribute("aria-label") });
      }
    }
    return found;
  }

  /**
   * Three strict phases: collect, decide, mutate.
   *
   * Reads and writes are kept apart on purpose. Hiding a post inside the same
   * loop that measures the next one forces a synchronous layout every time,
   * and on a feed full of ads that reflow storm is visible as the page
   * flickering and redrawing. All measuring finishes before anything is hidden.
   */
  function scan() {
    if (!document.body || !settings.enabled) return;

    const active = RULES.filter((r) => settings[r.setting]);
    if (!active.length) return;

    const root = document.querySelector('[role="main"]') || document.body;
    indexHeadings(root);

    // ---- 1. collect (reads) ----
    const found = collectLabels(root, active);
    tally = { labels: found.length, rejected: 0, reasons: {} };
    session.scans++;
    session.labels = Math.max(session.labels, found.length);

    // ---- 2. decide (reads) ----
    const decided = new Set();
    const toHide = [];

    for (const { el, rule, text } of found) {
      // For ads, walk up from the author heading: the post starts there, and
      // the label sits one row below it.
      const heading = rule.mode === "header-zone" ? headingAbove(el) : null;
      const post = heading
        ? postContainerFor(heading.el, heading.el)
        : postContainerFor(el);
      if (decided.has(post)) continue;
      if (post.dataset.fbfcSkip === "1" || post.dataset.fbfcHidden) {
        decided.add(post);
        continue;
      }

      const why = rejectReason(post, el, rule);
      if (why) {
        noteRejection(text, why, el);
        continue;
      }
      if (settings.strict && rule.strictable && !headerHasSuggestedMarker(post)) {
        noteRejection(text, "no 'Suggested for you' marker (cautious mode)", el);
        continue;
      }

      decided.add(post);
      toHide.push({ post, rule });
    }

    // ---- 2b. decide, by rendered text (reads) ----
    // Only for rules that need it, and only over posts not already spoken for.
    for (const rule of active) {
      if (!rule.byRender) continue;
      // Two sources: an author heading gives a tight band just beneath it; a
      // feed cell with no heading falls back to its own top and a wider band.
      const candidates = headingIndex.map((h) => ({
        post: postContainerFor(h.el, h.el),
        card: cardFor(h.el) || h.el.parentElement,
        refTop: h.rect.top,
        band: META_ROW_MAX_DROP_PX,
      }));
      const known = [...decided, ...candidates.map((c) => c.post)];
      const cells = feedCellsFrom(known);
      tally.feedCells = cells.length;
      session.feedCells = Math.max(session.feedCells, cells.length);
      for (const cell of cells) {
        if (cell.querySelector("h1, h2, h3, h4")) continue; // covered above
        candidates.push({
          post: cell,
          card: cell,
          refTop: cell.getBoundingClientRect().top,
          band: CARD_TOP_ZONE_PX,
        });
        tally.renderCardsNoHeading = (tally.renderCardsNoHeading || 0) + 1;
      }

      for (const { post, card, refTop, band } of candidates) {
        if (decided.has(post)) {
          tally.renderSkippedDecided = (tally.renderSkippedDecided || 0) + 1;
          continue;
        }
        if (post.dataset.fbfcSkip === "1" || post.dataset.fbfcHidden) {
          decided.add(post);
          continue;
        }
        // Reconstructing rendered text is the expensive path, so each post gets
        // a small number of sweeps — counted only once it has actually
        // rendered, so an empty shell never spends the budget.
        if (post.getBoundingClientRect().height === 0) {
          tally.renderSkippedEmpty = (tally.renderSkippedEmpty || 0) + 1;
          continue;
        }
        const now = Date.now();
        const last = adSweptAt.get(post) || 0;
        if (now - last < AD_SWEEP_COOLDOWN_MS) {
          tally.renderSkippedWindow = (tally.renderSkippedWindow || 0) + 1;
          continue;
        }
        adSweptAt.set(post, now);
        tally.renderExamined = (tally.renderExamined || 0) + 1;
        session.sweeps++;
        const el = findLabelInHeader(card, refTop, band, rule);
        if (!el) {
          const sample = sampleHeader(card, refTop, band, post);
          // Rolling, deduped, composer excluded: the fixed 4-slot buffer filled
          // with the "What's on your mind" box in the first second and the ad
          // rows that mattered never made it into the report.
          if (!/What's on your mind/i.test(sample) && !session.samples.includes(sample)) {
            session.samples.push(sample);
            if (session.samples.length > 8) session.samples.shift();
          }
          continue;
        }
        tally.labels++;
        tally.byRender = (tally.byRender || 0) + 1;
        session.sweepMatches++;
        const why = rejectReason(post, el, rule);
        if (why) {
          noteRejection("(rendered) " + rule.id, why, el);
          continue;
        }
        decided.add(post);
        toHide.push({ post, rule });
      }
    }

    // Last read of the scan: the rail is measured here, with the feed, so that
    // every rect in this pass is taken against one unmodified layout.
    const railBlocks = planRail();

    // ---- 3. mutate (writes) ----
    // rule.counter lets a rule report under an existing lifetime key. Without
    // it a new rule id would write lifetime[undefined] and the count would
    // silently vanish — a counter that cannot report is a feature that gets
    // deleted, per the working rules for this directory.
    for (const { post, rule } of toHide) hide(post, rule.counter || rule.id);
    for (const block of railBlocks) hide(block, "sponsored");
    updateBadge();
  }

  // Scan scheduling state. Declared ahead of safeScan(), which stamps lastRun.
  let queued = false;
  let lastRun = 0;

  /** Facebook's DOM is hostile; never let one bad post kill the observer. */
  function safeScan() {
    if (!contextAlive()) {
      shutdown();
      return;
    }
    try {
      scan();
    } catch (err) {
      console.warn(`[FB Feed Cleaner ${VERSION}] scan failed:`, err);
    } finally {
      // Every scan stamps the clock, including direct calls, so the debounce
      // below always measures from the last actual run. Without this the boot
      // scan leaves lastRun at 0 and the next mutation triggers a second full
      // scan immediately after the first.
      lastRun = Date.now();
    }
  }

  // Coalesce scans; Facebook mutates the DOM constantly.
  //
  // Deliberately a plain timer, not requestAnimationFrame: rAF never fires in a
  // backgrounded tab, which would leave `queued` stuck true and stop the feed
  // being filtered for as long as the tab sits in the background.
  function scheduleScan() {
    if (queued) return;
    queued = true;
    const wait = Math.max(0, SCAN_DEBOUNCE_MS - (Date.now() - lastRun));
    setTimeout(() => {
      queued = false;
      safeScan();
    }, wait);
  }

  // ----------------------------------------------------------------- boot

  let observer = null;

  /**
   * Go completely inert.
   *
   * Once the extension is reloaded, this copy is orphaned: it can never talk
   * to the extension again, and anything it keeps doing is pure noise in a
   * page that now has a NEW content script doing the real work. Guarding the
   * chrome.* calls stops the exceptions; detaching stops the wasted scanning
   * and the observer that triggers it.
   */
  function shutdown() {
    observer?.disconnect();
    observer = null;
    clearInterval(lifetimeTimer);
    window.removeEventListener("scroll", scheduleScan);
    window.removeEventListener("popstate", scheduleScan);
  }

  /**
   * Diagnostics that the gate depends on, mirroring the YouTube build.
   *
   * Running the gate on this extension on 2026-08-27 stopped at step one:
   * there was no way to read the running version from the page, and no
   * control arm, so two of the four steps could not be performed at all.
   * Both are a few lines and both end a class of error:
   *
   *   data-fbfc-version    which build is actually live — an unpacked
   *                        extension serves old code until Reload is pressed
   *   data-fbfc-tabhidden  whether the tab was backgrounded; Facebook does
   *                        not hydrate the feed in a hidden tab, so any count
   *                        taken there is void, exactly as on YouTube
   *   ?fbfcoff=1           disables the extension for one page load, so the
   *                        same feed can be read with it on and off
   *
   * The visibility name is deliberately NOT data-fbfc-hidden — that attribute
   * already marks individual hidden posts, and reusing it would make the two
   * impossible to tell apart in a report.
   */
  function stampDiagnostics() {
    try {
      const root = document.documentElement;
      root.setAttribute("data-fbfc-version", buildLabel());
      const mark = () => {
        try {
          if (document.visibilityState === "hidden") {
            root.setAttribute("data-fbfc-tabhidden", "1");
          } else if (!root.hasAttribute("data-fbfc-tabhidden")) {
            root.setAttribute("data-fbfc-tabhidden", "0");
          }
        } catch {
          /* reporting only */
        }
      };
      mark();
      document.addEventListener("visibilitychange", mark);
    } catch {
      /* diagnostics must never break the feed */
    }
  }

  function bypassed() {
    try {
      return location.search.indexOf("fbfcoff=1") !== -1;
    } catch {
      return false;
    }
  }

  function start() {
    stampDiagnostics();

    // A REAL bypass: nothing below is installed, so the control arm is the
    // page as Facebook serves it. The YouTube build shipped a bypass that
    // only half worked for several versions, and every conclusion drawn from
    // it was comparing the extension against itself.
    if (bypassed()) {
      try {
        document.documentElement.setAttribute("data-fbfc-bypassed", "1");
      } catch {
        /* reporting only */
      }
      console.log(`[FB Feed Cleaner ${VERSION}] bypassed for this page load`);
      return;
    }

    console.log(`[FB Feed Cleaner ${buildLabel()}] active on ${location.pathname}`);
    safeScan();
    // Give the feed time to hydrate before judging whether we did anything.
    setTimeout(report, 6000);
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", scheduleScan, { passive: true });
    // Feed re-renders on SPA navigation without a page load.
    window.addEventListener("popstate", scheduleScan);
  }

  loadLifetime();

  function boot(stored) {
    settings = { ...DEFAULTS, ...(stored || {}) };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }

  try {
    chrome.storage.sync.get(DEFAULTS, boot);
  } catch {
    // Orphaned before we ever read settings: still filter, using defaults,
    // rather than leaving the page unprotected.
    boot(null);
  }

  if (contextAlive()) chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[LIFETIME_KEY]) {
      lifetime = { ...lifetime, ...(changes[LIFETIME_KEY].newValue || {}) };
      return;
    }
    if (area !== "sync") return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;

    // Start from a clean slate: a setting can newly qualify a post (Join on) or
    // newly disqualify one that is already hidden (strict on), so re-run the
    // whole decision rather than patching it.
    unhideAll();
    // Reopen the render-pass window: switching a rule on long after page load
    // must re-examine posts whose window has already closed.
    adSweptAt = new WeakMap();
    updateBadge();
    if (settings.enabled) scheduleScan();
  });

  /** Everything needed to diagnose a miss, without opening DevTools. */
  function diagnostics() {
    const byRule = {};
    for (const target of hidden) {
      const r = target.dataset.fbfcReason || "?";
      byRule[r] = (byRule[r] || 0) + 1;
    }
    const root = document.querySelector('[role="main"]');
    return {
      version: VERSION,
      url: location.pathname,
      // The message listener is registered outside start(), so a page running
      // under ?fbfcoff=1 still answers a diagnostics request — previously with a
      // payload identical to a completely broken build. Every other number here
      // is meaningless when this is set, so it travels with the reading.
      bypassed: document.documentElement.hasAttribute("data-fbfc-bypassed"),

      // WHY THE FEED APPEARS TO REDRAW ON THE FIRST SCROLL. Two candidates,
      // measured rather than argued about:
      //   1. overflow-anchor. Instagram's feed is `auto`, so collapsing a post
      //      ABOVE the viewport is compensated and the reader sees nothing
      //      (ig-feed-cleaner/test/anchor-probe.html: scrollY -626, reference
      //      moved 0). If Facebook's scroller is `none`, that same collapse
      //      shifts everything on screen — and this extension has no
      //      above-viewport guard at all, unlike Instagram's.
      //   2. how many collapse at once, at a 60ms debounce, mid-scroll.
      // The live report showed feeds=0, so there is no [role="feed"] here and
      // the scroller has to be found by walking up from a real post.
      anchor: (() => {
        try {
          const se = document.scrollingElement || document.documentElement;
          const post = document.querySelector("[data-fbfc-hidden]") ||
                       document.querySelector('[role="article"]');
          let inner = null;
          for (let el = post; el && el !== document.body; el = el.parentElement) {
            const cs = getComputedStyle(el);
            if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40) {
              inner = el;
              break;
            }
          }
          const all = [...document.querySelectorAll("[data-fbfc-hidden]")];
          return {
            scroller: getComputedStyle(se).overflowAnchor,
            feed: getComputedStyle(inner || se).overflowAnchor,
            feedIs: inner ? (inner.getAttribute("role") || inner.tagName.toLowerCase())
                          : "page (no inner scroller found)",
            hiddenAboveViewport: all.filter((el) => el.getBoundingClientRect().bottom < 0).length,
            hiddenInViewport: all.filter((el) => {
              const r = el.getBoundingClientRect();
              return r.bottom >= 0 && r.top <= window.innerHeight;
            }).length,
            debounceMs: SCAN_DEBOUNCE_MS,
          };
        } catch (e) {
          return { error: String(e) };
        }
      })(),
      // CLAUDE.md requires the tab-visibility flag to accompany every reading:
      // a backgrounded tab reports zero-size rects, which voids the lot.
      tabHidden: document.documentElement.getAttribute("data-fbfc-tabhidden"),
      refusedOverreach,
      lifetime: { ...lifetime },
      settings: { ...settings },
      hidden: hidden.size,
      byRule,
      labelsSeen: tally.labels,
      labelsByRender: tally.byRender || 0,
      // Session-cumulative, because labelsSeen is per-scan and `tally` is reset
      // at the top of every scan while opening the popup does not trigger one.
      // A per-scan 0 means "the last mutation pass found nothing", which is not
      // the same as "this has never worked" — and on 2026-09-01 that ambiguity
      // was the whole question and the report could not answer it.
      sessionLabels: session.labels,
      sessionScans: session.scans || 0,
      session: { ...session },
      render: {
        examined: tally.renderExamined || 0,
        skippedDecided: tally.renderSkippedDecided || 0,
        skippedBudget: tally.renderSkippedWindow || 0,
        skippedEmpty: tally.renderSkippedEmpty || 0,
        cardsNoHeading: tally.renderCardsNoHeading || 0,
        feedCells: tally.feedCells || 0,
      },
      reasons: tally.reasons,
      structure: {
        roleMain: !!root,
        headings: (root || document).querySelectorAll("h1,h2,h3,h4").length,
        articles: document.querySelectorAll('div[role="article"]').length,
        feeds: document.querySelectorAll('div[role="feed"]').length,
      },
    };
  }

  if (contextAlive()) chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === "diagnostics") {
      respond(diagnostics());
    } else if (msg?.type === "getStats") {
      respond({ visible: hidden.size, total: sessionCount });
    } else if (msg?.type === "unhideAll") {
      unhideAll({ manual: true });
      respond({ ok: true });
    } else if (msg?.type === "rescan") {
      unhideAll();
      adSweptAt = new WeakMap();
      document
        .querySelectorAll("[data-fbfc-skip]")
        .forEach((el) => delete el.dataset.fbfcSkip);
      safeScan();
      respond({ ok: true, total: sessionCount });
    }
    // Every branch above responds SYNCHRONOUSLY, so returning true — which
    // means "a response is coming later" — left Chrome holding a channel that
    // nothing ever answered, and it logged "the message channel closed before a
    // response was received" on every popup open. That is what fills the Errors
    // button on chrome://extensions.
    return false;
  });
})();
