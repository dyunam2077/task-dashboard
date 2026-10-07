const labels = ['A', 'B', 'C', 'D'];

function makeId(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function validateExam(exam) {
  if (!exam || typeof exam !== 'object' || !Array.isArray(exam.passages)) {
    throw new Error('The exam file must contain a passages array.');
  }

  const questions = [];
  const passages = exam.passages.map((passage, passageIndex) => {
    if (!passage || typeof passage.text !== 'string' || !passage.text.trim()) {
      throw new Error(`Passage ${passageIndex + 1} is missing its reading text.`);
    }
    if (!Array.isArray(passage.questions) || passage.questions.length === 0) {
      throw new Error(`Passage ${passageIndex + 1} must contain at least one question.`);
    }

    const normalizedQuestions = passage.questions.map((question, questionIndex) => {
      const number = Number(question.number || questions.length + 1);
      const choices = Array.isArray(question.choices)
        ? question.choices.map((choice, index) => (
          typeof choice === 'string'
            ? { label: labels[index], text: choice }
            : { label: String(choice.label || labels[index]).toUpperCase(), text: choice.text }
        ))
        : [];

      if (!Number.isInteger(number) || number < 1) {
        throw new Error(`Question ${questionIndex + 1} in passage ${passageIndex + 1} has an invalid number.`);
      }
      if (typeof question.prompt !== 'string' || !question.prompt.trim()) {
        throw new Error(`Question ${number} is missing its prompt.`);
      }
      if (choices.length !== 4 || choices.some((choice) => typeof choice.text !== 'string' || !choice.text.trim())) {
        throw new Error(`Question ${number} must have four non-empty answer choices.`);
      }
      if (choices.some((choice, index) => choice.label !== labels[index])) {
        throw new Error(`Question ${number} choices must be labeled A, B, C, and D in order.`);
      }

      questions.push(number);
      return {
        number,
        prompt: question.prompt.trim(),
        choices,
        correctAnswer: question.correctAnswer || question.answer || '',
        explanation: question.explanation || '',
      };
    });

    return {
      id: passage.id || `passage-${passageIndex + 1}`,
      title: passage.title || `Passage ${passageIndex + 1}`,
      questionRange: passage.questionRange || '',
      text: passage.text.trim(),
      questions: normalizedQuestions,
    };
  });

  if (new Set(questions).size !== questions.length) {
    throw new Error('Question numbers must be unique across the exam.');
  }

  return {
    ...exam,
    durationMinutes: Number(exam.durationMinutes) > 0 ? Number(exam.durationMinutes) : 60,
    level: exam.level || 'VSTEP',
    passages,
  };
}

function normalizeAnswers(answerDocument) {
  if (!Array.isArray(answerDocument.answers) && (
    !answerDocument.answers || typeof answerDocument.answers !== 'object'
  )) {
    throw new Error('Each answer file must contain an answers array or question-number map.');
  }
  const answers = Array.isArray(answerDocument.answers)
    ? answerDocument.answers
    : Object.entries(answerDocument.answers).map(([number, value]) => ({
      number: Number(number),
      ...(typeof value === 'string' ? { answer: value } : value),
    }));
  const answerNumbers = answers.map((item) => Number(item.number));
  if (answerNumbers.some((number) => !Number.isInteger(number) || number < 1)) {
    throw new Error('Every answer entry needs a positive question number.');
  }
  if (new Set(answerNumbers).size !== answerNumbers.length) {
    throw new Error('The answer file contains duplicate question numbers.');
  }
  return answers;
}

function mergeAnswerDocuments(exam, answerDocuments) {
  if (answerDocuments.length === 0) {
    return validateExam(exam);
  }

  const answers = answerDocuments.flatMap(normalizeAnswers);
  const answerNumbers = answers.map((item) => Number(item.number));
  if (new Set(answerNumbers).size !== answerNumbers.length) {
    throw new Error('More than one answer file supplies the same question number.');
  }
  const byNumber = new Map(answers.map((item) => [Number(item.number), item]));

  const mergedExam = validateExam({
    ...exam,
    passages: exam.passages.map((passage) => ({
      ...passage,
      questions: passage.questions.map((question) => {
        const answer = byNumber.get(Number(question.number));
        if (!answer) return question;
        return {
          ...question,
          correctAnswer: answer.correctAnswer || answer.answer || question.correctAnswer,
          explanation: answer.explanation ?? question.explanation,
        };
      }),
    })),
  });
  const examNumbers = new Set(mergedExam.passages.flatMap((passage) => (
    passage.questions.map((question) => question.number)
  )));
  const unknownAnswers = answerNumbers.filter((number) => !examNumbers.has(number));
  if (unknownAnswers.length) {
    throw new Error(`The answer file refers to question numbers not found in the exam: ${unknownAnswers.join(', ')}.`);
  }
  return mergedExam;
}

function assertAnswerKey(exam) {
  exam.passages.forEach((passage) => {
    passage.questions.forEach((question) => {
      if (!labels.includes(question.correctAnswer)) {
        throw new Error(`Question ${question.number} needs a correctAnswer (A, B, C, or D) in the answer file.`);
      }
      if (typeof question.explanation !== 'string' || !question.explanation.trim()) {
        throw new Error(`Question ${question.number} is missing its explanation.`);
      }
    });
  });
  return exam;
}

export function importExamDocuments(documents) {
  const answerDocuments = documents
    .filter((document) => document && document.type === 'vstep-answers')
    .flatMap((document) => (
      Array.isArray(document.tests)
        ? document.tests.map((test) => ({
          examId: test.examId || test.id,
          examTitle: test.examTitle || test.title,
          answers: test.answers,
        }))
        : [document]
    ));
  const examDocuments = documents.filter((document) => (
    document && document.type !== 'vstep-answers'
  ));

  if (examDocuments.length === 0) {
    throw new Error('Choose an exam JSON file. An answer/explanation JSON file is optional if the exam already includes both.');
  }
  const sourceExams = examDocuments.flatMap((document) => (
    Array.isArray(document.tests) ? document.tests : [document]
  ));
  const hasUnkeyedAnswers = answerDocuments.some((answer) => !answer.examId && !answer.examTitle);
  if (hasUnkeyedAnswers && sourceExams.length !== 1) {
    throw new Error('When importing multiple exams, add an examTitle or examId to each separate answer file so the sets can be matched.');
  }
  if (hasUnkeyedAnswers && answerDocuments.length > 1) {
    throw new Error('Give each separate answer file an examTitle or examId to match it to its exam.');
  }

  const answersByExam = sourceExams.map(() => []);
  answerDocuments.forEach((answer) => {
    const matchingExamIndexes = sourceExams
      .map((exam, index) => {
        const examId = String(exam.id || '').trim().toLowerCase();
        const examTitle = String(exam.title || '').trim().toLowerCase();
        const matches = (!answer.examId && !answer.examTitle)
          || (answer.examId && String(answer.examId).trim().toLowerCase() === examId)
          || (answer.examTitle && String(answer.examTitle).trim().toLowerCase() === examTitle);
        return matches ? index : -1;
      })
      .filter((index) => index !== -1);

    if (matchingExamIndexes.length !== 1) {
      const identifier = answer.examTitle || answer.examId;
      if (matchingExamIndexes.length > 1) {
        throw new Error(`The answer file identifier "${identifier}" matches more than one exam.`);
      }
      throw new Error(
        identifier
          ? `No matching exam was found for answer file: ${identifier}.`
          : 'An answer file does not match an exam.',
      );
    }

    answersByExam[matchingExamIndexes[0]].push(answer);
  });

  const importedExams = sourceExams.map((exam, index) => (
    assertAnswerKey(mergeAnswerDocuments(exam, answersByExam[index]))
  ));

  const ids = new Set();
  return importedExams.map((exam, index) => {
    const title = exam.title || `Imported practice ${index + 1}`;
    const baseId = makeId(title) || `imported-practice-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (ids.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    ids.add(id);
    return { ...exam, id, title };
  });
}

export function createImportTemplate() {
  return {
    type: 'vstep-exam',
    title: 'My reading practice',
    level: 'B1–B2–C1',
    durationMinutes: 60,
    passages: [
      {
        title: 'Passage 1',
        questionRange: '1–10',
        text: 'Paste the reading passage here.',
        questions: [
          {
            number: 1,
            prompt: 'Write the question here.',
            choices: [
              { label: 'A', text: 'First option' },
              { label: 'B', text: 'Second option' },
              { label: 'C', text: 'Third option' },
              { label: 'D', text: 'Fourth option' },
            ],
          },
        ],
      },
    ],
  };
}

export function createAnswerTemplate() {
  return {
    type: 'vstep-answers',
    examTitle: 'My reading practice',
    answers: [
      {
        number: 1,
        answer: 'B',
        explanation: 'Paste the source explanation exactly as it appears in your answer file.',
      },
    ],
  };
}
