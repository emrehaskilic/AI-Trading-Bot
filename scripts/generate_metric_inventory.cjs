const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const cp = require('child_process');

const REPO_NAME = 'AI-Trading-Bot';
const repoRoot = path.resolve(__dirname, '..');
const today = new Date().toISOString().slice(0, 10);
const baseName = `AI_Trading_Bot_Metrik_Envanteri_${today}`;
const mdOut = path.join(repoRoot, `${baseName}.md`);
const htmlOut = path.join(repoRoot, `${baseName}.html`);
const pdfOut = path.join(repoRoot, `${baseName}.pdf`);

const requiredFiles = [
  'src/types/metrics.ts',
  'src/components/SymbolRow.tsx',
  'src/components/MobileSymbolCard.tsx',
  'src/components/panels/LeftStatsPanel.tsx',
  'src/components/panels/RightStatsPanel.tsx',
  'src/components/sections/OpenInterestSection.tsx',
  'server/index.ts',
  'server/ai/types.ts',
  'server/ai/DecisionProvider.ts',
  'server/ai/NoopDecisionProvider.ts',
  'server/ai/RuntimeDecisionProvider.ts',
];

const requiredMetricsFiles = [
  'server/metrics/SessionVwapTracker.ts',
  'server/metrics/HtfStructureMonitor.ts',
  'server/metrics/AdvancedMicrostructureMetrics.ts',
  'server/metrics/LegacyCalculator.ts',
];

function run(cmd, cwd = repoRoot) {
  return cp.execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
}

function safeGitHash() {
  try {
    return run('git rev-parse HEAD');
  } catch {
    return 'unknown';
  }
}

function rel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, '/');
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function toSourceRef(filePath, line) {
  return `${rel(filePath)}:${line}`;
}

function readSource(filePath) {
  const abs = path.join(repoRoot, filePath);
  const text = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return { abs, text, sf };
}

function walk(node, cb) {
  cb(node);
  ts.forEachChild(node, (child) => walk(child, cb));
}

function inferUnit(metricPath, typeText = '') {
  const leaf = metricPath.split('.').slice(-1)[0] || metricPath;
  const lower = leaf.toLowerCase();
  const typeLower = String(typeText || '').toLowerCase();

  if (typeLower.includes('boolean')) return 'bool';
  if (/(^|_)(is|has)[a-z]/i.test(leaf) || /(up|dn|intact|locked|passed|detected)$/i.test(leaf)) return 'bool';
  if (/bps$/i.test(leaf)) return 'bps';
  if (/(pct|percentile)$/i.test(leaf)) return 'pct';
  if (/ms$|timestamp|startms|elapsedms|updated|timetofunding/i.test(lower)) return 'raw';
  if (/price|vwap|atr|close|swing|mid|bid|ask/i.test(lower)) return 'price';
  if (/score|ratio|zscore|z$|count|volume|notional|qty|interest|delta|slope|vol|depth|basis|spread|state|side|signal|source|reason|name|trend/i.test(lower)) {
    return 'raw';
  }
  return 'unknown';
}

function shortDescription(metricPath) {
  const prefix = metricPath.split('.')[0];
  const leaf = metricPath.split('.').slice(-1)[0];

  const domainMap = {
    legacyMetrics: 'Legacy orderflow metriği',
    timeAndSales: 'Trade tape metriği',
    cvd: 'CVD metriği',
    openInterest: 'Open interest metriği',
    funding: 'Funding metriği',
    sessionVwap: 'Session VWAP ham metriği',
    htf: 'HTF ham structure metriği',
    liquidityMetrics: 'Likidite metriği',
    passiveFlowMetrics: 'Pasif akış metriği',
    derivativesMetrics: 'Türev piyasa metriği',
    toxicityMetrics: 'Toxicity metriği',
    regimeMetrics: 'Rejim metriği',
    crossMarketMetrics: 'Cross-market metriği',
    aiTrend: 'AI trend alanı',
    aiBias: 'AI bias alanı',
    signalDisplay: 'Sinyal gösterim alanı',
    strategyPosition: 'Strateji pozisyon alanı',
    orderbookIntegrity: 'Orderbook integrity alanı',
    advancedMetrics: 'Özet advanced skor alanı',
    snapshot: 'Snapshot metadata alanı',
    bids: 'Orderbook bid seviyesi',
    asks: 'Orderbook ask seviyesi',
    midPrice: 'Orta fiyat alanı',
  };

  const domain = domainMap[prefix] || 'Telemetri alanı';
  return `${domain}: ${leaf}`;
}

function addMetric(map, metricPath, sourceRef, typeText = '', extra = {}) {
  if (!metricPath) return;
  if (!map.has(metricPath)) {
    map.set(metricPath, {
      path: metricPath,
      unit: inferUnit(metricPath, typeText),
      description: shortDescription(metricPath),
      sources: new Set(),
      typeText: typeText || '',
      ...extra,
    });
  }
  map.get(metricPath).sources.add(sourceRef);
}

function getPropertyNameText(name, sf) {
  if (!name) return null;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  try {
    return name.getText(sf).replace(/^['"`]|['"`]$/g, '');
  } catch {
    return null;
  }
}

function collectInterfacesFromSource(sf, abs) {
  const interfaces = new Map();
  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) {
      interfaces.set(node.name.text, { node, file: abs });
    }
    if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      interfaces.set(node.name.text, { node: node.type, file: abs, alias: true });
    }
  });
  return interfaces;
}

function flattenTypeNodeToMetrics(typeNode, prefix, sf, interfaces, outMap, fileAbs, visited = new Set()) {
  if (!typeNode) return;
  if (ts.isParenthesizedTypeNode(typeNode)) {
    flattenTypeNodeToMetrics(typeNode.type, prefix, sf, interfaces, outMap, fileAbs, visited);
    return;
  }
  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
    for (const t of typeNode.types) {
      flattenTypeNodeToMetrics(t, prefix, sf, interfaces, outMap, fileAbs, visited);
    }
    return;
  }
  if (ts.isTypeLiteralNode(typeNode)) {
    for (const member of typeNode.members) {
      if (!ts.isPropertySignature(member)) continue;
      const name = getPropertyNameText(member.name, sf);
      if (!name) continue;
      const childPath = `${prefix}.${name}`;
      const childType = member.type ? member.type.getText(sf) : '';
      addMetric(outMap, childPath, toSourceRef(fileAbs, lineOf(sf, member)), childType);
      flattenTypeNodeToMetrics(member.type, childPath, sf, interfaces, outMap, fileAbs, visited);
    }
    return;
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    const refName = typeNode.typeName.getText(sf);
    const key = `${prefix}::${refName}`;
    if (visited.has(key)) return;
    visited.add(key);
    const ref = interfaces.get(refName);
    if (!ref) return;
    const refSf = ref.node.getSourceFile();
    const members = ts.isInterfaceDeclaration(ref.node) ? ref.node.members : ref.node.members;
    for (const member of members) {
      if (!ts.isPropertySignature(member)) continue;
      const name = getPropertyNameText(member.name, refSf);
      if (!name) continue;
      const childPath = `${prefix}.${name}`;
      const childType = member.type ? member.type.getText(refSf) : '';
      addMetric(outMap, childPath, toSourceRef(ref.file, lineOf(refSf, member)), childType);
      flattenTypeNodeToMetrics(member.type, childPath, refSf, interfaces, outMap, ref.file, visited);
    }
    return;
  }
}

function extractTypedMetrics() {
  const file = 'src/types/metrics.ts';
  const { abs, sf } = readSource(file);
  const interfaces = collectInterfacesFromSource(sf, abs);
  const out = new Map();
  const metricsMessage = interfaces.get('MetricsMessage');
  if (!metricsMessage) return out;
  const members = metricsMessage.node.members;
  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const propName = getPropertyNameText(member.name, sf);
    if (!propName) continue;
    const propType = member.type ? member.type.getText(sf) : '';
    addMetric(out, propName, toSourceRef(abs, lineOf(sf, member)), propType);
    flattenTypeNodeToMetrics(member.type, propName, sf, interfaces, out, abs);
  }
  return out;
}

function resolveExprPaths(expr, aliases, roots) {
  if (!expr) return [];
  if (ts.isParenthesizedExpression(expr)) return resolveExprPaths(expr.expression, aliases, roots);
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) return resolveExprPaths(expr.expression, aliases, roots);
  if (ts.isNonNullExpression(expr)) return resolveExprPaths(expr.expression, aliases, roots);
  if (ts.isIdentifier(expr)) {
    if (roots.has(expr.text)) return [expr.text];
    if (aliases.has(expr.text)) return [aliases.get(expr.text)];
    return [];
  }
  if (ts.isPropertyAccessExpression(expr) || ts.isPropertyAccessChain(expr)) {
    const parentPaths = resolveExprPaths(expr.expression, aliases, roots);
    return parentPaths.map((p) => `${p}.${expr.name.text}`);
  }
  if (ts.isElementAccessExpression(expr) || ts.isElementAccessChain(expr)) {
    const parentPaths = resolveExprPaths(expr.expression, aliases, roots);
    const arg = expr.argumentExpression;
    if (arg && (ts.isStringLiteral(arg) || ts.isNumericLiteral(arg))) {
      return parentPaths.map((p) => `${p}.${arg.text}`);
    }
    return parentPaths;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (
      op === ts.SyntaxKind.BarBarToken
      || op === ts.SyntaxKind.QuestionQuestionToken
      || op === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return [...resolveExprPaths(expr.left, aliases, roots), ...resolveExprPaths(expr.right, aliases, roots)];
    }
  }
  if (ts.isConditionalExpression(expr)) {
    return [...resolveExprPaths(expr.whenTrue, aliases, roots), ...resolveExprPaths(expr.whenFalse, aliases, roots)];
  }
  return [];
}

function normalizeUiPath(p) {
  return p.replace(/^(data|metrics)\./, '');
}

function extractUiMetricsFromFile(filePath) {
  const { abs, sf } = readSource(filePath);
  const roots = new Set(['data', 'metrics']);
  const aliases = new Map();
  const out = new Map();

  function addFromPaths(paths, node) {
    for (const rawPath of paths) {
      if (!rawPath) continue;
      const normalized = normalizeUiPath(rawPath);
      if (normalized === rawPath && !rawPath.startsWith('data.') && !rawPath.startsWith('metrics.')) continue;
      addMetric(out, normalized, toSourceRef(abs, lineOf(sf, node)));
    }
  }

  function processVarDecl(node) {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    const initPaths = resolveExprPaths(node.initializer, aliases, roots);
    const primary = initPaths[0] || null;

    if (ts.isIdentifier(node.name) && primary) {
      aliases.set(node.name.text, primary);
      return;
    }

    if (ts.isObjectBindingPattern(node.name) && primary) {
      for (const element of node.name.elements) {
        if (!ts.isBindingElement(element)) continue;
        if (!ts.isIdentifier(element.name)) continue;
        const local = element.name.text;
        let prop = local;
        if (element.propertyName) {
          prop = element.propertyName.getText(sf).replace(/^['"`]|['"`]$/g, '');
        }
        aliases.set(local, `${primary}.${prop}`);
      }
    }
  }

  walk(sf, (node) => {
    processVarDecl(node);

    const isProperty =
      ts.isPropertyAccessExpression(node)
      || ts.isPropertyAccessChain(node)
      || ts.isElementAccessExpression(node)
      || ts.isElementAccessChain(node);
    if (!isProperty) return;

    const parent = node.parent;
    if (
      parent
      && (
        ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAccessChain(parent)) && parent.expression === node)
        || ((ts.isElementAccessExpression(parent) || ts.isElementAccessChain(parent)) && parent.expression === node)
      )
    ) {
      return;
    }

    const paths = resolveExprPaths(node, aliases, roots);
    addFromPaths(paths, node);
  });

  return out;
}

function objectCandidates(expr) {
  if (!expr) return [];
  if (ts.isObjectLiteralExpression(expr)) return [expr];
  if (ts.isParenthesizedExpression(expr)) return objectCandidates(expr.expression);
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) return objectCandidates(expr.expression);
  if (ts.isNonNullExpression(expr)) return objectCandidates(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    return [...objectCandidates(expr.whenTrue), ...objectCandidates(expr.whenFalse)];
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...objectCandidates(expr.left), ...objectCandidates(expr.right)];
    }
  }
  return [];
}

function recurseObjectLiteral(objExpr, sf, abs, out, prefix = '') {
  for (const prop of objExpr.properties) {
    if (ts.isSpreadAssignment(prop)) continue;
    if (ts.isShorthandPropertyAssignment(prop)) {
      const key = prop.name.text;
      const pathKey = prefix ? `${prefix}.${key}` : key;
      addMetric(out, pathKey, toSourceRef(abs, lineOf(sf, prop)));
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = getPropertyNameText(prop.name, sf);
    if (!key) continue;
    const pathKey = prefix ? `${prefix}.${key}` : key;
    addMetric(out, pathKey, toSourceRef(abs, lineOf(sf, prop)));
    const nestedObjs = objectCandidates(prop.initializer);
    for (const nested of nestedObjs) {
      recurseObjectLiteral(nested, sf, abs, out, pathKey);
    }
  }
}

function extractPayloadMetrics() {
  const file = 'server/index.ts';
  const { abs, sf } = readSource(file);
  const out = new Map();
  walk(sf, (node) => {
    if (!ts.isVariableDeclaration(node)) return;
    if (!ts.isIdentifier(node.name) || node.name.text !== 'payload') return;
    const init = node.initializer;
    if (!init) return;
    for (const obj of objectCandidates(init)) {
      recurseObjectLiteral(obj, sf, abs, out, '');
    }
  });
  return out;
}

function parseInternalMetrics(metricFiles) {
  const out = new Map();
  for (const file of metricFiles) {
    const { abs, sf } = readSource(file);

    const interfaces = collectInterfacesFromSource(sf, abs);
    for (const [name, ref] of interfaces.entries()) {
      const members = ts.isInterfaceDeclaration(ref.node) ? ref.node.members : ref.node.members;
      for (const member of members) {
        if (!ts.isPropertySignature(member)) continue;
        const propName = getPropertyNameText(member.name, member.getSourceFile());
        if (!propName) continue;
        const propType = member.type ? member.type.getText(member.getSourceFile()) : '';
        addMetric(out, `${name}.${propName}`, toSourceRef(abs, lineOf(member.getSourceFile(), member)), propType, {
          description: `Internal/interface alanı: ${name}.${propName}`,
        });
      }
    }

    walk(sf, (node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        for (const member of node.members) {
          if (ts.isPropertyDeclaration(member) && member.name) {
            const propName = getPropertyNameText(member.name, sf);
            if (!propName) continue;
            const typeText = member.type ? member.type.getText(sf) : '';
            addMetric(out, `${className}.${propName}`, toSourceRef(abs, lineOf(sf, member)), typeText, {
              description: `Internal class state: ${className}.${propName}`,
            });
          }
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = getPropertyNameText(member.name, sf);
            if (!methodName) continue;
            if (!/(get|snapshot|metrics|legacy|bundle)/i.test(methodName)) continue;
            if (!member.body) continue;
            walk(member.body, (inner) => {
              if (!ts.isReturnStatement(inner) || !inner.expression) return;
              const objects = objectCandidates(inner.expression);
              for (const obj of objects) {
                recurseObjectLiteral(
                  obj,
                  sf,
                  abs,
                  out,
                  `${className}.${methodName}()`,
                );
              }
            });
          }
        }
      }
    });
  }
  return out;
}

function mergeMaps(target, source) {
  for (const [k, v] of source.entries()) {
    if (!target.has(k)) {
      target.set(k, {
        ...v,
        sources: new Set(v.sources),
      });
      continue;
    }
    const cur = target.get(k);
    for (const s of v.sources) cur.sources.add(s);
    if (cur.unit === 'unknown' && v.unit !== 'unknown') cur.unit = v.unit;
  }
}

function fileExists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function listMetricProducerFiles() {
  const metricDir = path.join(repoRoot, 'server/metrics');
  if (!fs.existsSync(metricDir)) return [];
  return fs
    .readdirSync(metricDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `server/metrics/${f}`)
    .sort();
}

function tableRowsFor(paths, sourceMaps, limit = null) {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  const rows = [];
  const final = limit != null ? sorted.slice(0, limit) : sorted;
  for (const pathKey of final) {
    let record = null;
    for (const m of sourceMaps) {
      if (m.has(pathKey)) {
        record = m.get(pathKey);
        break;
      }
    }
    if (!record) {
      rows.push(`| ${pathKey} | unknown | unknown | unknown |`);
      continue;
    }
    const src = [...record.sources].sort()[0] || 'unknown';
    rows.push(`| ${pathKey} | ${record.unit || 'unknown'} | ${record.description || 'unknown'} | ${src} |`);
  }
  return rows;
}

function mdEscape(value) {
  return String(value).replace(/\|/g, '\\|');
}

function renderTable(title, paths, sourceMaps, opts = {}) {
  const rows = tableRowsFor(paths, sourceMaps, opts.limit ?? null);
  let out = `### ${title}\n\n`;
  out += '| Metric Path | Unit | Kisa Aciklama | Kaynak |\n';
  out += '|---|---|---|---|\n';
  if (rows.length === 0) {
    out += '| - | - | - | - |\n\n';
    return out;
  }
  out += rows.map((r) => mdEscape(r).replace(/\\\|/g, '|')).join('\n');
  out += '\n\n';
  if (opts.limit != null && paths.size > opts.limit) {
    out += `Not: ${paths.size} alanin ilk ${opts.limit} satiri gosterildi.\n\n`;
  }
  return out;
}

function toPrefixed(paths, prefix) {
  const out = new Set();
  for (const p of paths) {
    if (p === prefix || p.startsWith(`${prefix}.`)) out.add(p);
  }
  return out;
}

function groupUiPaths(uiPaths) {
  const groups = {
    liveOrderflow: new Set(),
    volumeAnalysis: new Set(),
    cvd: new Set(),
    advancedMicro: new Set(),
    otherPanels: new Set(),
    sessionVwap: new Set(),
    htf: new Set(),
  };

  for (const p of uiPaths) {
    if (p.startsWith('sessionVwap.')) {
      groups.sessionVwap.add(p);
      continue;
    }
    if (p.startsWith('htf.')) {
      groups.htf.add(p);
      continue;
    }
    if (p.startsWith('timeAndSales.')) {
      groups.volumeAnalysis.add(p);
      continue;
    }
    if (p.startsWith('cvd.') || p.startsWith('legacyMetrics.cvd')) {
      groups.cvd.add(p);
      continue;
    }
    if (
      p.startsWith('liquidityMetrics.')
      || p.startsWith('passiveFlowMetrics.')
      || p.startsWith('derivativesMetrics.')
      || p.startsWith('toxicityMetrics.')
      || p.startsWith('regimeMetrics.')
      || p.startsWith('crossMarketMetrics.')
      || p.startsWith('advancedMetrics.')
      || p.startsWith('absorption')
      || p.startsWith('enableCrossMarketConfirmation')
    ) {
      groups.advancedMicro.add(p);
      continue;
    }
    if (
      p === 'legacyMetrics.price'
      || p === 'legacyMetrics.obiWeighted'
      || p === 'legacyMetrics.obiDeep'
      || p === 'legacyMetrics.obiDivergence'
      || p === 'legacyMetrics.deltaZ'
      || p === 'legacyMetrics.cvdSlope'
      || p === 'symbol'
      || p === 'state'
    ) {
      groups.liveOrderflow.add(p);
      continue;
    }
    groups.otherPanels.add(p);
  }

  return groups;
}

function markdownToSimpleHtml(md) {
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${baseName}</title>
<style>
body { font-family: "Segoe UI", Arial, sans-serif; margin: 20px; color: #111; }
pre { white-space: pre-wrap; font-family: Consolas, "Courier New", monospace; font-size: 12px; line-height: 1.45; }
</style>
</head>
<body>
<pre>${esc}</pre>
</body>
</html>`;
}

function renderPdfFromHtml(htmlPath, outPdfPath) {
  const chromeCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const browser = chromeCandidates.find((p) => fs.existsSync(p));
  if (!browser) return { ok: false, reason: 'NO_CHROME_EDGE' };

  const fileUri = `file:///${htmlPath.replace(/\\/g, '/')}`;
  const args = [
    '--headless=new',
    '--disable-gpu',
    `--print-to-pdf=${outPdfPath}`,
    fileUri,
  ];
  const result = cp.spawnSync(browser, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    return {
      ok: false,
      reason: 'PDF_RENDER_FAILED',
      stderr: (result.stderr || '').trim(),
      stdout: (result.stdout || '').trim(),
    };
  }
  return { ok: true };
}

function main() {
  const commitHash = safeGitHash();
  const metricFiles = listMetricProducerFiles();

  const scannedFiles = new Set();
  for (const f of requiredFiles) {
    if (fileExists(f)) scannedFiles.add(f);
  }
  for (const f of requiredMetricsFiles) {
    if (fileExists(f)) scannedFiles.add(f);
  }
  for (const f of metricFiles) scannedFiles.add(f);

  const typedMetrics = extractTypedMetrics();
  const payloadMetrics = extractPayloadMetrics();

  const uiFiles = [
    'src/components/SymbolRow.tsx',
    'src/components/MobileSymbolCard.tsx',
    'src/components/panels/LeftStatsPanel.tsx',
    'src/components/panels/RightStatsPanel.tsx',
    'src/components/sections/OpenInterestSection.tsx',
  ];
  const uiMetrics = new Map();
  for (const uiFile of uiFiles) {
    if (!fileExists(uiFile)) continue;
    mergeMaps(uiMetrics, extractUiMetricsFromFile(uiFile));
  }

  const internalMetrics = parseInternalMetrics(metricFiles);

  const aiTypeMetrics = (() => {
    const out = new Map();
    const aiFiles = [
      'server/ai/types.ts',
      'server/ai/DecisionProvider.ts',
      'server/ai/NoopDecisionProvider.ts',
      'server/ai/RuntimeDecisionProvider.ts',
    ];
    for (const file of aiFiles) {
      if (!fileExists(file)) continue;
      const { abs, sf } = readSource(file);
      const interfaces = collectInterfacesFromSource(sf, abs);
      for (const [name, ref] of interfaces.entries()) {
        const members = ts.isInterfaceDeclaration(ref.node) ? ref.node.members : ref.node.members;
        for (const member of members) {
          if (!ts.isPropertySignature(member)) continue;
          const prop = getPropertyNameText(member.name, member.getSourceFile());
          if (!prop) continue;
          const full = `${name}.${prop}`;
          const t = member.type ? member.type.getText(member.getSourceFile()) : '';
          addMetric(out, full, toSourceRef(abs, lineOf(member.getSourceFile(), member)), t, {
            description: `AI karar pipeline alani: ${name}.${prop}`,
          });
          flattenTypeNodeToMetrics(member.type, full, member.getSourceFile(), interfaces, out, abs);
        }
      }
    }
    return out;
  })();

  const typedSet = new Set(typedMetrics.keys());
  const payloadSet = new Set(payloadMetrics.keys());
  const uiSet = new Set(uiMetrics.keys());

  const uiVisibleSet = new Set([...uiSet].filter((p) => typedSet.has(p) || payloadSet.has(p)));
  const payloadOnlySet = new Set([...payloadSet].filter((p) => !uiSet.has(p)));

  const internalOnlySet = new Set(
    [...internalMetrics.keys()].filter((p) => {
      if (typedSet.has(p) || payloadSet.has(p) || uiSet.has(p)) return false;
      return true;
    }),
  );

  const typeNotPayload = new Set([...typedSet].filter((p) => !payloadSet.has(p)));
  const payloadNotUI = new Set([...payloadSet].filter((p) => !uiSet.has(p)));

  const decisionPayloadFields = new Set(
    [...payloadSet].filter((p) => p.startsWith('aiTrend') || p.startsWith('aiBias') || p.startsWith('signalDisplay') || p.startsWith('strategyPosition')),
  );

  const uiGroups = groupUiPaths(uiVisibleSet);

  let md = '';
  md += `# AI Trading Bot - Metrik Envanteri\n\n`;
  md += `## 0) Baslik + Metadata\n\n`;
  md += `- Uretim tarihi: ${new Date().toISOString()}\n`;
  md += `- Repo: ${REPO_NAME}\n`;
  md += `- Referans commit hash: ${commitHash}\n`;
  md += `- Kapsam: Bu envanter yalnizca kod icindeki alan adlari ve referanslar taranarak uretilmistir.\n`;
  md += `- Decision mode notu: DECISION_MODE=off varsayilanidir; decision alanlari envantere NOOP/disabled default notuyla dahil edilmistir.\n\n`;

  md += `### Ozet Sayilar\n\n`;
  md += `- UI gorunen metrik sayisi: ${uiVisibleSet.size}\n`;
  md += `- Payload-only metrik sayisi: ${payloadOnlySet.size}\n`;
  md += `- Internal-only metrik sayisi: ${internalOnlySet.size}\n`;
  md += `- Typed payload surface metrik sayisi: ${typedSet.size}\n\n`;

  md += `### Taranan Dosyalar\n\n`;
  for (const f of [...scannedFiles].sort()) {
    md += `- ${f}\n`;
  }
  md += '\n';

  md += `## 1) UI'da Gorunen Metrikler\n\n`;
  md += renderTable('1.1 Live Orderflow Metrics', uiGroups.liveOrderflow, [uiMetrics, typedMetrics, payloadMetrics]);
  md += renderTable('1.2 Volume Analysis', uiGroups.volumeAnalysis, [uiMetrics, typedMetrics, payloadMetrics]);
  md += renderTable('1.3 CVD', uiGroups.cvd, [uiMetrics, typedMetrics, payloadMetrics]);
  md += renderTable('1.4 Advanced Microstructure', uiGroups.advancedMicro, [uiMetrics, typedMetrics, payloadMetrics]);
  md += renderTable('1.5 Diger UI panelleri', uiGroups.otherPanels, [uiMetrics, typedMetrics, payloadMetrics]);
  md += renderTable('1.6 Yeni: Session VWAP (UI)', uiGroups.sessionVwap, [uiMetrics, typedMetrics, payloadMetrics]);
  md += renderTable('1.7 Yeni: HTF (1H/4H) (UI)', uiGroups.htf, [uiMetrics, typedMetrics, payloadMetrics]);

  md += `## 2) UI'da Dogrudan Gorunmeyen ama Payload'da Olanlar\n\n`;
  const payloadOnlyNoDecision = new Set([...payloadOnlySet].filter((p) => !decisionPayloadFields.has(p)));
  md += renderTable('2.1 Payload-only alanlar', payloadOnlyNoDecision, [payloadMetrics, typedMetrics], { limit: 250 });
  md += renderTable('2.2 Decision alanlari (NOOP/disabled default)', decisionPayloadFields, [payloadMetrics, typedMetrics]);

  md += `## 3) AI Dry Run / LLM Karar Pipeline Metrikleri\n\n`;
  md += `DECISION_MODE=off varsayilanda karar motoru NOOP provider ile neutral alanlar dondurur; asagidaki alanlar tip/telemetry yuzeyinde tanimlidir.\n\n`;
  md += renderTable('3.1 AI/Decision tip yuzeyi', new Set(aiTypeMetrics.keys()), [aiTypeMetrics], { limit: 400 });

  md += `## 4) Internal (UI ve payload disi) hesap metrikleri\n\n`;
  md += renderTable('4.1 Internal class/interface alanlari', internalOnlySet, [internalMetrics], { limit: 500 });

  md += `## Mismatch\n\n`;
  md += renderTable('Type var ama payload yok', typeNotPayload, [typedMetrics], { limit: 300 });
  md += renderTable('Payload var ama UI yok', payloadNotUI, [payloadMetrics], { limit: 300 });

  md += `## 5) Notlar\n\n`;
  md += `- Bu envanter metrics.ts + server payload assembly + UI mapping + server/metrics internal state taramasindan otomatik derlenmistir.\n`;
  md += `- Unit degeri koddan net cikmayan alanlarda "unknown" veya "raw" olarak birakilmistir.\n`;
  md += `- UI gorunurlugu component bazli oldugu icin route ve breakpoint durumuna gore farklilik gosterebilir.\n`;

  fs.writeFileSync(mdOut, md, 'utf8');
  const html = markdownToSimpleHtml(md);
  fs.writeFileSync(htmlOut, html, 'utf8');
  const pdfResult = renderPdfFromHtml(htmlOut, pdfOut);

  const jsonSummary = {
    generatedAt: new Date().toISOString(),
    commitHash,
    outputs: {
      md: rel(mdOut),
      html: rel(htmlOut),
      pdf: rel(pdfOut),
    },
    counts: {
      uiVisible: uiVisibleSet.size,
      payloadOnly: payloadOnlySet.size,
      internalOnly: internalOnlySet.size,
      typedSurface: typedSet.size,
      decisionPayload: decisionPayloadFields.size,
    },
    pdfRender: pdfResult,
  };
  const jsonOut = path.join(repoRoot, `${baseName}.json`);
  fs.writeFileSync(jsonOut, JSON.stringify(jsonSummary, null, 2), 'utf8');

  process.stdout.write(`${JSON.stringify(jsonSummary, null, 2)}\n`);
}

main();

