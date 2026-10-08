const PAGE_MARKER = /^\s*<<<PAGE_BREAK:(\d+):(text|ocr)>>>\s*$/i;
const PASSAGE_HEADING = /^\s*(?:reading\s+)?passage\s+([1-9]\d*)\b(?:\s*[:–—-]\s*(.*))?\s*$/i;
const TEST_HEADING = /^\s*(?:(?:practice\s+)?test\s+\d+\b|practice\s+test\b)/i;

function normalizeLine(line) {
  return line
    .replace(/[ \t]+/g, ' ')
    .replace(/\b([A-D])\s*[」〕］]/gi, '$1)')
    .replace(/^\s*[Il|](?=\s*[.)])/g, '1')
    .trim();
}

export function normalizePdfText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/-\s*\n\s*(?=[a-z])/gi, '')
    .replace(/([A-D])\s*[」〕］]/gi, '$1)')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function makeLines(text) {
  const lines = [];
  let page = 1;
  let source = 'text';
  normalizePdfText(text).split('\n').forEach((line) => {
    const marker = line.match(PAGE_MARKER);
    if (marker) {
      page = Number(marker[1]);
      source = marker[2].toLowerCase();
    } else if (line) {
      lines.push({ text: line, page, source });
    } else if (lines.length && lines[lines.length - 1].text) {
      lines.push({ text: '', page, source });
    }
  });
  return lines;
}

function splitExamLines(lines) {
  const testHeadings = [];
  lines.forEach((line, index) => {
    if (TEST_HEADING.test(line.text)) testHeadings.push(index);
  });

  if (testHeadings.length > 1) {
    const starts = [0, ...testHeadings.slice(1)];
    return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length));
  }

  const passageOneHeadings = [];
  lines.forEach((line, index) => {
    if (line.text.match(PASSAGE_HEADING)?.[1] === '1') passageOneHeadings.push(index);
  });
  if (passageOneHeadings.length > 1) {
    const starts = [0];
    for (const index of passageOneHeadings.slice(1)) {
      const previousSegment = lines.slice(starts[starts.length - 1], index);
      if (previousSegment.some((line) => Number(line.text.match(PASSAGE_HEADING)?.[1]) > 1)) {
        starts.push(index);
      }
    }
    if (starts.length > 1) {
      return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length));
    }
  }
  return [lines];
}

function questionNumber(line) {
  const match = line.match(/^\s*(?:question\s*)?([0-9Il|O]{1,3})\s*[.)]?\s*[:\-]?\s*(.*)$/i);
  if (!match) return null;
  const number = Number(match[1].replace(/[Il|]/g, '1').replace(/O/gi, '0'));
  return Number.isInteger(number) && number > 0 ? { number, prompt: match[2].trim() } : null;
}

function optionLine(line) {
  const match = line.match(/^\s*(?:\(([A-D])\)|\[([A-D])\]|([A-D])\s*[.)\]:]|([A-D])\s*[-–—])\s*(.*)$/i);
  if (!match) return null;
  return {
    label: (match[1] || match[2] || match[3] || match[4]).toUpperCase(),
    text: match[5].trim(),
  };
}

function parseAnswerKey(lines) {
  const headingIndex = lines.findIndex((line) => /^\s*(?:answer\s*key|answers?\s*(?:and\s*)?(?:explanations?)?)\b/i.test(line.text));
  if (headingIndex < 0) return new Map();

  const headingLine = lines[headingIndex];
  const headingContent = headingLine.text
    .replace(/^\s*(?:answer\s*key|answers?\s*(?:and\s*)?(?:explanations?)?)\b\s*[:\-]?\s*/i, '')
    .trim();
  const answerLines = [
    ...(headingContent ? [{ ...headingLine, text: headingContent }] : []),
    ...lines.slice(headingIndex + 1),
  ];
  const answers = new Map();
  const answerPattern = /(?:^|\s)(?:question\s*)?([0-9Il|O]{1,3})\s*[.):\-]?\s*([A-D0O])\b/gi;
  for (let index = 0; index < answerLines.length; index += 1) {
    const line = answerLines[index];
    const matches = [...line.text.matchAll(answerPattern)];
    matches.forEach((match, matchIndex) => {
      const number = Number(match[1].replace(/[Il|]/g, '1').replace(/O/gi, '0'));
      const answer = match[2].toUpperCase().replace('0', 'O');
      if (number > 0 && 'ABCD'.includes(answer)) {
        const explanationStart = match.index + match[0].length;
        const explanationEnd = matches[matchIndex + 1]?.index ?? line.text.length;
        const inlineExplanation = line.text
          .slice(explanationStart, explanationEnd)
          .replace(/^[\s,;:.)\-–]+/, '')
          .trim();
        answers.set(number, { answer, explanation: inlineExplanation });
      }
    });
    if (answers.size) {
      const keyNumbersOnLine = [...line.text.matchAll(answerPattern)].length;
      if (keyNumbersOnLine === 1) {
        const numberMatch = line.text.match(/^\s*(?:question\s*)?([0-9Il|O]{1,3})\s*[.):\-]?\s*[A-D0O]\b/i);
        const number = numberMatch
          ? Number(numberMatch[1].replace(/[Il|]/g, '1').replace(/O/gi, '0'))
          : null;
        if (number && !answers.get(number)?.explanation) {
          let next = index + 1;
          const continuation = [];
          while (next < answerLines.length) {
            answerPattern.lastIndex = 0;
            if (answerPattern.test(answerLines[next].text)) break;
            if (answerLines[next].text.trim()) continuation.push(answerLines[next].text);
            next += 1;
          }
          if (continuation.length) {
            answers.set(number, { ...answers.get(number), explanation: continuation.join(' ') });
          }
        }
      }
    }
  }
  return answers;
}

function findQuestionStarts(sectionLines) {
  const candidates = [];
  sectionLines.forEach((line, index) => {
    const question = questionNumber(line.text);
    if (!question) return;
    let optionCount = 0;
    for (let cursor = index + 1; cursor < Math.min(sectionLines.length, index + 18); cursor += 1) {
      if (questionNumber(sectionLines[cursor].text)) break;
      if (optionLine(sectionLines[cursor].text)) optionCount += 1;
    }
    if (optionCount >= 1 || /^\s*question\s+/i.test(line.text)) {
      candidates.push({ index, ...question });
    }
  });
  return candidates;
}

function parseQuestions(sectionLines, starts, answers) {
  return starts.map((start, questionIndex) => {
    const end = starts[questionIndex + 1]?.index ?? sectionLines.length;
    const questionLines = sectionLines.slice(start.index, end);
    let prompt = start.prompt;
    let currentChoice = null;
    const choices = [];

    questionLines.slice(1).forEach(({ text }) => {
      const option = optionLine(text);
      if (option) {
        if (currentChoice) choices.push(currentChoice);
        currentChoice = option;
      } else if (currentChoice) {
        currentChoice.text = `${currentChoice.text} ${text}`.trim();
      } else {
        prompt = `${prompt} ${text}`.trim();
      }
    });
    if (currentChoice) choices.push(currentChoice);

    const key = answers.get(start.number);
    const validChoices = ['A', 'B', 'C', 'D'].map((label) => (
      choices.find((choice) => choice.label === label) || { label, text: '' }
    ));
    const source = questionLines.some((line) => line.source === 'ocr') ? 'ocr' : 'text';
    return {
      number: start.number,
      prompt: prompt.trim(),
      choices: validChoices,
      correctAnswer: key?.answer || null,
      explanation: key?.explanation || '',
      confidence: source === 'ocr' ? 'low' : 'high',
      sourcePage: questionLines[0]?.page || 1,
      sourceText: questionLines.map((line) => line.text).join('\n'),
      warnings: choices.length < 4 ? ['Fewer than four answer choices were detected.'] : [],
    };
  });
}

function parseOneExam(lines, filename, examIndex) {
  const keyStart = lines.findIndex((line) => /^\s*(?:answer\s*key|answers?\s*(?:and\s*)?(?:explanations?)?)\b/i.test(line.text));
  const answerLines = keyStart < 0 ? [] : lines.slice(keyStart);
  const contentLines = keyStart < 0 ? lines : lines.slice(0, keyStart);
  const answers = parseAnswerKey(lines);
  const passageStarts = [];
  contentLines.forEach((line, index) => {
    const match = line.text.match(PASSAGE_HEADING);
    if (match) passageStarts.push({ index, number: Number(match[1]), title: match[2]?.trim() });
  });

  if (!passageStarts.length) {
    throw new Error('No reading passage heading was found. Include headings such as “Reading Passage 1”.');
  }

  const passages = passageStarts.map((passage, index) => {
    const end = passageStarts[index + 1]?.index ?? contentLines.length;
    const section = contentLines.slice(passage.index + 1, end);
    const questionStarts = findQuestionStarts(section);
    const firstQuestion = questionStarts[0]?.index ?? section.length;
    const passageText = section.slice(0, firstQuestion).map((line) => line.text).join('\n').trim();
    const questions = parseQuestions(section, questionStarts, answers);
    if (!passageText && !questions.length) return null;

    const numbers = questions.map((question) => question.number);
    return {
      id: `passage-${passage.number}`,
      title: passage.title || `Passage ${passage.number}`,
      questionRange: numbers.length ? `${Math.min(...numbers)}–${Math.max(...numbers)}` : '',
      text: passageText || '[Reading passage text could not be detected.]',
      sourcePage: contentLines[passage.index].page,
      questions,
    };
  }).filter((passage) => passage && passage.questions.length);

  if (!passages.some((passage) => passage.questions.length)) {
    throw new Error('No multiple-choice questions were detected. Check that each question has numbered text and A/B/C/D choices.');
  }

  const title = lines.find((line) => TEST_HEADING.test(line.text))?.text
    || filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
    || `Imported practice ${examIndex + 1}`;
  const warnings = [];
  passages.forEach((passage) => {
    passage.questions.forEach((question) => {
      if (!question.correctAnswer) warnings.push(`Question ${question.number}: answer key not detected.`);
      if (question.confidence === 'low') warnings.push(`Question ${question.number}: OCR text needs review.`);
      if (question.warnings.length) warnings.push(`Question ${question.number}: fewer than four options detected.`);
    });
  });
  if (!answerLines.length) warnings.push('No Answer Key section was detected; choose correct answers in the preview.');

  return {
    id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${examIndex + 1}`,
    title,
    level: 'VSTEP',
    durationMinutes: 60,
    source: filename,
    passages,
    warnings,
  };
}

export function parsePdfExamText(text, { filename = 'Imported practice.pdf' } = {}) {
  const lines = makeLines(text);
  if (!lines.length) throw new Error('The PDF contains no readable text.');
  if (!lines.some((line) => line.text.match(PASSAGE_HEADING))) {
    throw new Error('No reading passage heading was found. Include headings such as “Reading Passage 1”.');
  }
  const examSections = splitExamLines(lines);
  return examSections
    .filter((section) => section.some((line) => line.text.match(PASSAGE_HEADING)))
    .map((section, index) => parseOneExam(section, filename, index));
}
