# FB Feed Cleaner

A Chrome extension that strips the clutter out of your Facebook news feed.

It removes three kinds of post you never asked to see:

| | |
| --- | --- |
| **Suggested posts** | Pages you don't follow, pushed into your feed |
| **Ads** | Posts marked "Sponsored" or "Ad" |
| **Suggested groups** | Groups you're not a member of (optional, off by default) |

Your own posts, your friends' posts, groups you're in and pages you already
follow are never touched. Nothing is blocked, unfollowed or reported on your
behalf — posts are hidden from view, and everything comes straight back the
moment you switch it off.

## Install

Not on the Chrome Web Store, so it installs unpacked:

1. Download the latest release and unzip it. You need the **folder**.
   Keep it somewhere permanent — if you move or delete it, the extension stops working.
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the folder
5. Reload any Facebook tab you already had open

Chrome shows a "Developer mode extensions" warning on each startup. That's
normal for anything installed outside the Web Store, and can be dismissed.

Works in Chrome, Edge, Brave and other Chromium browsers.

## Options

Click the extension icon. Changes apply immediately — no reload needed.

| Option | Default | What it does |
| --- | --- | --- |
| Extension on | on | Master switch |
| Hide "Follow" posts | on | Suggested posts from pages you don't follow |
| Hide ads | on | Posts marked "Sponsored" or "Ad" |
| Hide "Join" posts | off | Suggested groups |
| Strict mode | off | Makes the Follow filter fussier — only hides posts also marked "Suggested for you". Doesn't affect ads |
| Show a placeholder bar | off | Leaves a small strip with a **Show** button instead of removing the post, so you can see what was caught |
| Show status badge | off | Troubleshooting overlay on the feed |
| Rescan / Show all | — | Re-run the filter, or reveal everything on the page |

## Worth knowing

Facebook shows a **Follow** button on *any* page post you don't already follow —
including one a friend shared. Those get hidden too. If that's costing you
things you wanted to see, turn on **Strict mode**: it then only removes posts
explicitly marked "Suggested for you". Fewer suggestions disappear, but nothing
you actually follow will.

Facebook actively disguises the labels this relies on, and changes the disguise
periodically. When that happens ads reappear until the extension is updated —
expected, not a regression.

## If it stops working

Click the extension icon. The version shown is the one **actually running in the
page** — if it doesn't match the version you installed, Chrome is still serving
an old build: hit the reload arrow on `chrome://extensions`, then reload Facebook.

Underneath is a **Diagnostics** box with a **Copy report** button. That report
says what was found, what was hidden, and why anything was rejected. Paste it
into an issue and it's usually enough to pin the problem immediately.

## Privacy

- Runs **only** on `facebook.com`. It has no permission to access any other site.
- Sends nothing anywhere. No server, no analytics, no account, no tracking.
- The only thing stored is your checkbox settings.
- Hides posts with a "don't display this" style — it never clicks anything,
  never blocks or unfollows for you, and makes no change to your account.

## Development

Detection logic is deliberately not documented here. Facebook obfuscates the
labels this depends on specifically to break tools like this one, and a public
write-up of the current approach is a roadmap for breaking it. The code is
commented for anyone maintaining it.

There's a regression suite covering 34 real-world post shapes — every disguise
and false-positive case found in the wild, so a fix can't silently undo an
earlier one. It stubs the extension APIs and loads the content script unmodified:

```bash
python3 -m http.server 8731
```

Then open <http://localhost:8731/test/mock-feed.html>. The panel reports
**ALL PASS** or lists failures. It also asserts two things beyond the cases: that
each hidden block contains exactly one post (no over-reach into the feed), and
that no scan measures the page after writing to it (which would cause visible
flicker).

All names and content in the test fixtures are fictional.

## Licence

MIT — see [LICENSE](LICENSE).

Not affiliated with Facebook or Meta.
