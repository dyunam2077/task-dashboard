import { describe, expect, it } from 'vitest';
import { normalizePdfText, parsePdfExamText } from './pdfExamParser';

const cleanPdfText = `Practice Test 1
Reading Passage 1: A city park
The park is a popular place for local families. It opened in the spring.

1. Why do families
visit the park?
(A) To exercise
regularly
(B) To relax
(C) To study
(D) To shop

Answer Key: 1. B - The passage says the park is popular with local families.`;

describe('PDF exam text parser', () => {
  it('parses clean passage, question, four choices, and answer explanation', () => {
    const [exam] = parsePdfExamText(cleanPdfText, { filename: 'parks.pdf' });

    expect(exam.title).toBe('Practice Test 1');
    expect(exam.passages[0]).toMatchObject({
      title: 'A city park',
      text: 'The park is a popular place for local families. It opened in the spring.',
      questionRange: '1–1',
    });
    expect(exam.passages[0].questions[0]).toMatchObject({
      number: 1,
      prompt: 'Why do families visit the park?',
      choices: [
        { label: 'A', text: 'To exercise regularly' },
        { label: 'B', text: 'To relax' },
        { label: 'C', text: 'To study' },
        { label: 'D', text: 'To shop' },
      ],
      correctAnswer: 'B',
      explanation: 'The passage says the park is popular with local families.',
      confidence: 'high',
    });
  });

  it('normalizes common OCR mistakes and marks OCR questions for review', () => {
    const ocrText = `Reading Passage 1
The museum is open every day.
Question lO. What time does it close?
A」 At four
B) At five
C) At six
D) At seven
Answer Key
lO. D - The opening hours list a six o'clock closing time.`;
    const normalized = normalizePdfText(ocrText);
    const [exam] = parsePdfExamText(
      `<<<PAGE_BREAK:3:ocr>>>\n${normalized}`,
      { filename: 'scanned.pdf' },
    );
    const question = exam.passages[0].questions[0];

    expect(question.number).toBe(10);
    expect(question.choices[0]).toEqual({ label: 'A', text: 'At four' });
    expect(question.correctAnswer).toBe('D');
    expect(question.confidence).toBe('low');
    expect(question.warnings).toEqual([]);
  });

  it('parses VSTEP layouts with inline choices, repeated footer headings, Vietnamese keys, and explanations', () => {
    const vstepText = `<<<PAGE_BREAK:1:text>>>
PASSAGE 1
Questions 1-2
This is the first reading passage about planning for a trip.
04B What is needed for the journey?
A. food B. a table C. a bed D. a Jeep
Which item is mentioned in the passage?
A. water B. a book C. a map D. a phone
PASSAGE 1
<<<PAGE_BREAK:2:text>>>
PASSAGE 2
Questions 11-11
This is the second reading passage.
What does the author recommend?
A. leave early B. stay home C. bring water D. travel alone
ĐÁP ÁN
1. B 2. A 1 1. C
GIỎI THÍCH ĐÁP ÁN
What is needed for the journey?
The passage says to bring food and water.
=> Đáp án B là đáp án đúng
Which item is mentioned in the passage?
The opening paragraph mentions water.
=> Đáp án A là đáp án đúng
What does the author recommend?
The passage recommends bringing water.
=> Đáp án C là đáp án đúng`;
    const [exam] = parsePdfExamText(vstepText, { filename: 'vstep.pdf' });

    expect(exam.passages).toHaveLength(2);
    expect(exam.passages.map((passage) => passage.questions.map((question) => question.number)))
      .toEqual([[1, 2], [11]]);
    expect(exam.passages[0].questions[0]).toMatchObject({
      prompt: 'What is needed for the journey?',
      correctAnswer: 'B',
      explanation: 'What is needed for the journey?\nThe passage says to bring food and water.\n=> Đáp án B là đáp án đúng',
      choices: [
        { label: 'A', text: 'food' },
        { label: 'B', text: 'a table' },
        { label: 'C', text: 'a bed' },
        { label: 'D', text: 'a Jeep' },
      ],
    });
    expect(exam.passages[1].questions[0].correctAnswer).toBe('C');
  });

  it('keeps a choice block when OCR misses the question text and flags it for review', () => {
    const [exam] = parsePdfExamText(`PASSAGE 1
Questions 1-1
A passage with a damaged question line.
A. First
B. Second
C. Third
D. Fourth`);

    expect(exam.passages[0].questions[0]).toMatchObject({
      number: 1,
      prompt: '',
      warnings: ['Question text could not be detected.'],
    });
  });

  it('splits multiple sets and reports missing keys/options; rejects unrecognizable PDFs', () => {
    const threeTests = [1, 2, 3].map((test) => `Test ${test}
Reading Passage 1
Passage ${test} text.
1) Choose an option.
A) First
B) Second`).join('\n');
    const exams = parsePdfExamText(threeTests, { filename: 'bundle.pdf' });

    expect(exams).toHaveLength(3);
    expect(exams.map((exam) => exam.passages[0].questions[0].correctAnswer))
      .toEqual([null, null, null]);
    expect(exams[0].passages[0].questions[0].warnings[0])
      .toMatch(/Fewer than four/);
    expect(exams[0].warnings).toContain('No Answer Key section was detected; choose correct answers in the preview.');
    expect(() => parsePdfExamText('A random scanned document without exam headings.'))
      .toThrow(/No reading passage heading/);
  });
});
