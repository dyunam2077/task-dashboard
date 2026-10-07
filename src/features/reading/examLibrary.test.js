import { describe, expect, it } from 'vitest';
import { createAnswerTemplate, createImportTemplate, importExamDocuments } from './examLibrary';

const examDocument = {
  title: 'Practice set',
  passages: [
    {
      title: 'Passage 1',
      text: 'A reading passage.',
      questions: [
        {
          number: 1,
          prompt: 'What is the answer?',
          choices: ['First', 'Second', 'Third', 'Fourth'],
        },
      ],
    },
  ],
};

describe('exam import', () => {
  it('merges a separate answer and explanation file by question number', () => {
    const [exam] = importExamDocuments([
      examDocument,
      {
        type: 'vstep-answers',
        answers: [{ number: 1, answer: 'B', explanation: 'Source explanation.' }],
      },
    ]);

    expect(exam.passages[0].questions[0]).toMatchObject({
      number: 1,
      correctAnswer: 'B',
      explanation: 'Source explanation.',
    });
  });

  it('pairs multiple exams with their separate answer files by exam title', () => {
    const buildExam = (title) => ({
      ...examDocument,
      title,
    });
    const answerFile = (examTitle, answer, explanation) => ({
      type: 'vstep-answers',
      examTitle,
      answers: [{ number: 1, answer, explanation }],
    });
    const exams = importExamDocuments([
      buildExam('Set One'),
      buildExam('Set Two'),
      answerFile('Set Two', 'C', 'Second source explanation.'),
      answerFile('Set One', 'A', 'First source explanation.'),
    ]);

    expect(exams.map((exam) => [
      exam.title,
      exam.passages[0].questions[0].correctAnswer,
      exam.passages[0].questions[0].explanation,
    ])).toEqual([
      ['Set One', 'A', 'First source explanation.'],
      ['Set Two', 'C', 'Second source explanation.'],
    ]);
  });

  it('accepts a combined file and preserves all four answer labels', () => {
    const [exam] = importExamDocuments([{
      ...examDocument,
      passages: [{
        ...examDocument.passages[0],
        questions: [{
          ...examDocument.passages[0].questions[0],
          correctAnswer: 'A',
          explanation: 'Shown after selection.',
        }],
      }],
    }]);

    expect(exam.passages[0].questions[0].choices.map(({ label }) => label))
      .toEqual(['A', 'B', 'C', 'D']);
  });

  it('rejects incomplete keys and malformed answer choice sets', () => {
    expect(() => importExamDocuments([examDocument])).toThrow(/correctAnswer/);
    expect(() => importExamDocuments([{
      ...examDocument,
      passages: [{
        ...examDocument.passages[0],
        questions: [{
          ...examDocument.passages[0].questions[0],
          choices: ['Only one'],
          correctAnswer: 'A',
          explanation: 'Explanation.',
        }],
      }],
    }])).toThrow(/four non-empty answer choices/);
  });

  it('rejects answer entries that do not map to exam questions', () => {
    expect(() => importExamDocuments([
      examDocument,
      {
        type: 'vstep-answers',
        answers: [
          { number: 1, answer: 'B', explanation: 'Source explanation.' },
          { number: 2, answer: 'A', explanation: 'Unmatched question.' },
        ],
      },
    ])).toThrow(/not found in the exam: 2/);
  });

  it('rejects separate answer files without a match in a multi-exam import', () => {
    expect(() => importExamDocuments([
      { ...examDocument, title: 'Set One' },
      { ...examDocument, title: 'Set Two' },
      {
        type: 'vstep-answers',
        examTitle: 'Set Three',
        answers: [{ number: 1, answer: 'A', explanation: 'Unmatched.' }],
      },
    ])).toThrow(/No matching exam was found/);
  });

  it('provides a reusable JSON template', () => {
    const template = createImportTemplate();

    expect(template.type).toBe('vstep-exam');
    expect(template.passages[0].questions[0].choices).toHaveLength(4);
    expect(createAnswerTemplate()).toMatchObject({
      type: 'vstep-answers',
      examTitle: 'My reading practice',
      answers: [{ number: 1, answer: 'B' }],
    });
  });
});
