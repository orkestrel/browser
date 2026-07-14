/**
 * Centralized error hierarchy.
 *
 * Every error thrown or returned by Queue, Worker, or NodeWorker is an
 * instance of its respective base class. Subclasses carry semantic meaning
 * so callers can branch on instanceof without parsing message strings.
 */

// === Queue Base

/**
 * Base error for all queue operations.
 */
export class QueueError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'QueueError'
	}
}

// === Queue Lifecycle Errors

/**
 * Queue has been destroyed and cannot accept operations.
 */
export class QueueDestroyedError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Queue is destroyed')
		this.name = 'QueueDestroyedError'
	}
}

/**
 * Queue has been aborted via signal or explicit abort.
 */
export class QueueAbortedError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Queue was aborted')
		this.name = 'QueueAbortedError'
	}
}

/**
 * Queue has been stopped and is not accepting new entries.
 */
export class QueueStoppedError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Queue was stopped')
		this.name = 'QueueStoppedError'
	}
}

/**
 * Pending entries were cleared from the queue.
 */
export class QueueClearedError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Queue was cleared')
		this.name = 'QueueClearedError'
	}
}

// === Queue Processing Errors

/**
 * Handler execution exceeded the configured timeout.
 */
export class QueueTimeoutError extends QueueError {
	readonly timeout: number

	constructor(timeout: number, message?: string) {
		super(message ?? `Timeout of ${timeout}ms exceeded`)
		this.name = 'QueueTimeoutError'
		this.timeout = timeout
	}
}

/**
 * Per-entry AbortSignal was triggered.
 */
export class QueueSignalAbortedError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Entry signal aborted')
		this.name = 'QueueSignalAbortedError'
	}
}

/**
 * Entry failed and triggered bail (automatic pause).
 */
export class QueueBailError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Entry bailed')
		this.name = 'QueueBailError'
	}
}

/**
 * Scheduled entry has expired (activation passed and expiration exceeded).
 */
export class QueueExpiredError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Scheduled entry expired')
		this.name = 'QueueExpiredError'
	}
}

/**
 * Task failed to execute (default fallback when no specific cause).
 */
export class QueueTaskError extends QueueError {
	constructor(message?: string) {
		super(message ?? 'Task failed to execute')
		this.name = 'QueueTaskError'
	}
}

// === Worker Base

/**
 * Base error for all worker operations.
 */
export class WorkerError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'WorkerError'
	}
}

// === Worker Lifecycle Errors

/**
 * Worker has been destroyed and cannot accept operations.
 */
export class WorkerDestroyedError extends WorkerError {
	constructor(message?: string) {
		super(message ?? 'Worker is destroyed')
		this.name = 'WorkerDestroyedError'
	}
}

// === NodeWorker Base

/**
 * Base error for all node worker operations.
 */
export class NodeWorkerError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'NodeWorkerError'
	}
}

// === NodeWorker Lifecycle Errors

/**
 * NodeWorker has been destroyed and cannot accept operations.
 */
export class NodeWorkerDestroyedError extends NodeWorkerError {
	constructor(message?: string) {
		super(message ?? 'NodeWorker is destroyed')
		this.name = 'NodeWorkerDestroyedError'
	}
}

/**
 * Worker thread encountered an error during dispatch.
 */
export class NodeWorkerThreadError extends NodeWorkerError {
	constructor(message?: string) {
		super(message ?? 'Worker thread error')
		this.name = 'NodeWorkerThreadError'
	}
}

// === Queue Type Guards

/**
 * Narrow an unknown value to QueueError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueError instance
 */
export function isQueueError(value: unknown): value is QueueError {
	return value instanceof QueueError
}

/**
 * Narrow an unknown value to QueueDestroyedError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueDestroyedError instance
 */
export function isQueueDestroyedError(value: unknown): value is QueueDestroyedError {
	return value instanceof QueueDestroyedError
}

/**
 * Narrow an unknown value to QueueAbortedError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueAbortedError instance
 */
export function isQueueAbortedError(value: unknown): value is QueueAbortedError {
	return value instanceof QueueAbortedError
}

/**
 * Narrow an unknown value to QueueStoppedError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueStoppedError instance
 */
export function isQueueStoppedError(value: unknown): value is QueueStoppedError {
	return value instanceof QueueStoppedError
}

/**
 * Narrow an unknown value to QueueTimeoutError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueTimeoutError instance
 */
export function isQueueTimeoutError(value: unknown): value is QueueTimeoutError {
	return value instanceof QueueTimeoutError
}

/**
 * Narrow an unknown value to QueueSignalAbortedError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueSignalAbortedError instance
 */
export function isQueueSignalAbortedError(value: unknown): value is QueueSignalAbortedError {
	return value instanceof QueueSignalAbortedError
}

/**
 * Narrow an unknown value to QueueClearedError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueClearedError instance
 */
export function isQueueClearedError(value: unknown): value is QueueClearedError {
	return value instanceof QueueClearedError
}

/**
 * Narrow an unknown value to QueueBailError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueBailError instance
 */
export function isQueueBailError(value: unknown): value is QueueBailError {
	return value instanceof QueueBailError
}

/**
 * Narrow an unknown value to QueueExpiredError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueExpiredError instance
 */
export function isQueueExpiredError(value: unknown): value is QueueExpiredError {
	return value instanceof QueueExpiredError
}

/**
 * Narrow an unknown value to QueueTaskError.
 *
 * @param value - Value to check
 * @returns True when value is a QueueTaskError instance
 */
export function isQueueTaskError(value: unknown): value is QueueTaskError {
	return value instanceof QueueTaskError
}

// === Worker Type Guards

/**
 * Narrow an unknown value to WorkerError.
 *
 * @param value - Value to check
 * @returns True when value is a WorkerError instance
 */
export function isWorkerError(value: unknown): value is WorkerError {
	return value instanceof WorkerError
}

/**
 * Narrow an unknown value to WorkerDestroyedError.
 *
 * @param value - Value to check
 * @returns True when value is a WorkerDestroyedError instance
 */
export function isWorkerDestroyedError(value: unknown): value is WorkerDestroyedError {
	return value instanceof WorkerDestroyedError
}

// === NodeWorker Type Guards

/**
 * Narrow an unknown value to NodeWorkerError.
 *
 * @param value - Value to check
 * @returns True when value is a NodeWorkerError instance
 */
export function isNodeWorkerError(value: unknown): value is NodeWorkerError {
	return value instanceof NodeWorkerError
}

/**
 * Narrow an unknown value to NodeWorkerDestroyedError.
 *
 * @param value - Value to check
 * @returns True when value is a NodeWorkerDestroyedError instance
 */
export function isNodeWorkerDestroyedError(value: unknown): value is NodeWorkerDestroyedError {
	return value instanceof NodeWorkerDestroyedError
}

/**
 * Narrow an unknown value to NodeWorkerThreadError.
 *
 * @param value - Value to check
 * @returns True when value is a NodeWorkerThreadError instance
 */
export function isNodeWorkerThreadError(value: unknown): value is NodeWorkerThreadError {
	return value instanceof NodeWorkerThreadError
}

// === EmailParser Base

/**
 * Base error for all email parser operations.
 */
export class EmailParserError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'EmailParserError'
	}
}

// === EmailParser Errors

/**
 * File format is not recognized as .eml or .msg.
 */
export class UnsupportedFormatError extends EmailParserError {
	constructor(message?: string) {
		super(message ?? 'Unsupported email format')
		this.name = 'UnsupportedFormatError'
	}
}

/**
 * File content could not be parsed as a valid email.
 */
export class ParseError extends EmailParserError {
	override readonly cause: unknown

	constructor(message?: string, cause?: unknown) {
		super(message ?? 'Failed to parse email')
		this.name = 'ParseError'
		this.cause = cause
	}
}

// === EmailParser Type Guards

/**
 * Narrow an unknown value to EmailParserError.
 *
 * @param value - Value to check
 * @returns True when value is an EmailParserError instance
 */
export function isEmailParserError(value: unknown): value is EmailParserError {
	return value instanceof EmailParserError
}

/**
 * Narrow an unknown value to UnsupportedFormatError.
 *
 * @param value - Value to check
 * @returns True when value is an UnsupportedFormatError instance
 */
export function isUnsupportedFormatError(value: unknown): value is UnsupportedFormatError {
	return value instanceof UnsupportedFormatError
}

/**
 * Narrow an unknown value to ParseError.
 *
 * @param value - Value to check
 * @returns True when value is a ParseError instance
 */
export function isParseError(value: unknown): value is ParseError {
	return value instanceof ParseError
}

// === Browser Base

/**
 * Base error for all browser operations.
 */
export class BrowserError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'BrowserError'
	}
}

// === Browser Lifecycle Errors

/**
 * Browser connection attempt failed.
 */
export class BrowserConnectionError extends BrowserError {
	constructor(message?: string) {
		super(message ?? 'Browser connection failed')
		this.name = 'BrowserConnectionError'
	}
}

/**
 * Browser operation exceeded the configured timeout.
 */
export class BrowserTimeoutError extends BrowserError {
	constructor(message?: string) {
		super(message ?? 'Browser operation timed out')
		this.name = 'BrowserTimeoutError'
	}
}

/**
 * Operation attempted on a browser that is not connected.
 */
export class BrowserNotConnectedError extends BrowserError {
	constructor(message?: string) {
		super(message ?? 'Browser is not connected')
		this.name = 'BrowserNotConnectedError'
	}
}

/**
 * Operation attempted on a browser that has been destroyed.
 */
export class BrowserDestroyedError extends BrowserError {
	constructor(message?: string) {
		super(message ?? 'Browser has been destroyed')
		this.name = 'BrowserDestroyedError'
	}
}

// === Browser Type Guards

/**
 * Narrow an unknown value to BrowserError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserError instance
 */
export function isBrowserError(value: unknown): value is BrowserError {
	return value instanceof BrowserError
}

/**
 * Narrow an unknown value to BrowserConnectionError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserConnectionError instance
 */
export function isBrowserConnectionError(value: unknown): value is BrowserConnectionError {
	return value instanceof BrowserConnectionError
}

/**
 * Narrow an unknown value to BrowserTimeoutError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserTimeoutError instance
 */
export function isBrowserTimeoutError(value: unknown): value is BrowserTimeoutError {
	return value instanceof BrowserTimeoutError
}

/**
 * Narrow an unknown value to BrowserNotConnectedError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserNotConnectedError instance
 */
export function isBrowserNotConnectedError(value: unknown): value is BrowserNotConnectedError {
	return value instanceof BrowserNotConnectedError
}

/**
 * Narrow an unknown value to BrowserDestroyedError.
 *
 * @param value - Value to check
 * @returns True when value is a BrowserDestroyedError instance
 */
export function isBrowserDestroyedError(value: unknown): value is BrowserDestroyedError {
	return value instanceof BrowserDestroyedError
}
