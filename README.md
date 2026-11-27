# FGO Quartz Calculator

A static planner for Fate/Grand Order Global. It uses the JP schedule (Global runs about two years behind) to estimate when each upcoming 5★ summoning campaign reaches Global and how many rolls you will have by then.

## Features

- **Calculator:** enter your Saint Quartz, fragments, tickets and unclaimed story SQ, plus weekly income. It shows your rolls now and a plan of banners in queue order: rolls available, rolls used, chance of at least one copy (0.8% per roll, guaranteed at 330), and what you're short of.
- **Timeline:** every upcoming 5★ summoning campaign and event, with campaign art, rate-up servants, estimated Global date and the rolls you'd have by then. You can search, filter and add banners to your plan.
- **Queue editor:** fix the order, days or SQ of any step if Global strays from JP, and import or export the queue as JSON.

Everything runs in the browser, with no backend. Your data is saved in `localStorage`.

## How the estimate works

The queue follows JP order, not fixed date offsets. For each step the planner adds weekly SQ, monthly shop tickets and event SQ for the days until that step arrives, with a ±15% range, then spends on the banners in your plan.

Rolls = `floor(units / 10) * 11 + units % 10`, where `units = floor(SQ / 3) + tickets`.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | The built page (template plus embedded data). Open it directly or serve the folder. |
| `assets/w/` | Campaign banners and servant icons, unmodified original files from the FGO Wiki. |
| `data/queue.json` | The queue: events and summoning campaigns in JP order. |
| `data/names.json` | English names for Atlas events that only have a Japanese name yet. |
| `tools/template.html` | The page source. Data goes in at `__ATLAS__`. |
| `tools/build.py` | Rebuilds `index.html` from the template and `data/queue.json`. |
| `tools/updater-core.mjs` | Reads the wiki and Atlas Academy and builds the queue. |
| `tools/update.mjs` | Runs the updater, downloads new images and writes `data/queue.json`. |
| `.github/workflows/update-data.yml` | Daily job that runs the updater and publishes any change. |

## Automatic updates

Every day at 10:00 UTC a GitHub Action runs `node tools/update.mjs` and `python3 tools/build.py`:

1. Reads [Event List (US)/Upcoming Events](https://fategrandorder.fandom.com/wiki/Event_List_(US)/Upcoming_Events) and every summoning campaign on those event pages.
2. Reads event Saint Quartz and tickets from Atlas Academy and works out where Global is on the JP timeline.
3. Downloads any banner or icon it doesn't have yet, byte for byte.
4. Commits only if something changed, and GitHub Pages republishes the site.

If the wiki returns too few banners, the job stops and keeps the last good data. You can also run it by hand from the **Actions** tab with **Run workflow**. Saved plans in visitors' browsers carry over to the new data.

If the log warns about an event without an English name, add it to `data/names.json`.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

After editing the template or the data, run `python3 tools/build.py`. To refresh the data yourself, run `node tools/update.mjs` first (Node 20+).

## Sources

- Event and banner order: [Fate/Grand Order Wiki, Event List (US)/Upcoming Events](https://fategrandorder.fandom.com/wiki/Event_List_(US)/Upcoming_Events)
- Event SQ and tickets: [Atlas Academy](https://atlasacademy.io/)

Fan-made and not affiliated with TYPE-MOON, Lasengle or Aniplex. Banner art and servant icons belong to TYPE-MOON / FGO PROJECT.
