import { readFile } from 'node:fs/promises';

async function main(): Promise<void> {
  const report = await readFile('coverage/lcov.info', 'utf8');
  const files = report.split('end_of_record').filter((record) => record.trim());
  const failures: string[] = [];

  for (const file of files) {
    const fileName = file.match(/^SF:(.+)$/m)?.[1] ?? 'unknown';
    const linesFound = Number(file.match(/^LF:(\d+)$/m)?.[1] ?? 0);
    const linesHit = Number(file.match(/^LH:(\d+)$/m)?.[1] ?? 0);

    if (linesFound === 0 || linesHit !== linesFound) {
      failures.push(`${fileName}: ${linesHit}/${linesFound} lines covered`);
    }
  }

  if (failures.length > 0) {
    console.error('100% line coverage required. Uncovered files/lines:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`100% line coverage verified across ${files.length} files.`);
}

void main();
