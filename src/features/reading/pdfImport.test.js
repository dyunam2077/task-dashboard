import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractPdfBatch } from './pdfImport';
import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(),
}));

function makePage(textItems) {
  return {
    cleanup: vi.fn(),
    getTextContent: vi.fn(async () => ({ items: textItems })),
    getViewport: vi.fn(() => ({ width: 400, height: 600 })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
}

const readableText = 'Reading Passage 1\nA short passage with enough words to stay above the text threshold.';
const ocrQuestion = `1. What does the passage say?
A) First option
B) Second option
C) Third option
D) Fourth option`;
const ocrAnswer = 'Answer Key: 1. B - The source supports the second choice.';

describe('PDF extraction pipeline', () => {
  let pages;
  let ocrLogger;
  let canvases;

  beforeEach(() => {
    pages = [
      makePage([{
        str: readableText,
        transform: [1, 0, 0, 1, 40, 740],
        width: 350,
      }]),
      makePage([]),
      makePage([]),
    ];
    ocrLogger = null;
    canvases = [];
    vi.mocked(pdfjs.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: vi.fn(async (number) => pages[number - 1]),
        destroy: vi.fn(),
      }),
      destroy: vi.fn(),
    });
    vi.mocked(createWorker).mockImplementation(async (_language, _oem, options) => {
      ocrLogger = options.logger;
      return {
        recognize: vi.fn(async () => {
          ocrLogger({ progress: 0.5 });
          return { data: { text: pages[1].cleanup.mock.calls.length ? ocrAnswer : ocrQuestion } };
        }),
        terminate: vi.fn(async () => {}),
      };
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options);
      if (tagName === 'canvas') canvases.push(element);
      return element;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts text and scanned pages in order, reuses one OCR worker, and frees canvases', async () => {
    const progress = [];
    const [result] = await extractPdfBatch(
      [{ name: 'mixed.pdf', arrayBuffer: async () => new ArrayBuffer(8) }],
      (detail) => progress.push(detail),
    );

    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].passages[0].text).toContain('short passage');
    expect(result.exams[0].passages[0].questions[0]).toMatchObject({
      correctAnswer: 'B',
      confidence: 'low',
    });
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(pages.map((page) => page.cleanup)).toHaveLength(3);
    expect(pages.every((page) => page.cleanup.mock.calls.length === 1)).toBe(true);
    expect(canvases).toHaveLength(2);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(progress.some((detail) => detail.pageNumber === 3 && detail.status === 'ocr')).toBe(true);
  });

  it('stops the batch when cancelled during recognition', async () => {
    const controller = new AbortController();
    vi.mocked(pdfjs.getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn(async (number) => pages[number - 1]),
        destroy: vi.fn(),
      }),
      destroy: vi.fn(),
    });
    vi.mocked(createWorker).mockImplementation(async () => ({
      recognize: vi.fn(async () => {
        controller.abort();
        return { data: { text: ocrQuestion } };
      }),
      terminate: vi.fn(async () => {}),
    }));

    await expect(extractPdfBatch(
      [{ name: 'scan.pdf', arrayBuffer: async () => new ArrayBuffer(8) }],
      () => {},
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });
  });
});
