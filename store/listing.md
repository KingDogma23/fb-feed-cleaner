# Chrome Web Store submission — Quite for Facebook™

Publisher: **Quite Apps**  ·  Contact: **support@quiteapps.co.uk**
Source: **github.com/KingDogma23/quite-for-facebook**
Package: `dist/fb-feed-cleaner-<version>-store.zip` (built with `./package.sh --store`)

> The zip is named from the working directory, which is still `fb-feed-cleaner` while
> the repository is `quite-for-facebook`. Harmless, but do not let it read as a
> different extension from the one being submitted.

## Summary (132 characters max)

Cleans up the Facebook feed: hides ads, suggested posts, suggested groups and
the Sponsored column. No accounts, no tracking.

## Description

Quite for Facebook removes the clutter from your Facebook feed and does
nothing else.

- Posts marked Sponsored or Ad are hidden.
- Suggested posts — pages you do not follow, pushed into your feed — are
  hidden.
- Suggested groups can be hidden too.
- The Sponsored column on the right, above your contacts, is hidden.

Two options worth knowing about: Strict mode only hides posts that are also
marked "Suggested for you", and a placeholder option leaves a small strip with
a Show button instead of removing a post outright, so you can always see what
was hidden and put it back.

It runs only on facebook.com. It has no account, no server and no analytics,
and nothing is sent to us. It stores the checkboxes you have ticked and a
running count of what it has hidden. Settings use Chrome's own extension-
settings sync, so with Chrome sync switched on they travel with your Chrome
profile, as any extension's settings do.

Facebook changes its markup regularly. When that happens some posts can start
getting through until the extension is updated — it is built to fail towards
"clutter gets through" rather than towards hiding something you wanted.

## Trademark attribution

Include verbatim at the end of the store description:

> Facebook™ is a trademark of Meta Platforms, Inc. This extension is an
> independent project and is not affiliated with, endorsed by or
> sponsored by Meta Platforms, Inc.

## Category

Functionality & UI

## Single purpose statement

The single purpose of this extension is to hide advertising and algorithmic
suggestions from the facebook.com feed.

## Permission justifications

- **storage** — remembers which options the user has ticked, and the counters
  shown in the popup. Nothing else is stored, and nothing leaves the browser.
- **host permission `*://*.facebook.com/*`** — the extension must read the
  feed in order to identify sponsored and suggested posts and hide them. It
  requests no other site.

## Data usage disclosures

Select: **does not collect or use user data.**

- No personally identifiable information
- No health, financial, authentication, personal communications, location,
  web history or user activity collected
- No data sold or transferred to third parties
- No data used for creditworthiness or lending
- Not used for purposes unrelated to the single purpose above

## Assets

- Screenshots, 1280x800, in `store/screenshots/`:
  - `01-a-quieter-feed.png`
  - `02-ads-and-suggestions.png`
  - `03-nothing-hidden.png`
- 128x128 icon — already in the package
- `store/promo-tile-440x280.png`
- `store/marquee-1400x560.png`

All three are drawn from the same generator as the other Quite Apps listings
(`tools/make-shots.py` in the website project), so the three extensions present
as one publisher. Each shows the popup in a different real state — the default
options, everything on, and the pared-back set — rather than the same picture
three times.

Earlier versions of these screenshots showed a fresh install's zeros. The
counters now read 243 ads hidden / 394 suggestions / 77 groups, read directly
from `chrome.storage` in the author's Chrome profile on 2026-08-29. They
replace 213 / 313 / 65, which were real when captured but had since moved on —
the counters keep running. Not invented for the listing.
