import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";

export type PromptReader = (question: string, defaultValue?: string) => Promise<string>;
export type PromptChoice = {
  label: string;
  value: string;
  description?: string;
};

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
    const redraw = () => {
      const lines = [
        `${question}:`,
        ...choices.map((choice, index) => {
          const pointer = index === selectedIndex ? ">" : " ";
          const suffix = choice.description ? ` ${choice.description}` : "";
          return `${pointer} ${choice.label}${suffix}`;
        })
      ];
      output.write("\x1b[2K\r");
      output.write(lines.join("\n"));
      output.write(`\x1b[${lines.length - 1}A\r`);
    };

    const cleanup = () => {
      input.off("keypress", onKeypress);
      if (input.isTTY && typeof input.setRawMode === "function") {
        input.setRawMode(false);
      }
      output.write(`\x1b[${choices.length}B\r`);
      output.write("\x1b[2K\r");
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
