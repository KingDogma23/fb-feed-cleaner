/**
 * Paste this into the DevTools console on an open facebook.com feed.
 *
 * You should not normally need it: since v1.0.2 the extension prints its own
 * report to the console if a page ends up filtering nothing. This is the manual
 * version, for when you want to inspect a specific post.
 *
 * It re-runs each of content.js's filters against every "Follow"/"Join" it can
 * find and prints a table, so a post that should have been hidden shows exactly
 * which filter rejected it.
 */
(() => {
  const norm = (s) =>
    (s || "").replace(/[\s ]+/g, " ").replace(/^[\s·•・\-–—|]+/, "").trim();

  const isClickable = (el) => {
    if (el.closest('a, button, [role="button"], [role="link"], [tabindex]')) return true;
    let n = el;
    for (let i = 0; i < 4 && n && n !== document.body; i++) {
      if (getComputedStyle(n).cursor === "pointer") return true;
      n = n.parentElement;
    }
    return false;
  };

  const textLeaf = (root) => {
    const ok = (n) => {
      if (n.children.length) return false;
      const t = norm(n.textContent);
      return !!t && t.length <= 80;
    };
    if (ok(root)) return root;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) if (ok(n)) return n;
    return null;
  };

  const posts = [...document.querySelectorAll('div[role="article"]')].filter(
    (a) => !(a.parentElement && a.parentElement.closest('div[role="article"]'))
  );

  console.log("content script ran:", document.querySelectorAll("[data-fbfc-checks]").length > 0);
  console.log("posts currently hidden:", document.querySelectorAll("[data-fbfc-hidden]").length);
  console.log("top-level posts found:", posts.length);

  const rows = [];
  posts.forEach((post, i) => {
    const top = post.getBoundingClientRect().top;

    const heading = post.querySelector("h1, h2, h3, h4");
    const link = post.querySelector("a[href]");
    const anchor =
      (heading && textLeaf(heading)) || (link && textLeaf(link)) || textLeaf(post);

    for (const el of post.querySelectorAll(
      'span, a, div[role="button"], div[role="link"], button'
    )) {
      const text = norm(el.textContent);
      if (text !== "Follow" && text !== "Join") continue;
      if (el.firstElementChild && norm(el.firstElementChild.textContent) === text) continue;

      let shared = null;
      if (anchor) {
        const chain = new Set();
        for (let p = anchor; p; p = p.parentElement) chain.add(p);
        for (let p = el; p; p = p.parentElement)
          if (chain.has(p)) {
            shared = p;
            break;
          }
      }

      const rect = el.getBoundingClientRect();
      rows.push({
        post: i,
        label: text,
        tag: el.tagName + (el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""),
        clickable: isClickable(el),
        sameArticle: el.closest('div[role="article"]') === post,
        rendered: !(rect.height === 0 && rect.width === 0),
        offsetTop: Math.round(rect.top - top),
        anchor: anchor ? norm(anchor.textContent).slice(0, 24) : "(none)",
        sharedIsPost: shared === post,
        sharedLen: shared ? norm(shared.textContent).length : -1,
      });
    }
  });

  console.table(rows);
  return `${rows.length} candidate(s) across ${posts.length} posts`;
})();
