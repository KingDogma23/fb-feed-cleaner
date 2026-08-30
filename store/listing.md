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

01 and 03 come from the same generator as the other Quite Apps listings
(`tools/make-shots.py` in the website project), so the three extensions present
as one publisher.

02 was regenerated on 2026-08-30 and is NOT from that generator: it is an HTML
render wrapping a live screenshot of the real 2.6.1 popup, so the panel in it is
the actual product rather than a mock. It replaces `02-hidden-as-it-loads.png`,
whose headline ("Hidden as it loads, not after.") and first bullet ("Posts never
paint, so nothing flickers away") were a timing claim the code does not deliver
— the harness records a newly arrived ad taking about 1.5s, with the post
painting at full height first, and deliberately does not assert it because it is
a known-unfixed defect. If 01 and 03 are ever regenerated, 02 will need
re-rendering from `store/screenshot-02-source.html` (open it at exactly
1280x800, device scale 1, and capture) to keep the set consistent.

The counters visible in 02 read 63 / 42 / 1, taken from a clean test profile on
2026-08-30. The previous set showed 243 / 394 / 77, which were real reads but of
a counter that re-counted every visible post on any settings change — a bug
fixed in 2.6.1, which means those figures were inflated by an unknown factor.
Nothing here is invented for the listing, but do not quote the old numbers.
