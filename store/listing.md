# Chrome Web Store submission — Quite for Facebook™

Publisher: **Quite Apps**  ·  Contact: **support@quiteapps.co.uk**
Source: **github.com/KingDogma23/quite-for-facebook**
Store:  **https://chromewebstore.google.com/detail/quite-for-facebook/mmkkijoeabmdogijjnkglkmeckhdhedl**  (published 2026-08-30)
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

Two options worth knowing about: Cautious mode hides FEWER posts, not more — suggested posts and groups are only removed when they are also
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

All three screenshots and the marquee were regenerated on 2026-09-01 from
`store/src/*.html`, which live in this repo — no external generator is needed
any more. Each embeds a LIVE capture of the shipped 2.6.6 popup (see
`store/src/` for the sources), so the panel is the real product rather than a
mock, per the brand guide.

> Version note, 2026-09-02: the package is now **2.6.7**, while the store
> art above was captured from 2.6.6. That number is left as it is because the
> images genuinely show 2.6.6 and editing it would make this file lie about its
> own evidence. Checked: no rendered version string is visible in any of the
> images, so nothing on the store is stale — only re-capture if that changes.


What was wrong with the set they replace, all of it live on the store:

- `01` claimed "Sponsored posts hidden as the feed loads". The hiding is done by
  `[data-fbfc-hidden="1"]`, an attribute JavaScript sets AFTER examining a post;
  the harness records a new ad taking about 1.5s with the post painting at full
  height first. Now reads "Sponsored posts taken out of your feed".
- `02-hidden-as-it-loads.png` carried that same claim in its headline and first
  bullet. It had been replaced once already, on 2026-08-30, and a regeneration
  on the 31st recreated it. Deleted.
- `03` said "Storage, to remember your six checkboxes". Storage also holds the
  hide counters. Now reads "Storage, for your settings and what it has hidden".
- All four images showed "Strict mode", renamed to "Cautious mode" in 2.6.5.
- The marquee also stamped v2.6.3. The popup no longer renders a version when
  opened outside a Facebook tab, so there is nothing left to go stale.

The counters visible in 02 read 63 / 42 / 1, taken from a clean test profile on
2026-08-30. The previous set showed 243 / 394 / 77, which were real reads but of
a counter that re-counted every visible post on any settings change — a bug
fixed in 2.6.1, which means those figures were inflated by an unknown factor.
Nothing here is invented for the listing, but do not quote the old numbers.
