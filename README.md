# VSTEP Reading Practice

A local-first VSTEP reading practice app with a split-pane exam workspace, passage navigation, answer feedback, explanations, and reusable exam imports.

The starter practice set is based on the supplied VSTEP PDF. That document contains one complete reading paper with four passages and 40 questions, followed by its answer key and explanations. It does not include ten complete papers, so the app starts with the content present in the source and lets you add more sets.

## Run locally

```sh
npm ci
npm start
```

Open [http://localhost:3000](http://localhost:3000). Use `npm test` to run the test suite and `npm run build` to create a production build.

## Deploy to GitHub Pages

The `Deploy VSTEP Reading to GitHub Pages` workflow runs tests, builds the site with the correct repository subpath, and deploys it when changes reach `main`. You can also start it from the repository’s **Actions** tab using **Run workflow**. In **Settings → Pages**, set the build and deployment source to **GitHub Actions**.

After the first successful deployment, the site will be available at [https://dyunam2077.github.io/task-dashboard/](https://dyunam2077.github.io/task-dashboard/). Pull requests and pushes to feature branches do not publish the site.

## Add practice sets

Choose **Import set** and select one or more `.pdf` files. Only PDFs are accepted. The browser extracts text from digital PDFs and runs English OCR on scanned pages, then shows a preview where you can switch between detected sets, correct question text/options/answers, and inspect the original page text. Confirm the preview to save the sets in this browser. Use **Export** to download a set in the app's JSON data format.

The parser recognizes headings such as `Reading Passage 1`, numbered questions (`1.`, `1)`, or `Question 1`), A–D options, and an `Answer Key` section. It splits bundles at `Test N` / `Practice Test` headings and repeated `Passage 1` headings after earlier passages. Since PDF layouts and answer-key styles vary, review the required preview—especially OCR text, missing options, and absent answer keys—before importing. Explanations are only extracted when they follow detected answers in the answer-key section; verify them against the source PDF.

Imported sets keep the same internal schema used by the practice UI. Answers may be `null` when no key was detected; those questions are not automatically marked correct or incorrect.

```json
{
  "id": "practice-test-1",
  "title": "Practice Test 1",
  "level": "B1–B2–C1",
  "durationMinutes": 60,
  "passages": [
    {
      "id": "passage-1",
      "title": "Passage 1",
      "questionRange": "1–10",
      "text": "Paste the reading passage here.",
      "questions": [
        {
          "number": 1,
          "prompt": "Write the question here.",
          "choices": [
            { "label": "A", "text": "First option" },
            { "label": "B", "text": "Second option" },
            { "label": "C", "text": "Third option" },
            { "label": "D", "text": "Fourth option" }
          ],
          "correctAnswer": null,
          "explanation": ""
        }
      ]
    }
  ]
}
```

### PDF.js and OCR assets

- `pdfjs-dist` and `tesseract.js` are installed with `npm ci`. Vite emits the PDF.js worker and Tesseract worker as assets via their `?url` imports; no separate worker-copy step is needed.
- Text PDFs need no OCR download. For scanned pages, Tesseract is loaded on demand and retrieves the English LSTM model and OCR core from the Tesseract.js jsDelivr endpoints on first use. OCR therefore needs network access.
- For an offline/self-hosted deployment, copy the matching `tesseract.js-core` `.wasm.js` and `.wasm` runtime files from `node_modules/tesseract.js-core/` into a public folder (for example `public/tesseract-core/`), and place `eng.traineddata.gz` in `public/tessdata/`. Build with `VITE_TESSERACT_CORE_PATH` and `VITE_TESSERACT_LANG_PATH` set to those served directories, including the site's Pages base path when applicable (for this repository, `/task-dashboard/tesseract-core` and `/task-dashboard/tessdata`). Ensure the core directory contains the SIMD LSTM runtime selected by Tesseract.js and the matching `.wasm` file. The English model can be downloaded from the official `@tesseract.js-data/eng` package or the Tesseract.js data CDN.

The uploaded PDFs are processed in the browser and are not sent to an application server. Each page is released after processing; OCR is performed sequentially and can be cancelled.

## Stack

- React 19 and Vite
- Vitest and Testing Library
- Heroicons
