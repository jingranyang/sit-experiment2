// Simple arithmetic problem generator for the cooperative math task.
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateProblem(difficulty) {
  let a, b, op, answer;
  const ops = difficulty === 'easy' ? ['+', '-'] : difficulty === 'hard' ? ['+', '-', '*'] : ['+', '-', '*'];

  op = ops[randInt(0, ops.length - 1)];

  if (difficulty === 'easy') {
    a = randInt(1, 20);
    b = randInt(1, 20);
  } else if (difficulty === 'hard') {
    a = op === '*' ? randInt(2, 12) : randInt(10, 99);
    b = op === '*' ? randInt(2, 12) : randInt(10, 99);
  } else {
    // medium (default)
    a = op === '*' ? randInt(2, 9) : randInt(1, 50);
    b = op === '*' ? randInt(2, 9) : randInt(1, 50);
  }

  if (op === '-' && b > a) {
    [a, b] = [b, a]; // keep result non-negative
  }

  if (op === '+') answer = a + b;
  else if (op === '-') answer = a - b;
  else answer = a * b;

  return {
    id: `${Date.now()}_${randInt(1000, 9999)}`,
    text: `${a} ${op} ${b}`,
    answer,
  };
}

module.exports = { generateProblem };
