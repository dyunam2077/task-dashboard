import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { extractPdfBatch } from './features/reading/pdfImport';

vi.mock('./features/reading/pdfImport', () => ({
  extractPdfBatch: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(extractPdfBatch).mockReset();
});

describe('VSTEP reading practice', () => {
  it('keeps the passage and answer sheet together and reveals the selected answer explanation', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Passage 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Questions 1–10/ })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /B It was not necessary/i }));

    expect(screen.getByText('That’s right')).toBeInTheDocument();
    expect(screen.getAllByText(/It was Strafe who found Glencorn for us/)).toHaveLength(2);
  });

  it('navigates in passage order', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Next passage' }));

    expect(screen.getByRole('heading', { name: 'Passage 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Questions 11–20/ })).toBeInTheDocument();
  });

  it('accepts PDFs only and previews extracted questions before importing them', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Import set/ }));
    const dialog = screen.getByRole('dialog');
    const input = document.querySelector('input[type="file"]');
    expect(input.accept).toBe('.pdf,application/pdf');
    input.accept = '';
    await user.upload(input, new File(['{}'], 'not-an-exam.json', { type: 'application/json' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Only \.pdf files are accepted/);
    expect(within(dialog).getByRole('button', { name: /Read PDFs/ })).toBeDisabled();
    input.accept = '.pdf,application/pdf';

    const question = {
      number: 1,
      prompt: 'Choose the answer.',
      choices: [
        { label: 'A', text: 'First' },
        { label: 'B', text: 'Second' },
        { label: 'C', text: 'Third' },
        { label: 'D', text: 'Fourth' },
      ],
      correctAnswer: null,
      explanation: 'The source says the second option is correct.',
      confidence: 'high',
      sourcePage: 1,
      sourceText: '1. Choose the answer.',
      warnings: [],
    };
    extractPdfBatch.mockResolvedValue([{
      fileName: 'practice.pdf',
      exams: [{
        id: 'practice-test-1',
        title: 'Practice Test 1',
        level: 'VSTEP',
        durationMinutes: 60,
        source: 'practice.pdf',
        passages: [{
          id: 'passage-1',
          title: 'Passage 1',
          questionRange: '1–1',
          text: 'A short reading passage.',
          sourcePage: 1,
          questions: [question],
        }],
        warnings: [],
      }],
      pages: [{ number: 1, source: 'text', text: '1. Choose the answer.' }],
    }]);
    await user.upload(input, new File(['pdf bytes'], 'practice.pdf', { type: 'application/pdf' }));
    await user.click(within(dialog).getByRole('button', { name: /Read PDFs/ }));

    expect(await screen.findByText(/1 passages · 1 questions/)).toBeInTheDocument();
    expect(screen.getByText('1 item need review')).toBeInTheDocument();
    expect(screen.getByText('Original PDF text · page 1')).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Question' }));
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'What did the passage say?');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Correct answer' }), 'A');
    await user.click(within(dialog).getByRole('button', { name: /Add 1 set to library/ }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Practice Test 1' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Passage 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Questions 1–1/ })).toBeInTheDocument();
    expect(extractPdfBatch).toHaveBeenCalledTimes(1);
  });
});
