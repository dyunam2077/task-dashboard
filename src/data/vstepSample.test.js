import { describe, expect, it } from 'vitest';
import { vstepSample } from './vstepSample';

describe('VSTEP starter paper', () => {
  it('contains the four source passages and all forty keyed questions in order', () => {
    const questions = vstepSample.passages.flatMap((passage) => passage.questions);

    expect(vstepSample.passages.map((passage) => passage.title))
      .toEqual(['Passage 1', 'Passage 2', 'Passage 3', 'Passage 4']);
    expect(questions).toHaveLength(40);
    expect(questions.map((question) => question.number))
      .toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    questions.forEach((question) => {
      expect(question.choices.map(({ label }) => label)).toEqual(['A', 'B', 'C', 'D']);
      expect(['A', 'B', 'C', 'D']).toContain(question.correctAnswer);
      expect(question.explanation.trim().length).toBeGreaterThan(0);
    });
  });
});
