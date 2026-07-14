import type { BatchInterface } from './types.js'
import { Batch } from './batches/Batch.js'

// === Reactive

/**
 * Maximum iterations when flushing a batch to prevent infinite reactive loops.
 */
export const MAX_BATCH_ITERATIONS = 100

/**
 * Shared reactive runtime instance used by all reactive primitives.
 */
export const batcher: BatchInterface = new Batch()

/**
 * Default concurrency for the Scheduler.
 */
export const DEFAULT_SCHEDULER_CONCURRENCY = 1

// === Queue

/**
 * Initial ring buffer capacity.
 */
export const INITIAL_CAPACITY = 32

/**
 * Prefix for auto-generated queue entry IDs.
 */
export const QUEUE_ID_PREFIX = 'q'

/**
 * Default number of parallel workers.
 */
export const DEFAULT_CONCURRENCY = 1

/**
 * Default handler timeout in milliseconds (0 = no timeout).
 */
export const DEFAULT_TIMEOUT_MS = 0

/**
 * Default retry count after first failure.
 */
export const DEFAULT_RETRIES = 0

/**
 * Default bail behavior (false = do not abort on first failure).
 */
export const DEFAULT_BAIL = false

/**
 * Default scheduling priority (0 = normal).
 */
export const DEFAULT_PRIORITY = 0

// === NodeWorker

/**
 * Prefix for node worker dispatch message IDs.
 */
export const NODE_WORKER_ID_PREFIX = 'nw'

// === MsgReader

/**
 * CFB magic header bytes (0xD0CF11E0A1B11AE1).
 */
export const MSG_FILE_HEADER = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/**
 * Sentinel for unused blocks in the FAT.
 */
export const MSG_UNUSED_BLOCK = -1

/**
 * Sentinel for end-of-chain in the FAT.
 */
export const MSG_END_OF_CHAIN = -2

/**
 * Small sector size (512 bytes).
 */
export const MSG_S_BIG_BLOCK_SIZE = 0x0200

/**
 * Small sector size mark in the header (byte at offset 30).
 */
export const MSG_S_BIG_BLOCK_MARK = 9

/**
 * Large sector size (4096 bytes).
 */
export const MSG_L_BIG_BLOCK_SIZE = 0x1000

/**
 * Large sector size mark in the header (byte at offset 30).
 */
export const MSG_L_BIG_BLOCK_MARK = 12

/**
 * Mini-stream sector size (64 bytes).
 */
export const MSG_SMALL_BLOCK_SIZE = 0x0040

/**
 * Threshold below which data is stored in the mini-stream.
 */
export const MSG_BIG_BLOCK_MIN_DOC_SIZE = 0x1000

/**
 * Header offset: property (directory) start sector.
 */
export const MSG_HEADER_PROPERTY_START_OFFSET = 0x30

/**
 * Header offset: BAT sector array start.
 */
export const MSG_HEADER_BAT_START_OFFSET = 0x4c

/**
 * Header offset: BAT sector count.
 */
export const MSG_HEADER_BAT_COUNT_OFFSET = 0x2c

/**
 * Header offset: SBAT start sector.
 */
export const MSG_HEADER_SBAT_START_OFFSET = 0x3c

/**
 * Header offset: SBAT sector count.
 */
export const MSG_HEADER_SBAT_COUNT_OFFSET = 0x40

/**
 * Header offset: XBAT (DIFAT) start sector.
 */
export const MSG_HEADER_XBAT_START_OFFSET = 0x44

/**
 * Header offset: XBAT (DIFAT) sector count.
 */
export const MSG_HEADER_XBAT_COUNT_OFFSET = 0x48

/**
 * No child/sibling index sentinel.
 */
export const MSG_PROP_NO_INDEX = -1

/**
 * Directory entry size in bytes.
 */
export const MSG_PROPERTY_SIZE = 0x0080

/**
 * Offset within a directory entry: name byte length.
 */
export const MSG_PROP_NAME_SIZE_OFFSET = 0x40

/**
 * Offset within a directory entry: object type byte.
 */
export const MSG_PROP_TYPE_OFFSET = 0x42

/**
 * Offset within a directory entry: left sibling index.
 */
export const MSG_PROP_PREVIOUS_PROPERTY_OFFSET = 0x44

/**
 * Offset within a directory entry: right sibling index.
 */
export const MSG_PROP_NEXT_PROPERTY_OFFSET = 0x48

/**
 * Offset within a directory entry: child index.
 */
export const MSG_PROP_CHILD_PROPERTY_OFFSET = 0x4c

/**
 * Offset within a directory entry: start sector of stream data.
 */
export const MSG_PROP_START_BLOCK_OFFSET = 0x74

/**
 * Offset within a directory entry: stream byte length.
 */
export const MSG_PROP_SIZE_OFFSET = 0x78

/**
 * Directory entry type: unallocated.
 */
export const MSG_TYPE_UNALLOCATED = 0

/**
 * Directory entry type: storage (folder).
 */
export const MSG_TYPE_DIRECTORY = 1

/**
 * Directory entry type: stream (document).
 */
export const MSG_TYPE_DOCUMENT = 2

/**
 * Directory entry type: root storage.
 */
export const MSG_TYPE_ROOT = 5

/**
 * Name prefix for attachment storage entries.
 */
export const MSG_PREFIX_ATTACHMENT = '__attach_version1.0'

/**
 * Name prefix for recipient storage entries.
 */
export const MSG_PREFIX_RECIPIENT = '__recip_version1.0'

/**
 * Name prefix for document (substg) stream entries.
 */
export const MSG_PREFIX_DOCUMENT = '__substg1.'

/**
 * Name prefix for named property mapping storage.
 */
export const MSG_PREFIX_NAMEID = '__nameid_version1.0'

/**
 * MAPI property tag to field name mapping.
 */
export const MSG_FIELD_NAME_MAPPING: Readonly<Record<string, string>> = {
	// email specific
	'001a': 'messageClass',
	'0037': 'subject',
	'0039': 'clientSubmitTime',
	'0070': 'conversationTopic',
	'007d': 'headers',
	'0c15': 'recipientRole',
	'0c1a': 'senderName',
	'0c1e': 'senderAddressType',
	'0c1f': 'senderEmail',
	'0e06': 'messageDeliveryTime',
	'0e07': 'messageFlags',
	'0e1d': 'normalizedSubject',
	'1000': 'body',
	'1009': 'compressedRtf',
	'1035': 'messageId',
	// recipient specific
	'3001': 'name',
	'3002': 'addressType',
	'3003': 'email',
	// shared (msg + attachment)
	'3007': 'creationTime',
	'3008': 'lastModificationTime',
	// attachment specific
	'3703': 'extension',
	'3704': 'fileNameShort',
	'3707': 'fileName',
	'3712': 'contentId',
	'370e': 'mimeType',
	// recipient / msg
	'39fe': 'smtpAddress',
	// msg metadata
	'3fd9': 'preview',
	'3fde': 'internetCodepage',
	'3ff1': 'messageLocaleId',
	'3ffa': 'lastModifierName',
	'3ffd': 'messageCodepage',
	'5d01': 'senderSmtpAddress',
	'5d02': 'sentRepresentingSmtpAddress',
	'5d0a': 'creatorSmtpAddress',
	'5d0b': 'lastModifierSmtpAddress',
	'7ffe': 'attachmentHidden',
	// contact specific
	'3a05': 'generation',
	'3a06': 'givenName',
	'3a08': 'businessPhone',
	'3a09': 'homePhone',
	'3a0d': 'location',
	'3a11': 'surname',
	'3a15': 'postalAddress',
	'3a16': 'companyName',
	'3a17': 'jobTitle',
	'3a18': 'departmentName',
	'3a1c': 'mobilePhone',
	'3a24': 'businessFax',
	'3a26': 'country',
	'3a27': 'homeAddressCity',
	'3a28': 'stateOrProvince',
	'3a29': 'streetAddress',
	'3a2a': 'postalCode',
	'3a44': 'middleName',
	'3a45': 'namePrefix',
	'3a51': 'businessHomePage',
}

/**
 * Full 8-char property tag to field name mapping (for compound tags).
 */
export const MSG_FIELD_FULL_NAME_MAPPING: Readonly<Record<string, string>> = {
	'1013001f': 'bodyHtml',
	'10130102': 'html',
}

/**
 * MAPI property type tag to decode type mapping.
 */
export const MSG_FIELD_TYPE_MAPPING: Readonly<Record<string, string>> = {
	'001e': 'string',
	'001f': 'unicode',
	'0040': 'time',
	'0102': 'binary',
	'0003': 'integer',
	'000b': 'boolean',
}

/**
 * Attachment data class identifier.
 */
export const MSG_FIELD_CLASS_ATTACHMENT_DATA = '3701'

/**
 * Directory field type indicating an embedded MSG.
 */
export const MSG_FIELD_DIR_TYPE_INNER_MSG = '000d'

/**
 * MAPI recipient type: TO.
 */
export const MSG_MAPI_RECIPIENT_TO = 1

/**
 * MAPI recipient type: CC.
 */
export const MSG_MAPI_RECIPIENT_CC = 2

/**
 * MAPI recipient type: BCC.
 */
export const MSG_MAPI_RECIPIENT_BCC = 3

/**
 * PidLid property set GUID to LID-to-field-name mapping.
 * Maps well-known MAPI named property sets to their property
 * long IDs and corresponding field names on MsgFieldData.
 */
export const MSG_PIDLID_MAPPING: Readonly<Record<string, Readonly<Record<number, string>>>> = {
	// PSETID_Common
	'00062008-0000-0000-c000-000000000046': {
		0x00008524: 'votingResponse',
		0x00008580: 'internetAccountName',
	},
	// PSETID_Appointment
	'00062002-0000-0000-c000-000000000046': {
		0x0000820d: 'appointmentStart',
		0x0000820e: 'appointmentEnd',
		0x00008208: 'appointmentLocation',
		0x00008234: 'timeZoneDescription',
		0x00008235: 'clipStart',
		0x00008236: 'clipEnd',
	},
	// PSETID_Address
	'00062004-0000-0000-c000-000000000046': {
		0x00008005: 'fileUnder',
		0x00008010: 'departmentName',
		0x0000801b: 'workAddress',
		0x0000802b: 'contactWebPage',
		0x0000802c: 'yomiFirstName',
		0x0000802d: 'yomiLastName',
		0x0000802e: 'yomiCompanyName',
		0x00008045: 'workAddressStreet',
		0x00008046: 'workAddressCity',
		0x00008047: 'workAddressState',
		0x00008048: 'workAddressPostalCode',
		0x00008049: 'workAddressCountry',
		0x00008062: 'instantMessagingAddress',
		0x00008080: 'primaryEmailDisplayName',
		0x00008083: 'primaryEmailAddress',
		0x00008084: 'primaryEmailOriginalDisplayName',
		0x000080b2: 'fax1AddressType',
		0x000080b3: 'fax1EmailAddress',
		0x000080b4: 'fax1OriginalDisplayName',
		0x000080c2: 'fax2AddressType',
		0x000080c3: 'fax2EmailAddress',
		0x000080c4: 'fax2OriginalDisplayName',
		0x000080d2: 'fax3AddressType',
		0x000080d3: 'fax3EmailAddress',
		0x000080d4: 'fax3OriginalDisplayName',
		0x000080db: 'workAddressCountryCode',
		0x000080dd: 'addressCountryCode',
	},
	// PSETID_Meeting
	'6ed8da90-450b-101b-98da-00aa003f1305': {
		0x00000003: 'globalAppointmentId',
		0x00000028: 'appointmentOldLocation',
	},
}

// === MsgBurner

/**
 * Standard CFB sector size in bytes (512).
 */
export const MSG_BURNER_SECTOR_SIZE = 512

/**
 * CFB mini-stream sector size in bytes (64).
 */
export const MSG_BURNER_MINI_SECTOR_SIZE = 64

/**
 * Threshold below which streams are stored in the mini-stream (4096).
 */
export const MSG_BURNER_MINI_STREAM_CUTOFF = 4096

/**
 * Number of 32-bit integers per standard sector (128).
 */
export const MSG_BURNER_INTS_PER_SECTOR = MSG_BURNER_SECTOR_SIZE / 4

/**
 * Maximum DIFAT entries stored in the CFB header (109).
 */
export const MSG_BURNER_DIFAT_HEADER_SLOTS = 109

/**
 * CFB directory entry size in bytes (128).
 */
export const MSG_BURNER_DIR_ENTRY_SIZE = 128

/**
 * FAT sector marker: this sector holds FAT data (-3).
 */
export const MSG_BURNER_FAT_SECTOR_MARKER = -3

/**
 * DIFAT sector marker: this sector holds DIFAT data (-4).
 */
export const MSG_BURNER_DIFAT_SECTOR_MARKER = -4

/**
 * Root entry CLSID for MSG compound files.
 */
export const MSG_BURNER_ROOT_CLSID = new Uint8Array([
	0x0b, 0x0d, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
])

// === EmailParser

/**
 * File extensions recognized as RFC 2822 / MIME email files.
 */
export const EML_EXTENSIONS: readonly string[] = ['.eml']

/**
 * File extensions recognized as Outlook binary email files.
 */
export const MSG_EXTENSIONS: readonly string[] = ['.msg']

/**
 * MIME types recognized as RFC 2822 / MIME email files.
 */
export const EML_MIME_TYPES: readonly string[] = ['message/rfc822']

/**
 * MIME types recognized as Outlook binary email files.
 */
export const MSG_MIME_TYPES: readonly string[] = ['application/vnd.ms-outlook']

/**
 * Default charset for decoding MIME part bodies.
 */
export const FALLBACK_CHARSET = 'utf-8'

/**
 * Default file name for attachments without an explicit name.
 */
export const FALLBACK_ATTACHMENT_NAME = 'attachment'

/**
 * Common MIME types to file extensions mapping.
 * Used for inferring the correct extension during file extraction.
 */
export const MIME_EXTENSIONS: ReadonlyMap<string, string> = new Map([
	['image/jpeg', '.jpg'],
	['image/jpg', '.jpg'],
	['image/png', '.png'],
	['image/gif', '.gif'],
	['image/webp', '.webp'],
	['application/pdf', '.pdf'],
	['text/plain', '.txt'],
	['text/csv', '.csv'],
	['text/html', '.html'],
	['application/json', '.json'],
	['application/zip', '.zip'],
	['application/vnd.ms-excel', '.xls'],
	['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
	['application/msword', '.doc'],
	['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
	['application/vnd.ms-powerpoint', '.ppt'],
	['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
	['message/rfc822', '.eml'],
	['application/vnd.ms-outlook', '.msg'],
])

// === Browser

/**
 * Default CDP port for browser discovery.
 */
export const BROWSER_DEFAULT_CDP_PORT = 9222

/**
 * Default timeout in milliseconds for browser connection and navigation.
 */
export const BROWSER_DEFAULT_TIMEOUT_MS = 30_000

/**
 * Default viewport width in pixels.
 */
export const BROWSER_DEFAULT_VIEWPORT_WIDTH = 1280

/**
 * Default viewport height in pixels.
 */
export const BROWSER_DEFAULT_VIEWPORT_HEIGHT = 720

/**
 * Path appended to the CDP host to fetch version metadata.
 */
export const BROWSER_CDP_VERSION_PATH = '/json/version'

/**
 * Protocol prefix for CDP discovery requests.
 */
export const BROWSER_CDP_PROTOCOL = 'http'
