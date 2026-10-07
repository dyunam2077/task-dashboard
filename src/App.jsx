import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpTrayIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ClockIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { vstepSample } from './data/vstepSample';
import { createAnswerTemplate, createImportTemplate, importExamDocuments } from './features/reading/examLibrary';

const LIBRARY_KEY = 'vstep-reading-library-v1';
const PROGRESS_KEY = 'vstep-reading-progress-v1';

function readLocalJson(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    return { value: fallback, error };
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function downloadJson(filename, content) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read ${file.name} as text.`));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

function ImportDialog({ onClose, onImport }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [error, setError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const inputRef = useRef(null);

  async function handleImport() {
    if (!selectedFiles.length) {
      setError('Choose an exam JSON file to import.');
      return;
    }

    setIsImporting(true);
    setError('');
    try {
      const documents = await Promise.all(selectedFiles.map(async (file) => {
        const contents = await readFileAsText(file);
        try {
          return JSON.parse(contents);
        } catch (parseError) {
          if (!(parseError instanceof SyntaxError)) throw parseError;
          throw new Error(`${file.name} is not valid JSON. Use the template to check its format.`);
        }
      }));
      onImport(importExamDocuments(documents));
    } catch (importError) {
      setError(importError.message);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">BUILD YOUR LIBRARY</span>
            <h2 id="import-title">Import practice sets</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close import dialog">
            <XMarkIcon />
          </button>
        </div>
        <p className="dialog-copy">
          Import multiple exams and their answer/explanation JSON files together. Match each separate answer
          file by exam title; everything stays in this browser.
        </p>
        <button className="upload-dropzone" type="button" onClick={() => inputRef.current?.click()}>
          <span className="upload-icon"><ArrowUpTrayIcon /></span>
          <strong>{selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} selected` : 'Choose exam files'}</strong>
          <span>JSON files · one or more exams and matching answer keys</span>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            multiple
            onChange={(event) => {
              setSelectedFiles(Array.from(event.target.files || []));
              setError('');
            }}
            hidden
          />
        </button>
        {selectedFiles.length > 0 && (
          <div className="selected-files">
            {selectedFiles.map((file) => (
              <span className="file-chip" key={`${file.name}-${file.size}`}>{file.name}</span>
            ))}
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <div className="template-actions">
            <button className="button button-quiet" type="button" onClick={() => downloadJson('vstep-exam-template.json', createImportTemplate())}>
              <ArrowDownTrayIcon />
              Exam template
            </button>
            <button className="button button-quiet" type="button" onClick={() => downloadJson('vstep-answers-template.json', createAnswerTemplate())}>
              <ArrowDownTrayIcon />
              Answer template
            </button>
          </div>
          <button className="button button-primary" type="button" onClick={handleImport} disabled={isImporting}>
            {isImporting ? 'Importing…' : 'Import set'}
            {!isImporting && <ArrowRightIcon />}
          </button>
        </div>
        <p className="template-note">
          Add <code>examTitle</code> to each separate answer file when importing multiple sets. Each answer entry
          uses its question <code>number</code>, <code>answer</code>, and source <code>explanation</code>.
        </p>
      </section>
    </div>
  );
}

function App() {
  const storedLibrary = readLocalJson(LIBRARY_KEY, []);
  const [library, setLibrary] = useState(Array.isArray(storedLibrary) ? storedLibrary : []);
  const [progress, setProgress] = useState(() => {
    const saved = readLocalJson(PROGRESS_KEY, {});
    return saved && !saved.error && typeof saved === 'object' ? saved : {};
  });
  const [storageWarning, setStorageWarning] = useState(storedLibrary?.error ? 'Saved browser data could not be read; the sample exam is available.' : '');
  const [activeExamId, setActiveExamId] = useState('');
  const [activePassageIndex, setActivePassageIndex] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(vstepSample.durationMinutes * 60);
  const [timerRunning, setTimerRunning] = useState(false);

  const exams = useMemo(() => [vstepSample, ...library], [library]);
  const activeExam = exams.find((exam) => exam.id === activeExamId) || exams[0];
  const currentPassage = activeExam.passages[activePassageIndex] || activeExam.passages[0];
  const examProgress = progress[activeExam.id] || {};
  const selectedCount = Object.keys(examProgress).length;
  const totalQuestions = activeExam.passages.reduce((total, passage) => total + passage.questions.length, 0);
  const currentAnswers = examProgress;
  const correctCount = activeExam.passages.reduce((total, passage) => (
    total + passage.questions.filter((question) => currentAnswers[question.number] === question.correctAnswer).length
  ), 0);

  useEffect(() => {
    if (!activeExamId && exams.length) setActiveExamId(exams[0].id);
  }, [activeExamId, exams]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
    } catch {
      setStorageWarning('This browser could not save your imported library. Export your sets to keep a copy.');
    }
  }, [library]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      setStorageWarning('This browser could not save your answers. Your current attempt will remain available until you leave.');
    }
  }, [progress]);

  useEffect(() => {
    setSecondsLeft(activeExam.durationMinutes * 60);
    setTimerRunning(false);
    setActivePassageIndex(0);
  }, [activeExam.id, activeExam.durationMinutes]);

  useEffect(() => {
    if (!timerRunning || secondsLeft <= 0) return undefined;
    const timer = window.setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning, secondsLeft]);

  useEffect(() => {
    if (secondsLeft === 0) setTimerRunning(false);
  }, [secondsLeft]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function chooseAnswer(questionNumber, label) {
    setProgress((current) => ({
      ...current,
      [activeExam.id]: {
        ...(current[activeExam.id] || {}),
        [questionNumber]: label,
      },
    }));
  }

  function handleImport(importedExams) {
    const imported = importedExams.map((exam, index) => ({
      ...exam,
      id: `${exam.id}-${Date.now()}-${index + 1}`,
    }));
    setLibrary((current) => [...current, ...imported]);
    setActiveExamId(imported[0].id);
    setActivePassageIndex(0);
    setShowImport(false);
    setToast(`${imported.length} practice set${imported.length === 1 ? '' : 's'} added to your library`);
  }

  function removeCurrentExam() {
    if (activeExam.id === vstepSample.id) return;
    setLibrary((current) => current.filter((exam) => exam.id !== activeExam.id));
    setProgress((current) => {
      const next = { ...current };
      delete next[activeExam.id];
      return next;
    });
    setActiveExamId(vstepSample.id);
    setToast('Imported practice set removed');
  }

  function navigatePassage(index) {
    setActivePassageIndex(Math.min(Math.max(index, 0), activeExam.passages.length - 1));
    document.querySelector('.exam-workspace')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function jumpToQuestion(number) {
    document.getElementById(`question-${activeExam.id}-${number}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="VSTEP Reading practice home">
          <span className="brand-mark"><BookOpenIcon /></span>
          <span className="brand-name">VSTEP <span>READING</span></span>
        </a>
        <div className="topbar-right">
          <label className="exam-select-label" htmlFor="exam-select">PRACTICE SET</label>
          <select
            id="exam-select"
            className="exam-select"
            value={activeExam.id}
            onChange={(event) => setActiveExamId(event.target.value)}
            aria-label="Choose a practice set"
          >
            {exams.map((exam, index) => (
              <option key={exam.id} value={exam.id}>
                {index === 0 ? 'Source practice · 01' : exam.title}
              </option>
            ))}
          </select>
          {activeExam.id !== vstepSample.id && (
            <button className="text-button remove-set" type="button" onClick={removeCurrentExam}>Remove set</button>
          )}
          <button className="button button-import" type="button" onClick={() => setShowImport(true)}>
            <ArrowUpTrayIcon />
            <span>Import set</span>
          </button>
        </div>
      </header>

      <main className="exam-page">
        <section className="exam-heading">
          <div className="heading-copy">
            <div className="breadcrumb"><span>Reading practice</span><span className="breadcrumb-separator">/</span><span>{activeExam.title}</span></div>
            <h1>{activeExam.title}</h1>
            <div className="exam-meta">
              <span>{activeExam.level || 'VSTEP'}</span>
              <span className="meta-dot" />
              <span>{activeExam.passages.length} passages</span>
              <span className="meta-dot" />
              <span>{totalQuestions} questions</span>
              {activeExam.source && <><span className="meta-dot" /><span className="source-label">From {activeExam.source}</span></>}
            </div>
          </div>
          <div className="exam-tools">
            <div className={`timer-pill ${secondsLeft < 300 ? 'timer-low' : ''}`} aria-live="polite">
              <ClockIcon />
              <span className="timer-label">TIME LEFT</span>
              <strong>{formatTime(secondsLeft)}</strong>
              <button type="button" className="timer-toggle" onClick={() => setTimerRunning((running) => !running)} aria-label={timerRunning ? 'Pause timer' : 'Start timer'}>
                {timerRunning ? 'Pause' : 'Start'}
              </button>
            </div>
            <button className="button button-quiet export-button" type="button" onClick={() => downloadJson(`${activeExam.id}.json`, activeExam)}>
              <ArrowDownTrayIcon />
              <span>Export</span>
            </button>
          </div>
        </section>

        <nav className="passage-tabs" aria-label="Passage navigation">
          {activeExam.passages.map((passage, index) => {
            const answered = passage.questions.filter((question) => currentAnswers[question.number]).length;
            return (
              <button
                className={`passage-tab ${activePassageIndex === index ? 'is-active' : ''}`}
                key={passage.id}
                type="button"
                onClick={() => navigatePassage(index)}
                aria-current={activePassageIndex === index ? 'step' : undefined}
              >
                <span className="passage-tab-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="passage-tab-name">{passage.title}</span>
                <span className="passage-tab-count">{passage.questions.length} Q</span>
                {answered === passage.questions.length && <CheckCircleIcon className="tab-complete" />}
              </button>
            );
          })}
        </nav>

        <div className="progress-row">
          <div className="progress-copy">
            <span>YOUR PROGRESS</span>
            <strong>{selectedCount}<span> / {totalQuestions} answered</span></strong>
          </div>
          <div className="progress-bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax={totalQuestions} aria-valuenow={selectedCount}>
            <span style={{ width: `${totalQuestions ? Math.min(100, (selectedCount / totalQuestions) * 100) : 0}%` }} />
          </div>
          <div className="score-copy"><strong>{correctCount}</strong><span> correct so far</span></div>
        </div>

        <section className="exam-workspace" aria-label="Reading passage and questions">
          <article className="reading-pane">
            <div className="pane-heading">
              <div>
                <span className="eyebrow">READING PASSAGE</span>
                <h2>{currentPassage.title}</h2>
              </div>
              <span className="question-range">{currentPassage.questionRange || `${currentPassage.questions[0].number}–${currentPassage.questions[currentPassage.questions.length - 1].number}`}</span>
            </div>
            <div className="reading-text">
              {currentPassage.text.split(/\n{2,}/).map((paragraph, index) => (
                <p key={`${currentPassage.id}-paragraph-${index}`}>{paragraph}</p>
              ))}
            </div>
            <div className="passage-footer">
              <span>Read the passage, then choose the best answer.</span>
              <span>{currentPassage.questions.length} questions</span>
            </div>
          </article>

          <aside className="questions-pane" aria-label="Questions and answer choices">
            <div className="questions-heading">
              <div>
                <span className="eyebrow">ANSWER SHEET</span>
                <h2>Questions <span>{currentPassage.questionRange || ''}</span></h2>
              </div>
              <span className="answered-count">{currentPassage.questions.filter((question) => currentAnswers[question.number]).length} / {currentPassage.questions.length}</span>
            </div>
            <div className="question-jump" aria-label="Jump to question">
              {currentPassage.questions.map((question) => (
                <button
                  className={`question-jump-item ${currentAnswers[question.number] ? 'is-answered' : ''}`}
                  type="button"
                  key={question.number}
                  onClick={() => jumpToQuestion(question.number)}
                  aria-label={`Go to question ${question.number}${currentAnswers[question.number] ? ', answered' : ''}`}
                >
                  {question.number}
                </button>
              ))}
            </div>
            <div className="question-scroll">
              {currentPassage.questions.map((question) => {
                const selected = currentAnswers[question.number];
                const isCorrect = selected === question.correctAnswer;
                return (
                  <section
                    className={`question-card ${selected ? (isCorrect ? 'answer-correct' : 'answer-incorrect') : ''}`}
                    id={`question-${activeExam.id}-${question.number}`}
                    key={question.number}
                  >
                    <div className="question-title-row">
                      <span className="question-number">{String(question.number).padStart(2, '0')}</span>
                      <h3>{question.prompt}</h3>
                    </div>
                    <div className="answer-options" role="radiogroup" aria-label={`Answer choices for question ${question.number}`}>
                      {question.choices.map((choice) => {
                        const selectedChoice = selected === choice.label;
                        const isAnswer = selected && question.correctAnswer === choice.label;
                        return (
                          <button
                            className={`answer-option ${selectedChoice ? 'is-selected' : ''} ${isAnswer ? 'is-correct' : ''} ${selectedChoice && !isCorrect ? 'is-wrong' : ''}`}
                            type="button"
                            role="radio"
                            aria-checked={selectedChoice}
                            key={choice.label}
                            onClick={() => chooseAnswer(question.number, choice.label)}
                          >
                            <span className="choice-label">{choice.label}</span>
                            <span className="choice-text">{choice.text}</span>
                            {isAnswer && <CheckCircleIcon className="choice-state-icon" aria-label="Correct answer" />}
                          </button>
                        );
                      })}
                    </div>
                    {selected && (
                      <div className={`explanation-box ${isCorrect ? 'explanation-correct' : 'explanation-incorrect'}`} aria-live="polite">
                        <div className="explanation-heading">
                          <CheckCircleIcon />
                          <strong>{isCorrect ? 'That’s right' : `Not quite — the answer is ${question.correctAnswer}`}</strong>
                        </div>
                        <p>{question.explanation}</p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </aside>
        </section>

        <footer className="workspace-footer">
          <button className="button button-quiet" type="button" onClick={() => navigatePassage(activePassageIndex - 1)} disabled={activePassageIndex === 0}>
            <ArrowLeftIcon />
            Previous passage
          </button>
          <span className="footer-progress">Passage {activePassageIndex + 1} of {activeExam.passages.length}</span>
          <button className="button button-primary" type="button" onClick={() => navigatePassage(activePassageIndex + 1)} disabled={activePassageIndex === activeExam.passages.length - 1}>
            Next passage
            <ArrowRightIcon />
          </button>
        </footer>
        <p className="local-note">Your answers and imported sets are saved only on this device.</p>
        {storageWarning && <p className="storage-warning" role="status">{storageWarning}</p>}
      </main>

      {showImport && <ImportDialog onClose={() => setShowImport(false)} onImport={handleImport} />}
      {toast && <div className="toast" role="status"><CheckCircleIcon />{toast}</div>}
    </div>
  );
}

export default App;
