# Chrome Web Store submission — Quite for Facebook™

Publisher: **Quite Apps**  ·  Contact: **support@quiteapps.co.uk**
Package: `dist/fb-feed-cleaner-<version>-store.zip` (built with `./package.sh --store`)

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
and it never sends anything anywhere. The only thing it stores is which of the
checkboxes you have ticked.

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
  - `02-nothing-hidden.png`
- 128x128 icon — already in the package
- Optional 440x280 small promo tile — not made

The screenshots show the real popup, rendered from the shipped popup.html with
the extension's own default options ticked. The counters read zero because
that is what a fresh install shows; inventing numbers for a store listing
would be a lie told to everyone who reads it.
