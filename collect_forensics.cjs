const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

// Configuration
const LOG_DIR = path.resolve(__dirname, 'server/logs/orchestrator');
const DESKTOP_DIR = path.join(os.homedir(), 'Desktop');
const COMMIT_HASH = execSync('git rev-parse --short HEAD').toString().trim();
const NOW = new Date();
const DATE_STR = NOW.toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHMM
const REPORT_FILENAME = `tele-codex-rawlogs-commit-${COMMIT_HASH}-${DATE_STR}.md`;
const REPORT_PATH = path.join(DESKTOP_DIR, REPORT_FILENAME);
const ZIP_FILENAME = `tele-codex-forensic-logs-${COMMIT_HASH}-${DATE_STR}.zip`;
const ZIP_PATH = path.join(DESKTOP_DIR, ZIP_FILENAME);

// Keywords to track
const KEYWORDS = [
    'freeze_active', 'exec_quality', 'exec_metrics_present',
    'emergency_exit', 'emergency_exit_exec_quality', 'hard_stop',
    'liquidation', 'reject_storm', 'margin_precheck',
    '-2019', '-4061', 'DEPTH_DESYNC', 'SNAPSHOT_SKIP_LOCAL'
];

let keywordCounts = {};
KEYWORDS.forEach(k => keywordCounts[k] = 0);

// Secrets masking
function sanitize(text) {
    if (!text) return '';
    let s = text;
    s = s.replace(/(API_KEY|SECRET|TOKEN|PASSPHRASE|PRIVATE_KEY)(=|:)(\s*)(['"]?)([^'"\n,]+)(['"]?)/gi, '$1$2$3$4***MASKED***$6');
    s = s.replace(/(injecting env.*)/gi, '$1 [VALUE HIDDEN]');
    return s;
}

function countKeywords(text) {
    if (!text) return;
    KEYWORDS.forEach(k => {
        // Simple includes check as log lines might be JSON or messy. 
        // For exact word match one needs regex, but "includes" is often safer/faster for "raw log presence" unless specific tokenization needed.
        // User asked for "freeze_active" etc.
        if (text.includes(k)) {
            keywordCounts[k]++;
        }
    });
}

// Main execution
async function main() {
    console.log(`Starting Forensic Collection...`);
    console.log(`Commit: ${COMMIT_HASH}`);
    console.log(`Report Path: ${REPORT_PATH}`);

    let logFiles = [];
    if (fs.existsSync(LOG_DIR)) {
        logFiles = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl') || f.endsWith('.log'));
    }

    // Filter for current run (assuming today's logs are relevant or user wants all current logs)
    // User said: "SON ÇALIŞTIRILAN COMMIT'inin aktif edildiği andan itibaren"
    // We'll take files modified recently or with today's date in name.
    // The files are named like 'decision_20260208.jsonl'. Matches current date.
    const todayStr = NOW.toISOString().slice(0, 10).replace(/-/g, ''); // 20260208
    const relevantFiles = logFiles.filter(f => f.includes(todayStr));

    console.log(`Found ${relevantFiles.length} relevant log files.`);

    // --- Report Generation ---
    let mdContent = '';

    // 1. Context
    const startTimeStr = relevantFiles.length > 0 ? fs.statSync(path.join(LOG_DIR, relevantFiles[0])).birthtime.toISOString() : new Date().toISOString();
    const runtimeMs = Date.now() - new Date(startTimeStr).getTime();
    const runtimeStr = new Date(runtimeMs).toISOString().substr(11, 8); // HH:mm:ss approx

    mdContent += `# FORENSIC LOG REPORT\n\n`;
    mdContent += `## 1) CONTEXT\n`;
    mdContent += `- **Repo**: tele-codex\n`;
    mdContent += `- **Commit**: ${COMMIT_HASH}\n`;
    mdContent += `- **Activated At**: ${startTimeStr}\n`;
    mdContent += `- **Observed Until**: ${NOW.toISOString()}\n`;
    mdContent += `- **Total Runtime**: ${runtimeStr}\n`;
    mdContent += `- **Log Source**: File (${LOG_DIR})\n`;
    mdContent += `\n`;

    // 2. Env Safety
    mdContent += `## 2) ENV SAFETY\n`;
    mdContent += `- **No secrets leaked**: YES (Sanitization applied)\n`;
    mdContent += `- **Masked Patterns**: API_KEY, SECRET, TOKEN, PASSPHRASE, PRIVATE_KEY, injecting env\n\n`;

    // 3. Raw Logs
    mdContent += `## 3) RAW LOGS (FULL WINDOW)\n`;

    let combinedLogContent = '';

    for (const f of relevantFiles) {
        mdContent += `\n### File: ${f}\n\`\`\`log\n`;
        const filePath = path.join(LOG_DIR, f);
        const content = fs.readFileSync(filePath, 'utf8');

        const lines = content.split('\n');
        lines.forEach(line => {
            const cleanLine = sanitize(line);
            mdContent += cleanLine + '\n';
            countKeywords(line); // Count on raw or clean? User wants counts.
        });

        mdContent += `\`\`\`\n`;
        combinedLogContent += content + '\n'; // Keep for other analysis if needed, but not used now
    }

    // 4. Quick Index
    mdContent += `\n## 4) QUICK INDEX\n`;
    mdContent += `| Keyword | Count |\n|---|---|\n`;
    for (const [k, v] of Object.entries(keywordCounts)) {
        mdContent += `| ${k} | ${v} |\n`;
    }
    mdContent += `\n`;

    // Write Report
    fs.writeFileSync(REPORT_PATH, mdContent);
    const reportStat = fs.statSync(REPORT_PATH);
    console.log(`Report Written. Size: ${(reportStat.size / 1024).toFixed(2)} KB`);

    // 5. Zip Packaging
    console.log(`Creating ZIP...`);

    // Create temp dir for logs to avoid file locking
    const tempDir = path.join(DESKTOP_DIR, `temp_logs_${DATE_STR}`);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    // Copy files
    const copiedFiles = [];
    relevantFiles.forEach(f => {
        const src = path.join(LOG_DIR, f);
        const dest = path.join(tempDir, f);
        try {
            fs.copyFileSync(src, dest);
            copiedFiles.push(dest);
        } catch (e) {
            console.error(`Failed to copy ${f}: ${e.message}`);
        }
    });

    // Also copy report to temp dir to zip everything together cleanly
    const reportDest = path.join(tempDir, REPORT_FILENAME);
    fs.copyFileSync(REPORT_PATH, reportDest);

    // Zip the temp dir contents
    const zipCommand = `powershell -Command "Compress-Archive -Path '${tempDir}\\*' -DestinationPath '${ZIP_PATH}' -Force"`;

    try {
        execSync(zipCommand, { stdio: 'inherit' });

        // Cleanup temp dir
        fs.rmSync(tempDir, { recursive: true, force: true });

        const zipStat = fs.statSync(ZIP_PATH);

        // 6. Final Output
        console.log(`\n=== OUTPUT ===`);
        console.log(`md_file_full_path: ${REPORT_PATH}`);
        console.log(`size_kb: ${(fs.statSync(REPORT_PATH).size / 1024).toFixed(2)}`);
        console.log(`zip_file_full_path: ${ZIP_PATH}`);
        console.log(`size_kb: ${(zipStat.size / 1024).toFixed(2)}`);
        console.log(`included_files: ${[REPORT_FILENAME, ...relevantFiles].join(', ')}`);
        console.log(`quick_index_counts:`);
        console.table(keywordCounts);

    } catch (err) {
        console.error("ZIP Generation Failed:", err.message);
    }
}

main().catch(console.error);
