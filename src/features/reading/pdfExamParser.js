const PAGE_MARKER = /^\s*<<<PAGE_BREAK:(\d+):(text|ocr)>>>\s*$/i;
const PASSAGE_HEADING = /^\s*(?:reading\s+)?passage\s+([1-9]\d*)\b(?:\s*[:–—-]\s*(.*))?\s*$/i;
const TEST_HEADING = /^\s*(?:(?:practice\s+)?test\s+\d+\b|practice\s+test\b)/i;
const ANSWER_KEY_HEADING = /^\s*(?:answer\s*key\b|answers?\b|đáp\s*án(?:\s|$|[:\-]))/i;
const EXPLANATION_HEADING = /^\s*(?:explanations?\b|.*\bth[iíìỉĩị]ch\s*đáp\s*án(?:\s|$|[:\-]))/i;

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
    if (isPassageHeading(lines, index)?.[1] === '1') passageOneHeadings.push(index);
  });
  if (passageOneHeadings.length > 1) {
    const starts = [0];
    for (const index of passageOneHeadings.slice(1)) {
      const previousSegment = lines.slice(starts[starts.length - 1], index);
      if (previousSegment.some((line, lineIndex) => (
        Number(isPassageHeading(previousSegment, lineIndex)?.[1]) > 1
      ))) {
        starts.push(index);
      }
    }
    if (starts.length > 1) {
      return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length));
    }
  }
  return [lines];
}

function isPassageHeading(lines, index) {
  const match = lines[index]?.text.match(PASSAGE_HEADING);
  if (!match) return null;
  if (match[2]) return match;
  const following = lines
    .slice(index + 1, index + 7)
    .find(({ text }) => text.trim());
  if (following && /^\s*questions?\s+[0-9Il|O]+\s*[-–—]\s*[0-9Il|O]+\b/i.test(following.text)) return match;
  const pageLines = lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter(({ line }) => line.page === lines[index].page);
  const lastPageLineIndex = pageLines.at(-1)?.lineIndex ?? index;
  return index < lastPageLineIndex - 1 ? match : null;
}

function questionNumber(line) {
  const match = line.match(/^\s*(?:question\s*)?([0-9Il|O]{1,3})\s*[.)]?\s*[:\-]?\s*(.*)$/i);
  if (!match) return null;
  const number = Number(match[1].replace(/[Il|]/g, '1').replace(/O/gi, '0'));
  return Number.isInteger(number) && number > 0 ? { number, prompt: match[2].trim() } : null;
}

function optionSegments(line) {
  const pattern = /(^|[\s])(?:\(([A-D])\)|\[([A-D])\]|([A-D])\s*[.)\]:]|([A-D])\s*[-–—])\s*/gi;
  const markers = [...line.matchAll(pattern)].map((match) => ({
    start: match.index + (match[1] ? 1 : 0),
    end: match.index + match[0].length,
    label: (match[2] || match[3] || match[4] || match[5]).toUpperCase(),
  }));
  if (!markers.length) return null;
  return {
    prefix: line.slice(0, markers[0].start).trim(),
    options: markers.map((marker, index) => ({
      label: marker.label,
      text: line.slice(marker.end, markers[index + 1]?.start ?? line.length).trim(),
    })),
  };
}

function parseAnswerKey(lines) {
  const headingIndex = lines.findIndex((line) => ANSWER_KEY_HEADING.test(line.text));
  if (headingIndex < 0) return new Map();

  const headingLine = lines[headingIndex];
  const headingContent = headingLine.text
    .replace(/^\s*(?:answer\s*key|answers?|đáp\s*án)\s*[:\-]?\s*/i, '')
    .trim();
  const explanationIndex = lines.findIndex((line, index) => (
    index > headingIndex && EXPLANATION_HEADING.test(line.text)
  ));
  const answerLines = [
    ...(headingContent ? [{ ...headingLine, text: headingContent }] : []),
    ...lines.slice(headingIndex + 1, explanationIndex < 0 ? lines.length : explanationIndex),
  ];
  const answers = new Map();
  const answerPattern = /(?:^|\s)(?:question\s*)?([0-9Il|O]{1,3})\s*[.):\-]?\s*([A-D0O])\b/gi;
  for (let index = 0; index < answerLines.length; index += 1) {
    const line = answerLines[index];
    const answerText = line.text
      .replace(/passage\s+[1-4]\b/gi, '')
      .replace(/(^|\s)([1-4])\s+([0-9])(?=\s*[.)]\s*[A-D])/gi, '$1$2$3');
    const matches = [...answerText.matchAll(answerPattern)];
    matches.forEach((match, matchIndex) => {
      const number = Number(match[1].replace(/[Il|]/g, '1').replace(/O/gi, '0'));
      const answer = match[2].toUpperCase().replace('0', 'O');
      if (number > 0 && 'ABCD'.includes(answer)) {
        const explanationStart = match.index + match[0].length;
        const explanationEnd = matches[matchIndex + 1]?.index ?? line.text.length;
        const inlineExplanation = answerText
          .slice(explanationStart, explanationEnd)
          .replace(/^[\s,;:.)\-–]+/, '')
          .trim();
        answers.set(number, { answer, explanation: inlineExplanation });
      }
    });
    if (answers.size) {
      const keyNumbersOnLine = [...answerText.matchAll(answerPattern)].length;
      if (keyNumbersOnLine === 1) {
        const numberMatch = answerText.match(/^\s*(?:question\s*)?([0-9Il|O]{1,3})\s*[.):\-]?\s*[A-D0O]\b/i);
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

function isQuestionPrompt(text) {
  return /[?؟]\s*$/.test(text)
    || /^\s*(?:(?:question\s*)?[0-9Il|O]{1,3}\s*[.)]?\s*)?(?:what|which|who|whom|whose|why|how|where|when|in which|according to|the word|in paragraph|the passage|the author|the writer|the main idea|what is not|choose|select|complete|mark)\b/i.test(text);
}

function questionGroups(sectionLines) {
  const groups = [];
  const pending = [];
  let current = null;
  const finish = () => {
    if (current) groups.push(current);
    current = null;
  };
  const promptFromPending = () => {
    let lastQuestionLine = -1;
    for (let index = Math.max(0, pending.length - 10); index < pending.length; index += 1) {
      if (isQuestionPrompt(pending[index].text)) lastQuestionLine = index;
    }
    let start = lastQuestionLine;
    while (start > 0 && pending[start - 1].text.trim() && isQuestionPrompt(pending[start - 1].text)) start -= 1;
    const lines = start < 0 ? [] : pending.slice(start);
    let prompt = lines
      .map(({ text }) => text
        .replace(/^\s*(?:[°^<*oO0-9Il|]{1,4}[A-D]?)\s+(?=(?:what|which|who|why|how|where|when|the word|in paragraph|according to))/i, '')
        .replace(/^\s*(?:question\s*)?[0-9Il|O]{1,3}\s*[.)]?\s*/i, '')
        .trim())
      .filter((text) => text.length > 1)
      .join(' ')
      .trim();
    prompt = prompt.replace(/\?\s+[a-z][^?]{0,16}$/i, '?').trim();
    const number = lines
      .map(({ text }) => questionNumber(text)?.number)
      .find((candidate) => candidate != null);
    return {
      prompt,
      number,
      startIndex: start < 0 ? pending.length : pending[start].index,
    };
  };

  sectionLines.forEach(({ text, ...metadata }, index) => {
    const split = optionSegments(text);
    if (!split) {
      if (current?.options.length && current.options[current.options.length - 1].label !== 'D') {
        current.options[current.options.length - 1].text = `${current.options[current.options.length - 1].text} ${text}`.trim();
      } else {
        pending.push({ text, ...metadata, index });
      }
      return;
    }
    if (split.prefix) pending.push({ text: split.prefix, ...metadata, index });
    split.options.forEach((option) => {
      if (option.label === 'A') {
        finish();
        const promptDetails = promptFromPending();
        const promptStart = pending.find((line) => line.index === promptDetails.startIndex);
        current = {
          prompt: promptDetails.prompt,
          number: promptDetails.number,
          startIndex: promptDetails.prompt ? promptDetails.startIndex : index,
          sourcePage: promptStart?.page || metadata.page,
          source: promptStart?.source || metadata.source,
          options: [],
        };
        pending.length = 0;
      }
      if (!current) return;
      const previous = current.options[current.options.length - 1];
      if (option.label !== 'A' && previous?.label === option.label) {
        previous.text = `${previous.text} ${option.text}`.trim();
      } else {
        current.options.push(option);
      }
      if (option.label === 'D') finish();
    });
  });
  finish();
  return groups
    .filter((group) => group.options.length >= 3 || (group.prompt && group.options.length >= 2))
    .map((group) => ({
      ...group,
      sourceText: `${group.prompt}\n${group.options.map(({ label, text }) => `${label}. ${text}`).join('\n')}`,
    }));
}

function questionRange(sectionLines) {
  const line = sectionLines.slice(0, 12).find(({ text }) => /questions?/i.test(text) && /[-–—]/.test(text));
  const cleaned = line?.text
    .replace(/(questions)\1/gi, '$1')
    .replace(/\b(\d{2})\1\b/g, '$1')
    .replace(/(-\s*\d{1,2})\1\b/g, '$1');
  const match = cleaned?.match(/questions?\s+([0-9Il|O]{1,3})\s*[-–—]\s*([0-9Il|O]{1,3})/i);
  if (!match) return null;
  const start = Number(match[1].replace(/[Il|]/g, '1').replace(/O/gi, '0'));
  const end = Number(match[2].replace(/[Il|]/g, '1').replace(/O/gi, '0'));
  return Number.isInteger(start) && start > 0 && end >= start ? { start, end } : null;
}

function parseQuestions(sectionLines, groups, answers, explanations, explanationOffset = 0, passageNumber = 1) {
  const range = questionRange(sectionLines);
  const firstNumber = range?.start || Math.max(1, (passageNumber - 1) * 10 + 1);
  const expectedCount = range ? range.end - range.start + 1 : groups.length;
  return groups.slice(0, expectedCount).map((group, questionIndex) => {
    const hintedNumber = group.number;
    const number = range
      ? firstNumber + questionIndex
      : hintedNumber >= firstNumber && hintedNumber < firstNumber + 10
        ? hintedNumber
        : firstNumber + questionIndex;
    const key = answers.get(number);
    const explanation = explanations[explanationOffset + questionIndex];
    const validChoices = ['A', 'B', 'C', 'D'].map((label) => (
      group.options.find((choice) => choice.label === label) || { label, text: '' }
    ));
    return {
      number,
      prompt: group.prompt,
      choices: validChoices,
      correctAnswer: key?.answer || explanation?.answer || null,
      explanation: explanation?.text || key?.explanation || '',
      confidence: group.source === 'ocr' ? 'low' : 'high',
      sourcePage: group.sourcePage || 1,
      sourceText: group.sourceText || group.prompt,
      warnings: [
        ...(group.prompt ? [] : ['Question text could not be detected.']),
        ...(group.options.filter((option) => option.text.trim()).length < 4
          ? ['Fewer than four answer choices were detected.']
          : []),
      ],
    };
  });
}

function parseExplanations(lines) {
  const headingIndex = lines.findIndex((line) => EXPLANATION_HEADING.test(line.text));
  if (headingIndex < 0) return [];
  const explanations = [];
  let current = [];
  lines.slice(headingIndex + 1).forEach(({ text }) => {
    current.push(text);
    const vietnameseAnswer = text.match(/đáp\s*án\s*([A-D])\s*(?:là\s*đáp\s*án\s*đúng|là\s*đúng|đúng)/i);
    const englishAnswer = text.match(/correct\s+answer\s*[:\-]?\s*([A-D])\b/i);
    const answer = vietnameseAnswer?.[1] || englishAnswer?.[1];
    if (answer) {
      explanations.push({ answer: answer.toUpperCase(), text: current.join('\n').trim() });
      current = [];
    }
  });
  return explanations;
}

function parseOneExam(lines, filename, examIndex, answers, explanations, hasAnswerKey) {
  const contentLines = lines;
  const passageStarts = [];
  contentLines.forEach((line, index) => {
    const match = isPassageHeading(contentLines, index);
    if (match) passageStarts.push({ index, number: Number(match[1]), title: match[2]?.trim() });
  });

  if (!passageStarts.length) {
    throw new Error('No reading passage heading was found. Include headings such as “Reading Passage 1”.');
  }

  let questionOffset = 0;
  const passages = passageStarts.map((passage, index) => {
    const end = passageStarts[index + 1]?.index ?? contentLines.length;
    const section = contentLines.slice(passage.index + 1, end);
    const groups = questionGroups(section);
    const firstQuestion = groups[0]?.startIndex ?? section.length;
    const passageText = section.slice(0, firstQuestion).map((line) => line.text).join('\n').trim();
    const questions = parseQuestions(section, groups, answers, explanations, questionOffset, passage.number);
    questionOffset += questions.length;
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
  if (!hasAnswerKey) warnings.push('No Answer Key section was detected; choose correct answers in the preview.');

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
  const keyStart = lines.findIndex((line) => ANSWER_KEY_HEADING.test(line.text));
  const explanationStart = lines.findIndex((line) => EXPLANATION_HEADING.test(line.text));
  const contentEnd = [keyStart, explanationStart].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? lines.length;
  const contentLines = lines.slice(0, contentEnd);
  if (!contentLines.some((line, index) => isPassageHeading(contentLines, index))) {
    throw new Error('No reading passage heading was found. Include headings such as “Reading Passage 1”.');
  }
  const examSections = splitExamLines(contentLines);
  const answers = parseAnswerKey(lines);
  const explanations = parseExplanations(lines);
  return examSections
    .filter((section) => section.some((line, index) => isPassageHeading(section, index)))
    .map((section, index) => parseOneExam(
      section,
      filename,
      index,
      answers,
      explanations,
      keyStart >= 0,
    ));
}
