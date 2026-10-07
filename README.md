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

Choose **Import set** in the app. Download the exam and answer templates, fill them with your source material, then select one or more exam JSON files and their answer/explanation JSON files together. Include a matching `examTitle` (or `examId`) on each separate answer file when importing multiple sets. A single unlabelled answer file can accompany one exam. Imported sets and answers are stored in this browser only; use **Export** to save a portable copy.

Imports use this structured JSON format rather than guessing at arbitrary PDF or Word layouts. Copy the original passage, question, answer, and explanation text into the templates so you can review it before importing.

An exam file has a `passages` array. Each passage contains its source text and questions:

```json
{
  "title": "Practice set 2",
  "level": "B1–B2–C1",
  "durationMinutes": 60,
  "passages": [
    {
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
          "correctAnswer": "B",
          "explanation": "Paste the source explanation verbatim."
        }
      ]
    }
  ]
}
```

Answers and explanations can instead be supplied in a second file, keyed by the question numbers used in the exam:

```json
{
  "type": "vstep-answers",
  "examTitle": "Practice set 2",
  "answers": [
    {
      "number": 1,
      "answer": "B",
      "explanation": "Paste the source explanation verbatim."
    }
  ]
}
```

Each question needs four choices labeled A–D, a correct answer, and a non-empty explanation. Question numbers must be unique within an exam. Imported files are parsed in the browser and are not uploaded to a server.

## Stack

- React 19 and Vite
- Vitest and Testing Library
- Heroicons
