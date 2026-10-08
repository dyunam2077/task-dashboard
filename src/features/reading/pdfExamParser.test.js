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
