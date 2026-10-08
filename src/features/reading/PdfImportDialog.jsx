import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightIcon,
  ArrowUpTrayIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { extractPdfBatch } from './pdfImport';

function toExamSchema(exam) {
  return {
    id: exam.id,
    title: exam.title,
    level: exam.level,
    durationMinutes: exam.durationMinutes,
    source: exam.source,
    passages: exam.passages.map((passage) => ({
      id: passage.id,
      title: passage.title,
      questionRange: passage.questionRange,
      text: passage.text,
      questions: passage.questions.map((question) => ({
        number: question.number,
        prompt: question.prompt,
        choices: question.choices.map(({ label, text }) => ({ label, text })),
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
      })),
    })),
  };
}

function questionWarnings(question) {
  const warnings = [];
  if (!question.correctAnswer) warnings.push('Missing answer key');
  if (question.choices.some((choice) => !choice.text.trim())) warnings.push('Missing option');
  if (question.confidence === 'low') warnings.push('Low OCR confidence');
  return warnings;
}

export default function PdfImportDialog({ onClose, onImport }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const [results, setResults] = useState(null);
  const [activePreview, setActivePreview] = useState(0);
  const [progress, setProgress] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const inputRef = useRef(null);
  const controllerRef = useRef(null);

  const previews = useMemo(() => (results || []).flatMap((result, fileIndex) => (
    result.error
      ? []
      : result.exams.map((exam, examIndex) => ({
        key: `${fileIndex}:${examIndex}`,
        fileIndex,
        examIndex,
        fileName: result.fileName,
        exam,
        pages: result.pages,
      }))
  )), [results]);
  const active = previews[activePreview] || previews[0];
  const allQuestions = active?.exam.passages.flatMap((passage) => passage.questions) || [];
  const warningCount = allQuestions.reduce((count, question) => count + questionWarnings(question).length, 0);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function updateQuestion(passageIndex, questionIndex, field, value) {
    setResults((current) => current.map((result, fileIndex) => {
      if (fileIndex !== active.fileIndex) return result;
      return {
        ...result,
        exams: result.exams.map((exam, examIndex) => {
          if (examIndex !== active.examIndex) return exam;
          return {
            ...exam,
            passages: exam.passages.map((passage, index) => (
              index !== passageIndex
                ? passage
                : {
                  ...passage,
                  questions: passage.questions.map((question, currentIndex) => (
                    currentIndex !== questionIndex
                      ? question
                      : { ...question, [field]: value }
                  )),
                }
            )),
          };
        }),
      };
    }));
  }

  function updateChoice(passageIndex, questionIndex, choiceIndex, text) {
    setResults((current) => current.map((result, fileIndex) => {
      if (fileIndex !== active.fileIndex) return result;
      return {
        ...result,
        exams: result.exams.map((exam, examIndex) => (
          examIndex !== active.examIndex
            ? exam
            : {
              ...exam,
              passages: exam.passages.map((passage, index) => (
                index !== passageIndex
                  ? passage
                  : {
                    ...passage,
                    questions: passage.questions.map((question, currentIndex) => (
                      currentIndex !== questionIndex
                        ? question
                        : {
                          ...question,
                          choices: question.choices.map((choice, optionIndex) => (
                            optionIndex === choiceIndex ? { ...choice, text } : choice
                          )),
                        }
                    )),
                  }
              )),
            }
        )),
      };
    }));
  }

  async function analyzePdfs() {
    if (!selectedFiles.length) {
      setFileError('Choose one or more PDF files.');
      return;
    }
    setFileError('');
    setResults(null);
    setProgress(null);
    setCancelled(false);
    setIsImporting(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const nextResults = await extractPdfBatch(
        selectedFiles,
        setProgress,
        controller.signal,
      );
      setResults(nextResults);
      setActivePreview(0);
    } catch (error) {
      if (error.name === 'AbortError') {
        setCancelled(true);
      } else {
        setFileError(error.message || 'PDF extraction failed.');
      }
    } finally {
      controllerRef.current = null;
      setIsImporting(false);
      setProgress(null);
    }
  }

  function cancelImport() {
    controllerRef.current?.abort();
  }

  function confirmImport() {
    const exams = previews.map(({ exam }) => toExamSchema(exam));
    if (exams.length) onImport(exams);
  }

  function closeDialog() {
    if (isImporting) cancelImport();
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isImporting) onClose();
    }}>
      <section className={`import-dialog pdf-import-dialog ${results ? 'has-preview' : ''}`} role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">BUILD YOUR LIBRARY</span>
            <h2 id="import-title">Import PDF practice sets</h2>
          </div>
          <button className="icon-button" type="button" onClick={closeDialog} aria-label="Close import dialog">
            <XMarkIcon />
          </button>
        </div>
        {!results && (
          <>
            <p className="dialog-copy">
              Upload one or more reading PDFs. Text is extracted automatically; scanned pages use English OCR.
              Review and correct each detected question before adding it to your library.
            </p>
            <button className="upload-dropzone" type="button" onClick={() => inputRef.current?.click()} disabled={isImporting}>
              <span className="upload-icon"><ArrowUpTrayIcon /></span>
              <strong>{selectedFiles.length ? `${selectedFiles.length} PDF${selectedFiles.length > 1 ? 's' : ''} selected` : 'Choose PDF files'}</strong>
              <span>PDF only · multiple files supported</span>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  const invalid = files.filter((file) => !file.name.toLowerCase().endsWith('.pdf'));
                  setSelectedFiles(files.filter((file) => file.name.toLowerCase().endsWith('.pdf')));
                  setResults(null);
                  setCancelled(false);
                  setFileError(invalid.length ? `${invalid.map((file) => file.name).join(', ')} is not a PDF. Only .pdf files are accepted.` : '');
                  event.target.value = '';
                }}
                hidden
              />
            </button>
            {selectedFiles.length > 0 && (
              <div className="selected-files">
                {selectedFiles.map((file, index) => (
                  <span className="file-chip" key={`${file.name}-${file.size}-${index}`}>{file.name}</span>
                ))}
              </div>
            )}
            {fileError && <p className="form-error" role="alert">{fileError}</p>}
            {cancelled && <p className="pdf-cancelled" role="status">Import cancelled. You can select files and try again.</p>}
            {progress && (
              <div className="pdf-progress" role="status" aria-live="polite">
                <span className="pdf-progress-spinner" />
                <div>
                  <strong>
                    File {progress.fileIndex}/{progress.fileCount}
                    {progress.pageNumber ? ` – page ${progress.pageNumber}/${progress.pageCount}` : ''}
                    {progress.status === 'ocr' ? ' – running OCR' : progress.status === 'extracting' ? ' – extracting text' : ' – opening PDF'}
                  </strong>
                  <span>{progress.fileName}{progress.ocrProgress != null ? ` · ${Math.round(progress.ocrProgress * 100)}%` : ''}</span>
                </div>
              </div>
            )}
            <div className="dialog-actions">
              <p className="pdf-import-note">Scanned pages may take longer; OCR runs one page at a time and uses the English language model.</p>
              {isImporting ? (
                <button className="button button-quiet" type="button" onClick={cancelImport}>Cancel</button>
              ) : (
                <button className="button button-primary" type="button" onClick={analyzePdfs} disabled={!selectedFiles.length}>
                  Read PDFs <ArrowRightIcon />
                </button>
              )}
            </div>
          </>
        )}
        {results && (
          <div className="pdf-preview">
            <div className="pdf-preview-toolbar">
              <label htmlFor="pdf-preview-select">Detected practice set</label>
              {previews.length > 0 && (
                <select
                  id="pdf-preview-select"
                  value={active?.key || ''}
                  onChange={(event) => setActivePreview(previews.findIndex((preview) => preview.key === event.target.value))}
                >
                  {previews.map((preview) => (
                    <option key={preview.key} value={preview.key}>{preview.exam.title} · {preview.fileName}</option>
                  ))}
                </select>
              )}
            </div>
            {results.filter((result) => result.error).map((result) => (
              <p className="pdf-file-error" role="alert" key={result.fileName}>
                <strong>{result.fileName}</strong>: {result.error}
              </p>
            ))}
            {active ? (
              <>
                <div className="pdf-preview-summary">
                  <strong>{active.exam.title}</strong>
                  <span>{active.exam.passages.length} passages · {allQuestions.length} questions</span>
                  <span className={warningCount ? 'warning-count' : 'success-count'}>
                    {warningCount ? `${warningCount} item${warningCount === 1 ? '' : 's'} need review` : 'No warnings'}
                  </span>
                </div>
                <div className="pdf-question-list">
                  {active.exam.passages.map((passage, passageIndex) => (
                    <section className="pdf-passage-preview" key={`${active.key}-${passage.id}`}>
                      <h3>{passage.title} <span>{passage.questions.length} questions</span></h3>
                      {passage.questions.map((question, questionIndex) => {
                        const warnings = questionWarnings(question);
                        const sourcePage = active.pages.find((page) => page.number === question.sourcePage);
                        return (
                          <article className="pdf-question-preview" key={`${passage.id}-${question.number}`}>
                            <div className="pdf-question-preview-head">
                              <strong>Question {question.number}</strong>
                              <span>{question.confidence === 'low' ? 'Low OCR confidence' : 'Text extracted'}</span>
                              {warnings.length > 0 && <span className="warning-count">{warnings.join(' · ')}</span>}
                            </div>
                            <label>
                              Question
                              <textarea
                                rows="2"
                                value={question.prompt}
                                onChange={(event) => updateQuestion(passageIndex, questionIndex, 'prompt', event.target.value)}
                              />
                            </label>
                            <div className="pdf-choice-editor">
                              {question.choices.map((choice, choiceIndex) => (
                                <label key={choice.label}>
                                  <span>{choice.label}</span>
                                  <input
                                    value={choice.text}
                                    aria-label={`Question ${question.number} option ${choice.label}`}
                                    onChange={(event) => updateChoice(passageIndex, questionIndex, choiceIndex, event.target.value)}
                                  />
                                </label>
                              ))}
                            </div>
                            <label className="pdf-answer-editor">
                              Correct answer
                              <select
                                value={question.correctAnswer || ''}
                                onChange={(event) => updateQuestion(passageIndex, questionIndex, 'correctAnswer', event.target.value || null)}
                              >
                                <option value="">Select an answer</option>
                                {['A', 'B', 'C', 'D'].map((label) => <option key={label} value={label}>{label}</option>)}
                              </select>
                            </label>
                            <label>
                              Explanation
                              <textarea
                                rows="2"
                                value={question.explanation || ''}
                                onChange={(event) => updateQuestion(passageIndex, questionIndex, 'explanation', event.target.value)}
                              />
                            </label>
                            <details className="pdf-source-text">
                              <summary>Original PDF text · page {question.sourcePage}</summary>
                              <pre>{sourcePage?.text || question.sourceText}</pre>
                            </details>
                          </article>
                        );
                      })}
                    </section>
                  ))}
                </div>
                <div className="dialog-actions pdf-preview-actions">
                  <button className="button button-quiet" type="button" onClick={() => setResults(null)}>Choose other PDFs</button>
                  <button className="button button-primary" type="button" onClick={confirmImport}>
                    Add {previews.length} set{previews.length === 1 ? '' : 's'} to library <ArrowRightIcon />
                  </button>
                </div>
              </>
            ) : (
              <p className="form-error">No practice sets could be detected. Check the PDF format and try another file.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
