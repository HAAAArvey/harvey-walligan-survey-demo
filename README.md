# Harvey & Walligan — 360° Site Survey Demo

A browser-only, photo-first survey workflow: import a site folder, run a simulated AI pass, review large photos against the full floor plan, assign defect layers, and export a report.

**Live demo:** https://haaaarvey.github.io/harvey-walligan-survey-demo/

## Run locally

No install or build step is required. Serve this directory over HTTP:

```sh
python3 -m http.server 4178
```

Then open `http://127.0.0.1:4178/`.

## Demo flow

1. Choose a company folder, internal server, or internal cloud source.
2. Select **Import folder** to see the folder burst and simulated AI pass.
3. Review each AI candidate using the hero photo, route plan, and defect layers.
4. Keep or reject each finding. Confirmed pins are filled; rejected candidates disappear.
5. Export an editable Word report, print/save a PDF, or download a marked-plan PNG.

Direct routes:

- `#/import` — source selection and import
- `#/processing` — simulated AI pass
- `#/review` — photo-by-photo review
- `#/report` — report preview; seeds all candidates as kept when opened without review decisions

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` / `→` | Previous / next finding |
| `1`–`4` | Select a defect layer |
| `Enter` | Keep finding |
| `X` | Not a defect |
| `R` | Reset the demo |

## Real vs simulated

| Item | Status |
| --- | --- |
| Interface, navigation, review decisions, layer counts | Working browser interactions |
| Photos | Real 360° captures used as labelled placeholders |
| Floor plan | Real public-domain plan used as a redacted reference placeholder |
| AI indexing, detection, confidence, and processing progress | Simulated for the demo |
| Word report and marked-plan PNG | Generated locally in the browser |
| PDF | Uses the browser's print / save-as-PDF flow |
| Backend, authentication, storage, and file upload | Not included; nothing leaves the browser |

## Replace the demo assets

- Replace `assets/photos/` with your own cropped survey photos.
- Replace `assets/floor-plan.png` with your redacted floor plan.
- Update project metadata, photo references, room coordinates, pins, and the survey route in `js/data.js`.
- Update finding titles, descriptions, layers, and confidence values in the same file.

The app uses plain HTML, CSS, and JavaScript modules. No framework or package manager is required.

## Media attribution

- **Classroom photos:** “Classroom — Golden Jubilee Bhavan…” by **Biswarup Ganguly**, Wikimedia Commons, **CC BY 3.0**. Used as labelled 360° photo placeholders.
- **Hall photos:** “Large Corridor” by **Sergej Majboroda / Poly Haven**, **CC0**. Used as labelled 360° photo placeholders.
- **Floor plan:** “Reliance Building typical floor plan” (1906), Wikimedia Commons, **public domain**. Cropped to remove the caption and used as a redacted reference plan, not as the actual Belmont Court plan.

The project names, survey data, AI findings, and export content are illustrative demo content.
