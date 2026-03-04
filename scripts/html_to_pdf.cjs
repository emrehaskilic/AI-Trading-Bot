const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg || !outputArg) {
    console.error('Usage: node scripts/html_to_pdf.cjs <input.html> <output.pdf>');
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(outputArg);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const fileUrl = `file:///${inputPath.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '16mm',
        right: '14mm',
        bottom: '16mm',
        left: '14mm',
      },
    });
  } finally {
    await browser.close();
  }

  console.log(`PDF generated: ${outputPath}`);
}

main().catch((error) => {
  console.error('Failed to generate PDF:', error);
  process.exit(1);
});
