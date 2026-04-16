import type { NextApiRequest, NextApiResponse } from 'next'
import { getToken } from 'next-auth/jwt'
import prisma from '../../../lib/prisma'
import { normalizeExamQuestionContent } from '../../../lib/questionMath'
import {
  questionRootFromNumber,
  questionDepthFromNumber,
  buildQuestionPreambleMapFromMmd,
  buildQuestionImageMapFromMmd,
  buildQuestionTableMapFromMmd,
  buildQuestionMarksMapFromMmd,
  pickRootPreambleImageUrls,
  pickRootPreambleTableMarkdown,
  isMultiColumnTable,
  normalizeMarksValue,
  extractMarksFromText,
  pickQuestionMarks,
  upsertRootPreambleRecords,
  getExtractProvider,
  extractQuestionsWithGeminiApi,
  extractQuestionsWithOpenAI,
  VALID_TOPICS,
} from '../resources/extract-questions'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '32kb',
    },
  },
}

type RootContextSnapshot = {
  questionText: string | null
  latex: string | null
  imageUrl: string | null
  tableMarkdown: string | null
  marks: number | null
}

type UndoPayload =
  | {
      mode: 'restore-existing'
      rootQuestionId: string
      snapshot: RootContextSnapshot
    }
  | {
      mode: 'delete-created'
      rootQuestionId: string
    }

function normalizeTextValue(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

function buildSnapshot(row: {
  questionText?: string | null
  latex?: string | null
  imageUrl?: string | null
  tableMarkdown?: string | null
  marks?: number | null
} | null | undefined): RootContextSnapshot {
  return {
    questionText: normalizeTextValue(row?.questionText),
    latex: normalizeTextValue(row?.latex),
    imageUrl: normalizeTextValue(row?.imageUrl),
    tableMarkdown: normalizeTextValue(row?.tableMarkdown),
    marks: typeof row?.marks === 'number' && Number.isFinite(row.marks) ? row.marks : null,
  }
}

function rootSelectionWarning(inputMmd: string, rootNumber: string): string | null {
  const text = String(inputMmd || '')
  const hasQuestionHeading = new RegExp(`\\bQUESTION\\s+${rootNumber}\\b`, 'i').test(text)
  const hasRootReference = new RegExp(`\\b${rootNumber}(?:\\.\\d+)?\\b`).test(text)
  if (hasQuestionHeading || hasRootReference) return null
  return `Selected text does not appear to reference QUESTION ${rootNumber}. Review before applying.`
}

function sameNullableText(a: string | null, b: string | null): boolean {
  return (a || '') === (b || '')
}

function hasSnapshotChanges(before: RootContextSnapshot, proposed: RootContextSnapshot): boolean {
  return !(
    sameNullableText(before.questionText, proposed.questionText)
    && sameNullableText(before.latex, proposed.latex)
    && sameNullableText(before.imageUrl, proposed.imageUrl)
    && sameNullableText(before.tableMarkdown, proposed.tableMarkdown)
    && before.marks === proposed.marks
  )
}

/** Slice MMD to the section for a specific root question number. */
function sliceMmdForRootQuestion(mmd: string, rootNumber: string): string {
  const lines = mmd.split('\n')
  const startPattern = new RegExp(`(?:^|\\s)QUESTION\\s+${rootNumber}\\b`, 'i')
  const nextQPattern = /\bQUESTION\s+\d+\b/i

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (startPattern.test(lines[i])) {
      start = i
      break
    }
  }

  // Fallback: return first 6000 chars of full MMD if marker not found
  if (start === -1) return mmd.slice(0, 6000)

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (nextQPattern.test(lines[i])) {
      end = i
      break
    }
  }

  return lines.slice(start, end).join('\n')
}

/** Build a targeted prompt for extracting ONLY the root context of one question. */
function buildContextExtractionPrompt(
  mmd: string,
  rootNumber: string,
  grade: string,
  year: number,
  month: string,
  paper: number,
): string {
  const gradeLabel = String(grade || '').replace('_', ' ').replace(/^GRADE /i, 'Grade ')
  const topicList = VALID_TOPICS.join(', ')
  return [
    `You are a South African NSC Mathematics exam parser.`,
    `Extract the ROOT CONTEXT for QUESTION ${rootNumber} from the following OCR/Mathpix output of a ${gradeLabel} Mathematics Paper ${paper} exam (${month} ${year}).`,
    `This is Mathpix Markdown (MMD): math is in LaTeX, tables appear as GitHub-Flavored Markdown pipe tables.`,
    ``,
    `Extract ONLY the shared context/preamble for QUESTION ${rootNumber} — the introductory text, data table (if any), and marks.`,
    `This is context that applies to ALL sub-questions (${rootNumber}.1, ${rootNumber}.2, etc.).`,
    `Do NOT extract individual sub-questions.`,
    ``,
    `Rules:`,
    `- questionNumber: "${rootNumber}"`,
    `- questionText: the full preamble/context text for QUESTION ${rootNumber}. Where math appears, wrap each expression using ONLY single-dollar delimiters: $Expression$.`,
    `- latex: the PRIMARY mathematical expression without outer $ delimiters, or empty string if none`,
    `- marks: total marks for this question as an integer if shown in brackets (e.g. "(15)" → 15), else null`,
    `- topic: one of: ${topicList}`,
    `- cognitiveLevel: integer 1-4 (1=Knowledge, 2=Routine procedures, 3=Complex procedures, 4=Problem-solving)`,
    `- tableMarkdown: if there is a data table in the preamble, copy the FULL pipe-table markdown exactly (including header and separator rows). If none, use null.`,
    ``,
    `Return ONLY a valid JSON array with a SINGLE object for QUESTION ${rootNumber}. No commentary outside the JSON.`,
    ``,
    `OCR/MMD INPUT:`,
    mmd.slice(0, 8000),
  ].join('\n')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = await getToken({ req })
  if ((token as any)?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin only' })
  }

  // ── GET: return raw MMD for the collapsible parse panel ──
  if (req.method === 'GET') {
    const { sourceId } = req.query
    if (!sourceId || typeof sourceId !== 'string') {
      return res.status(400).json({ message: 'sourceId is required' })
    }
    const source = await prisma.resourceBankItem.findUnique({
      where: { id: sourceId },
      select: { parsedJson: true },
    })
    if (!source) return res.status(404).json({ message: 'Source not found' })
    const mmd = String((source.parsedJson as any)?.raw?.mmd || '')
    return res.status(200).json({ mmd })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { questionId, action, mmdSlice, preview, undo } = req.body as {
    questionId?: string
    action?: string
    mmdSlice?: string
    preview?: boolean
    undo?: UndoPayload
  }

  if (!questionId || typeof questionId !== 'string') {
    return res.status(400).json({ message: 'questionId is required' })
  }
  if (action !== 'recover' && action !== 'ai-reextract' && action !== 'undo-ai-reextract') {
    return res.status(400).json({ message: "action must be 'recover', 'ai-reextract', or 'undo-ai-reextract'" })
  }

  // Load the question to derive sourceId, grade, year, month, paper
  const question = await prisma.examQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      sourceId: true,
      questionNumber: true,
      grade: true,
      year: true,
      month: true,
      paper: true,
    },
  })
  if (!question) return res.status(404).json({ message: 'Question not found' })
  if (!question.sourceId) {
    return res.status(400).json({ message: 'Question has no linked source document' })
  }

  // Load the source resource parsedJson
  const source = await prisma.resourceBankItem.findUnique({
    where: { id: question.sourceId },
    select: { id: true, parsedJson: true },
  })
  if (!source) return res.status(404).json({ message: 'Source resource not found' })
  if (!source.parsedJson) {
    return res.status(400).json({ message: 'Source has no parsed data. Parse it first using Mathpix OCR.' })
  }

  const rawMmd = String((source.parsedJson as any)?.raw?.mmd || '')
  const rootNumber = questionRootFromNumber(String(question.questionNumber || ''))

  // ── RECOVER: deterministic recovery from stored parse ──
  if (action === 'recover') {
    const preambleMap = buildQuestionPreambleMapFromMmd(rawMmd)
    const imageMap = buildQuestionImageMapFromMmd(rawMmd)
    const tableMap = buildQuestionTableMapFromMmd(rawMmd)

    const rootPreamble = preambleMap.get(rootNumber)

    if (!rootPreamble) {
      // No preamble text found — try to at least recover image + table for the existing root record
      const rootImageUrls = pickRootPreambleImageUrls(rootNumber, imageMap)
      const rootTableMarkdown = pickRootPreambleTableMarkdown(rootNumber, tableMap)

      if (rootImageUrls.length === 0 && !rootTableMarkdown) {
        return res.status(200).json({
          message: 'No context found in stored parse for this question.',
          recovered: false,
        })
      }

      const existingRoot = await prisma.examQuestion.findFirst({
        where: {
          sourceId: question.sourceId,
          grade: question.grade,
          year: question.year,
          month: question.month,
          paper: question.paper,
          questionNumber: rootNumber,
        },
        select: { id: true, imageUrl: true, tableMarkdown: true },
      })

      if (existingRoot) {
        const patch: Record<string, unknown> = {}
        if (!existingRoot.imageUrl && rootImageUrls[0]) patch.imageUrl = rootImageUrls[0]
        if (!existingRoot.tableMarkdown && rootTableMarkdown) patch.tableMarkdown = rootTableMarkdown

        if (Object.keys(patch).length > 0) {
          await prisma.examQuestion.update({ where: { id: existingRoot.id }, data: patch })
          return res.status(200).json({
            message: 'Recovered image/table from stored parse.',
            recovered: true,
          })
        }
      }

      return res.status(200).json({
        message: 'No new context could be recovered from the stored parse.',
        recovered: false,
      })
    }

    // Have preamble text — run the full upsert for this root only
    const filteredPreambleMap = new Map([[rootNumber, rootPreamble]])
    const result = await upsertRootPreambleRecords({
      sourceId: question.sourceId,
      grade: question.grade,
      year: question.year,
      month: question.month,
      paper: question.paper,
      preambleMap: filteredPreambleMap,
      imageMap,
      tableMap,
    })

    return res.status(200).json({
      message: `Recovered from stored parse: ${result.created} created, ${result.updated} updated.`,
      recovered: true,
      created: result.created,
      updated: result.updated,
    })
  }

  if (action === 'undo-ai-reextract') {
    if (!undo || typeof undo !== 'object' || !undo.rootQuestionId) {
      return res.status(400).json({ message: 'undo payload is required' })
    }

    if (undo.mode === 'delete-created') {
      const existing = await prisma.examQuestion.findUnique({
        where: { id: undo.rootQuestionId },
        select: { id: true, sourceId: true },
      })
      if (!existing || existing.sourceId !== question.sourceId) {
        return res.status(404).json({ message: 'Undo target not found for this source' })
      }

      await prisma.examQuestion.delete({ where: { id: undo.rootQuestionId } })
      return res.status(200).json({ message: `Undid AI apply by deleting root context Q${rootNumber}.`, undone: true })
    }

    if (undo.mode === 'restore-existing') {
      const existing = await prisma.examQuestion.findUnique({
        where: { id: undo.rootQuestionId },
        select: { id: true, sourceId: true },
      })
      if (!existing || existing.sourceId !== question.sourceId) {
        return res.status(404).json({ message: 'Undo target not found for this source' })
      }

      await prisma.examQuestion.update({
        where: { id: undo.rootQuestionId },
        data: {
          questionText: undo.snapshot.questionText,
          latex: undo.snapshot.latex,
          imageUrl: undo.snapshot.imageUrl,
          tableMarkdown: undo.snapshot.tableMarkdown,
          marks: undo.snapshot.marks,
        },
      })
      return res.status(200).json({ message: `Undid AI apply for Q${rootNumber}.`, undone: true })
    }

    return res.status(400).json({ message: 'Invalid undo payload' })
  }

  // ── AI RE-EXTRACT: targeted AI extraction for this root question ──
  const inputMmd =
    (typeof mmdSlice === 'string' && mmdSlice.trim())
      ? mmdSlice.trim()
      : sliceMmdForRootQuestion(rawMmd, rootNumber)

  const manualSelectionWarning = typeof mmdSlice === 'string' && mmdSlice.trim()
    ? rootSelectionWarning(inputMmd, rootNumber)
    : null

  const prompt = buildContextExtractionPrompt(
    inputMmd,
    rootNumber,
    String(question.grade || ''),
    question.year,
    question.month,
    question.paper,
  )

  const provider = getExtractProvider()
  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
  const openAiApiKey = (process.env.OPENAI_API_KEY || '').trim()
  const openAiModel = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini'

  let rawAiResult: any[] = []
  try {
    if (provider === 'openai') {
      if (!openAiApiKey) return res.status(500).json({ message: 'OpenAI not configured (missing OPENAI_API_KEY)' })
      rawAiResult = await extractQuestionsWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
    } else if (provider === 'auto') {
      if (openAiApiKey) {
        try {
          rawAiResult = await extractQuestionsWithOpenAI({ apiKey: openAiApiKey, model: openAiModel, prompt })
        } catch {
          if (!geminiApiKey) throw new Error('No extraction provider configured')
          rawAiResult = await extractQuestionsWithGeminiApi({ apiKey: geminiApiKey, model: geminiModel, prompt })
        }
      } else {
        if (!geminiApiKey) return res.status(500).json({ message: 'No extraction provider configured' })
        rawAiResult = await extractQuestionsWithGeminiApi({ apiKey: geminiApiKey, model: geminiModel, prompt })
      }
    } else {
      if (!geminiApiKey) return res.status(500).json({ message: 'Gemini not configured (missing GEMINI_API_KEY)' })
      rawAiResult = await extractQuestionsWithGeminiApi({ apiKey: geminiApiKey, model: geminiModel, prompt })
    }
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || 'AI extraction failed' })
  }

  // Pick the context object — expect a single-element array, take first non-subquestion entry
  const contextObj =
    rawAiResult.find((q: any) => !String(q?.questionNumber || '').includes('.')) ??
    rawAiResult[0] ??
    null

  if (!contextObj) {
    return res.status(200).json({ message: 'AI returned no context for this question.', updated: false })
  }

  // Build MMD maps from the input slice for image/table fallbacks
  const imageMap = buildQuestionImageMapFromMmd(inputMmd)
  const tableMap = buildQuestionTableMapFromMmd(inputMmd)
  const marksMap = buildQuestionMarksMapFromMmd(inputMmd)

  const normalized = normalizeExamQuestionContent(
    typeof contextObj.questionText === 'string' ? contextObj.questionText : '',
    typeof contextObj.latex === 'string' ? contextObj.latex : '',
  )
  const aiText = normalized.questionText
  const aiLatex = normalized.latex || null

  const aiImageUrls = pickRootPreambleImageUrls(rootNumber, imageMap)
  const aiTableMarkdown =
    (typeof contextObj.tableMarkdown === 'string' && contextObj.tableMarkdown.trim())
      ? contextObj.tableMarkdown.trim()
      : pickRootPreambleTableMarkdown(rootNumber, tableMap)
  const aiMarks =
    normalizeMarksValue(contextObj.marks) ??
    extractMarksFromText(aiText) ??
    pickQuestionMarks(rootNumber, marksMap)

  // Find existing root record
  const existingRoot = await prisma.examQuestion.findFirst({
    where: {
      sourceId: question.sourceId,
      grade: question.grade,
      year: question.year,
      month: question.month,
      paper: question.paper,
      questionNumber: rootNumber,
    },
    select: { id: true, questionText: true, latex: true, imageUrl: true, tableMarkdown: true, marks: true },
  })

  const beforeSnapshot = buildSnapshot(existingRoot)
  const proposedSnapshot: RootContextSnapshot = {
    questionText: aiText || beforeSnapshot.questionText,
    latex: aiLatex || beforeSnapshot.latex,
    imageUrl: beforeSnapshot.imageUrl || aiImageUrls[0] || null,
    tableMarkdown: (
      aiTableMarkdown && (!beforeSnapshot.tableMarkdown || !isMultiColumnTable(beforeSnapshot.tableMarkdown))
    )
      ? aiTableMarkdown
      : beforeSnapshot.tableMarkdown,
    marks: beforeSnapshot.marks == null && aiMarks != null ? aiMarks : beforeSnapshot.marks,
  }

  const hasChanges = hasSnapshotChanges(beforeSnapshot, proposedSnapshot)

  if (preview === true) {
    return res.status(200).json({
      message: hasChanges ? `Preview ready for Q${rootNumber}.` : `No changes proposed for Q${rootNumber}.`,
      preview: {
        questionId,
        rootNumber,
        existingRootQuestionId: existingRoot?.id || null,
        selectionWarning: manualSelectionWarning,
        hasChanges,
        before: beforeSnapshot,
        proposed: proposedSnapshot,
      },
    })
  }

  if (existingRoot) {
    const patch: Record<string, unknown> = {}
    if (proposedSnapshot.questionText !== beforeSnapshot.questionText) patch.questionText = proposedSnapshot.questionText
    if (proposedSnapshot.latex !== beforeSnapshot.latex) patch.latex = proposedSnapshot.latex
    if (proposedSnapshot.imageUrl !== beforeSnapshot.imageUrl) patch.imageUrl = proposedSnapshot.imageUrl
    if (proposedSnapshot.tableMarkdown !== beforeSnapshot.tableMarkdown) patch.tableMarkdown = proposedSnapshot.tableMarkdown
    if (proposedSnapshot.marks !== beforeSnapshot.marks) patch.marks = proposedSnapshot.marks

    if (Object.keys(patch).length > 0) {
      await prisma.examQuestion.update({ where: { id: existingRoot.id }, data: patch })
    }
    const undoPayload: UndoPayload = {
      mode: 'restore-existing',
      rootQuestionId: existingRoot.id,
      snapshot: beforeSnapshot,
    }
    return res.status(200).json({
      message: hasChanges ? 'Root context updated from AI extraction.' : 'No changes were applied.',
      updated: hasChanges,
      selectionWarning: manualSelectionWarning,
      undo: undoPayload,
      rootQuestionId: existingRoot.id,
    })
  }

  // No root record exists — create one if we have text
  if (proposedSnapshot.questionText) {
    const created = await prisma.examQuestion.create({
      data: {
        sourceId: question.sourceId,
        grade: question.grade,
        year: question.year,
        month: question.month,
        paper: question.paper,
        questionNumber: rootNumber,
        questionDepth: questionDepthFromNumber(rootNumber),
        topic: null,
        cognitiveLevel: null,
        marks: proposedSnapshot.marks,
        questionText: proposedSnapshot.questionText,
        latex: proposedSnapshot.latex,
        imageUrl: proposedSnapshot.imageUrl,
        tableMarkdown: proposedSnapshot.tableMarkdown,
        approved: false,
      },
      select: { id: true },
    })
    const undoPayload: UndoPayload = {
      mode: 'delete-created',
      rootQuestionId: created.id,
    }
    return res.status(200).json({
      message: 'Root context created from AI extraction.',
      updated: true,
      selectionWarning: manualSelectionWarning,
      undo: undoPayload,
      rootQuestionId: created.id,
    })
  }

  return res.status(200).json({
    message: 'AI returned no usable content for this question.',
    updated: false,
    selectionWarning: manualSelectionWarning,
  })
}
