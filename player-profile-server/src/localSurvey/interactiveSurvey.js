'use strict';

const readline = require('node:readline/promises');

async function promptChoice(readlineInterface, output, question) {
  output.write(`\n${question.text}\n`);
  question.options.forEach((option, index) => {
    output.write(`  ${index + 1}. ${option.label ?? option.value}\n`);
  });

  while (true) {
    const raw = await readlineInterface.question('番号を入力してください: ');
    const normalized = raw.trim();
    const selected = /^[0-9]+$/.test(normalized)
      ? Number.parseInt(normalized, 10)
      : Number.NaN;
    if (Number.isInteger(selected) && selected >= 1 && selected <= question.options.length) {
      return question.options[selected - 1].value;
    }
    output.write(`1〜${question.options.length} の番号を入力してください。\n`);
  }
}

async function collectInteractiveAnswers(
  questions,
  {
    input = process.stdin,
    output = process.stdout,
    createInterface = readline.createInterface,
  } = {}
) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Interactive survey requires at least one question');
  }
  if (!input.isTTY && createInterface === readline.createInterface) {
    throw new Error('Interactive survey requires a terminal; use --answers <file.json>');
  }

  const readlineInterface = createInterface({ input, output });
  const answers = {};
  try {
    for (const question of questions) {
      if (question.type === 'choice') {
        answers[question.id] = await promptChoice(readlineInterface, output, question);
      } else if (question.type === 'freetext') {
        answers[question.id] = await readlineInterface.question(`\n${question.text}\n> `);
      } else {
        throw new Error(`Unsupported interactive question type: ${question.type}`);
      }
    }
  } finally {
    readlineInterface.close();
  }
  return answers;
}

module.exports = { collectInteractiveAnswers };
