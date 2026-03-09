import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";

export type PromptReader = (question: string, defaultValue?: string) => Promise<string>;
export type PromptChoice = {
  label: string;
  value: string;
  description?: string;
};

function supportsPromptColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }
  if (process.env.TERM === "dumb") {
    return false;
  }
  return Boolean(output.isTTY);
}

function colorize(text: string, code: number, enabled = supportsPromptColor()): string {
  if (!enabled) {
    return text;
  }
  return `\x1b[${code}m${text}\x1b[0m`;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function getTerminalWidth(): number {
  return Math.max(output.columns || 80, 20);
}

function getRenderedRowCount(lines: string[]): number {
  const width = getTerminalWidth();
  return lines.reduce((total, line) => {
    const visibleLength = Array.from(stripAnsi(line)).length;
    return total + Math.max(1, Math.ceil(visibleLength / width));
  }, 0);
}

export function formatPromptChoiceLine(
  choice: PromptChoice,
  selected: boolean,
  colorEnabled = supportsPromptColor()
): string {
  const pointer = selected ? ">" : " ";
  if (selected) {
    const selectedText = choice.description ? `${pointer} ${choice.label} ${choice.description}` : `${pointer} ${choice.label}`;
    return colorize(selectedText, 94, colorEnabled);
  }
  const label = `${pointer} ${choice.label}`;
  if (!choice.description) {
    return label;
  }
  return `${label} ${colorize(choice.description, 90, colorEnabled)}`;
}

export async function askLine(question: string, defaultValue = ""): Promise<string> {
  const rl = readlinePromises.createInterface({ input, output });
  try {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    if (!answer && defaultValue) {
      return defaultValue;
    }
    return answer;
  } finally {
    rl.close();
  }
}

export async function askChoice(question: string, choices: PromptChoice[], defaultValue?: string): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    const fallbackDefault = defaultValue ?? choices[0]?.value ?? "";
    const answer = (await askLine(question, fallbackDefault)).trim();
    const normalized = answer.toLowerCase();
    const matched = choices.find((choice) => {
      const label = choice.label.toLowerCase();
      const value = choice.value.toLowerCase();
      return normalized === label || normalized === value;
    });
    return matched?.value ?? fallbackDefault;
  }

  const defaultIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.value === defaultValue || choice.label === defaultValue)
  );
  let selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
  let settled = false;

  return await new Promise<string>((resolve, reject) => {
    const wasPaused = input.isPaused();
    let renderedRows = 0;

    const clearCurrentLine = () => {
      output.write("\x1b[2K\r");
    };

    const clearChoiceBlock = (rows: number) => {
      if (rows <= 0) {
        return;
      }
      for (let index = 0; index < rows; index += 1) {
        clearCurrentLine();
        if (index < rows - 1) {
          output.write("\x1b[1B\r");
        }
      }
      if (rows > 1) {
        output.write(`\x1b[${rows - 1}A\r`);
      }
    };

    const redraw = () => {
      const lines = [
        `${question}:`,
        ...choices.map((choice, index) => formatPromptChoiceLine(choice, index === selectedIndex))
      ];
      clearChoiceBlock(renderedRows);
      renderedRows = getRenderedRowCount(lines);
      for (let index = 0; index < lines.length; index += 1) {
        clearCurrentLine();
        output.write(lines[index]);
        if (index < lines.length - 1) {
          output.write("\n");
        }
      }
      if (renderedRows > 1) {
        output.write(`\x1b[${renderedRows - 1}A\r`);
      } else {
        output.write("\r");
      }
    };

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY && typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      if (wasPaused) {
        input.pause();
      }
      clearChoiceBlock(renderedRows);
      renderedRows = 0;
    };

    const finish = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      output.write(`${question}: ${choices.find((choice) => choice.value === value)?.label ?? value}\n`);
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        redraw();
        return;
      }
      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % choices.length;
        redraw();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(choices[selectedIndex]?.value ?? choices[0].value);
        return;
      }
      if (key.ctrl && key.name === "c") {
        fail(new Error("setup aborted"));
      }
    };

    readline.emitKeypressEvents(input);
    input.resume();
    input.setRawMode(true);
    input.on("keypress", onKeypress);
    redraw();
  });
}

export async function askRequiredLine(
  question: string,
  reader: PromptReader = askLine
): Promise<string> {
  while (true) {
    const answer = (await reader(question)).trim();
    if (answer) {
      return answer;
    }
    output.write(`${question} is required.\n`);
  }
}
