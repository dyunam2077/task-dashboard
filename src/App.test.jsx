import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

beforeEach(() => {
  window.localStorage.clear();
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

  it('imports several exam and matching answer files into the practice library', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Import set/ }));
    const dialog = screen.getByRole('dialog');

    const makeExam = (title) => ({
      title,
      passages: [{
        title: 'Passage 1',
        text: 'A short passage.',
        questions: [{
          number: 1,
          prompt: 'Choose the answer.',
          choices: ['One', 'Two', 'Three', 'Four'],
        }],
      }],
    });
    const makeAnswers = (examTitle, answer, explanation) => ({
      type: 'vstep-answers',
      examTitle,
      answers: [{ number: 1, answer, explanation }],
    });
    const files = [
      new File([JSON.stringify(makeExam('My second set'))], 'second-set.json', { type: 'application/json' }),
      new File([JSON.stringify(makeExam('My third set'))], 'third-set.json', { type: 'application/json' }),
      new File([JSON.stringify(makeAnswers('My second set', 'A', 'Second source explanation.'))], 'second-set-answers.json', { type: 'application/json' }),
      new File([JSON.stringify(makeAnswers('My third set', 'C', 'Third source explanation.'))], 'third-set-answers.json', { type: 'application/json' }),
    ];
    await user.upload(document.querySelector('input[type="file"]'), files);
    await user.click(within(dialog).getByRole('button', { name: 'Import set' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'My second set' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Passage 1' })).toBeInTheDocument();
    const thirdSetOption = screen.getByRole('option', { name: 'My third set' });
    expect(thirdSetOption).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Choose a practice set' }),
      thirdSetOption.value,
    );
    expect(screen.getByRole('heading', { name: 'My third set' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /C Three/i }));
    expect(screen.getByText('Third source explanation.')).toBeInTheDocument();
  });
});
