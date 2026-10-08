import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import { parsePdfExamText } from './pdfExamParser';

const PAGE_BREAK = (page, source) => `\n<<<PAGE_BREAK:${page}:${source}>>>\n`;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('PDF import cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function groupTextItems(items) {
  const positioned = items
    .filter((item) => item.str?.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
      width: item.width || 0,
    }));
  if (!positioned.length) return [];

  const sortedXs = positioned.map((item) => item.x).sort((a, b) => a - b);
  let gutter = null;
  let largestGap = 0;
  for (let index = 1; index < sortedXs.length; index += 1) {
    const gap = sortedXs[index] - sortedXs[index - 1];
    const leftCount = index;
    const rightCount = sortedXs.length - index;
    if (gap > Math.max(42, (sortedXs[sortedXs.length - 1] - sortedXs[0]) * 0.08)
      && leftCount >= 4 && rightCount >= 4 && gap > largestGap) {
      largestGap = gap;
      gutter = (sortedXs[index] + sortedXs[index - 1]) / 2;
    }
  }

  const columns = gutter === null
    ? [positioned]
    : [
      positioned.filter((item) => item.x < gutter),
      positioned.filter((item) => item.x >= gutter),
    ];
  return columns.flatMap((column) => {
    const rows = [];
    column.sort((a, b) => b.y - a.y || a.x - b.x).forEach((item) => {
      let row = rows.find((candidate) => Math.abs(candidate.y - item.y) < 3);
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    });
    const orderedRows = rows.sort((a, b) => b.y - a.y);
    const rowGaps = orderedRows.slice(1).map((row, index) => (
      orderedRows[index].y - row.y
    )).sort((a, b) => a - b);
    const typicalRowGap = rowGaps[Math.floor(rowGaps.length / 2)] || 12;
    return orderedRows.flatMap((row, index) => {
      const line = row.items
        .sort((a, b) => a.x - b.x)
        .map((item, index) => {
          if (!index) return item.text;
          const previous = row.items[index - 1];
          const gap = item.x - (previous.x + previous.width);
          return `${gap > 1.5 ? ' ' : ''}${item.text}`;
        })
        .join('')
        .trim();
      const blankBefore = index > 0
        && orderedRows[index - 1].y - row.y > typicalRowGap * 1.8;
      return blankBefore ? ['', line] : [line];
    });
  });
}

function removeRepeatedPageFurniture(pages) {
  const candidates = new Map();
  pages.forEach((page) => {
    const lines = page.text.split('\n').filter(Boolean);
    [...lines.slice(0, 2), ...lines.slice(-2)].forEach((line) => {
      const normalized = line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
      if (normalized.length > 2) {
        const pageNumbers = candidates.get(normalized) || new Set();
        pageNumbers.add(page.number);
        candidates.set(normalized, pageNumbers);
      }
    });
  });
  const minimum = Math.max(2, Math.ceil(pages.length * 0.4));
  const repeated = new Set([...candidates]
    .filter(([, pageNumbers]) => pageNumbers.size >= minimum)
    .map(([line]) => line));
  pages.forEach((page) => {
    const lines = page.text.split('\n');
    page.text = lines.filter((line, index) => {
      const normalized = line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
      const pageNumber = /^(?:page\s*)?#\s*(?:of\s*#)?$/.test(normalized);
      const isPageEdge = index < 2 || index >= lines.length - 2;
      return !(pageNumber && isPageEdge) && !(isPageEdge && repeated.has(normalized));
    }).join('\n');
  });
}

export async function extractPdfBatch(files, onProgress = () => {}, signal) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const results = [];
  let ocrWorker = null;
  let activeRenderTask = null;
  let activeDocument = null;
  let activeLoadingTask = null;
  let activeOcrProgress = () => {};
  const handleAbort = () => {
    activeRenderTask?.cancel();
    activeRenderTask = null;
    const worker = ocrWorker;
    ocrWorker = null;
    if (worker) void worker.terminate().catch(() => {});
    const loadingTask = activeLoadingTask;
    activeLoadingTask = null;
    if (loadingTask) void loadingTask.destroy().catch(() => {});
    activeDocument = null;
  };
  signal?.addEventListener('abort', handleAbort, { once: true });

  async function getOcrWorker() {
    if (!ocrWorker) {
      const { createWorker } = await import('tesseract.js');
      throwIfAborted(signal);
      const workerOptions = {
        workerPath: tesseractWorkerUrl,
        logger: (message) => activeOcrProgress({
          status: 'ocr',
          ocrProgress: message.progress,
        }),
      };
      if (import.meta.env.VITE_TESSERACT_CORE_PATH) {
        workerOptions.corePath = import.meta.env.VITE_TESSERACT_CORE_PATH;
      }
      if (import.meta.env.VITE_TESSERACT_LANG_PATH) {
        workerOptions.langPath = import.meta.env.VITE_TESSERACT_LANG_PATH;
      }
      ocrWorker = await createWorker('eng', 1, workerOptions);
    }
    return ocrWorker;
  }

  try {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      let fileResult;
      try {
        throwIfAborted(signal);
        onProgress({ fileIndex: fileIndex + 1, fileCount: files.length, fileName: file.name, status: 'loading' });
        const data = await file.arrayBuffer();
        throwIfAborted(signal);
        const loadingTask = pdfjs.getDocument({ data, isEvalSupported: false });
        activeLoadingTask = loadingTask;
        activeDocument = await loadingTask.promise;
        const pages = [];
        const pageCount = activeDocument.numPages;

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          throwIfAborted(signal);
          const page = await activeDocument.getPage(pageNumber);
          onProgress({
            fileIndex: fileIndex + 1,
            fileCount: files.length,
            fileName: file.name,
            pageNumber,
            pageCount,
            status: 'extracting',
          });

          let text = '';
          let source = 'text';
          try {
            const content = await page.getTextContent();
            text = groupTextItems(content.items).join('\n');
            if (text.replace(/\s/g, '').length < 30) {
              source = 'ocr';
              activeOcrProgress = (detail) => onProgress({
                fileIndex: fileIndex + 1,
                fileCount: files.length,
                fileName: file.name,
                pageNumber,
                pageCount,
                ...detail,
              });
              const worker = await getOcrWorker();
              throwIfAborted(signal);
              const viewport = page.getViewport({ scale: 2 });
              const canvas = document.createElement('canvas');
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              const context = canvas.getContext('2d', { alpha: false });
              try {
                if (!context) throw new Error(`Could not create a canvas for page ${pageNumber}.`);
                activeRenderTask = page.render({ canvasContext: context, viewport });
                await activeRenderTask.promise;
                activeRenderTask = null;
                throwIfAborted(signal);
                const recognized = await worker.recognize(canvas);
                throwIfAborted(signal);
                text = recognized.data.text || '';
              } finally {
                activeRenderTask?.cancel();
                activeRenderTask = null;
                canvas.width = 0;
                canvas.height = 0;
              }
            }
            pages.push({ number: pageNumber, source, text });
          } finally {
            page.cleanup();
          }
        }

        removeRepeatedPageFurniture(pages);
        const combinedText = pages.map((page) => (
          `${PAGE_BREAK(page.number, page.source)}${page.text}`
        )).join('\n');
        fileResult = {
          fileName: file.name,
          exams: parsePdfExamText(combinedText, { filename: file.name }),
          pages: pages.map(({ number, source, text }) => ({ number, source, text })),
        };
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        fileResult = { fileName: file.name, error: error.message || 'Could not read this PDF.' };
      } finally {
        const loadingTask = activeLoadingTask;
        activeLoadingTask = null;
        activeDocument = null;
        const cleanupErrors = [];
        if (loadingTask) {
          try {
            await loadingTask.destroy();
          } catch (error) {
            cleanupErrors.push(error.message || 'Could not release a PDF resource.');
          }
        }
        if (cleanupErrors.length && !signal?.aborted) {
          fileResult = {
            fileName: file.name,
            error: [fileResult?.error, ...cleanupErrors].filter(Boolean).join(' '),
          };
        }
      }
      if (fileResult) results.push(fileResult);
    }
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    activeRenderTask?.cancel();
    if (ocrWorker) await ocrWorker.terminate();
  }
  return results;
}
