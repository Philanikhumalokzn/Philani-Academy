const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

function normalizeQuestionNumber(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const matches = [...text.matchAll(/(\d+(?:\.\d+)*)/g)].map((match) => match[1]).filter(Boolean);
  if (!matches.length) return null;
  return matches.sort((left, right) => {
    const depthDiff = right.split('.').length - left.split('.').length;
    if (depthDiff !== 0) return depthDiff;
    return right.length - left.length;
  })[0] || null;
}

function compareQuestionNumbers(a, b) {
  const pa = String(normalizeQuestionNumber(a) || '').split('.').filter(Boolean).map(Number);
  const pb = String(normalizeQuestionNumber(b) || '').split('.').filter(Boolean).map(Number);
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const left = Number.isFinite(pa[index]) ? pa[index] : 0;
    const right = Number.isFinite(pb[index]) ? pb[index] : 0;
    if (left !== right) return left - right;
  }
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function clampText(value, max) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQuestionContent(row) {
  return clampText(row.questionText || row.latex || row.tableMarkdown || '', 220) || '[no extracted text]';
}

function extractQuestionContextSnippet(paperMmd, questionNumber) {
  const text = String(paperMmd || '');
  if (!text.trim()) return '';
  const normalizedQuestionNumber = normalizeQuestionNumber(questionNumber) || String(questionNumber || '').trim();
  const rootNumber = normalizedQuestionNumber.split('.')[0] || normalizedQuestionNumber;
  const lines = text.split(/\r?\n/);
  const patterns = [
    new RegExp(`^\\s*${escapeRegExp(String(questionNumber || '').trim())}\\b`, 'i'),
    new RegExp(`^\\s*Q?${escapeRegExp(normalizedQuestionNumber)}\\b`, 'i'),
    new RegExp(`QUESTION\\s+${escapeRegExp(rootNumber)}\\b`, 'i'),
  ];
  let hitIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (patterns.some((pattern) => pattern.test(String(lines[index] || '')))) {
      hitIndex = index;
      break;
    }
  }
  if (hitIndex < 0) return clampText(text, 260);
  const start = Math.max(0, hitIndex - 4);
  const end = Math.min(lines.length, hitIndex + 8);
  return clampText(lines.slice(start, end).join('\n'), 320);
}

function buildQuestionPromptLine(row, paperMmd) {
  const parts = [`Q${row.questionNumber}`, `depth=${row.questionDepth}`];
  if (row.marks != null) parts.push(`marks=${row.marks}`);
  if (row.topic) parts.push(`topic=${row.topic}`);
  return [
    parts.join(' | '),
    `Question: ${normalizeQuestionContent(row)}`,
    `Local MMD context: ${extractQuestionContextSnippet(paperMmd, row.questionNumber) || '[missing local context]'}`,
  ].join('\n');
}

function buildAuditPrompt(meta, paperMmd, questions) {
  const questionLines = questions.map((row) => buildQuestionPromptLine(row, paperMmd)).join('\n\n');
  return [
    'Audit the DB cognitive level for EVERY listed Mathematics question and subquestion.',
    `Context: ${meta.grade.replace('_', ' ').replace(/^GRADE /i, 'Grade ')} Mathematics Paper ${meta.paper} (${meta.month} ${meta.year}).`,
    'Use the paper MMD and each question\'s local MMD context as the final decider.',
    'Do not classify by command verb alone. For example, not every "show that" item is Level 4 and not every "determine" item is Level 3.',
    'Judge the actual cognitive demand of the specific item in its paper context.',
    'Use ONLY these levels:',
    '- 1 = Knowledge: recall, identification, direct read-off, direct substitution, or an obvious one-step fact.',
    '- 2 = Routine procedures: standard familiar procedures or straightforward multi-step methods where the method is obvious.',
    '- 3 = Complex procedures: method selection, connected procedures, interpretation, or sustained reasoning across steps.',
    '- 4 = Problem-solving: unfamiliar or unstructured tasks requiring insight, strategy design, justification, modelling, or extended reasoning.',
    'Rules:',
    '- Include every listed questionNumber exactly once.',
    '- cognitiveLevel must be an integer 1, 2, 3, or 4 only.',
    '- Return JSON only in this exact shape: {"items":[{"questionNumber":"1.1","cognitiveLevel":2}]}.',
    '- Do not omit subquestions.',
    '- Do not add commentary.',
    'Paper MMD context:',
    String(paperMmd || '').slice(0, 18000),
    'Questions to audit:',
    questionLines,
  ].join('\n');
}

function stripCodeFence(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseLooseJson(text) {
  const cleaned = stripCodeFence(text);
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {}
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {}
  }
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
    } catch {}
  }
  return null;
}

function extractItemsArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value;
  for (const key of ['items', 'questions', 'results', 'data']) {
    if (Array.isArray(record[key])) return record[key];
  }
  return Object.entries(record)
    .filter(([key]) => Boolean(normalizeQuestionNumber(key)))
    .map(([questionNumber, cognitiveLevel]) => ({ questionNumber, cognitiveLevel }));
}

function normalizeCognitiveLevel(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(4, Math.max(1, Math.round(value)));
  const text = String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!text) return null;
  const exactNumber = text.match(/\b([1-4])\b/);
  if (exactNumber && exactNumber[1]) return Number(exactNumber[1]);
  if (/\bknowledge\b|\brecall\b|\blevel\s*one\b/.test(text)) return 1;
  if (/\broutine\b|\bprocedure\b|\blevel\s*two\b/.test(text)) return 2;
  if (/\bcomplex\b|\bnon routine\b|\bnonroutine\b|\blevel\s*three\b/.test(text)) return 3;
  if (/\bproblem solving\b|\bproblem-solving\b|\blevel\s*four\b/.test(text)) return 4;
  return null;
}

function extractLineItems(text) {
  const items = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const questionNumberMatch = trimmed.match(/(?:^|\b)Q?\s*(\d+(?:\.\d+)*)/i);
    if (!questionNumberMatch || !questionNumberMatch[1]) continue;
    const tail = trimmed.slice((questionNumberMatch.index || 0) + questionNumberMatch[0].length).trim();
    items.push({ questionNumber: questionNumberMatch[1], cognitiveLevel: tail || trimmed });
  }
  return items;
}

function buildProposedLevelMap(rows, rawText) {
  const parsed = parseLooseJson(rawText);
  const candidateItems = extractItemsArray(parsed);
  const fallbackItems = candidateItems.length ? [] : extractLineItems(rawText);
  const items = candidateItems.length ? candidateItems : fallbackItems;
  const map = new Map();
  for (const item of items) {
    const questionNumber = normalizeQuestionNumber(item && (item.questionNumber || item.q || item.question || item.number || item.label || item.id));
    const cognitiveLevel = normalizeCognitiveLevel(item && (item.cognitiveLevel || item.level || item.classification || item.value || item.answer || item));
    if (!questionNumber || cognitiveLevel == null) continue;
    map.set(questionNumber, cognitiveLevel);
  }
  if (!map.size && rows.length === 1 && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const directLevel = normalizeCognitiveLevel(parsed.cognitiveLevel || parsed.level || parsed.classification || parsed.value || parsed.answer);
    if (directLevel != null) {
      const onlyRowKey = normalizeQuestionNumber(rows[0].questionNumber) || rows[0].questionNumber;
      map.set(onlyRowKey, directLevel);
    }
  }
  if (!map.size && rows.length === 1) {
    const directLevel = normalizeCognitiveLevel(parsed != null ? parsed : rawText);
    if (directLevel != null) {
      const onlyRowKey = normalizeQuestionNumber(rows[0].questionNumber) || rows[0].questionNumber;
      map.set(onlyRowKey, directLevel);
    }
  }
  return new Map(rows.map((row) => [normalizeQuestionNumber(row.questionNumber) || row.questionNumber, map.get(normalizeQuestionNumber(row.questionNumber) || row.questionNumber) || null]));
}

async function classifyWithOpenAI(apiKey, model, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You assign NSC Mathematics DB cognitive levels using only the integers 1, 2, 3, and 4. Return JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI classify failed (${response.status}): ${errorText.slice(0, 240)}`);
  }
  const data = await response.json();
  return String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
}

async function classifyWithGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini classify failed (${response.status}): ${errorText.slice(0, 240)}`);
  }
  const data = await response.json();
  const text = (((data || {}).candidates || [])[0] || {}).content;
  const parts = (text && text.parts) || [];
  return parts.map((part) => String((part && part.text) || '')).join('\n').trim();
}

async function classifyPrompt(provider, prompt) {
  const extractProvider = String(provider || process.env.EXTRACT_PROVIDER || 'auto').trim().toLowerCase();
  const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const openAiModel = String(process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini';
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const geminiModel = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';

  if (extractProvider === 'openai') {
    if (!openAiApiKey) throw new Error('OPENAI_API_KEY is missing');
    return classifyWithOpenAI(openAiApiKey, openAiModel, prompt);
  }
  if (extractProvider === 'gemini') {
    if (!geminiApiKey) throw new Error('GEMINI_API_KEY is missing');
    return classifyWithGemini(geminiApiKey, geminiModel, prompt);
  }
  if (openAiApiKey) {
    try {
      return await classifyWithOpenAI(openAiApiKey, openAiModel, prompt);
    } catch (error) {
      if (!geminiApiKey) throw error;
    }
  }
  if (!geminiApiKey) throw new Error('No AI provider key available');
  return classifyWithGemini(geminiApiKey, geminiModel, prompt);
}

function buildRetryPrompt(meta, paperMmd, rows) {
  return [
    'Return the missing DB cognitive levels for these Mathematics questions using the paper MMD context.',
    `Context: ${meta.grade.replace('_', ' ').replace(/^GRADE /i, 'Grade ')} Mathematics Paper ${meta.paper} (${meta.month} ${meta.year}).`,
    'Context is the final decider. Do not classify by command verb alone.',
    `Return levels ONLY for these exact questionNumbers: ${rows.map((row) => normalizeQuestionNumber(row.questionNumber) || row.questionNumber).join(', ')}.`,
    'Return JSON only in this exact shape: {"items":[{"questionNumber":"1.1","cognitiveLevel":2}]}.',
    'Missing questions:',
    rows.map((row) => buildQuestionPromptLine(row, paperMmd)).join('\n\n'),
  ].join('\n');
}

function buildSingleQuestionPrompt(meta, paperMmd, row) {
  const targetQuestionNumber = normalizeQuestionNumber(row.questionNumber) || row.questionNumber;
  return [
    'Return the DB cognitive level for this single Mathematics question in its paper context.',
    `Context: ${meta.grade.replace('_', ' ').replace(/^GRADE /i, 'Grade ')} Mathematics Paper ${meta.paper} (${meta.month} ${meta.year}).`,
    'Context is the final decider. Not every "show that" is Level 4.',
    `Return a level ONLY for questionNumber ${targetQuestionNumber}. Do not return any other question numbers.`,
    'Return JSON only in this exact shape: {"items":[{"questionNumber":"1.1","cognitiveLevel":2}]}.',
    'Question:',
    buildQuestionPromptLine(row, paperMmd),
  ].join('\n');
}

async function resolveAllLevelsForPaper(provider, meta, paperMmd, rows) {
  const prompt = buildAuditPrompt(meta, paperMmd, rows);
  const raw = await classifyPrompt(provider, prompt);
  const proposed = buildProposedLevelMap(rows, raw);
  let missingRows = rows.filter((row) => proposed.get(normalizeQuestionNumber(row.questionNumber) || row.questionNumber) == null);

  if (missingRows.length > 0) {
    const retryRaw = await classifyPrompt(provider, buildRetryPrompt(meta, paperMmd, missingRows));
    const retryMap = buildProposedLevelMap(missingRows, retryRaw);
    for (const row of missingRows) {
      const key = normalizeQuestionNumber(row.questionNumber) || row.questionNumber;
      const value = retryMap.get(key);
      if (value != null) proposed.set(key, value);
    }
    missingRows = rows.filter((row) => proposed.get(normalizeQuestionNumber(row.questionNumber) || row.questionNumber) == null);
  }

  for (const row of missingRows) {
    if (Number(row.questionDepth) !== 0) continue;
    const rowKey = normalizeQuestionNumber(row.questionNumber) || row.questionNumber;
    const childRows = rows
      .filter((candidate) => {
        const candidateKey = normalizeQuestionNumber(candidate.questionNumber) || candidate.questionNumber;
        return candidateKey !== rowKey && String(candidateKey).startsWith(`${rowKey}.`);
      })
      .sort((left, right) => compareQuestionNumbers(left.questionNumber, right.questionNumber));
    const childLevel = childRows
      .map((candidate) => proposed.get(normalizeQuestionNumber(candidate.questionNumber) || candidate.questionNumber))
      .find((value) => value != null);
    if (childLevel != null) {
      proposed.set(rowKey, childLevel);
    }
  }

  missingRows = rows.filter((row) => proposed.get(normalizeQuestionNumber(row.questionNumber) || row.questionNumber) == null);

  for (const row of missingRows) {
    const singleRaw = await classifyPrompt(provider, buildSingleQuestionPrompt(meta, paperMmd, row));
    const singleMap = buildProposedLevelMap([row], singleRaw);
    const key = normalizeQuestionNumber(row.questionNumber) || row.questionNumber;
    const value = singleMap.get(key);
    if (value == null) {
      throw new Error(`Unresolved cognitive level for ${meta.sourceId} ${row.questionNumber}. Raw response: ${String(singleRaw || '').slice(0, 400)}`);
    }
    proposed.set(key, value);
  }

  return proposed;
}

async function main() {
  const dryRun = !process.argv.includes('--write');
  const sourceIdArg = process.argv.find((arg) => arg.startsWith('--source-id='));
  const limitPapersArg = process.argv.find((arg) => arg.startsWith('--limit-papers='));
  const startSourceArg = process.argv.find((arg) => arg.startsWith('--start-source='));
  const forcedSourceId = sourceIdArg ? String(sourceIdArg.split('=').slice(1).join('=') || '').trim() : '';
  const limitPapers = limitPapersArg ? Math.max(1, Number(limitPapersArg.split('=').slice(1).join('=')) || 0) : null;
  const startSourceId = startSourceArg ? String(startSourceArg.split('=').slice(1).join('=') || '').trim() : '';
  const provider = String(process.env.EXTRACT_PROVIDER || 'auto').trim().toLowerCase();
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('DATABASE_URL is missing');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const sourceRows = await client.query(`
      SELECT DISTINCT q."sourceId"
      FROM "ExamQuestion" q
      WHERE q."sourceId" IS NOT NULL
      ${forcedSourceId ? 'AND q."sourceId" = $1' : startSourceId ? 'AND q."sourceId" >= $1' : ''}
      ORDER BY q."sourceId" ASC
      ${limitPapers ? `LIMIT ${limitPapers}` : ''}
    `, forcedSourceId ? [forcedSourceId] : startSourceId ? [startSourceId] : []);

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let changedPapers = 0;

    for (let sourceIndex = 0; sourceIndex < sourceRows.rows.length; sourceIndex += 1) {
      const sourceId = sourceRows.rows[sourceIndex].sourceId;
      const paperResult = await client.query(`
        SELECT q.id,
               q."sourceId",
               q.grade,
               q.year,
               q.month,
               q.paper,
               q."questionNumber",
               q."questionDepth",
               q.topic,
               q.marks,
               q."cognitiveLevel",
               q."questionText",
               q.latex,
               q."imageUrl",
               q."tableMarkdown",
               r."parsedJson"->'raw'->>'mmd' AS mmd
        FROM "ExamQuestion" q
        LEFT JOIN "ResourceBankItem" r ON r.id = q."sourceId"
        WHERE q."sourceId" = $1
        ORDER BY q.year DESC, q.month ASC, q.paper ASC, q."questionNumber" ASC
      `, [sourceId]);

      const paperRows = paperResult.rows.map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        grade: row.grade,
        year: row.year,
        month: row.month,
        paper: row.paper,
        questionNumber: row.questionNumber,
        questionDepth: row.questionDepth,
        topic: row.topic,
        marks: row.marks,
        cognitiveLevel: row.cognitiveLevel,
        questionText: row.questionText,
        latex: row.latex,
        imageUrl: row.imageUrl,
        tableMarkdown: row.tableMarkdown,
      }));
      paperRows.sort((a, b) => compareQuestionNumbers(a.questionNumber, b.questionNumber));

      const paperMmd = String((paperResult.rows[0] && paperResult.rows[0].mmd) || '').trim();
      if (!paperRows.length || !paperMmd) {
        skipped += paperRows.length;
        scanned += paperRows.length;
        console.log(`[${sourceIndex + 1}/${sourceRows.rows.length}] skipped ${sourceId} (${paperRows.length} rows, missing MMD)`);
        continue;
      }

      const meta = {
        sourceId,
        grade: paperRows[0].grade,
        year: paperRows[0].year,
        month: paperRows[0].month,
        paper: paperRows[0].paper,
      };

      const proposed = await resolveAllLevelsForPaper(provider, meta, paperMmd, paperRows);
      const changes = [];
      for (const row of paperRows) {
        const key = normalizeQuestionNumber(row.questionNumber) || row.questionNumber;
        const nextLevel = proposed.get(key);
        if (nextLevel == null) throw new Error(`Missing proposed level for ${sourceId} ${row.questionNumber}`);
        scanned += 1;
        if (Number(row.cognitiveLevel) === Number(nextLevel)) {
          skipped += 1;
          continue;
        }
        changes.push({ id: row.id, cognitiveLevel: nextLevel });
      }

      if (!dryRun) {
        for (const change of changes) {
          await client.query(`UPDATE "ExamQuestion" SET "cognitiveLevel" = $2 WHERE id = $1`, [change.id, change.cognitiveLevel]);
        }
      }

      updated += changes.length;
      if (changes.length > 0) changedPapers += 1;
      console.log(`[${sourceIndex + 1}/${sourceRows.rows.length}] ${sourceId} scanned=${paperRows.length} changed=${changes.length} dryRun=${dryRun}`);
    }

    const distributionResult = await client.query(`
      SELECT "cognitiveLevel", COUNT(*)::int AS count
      FROM "ExamQuestion"
      GROUP BY "cognitiveLevel"
      ORDER BY "cognitiveLevel" ASC NULLS FIRST
    `);

    console.log(JSON.stringify({
      dryRun,
      provider,
      papers: sourceRows.rows.length,
      scanned,
      updated,
      skipped,
      changedPapers,
      distribution: distributionResult.rows,
    }, null, 2));
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});