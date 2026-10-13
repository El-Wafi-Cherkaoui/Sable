// Breaks text at spaces so a word is never split; a single word longer than the line is cut.
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(" ")) {
    let rest = word;

    while (rest.length > width) {
      if (line !== "") {
        lines.push(line);
        line = "";
      }

      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }

    if (line === "") {
      line = rest;
    } else if (line.length + 1 + rest.length <= width) {
      line = `${line} ${rest}`;
    } else {
      lines.push(line);
      line = rest;
    }
  }

  return line === "" ? lines : [...lines, line];
}
