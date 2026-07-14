/**
 * Email Example
 *
 * A richer email inspector for `.eml` and `.msg` files.
 * Demonstrates:
 * - high-level parsing with EmailParser
 * - low-level MIME inspection for `.eml`
 * - low-level MSG inspection for `.msg`
 * - attachment export
 * - full `.msg` round-trips using MsgReader and MsgBurner
 *
 * Usage:
 *   npx tsx examples/email.ts <file.eml|file.msg>
 *   npx tsx examples/email.ts tests/readers/fixtures/test.msg --headers --burn
 *   npx tsx examples/email.ts tests/readers/fixtures/attachmentFiles.msg --save --output tmp/email-demo
 *   npx tsx examples/email.ts path/to/message.eml --interactive
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface, type Interface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import type { EmailMessage, MimePart, MsgFieldData } from 'keepalive'
import {
	createEmailParser,
	createMsgReader,
	detectFormat,
	extractMessage,
	extractMessageFromMsg,
	inferExtension,
	isMsgFile,
	isParseError,
	isUnsupportedFormatError,
	parseMimePart,
} from 'keepalive'

// === CLI Arguments

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		help: { type: 'boolean', short: 'h' },
		headers: { type: 'boolean' },
		save: { type: 'boolean' },
		burn: { type: 'boolean' },
		interactive: { type: 'boolean', short: 'i' },
		output: { type: 'string', short: 'o' },
		'ansi-encoding': { type: 'string' },
		'no-color': { type: 'boolean' },
	},
})

const color = values['no-color'] !== true && stdout.isTTY
const RESET = color ? '\x1b[0m' : ''
const BOLD = color ? '\x1b[1m' : ''
const DIM = color ? '\x1b[2m' : ''
const GREEN = color ? '\x1b[32m' : ''
const YELLOW = color ? '\x1b[33m' : ''
const CYAN = color ? '\x1b[36m' : ''
const RED = color ? '\x1b[31m' : ''
const MAGENTA = color ? '\x1b[35m' : ''

// === Helpers

function label(text: string): string {
	return `${DIM}${text}${RESET}`
}

function heading(text: string): void {
	console.log(`\n${BOLD}${CYAN}═══ ${text} ═══${RESET}`)
}

function subheading(text: string): void {
	console.log(`\n${BOLD}${text}${RESET}`)
}

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\r?\n/g, ' ').trim()
	if (oneLine.length <= max) return oneLine
	return `${oneLine.slice(0, max)}...`
}

function sanitizeFileName(text: string): string {
	const cleaned = text
		.replace(/[^a-zA-Z0-9._-]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
	return cleaned.length > 0 ? cleaned : 'file'
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(buffer).set(bytes)
	return buffer
}

function countMimeParts(part: MimePart): number {
	let total = 1
	for (const child of part.parts) {
		total += countMimeParts(child)
	}
	return total
}

function printMimeTree(part: MimePart, depth = 0): void {
	const indent = '  '.repeat(depth)
	const contentType = part.headers.get('content-type')
	const disposition = part.headers.get('content-disposition')
	const name = disposition?.params.get('filename') ?? contentType?.params.get('name')
	const summary =
		part.parts.length > 0 ? `${part.parts.length} child parts` : `${part.body.length} body chars`

	console.log(
		`${indent}${MAGENTA}•${RESET} ${contentType?.value ?? 'text/plain'} ${DIM}(${summary})${RESET}${name !== undefined ? ` ${YELLOW}[${name}]${RESET}` : ''}`,
	)

	for (const child of part.parts) {
		printMimeTree(child, depth + 1)
	}
}

function printMimeHeaders(part: MimePart): void {
	for (const [name, header] of part.headers.entries()) {
		const params = [...header.params.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
		const suffix = params.length > 0 ? ` ${DIM}[${params}]${RESET}` : ''
		console.log(`  ${label(name + ':')} ${header.value}${suffix}`)
	}
}

function printAttachmentSummary(message: EmailMessage): void {
	console.log(`  ${label('Attachments:')} ${message.attachments.length}`)
	for (const attachment of message.attachments) {
		console.log(
			`    ${MAGENTA}📎${RESET} ${attachment.name} ${DIM}(${attachment.mimeType}, ${attachment.size} bytes)${RESET}`,
		)
	}
}

async function saveAttachments(message: EmailMessage, outputDir: string): Promise<void> {
	if (message.attachments.length === 0) {
		console.log(`  ${YELLOW}No attachments to save.${RESET}`)
		return
	}

	await mkdir(outputDir, { recursive: true })

	let index = 0
	for (const attachment of message.attachments) {
		index++
		const extension = inferExtension(attachment.mimeType, attachment.name)
		const stem = sanitizeFileName(attachment.name)
		const fileName = stem.toLowerCase().endsWith(extension.toLowerCase())
			? stem
			: `${stem}${extension}`
		const outputPath = join(outputDir, fileName)

		await writeFile(outputPath, attachment.bytes)
		console.log(`  ${GREEN}saved attachment ${index}:${RESET} ${outputPath}`)
	}
}

async function saveMsgAttachments(
	reader: ReturnType<typeof createMsgReader>,
	fields: MsgFieldData,
	outputDir: string,
): Promise<void> {
	const attachments = fields.attachments ?? []
	if (attachments.length === 0) {
		console.log(`  ${YELLOW}No MSG attachments to save.${RESET}`)
		return
	}

	await mkdir(outputDir, { recursive: true })

	for (let index = 0; index < attachments.length; index++) {
		const attachment = attachments[index]
		const result = reader.attachment(index)
		const originalName = result.fileName.length > 0 ? result.fileName : `attachment-${index + 1}`
		const extension =
			attachment.innerMsgContent === true
				? '.msg'
				: inferExtension(attachment.mimeType, originalName)
		const stem = sanitizeFileName(originalName)
		const fileName = stem.toLowerCase().endsWith(extension.toLowerCase())
			? stem
			: `${stem}${extension}`
		const outputPath = join(outputDir, fileName)
		const embedded =
			attachment.innerMsgContent === true ? ` ${YELLOW}(embedded .msg round-trip)${RESET}` : ''

		await writeFile(outputPath, result.content)
		console.log(`  ${GREEN}saved MSG attachment ${index + 1}:${RESET} ${outputPath}${embedded}`)
	}
}

async function runBurnerDemo(
	reader: ReturnType<typeof createMsgReader>,
	message: EmailMessage,
	outputDir: string,
	fileStem: string,
	encoding: string | undefined,
): Promise<void> {
	subheading('Method 3: MsgReader → MsgBurner → MsgReader round-trip')

	const binary = reader.burn()
	const outputPath = join(outputDir, `${fileStem}.roundtrip.msg`)

	await mkdir(outputDir, { recursive: true })
	await writeFile(outputPath, binary)

	const valid = isMsgFile(new DataView(binary.buffer, binary.byteOffset, binary.byteLength))
	console.log(`  ${label('Valid CFB:')}     ${valid ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`}`)
	console.log(`  ${label('Saved:')}         ${outputPath}`)
	console.log(`  ${label('Original subject:')} ${message.subject || '(none)'}`)

	const rebuiltReader = createMsgReader(
		toArrayBuffer(binary),
		encoding !== undefined ? { encoding } : undefined,
	)
	const fields = rebuiltReader.parse()

	console.log(`  ${label('Round-trip subject:')} ${fields.subject ?? '(none)'}`)
	console.log(`  ${label('Round-trip body:')}    ${truncate(fields.body ?? '', 120) || '(empty)'}`)
	console.log(`  ${label('Round-trip attachments:')} ${fields.attachments?.length ?? 0}`)
}

function printMsgDetails(fields: MsgFieldData): void {
	console.log(`  ${label('Data type:')}    ${fields.dataType}`)
	console.log(`  ${label('Subject:')}      ${fields.subject ?? '(none)'}`)
	console.log(`  ${label('Sender:')}       ${fields.senderName ?? '(none)'}`)
	console.log(
		`  ${label('Sender SMTP:')}  ${fields.senderSmtpAddress ?? fields.senderEmail ?? '(none)'}`,
	)
	console.log(`  ${label('Headers:')}      ${fields.headers !== undefined ? 'present' : 'absent'}`)
	console.log(`  ${label('Recipients:')}   ${fields.recipients?.length ?? 0}`)
	console.log(`  ${label('Attachments:')}  ${fields.attachments?.length ?? 0}`)

	const recipients = fields.recipients ?? []
	if (recipients.length > 0) {
		console.log(`  ${label('Recipient list:')}`)
		for (const recipient of recipients) {
			console.log(
				`    ${MAGENTA}•${RESET} ${recipient.recipientRole ?? 'unknown'} → ${recipient.name ?? '(no name)'} <${recipient.smtpAddress ?? recipient.email ?? ''}>`,
			)
		}
	}

	const attachments = fields.attachments ?? []
	if (attachments.length > 0) {
		console.log(`  ${label('Attachment list:')}`)
		for (const attachment of attachments) {
			const fileName = attachment.fileName ?? attachment.fileNameShort ?? '(unnamed)'
			const embedded = attachment.innerMsgContent === true ? `${YELLOW} embedded .msg${RESET}` : ''
			console.log(
				`    ${MAGENTA}📎${RESET} ${fileName} ${DIM}(${attachment.mimeType ?? 'application/octet-stream'}, ${attachment.contentLength ?? 0} bytes)${RESET}${embedded}`,
			)
			if (attachment.innerMsgContentFields?.subject !== undefined) {
				console.log(
					`      ${label('embedded subject:')} ${attachment.innerMsgContentFields.subject}`,
				)
			}
		}
	}
}

function printHelp(): void {
	console.log(`${BOLD}Email Example${RESET}`)
	console.log(`\n${DIM}Usage:${RESET}`)
	console.log('  npx tsx examples/email.ts <file.eml|file.msg> [options]')
	console.log(`\n${DIM}Options:${RESET}`)
	console.log('  --headers           Show raw MIME headers or MSG transport headers')
	console.log(
		'  --save              Save extracted attachments to disk (embedded .msg files included)',
	)
	console.log('  --burn              Generate a full `.msg` round-trip file from a `.msg` input')
	console.log('  --interactive, -i   Ask before saving attachments / burner output')
	console.log('  --output, -o [directory]  Output directory for attachments and burner demo')
	console.log('  --ansi-encoding     Override MsgReader ANSI decoding (default windows-1252)')
	console.log('  --no-color          Disable ANSI colors')
	console.log('  --help, -h          Show this help')
	console.log(`\n${DIM}Examples:${RESET}`)
	console.log('  npx tsx examples/email.ts tests/readers/fixtures/test.msg --headers --burn')
	console.log('  npx tsx examples/email.ts tests/readers/fixtures/attachmentFiles.msg --save')
	console.log('  npx tsx examples/email.ts path/to/message.eml --interactive')
}

async function askYesNo(rl: Interface, prompt: string, fallback = false): Promise<boolean> {
	const hint = fallback ? 'Y/n' : 'y/N'
	const answer = (await rl.question(`${prompt} [${hint}] `)).trim().toLowerCase()
	if (answer === '') return fallback
	return answer === 'y' || answer === 'yes'
}

// === Main

if (values.help === true || positionals[0] === undefined) {
	printHelp()
	process.exit(0)
}

const filePath = resolve(process.cwd(), positionals[0])
const fileName = basename(filePath)
const fileStem = sanitizeFileName(basename(filePath, extname(filePath)))
const outputDir = resolve(process.cwd(), values.output ?? join('tmp', 'email-example', fileStem))
const ansiEncoding = values['ansi-encoding']

const fileStats = await stat(filePath)
const bytes = await readFile(filePath)
const file = new File([bytes], fileName)
const detected = detectFormat(file)

heading(`Inspecting: ${fileName}`)
console.log(`  ${label('Path:')}      ${filePath}`)
console.log(`  ${label('Size:')}      ${fileStats.size} bytes`)
console.log(`  ${label('Detected:')}  ${detected ?? '(unknown)'}`)
console.log(`  ${label('Output dir:')} ${outputDir}`)

subheading('Method 1: EmailParser (recommended)')

const parser = createEmailParser()
const result = await parser.parse(file)

if (!result.success) {
	const error = result.error
	const prefix = isUnsupportedFormatError(error)
		? 'Unsupported format'
		: isParseError(error)
			? 'Parse error'
			: 'Error'
	console.log(`  ${RED}✗ ${prefix}:${RESET} ${error.message}`)
	process.exit(1)
}

const chain = result.value
const message = chain.messages[0]

if (message === undefined) {
	console.log(`  ${RED}✗ No messages extracted${RESET}`)
	process.exit(1)
}

console.log(`  ${label('Format:')}      ${GREEN}${chain.format}${RESET}`)
console.log(`  ${label('From:')}        ${message.from || '(none)'}`)
console.log(`  ${label('To:')}          ${message.to.join(', ') || '(none)'}`)
console.log(`  ${label('CC:')}          ${message.cc.join(', ') || '(none)'}`)
console.log(`  ${label('Subject:')}     ${message.subject || '(none)'}`)
console.log(`  ${label('Date:')}        ${message.date?.toISOString() ?? '(unknown)'}`)
console.log(`  ${label('Text preview:')} ${truncate(message.text, 140) || '(empty)'}`)
console.log(
	`  ${label('HTML:')}        ${message.html.length > 0 ? `${message.html.length} chars` : '(empty)'}`,
)
printAttachmentSummary(message)

let saveRequested = values.save === true
let burnRequested = values.burn === true
let headerRequested = values.headers === true

if (values.interactive === true && stdin.isTTY && stdout.isTTY) {
	subheading('Interactive Options')
	const rl = createInterface({ input: stdin, output: stdout })
	if (!headerRequested) {
		headerRequested = await askYesNo(rl, 'Show raw headers?', false)
	}
	if (!saveRequested && message.attachments.length > 0) {
		saveRequested = await askYesNo(rl, 'Save attachments to disk?', false)
	}
	if (!burnRequested) {
		burnRequested = await askYesNo(rl, 'Generate a round-trip .msg file?', true)
	}
	rl.close()
}

let msgReader: ReturnType<typeof createMsgReader> | undefined
let msgFields: MsgFieldData | undefined

if (chain.format === 'msg') {
	subheading('Method 2: MsgReader + extractMessageFromMsg')

	const reader = createMsgReader(
		toArrayBuffer(bytes),
		ansiEncoding !== undefined ? { encoding: ansiEncoding } : undefined,
	)
	msgReader = reader
	const fields = reader.parse()
	msgFields = fields
	printMsgDetails(fields)

	const extracted = extractMessageFromMsg(reader)
	console.log(
		`  ${label('Extracted OK:')} ${GREEN}✓${RESET} ${extracted.to.length} recipients, ${extracted.attachments.length} attachments`,
	)

	if (headerRequested) {
		subheading('MSG Headers')
		console.log(fields.headers ?? '(none)')
	}
}

if (chain.format === 'eml') {
	subheading('Method 2: parseMimePart + extractMessage')

	const text = await file.text()
	const root = parseMimePart(text)
	const extracted = extractMessage(root)

	console.log(`  ${label('Header count:')} ${root.headers.size}`)
	console.log(`  ${label('Part count:')}   ${countMimeParts(root)}`)
	console.log(
		`  ${label('Extracted OK:')} ${GREEN}✓${RESET} ${extracted.to.length} recipients, ${extracted.attachments.length} attachments`,
	)

	subheading('MIME Tree')
	printMimeTree(root)

	if (headerRequested) {
		subheading('Top-level MIME Headers')
		printMimeHeaders(root)
	}
}

if (saveRequested) {
	subheading('Attachment Export')
	if (msgReader !== undefined && msgFields !== undefined) {
		await saveMsgAttachments(msgReader, msgFields, outputDir)
	} else {
		await saveAttachments(message, outputDir)
	}
}

if (burnRequested) {
	if (msgReader === undefined) {
		subheading('Method 3: Round-trip rebuild')
		console.log(`  ${YELLOW}Skipping: burner round-trip applies to .msg inputs only.${RESET}`)
	} else {
		await runBurnerDemo(msgReader, message, outputDir, fileStem, ansiEncoding)
	}
}

subheading('Format Detection')
console.log(`  ${label('File name:')}  ${fileName}`)
console.log(`  ${label('Detected:')}   ${detected ?? '(unknown)'}`)
console.log(`  ${label('MIME type:')}  ${file.type || '(none)'}`)

heading('Done')
console.log(`  ${YELLOW}Email inspection completed with zero external dependencies.${RESET}\n`)
