// === Browser document

/** Configures a toolset that drives one browser document. */
export interface BrowserDocumentOptions {
	/** The document the toolset reads and acts on. */
	readonly document: Document
	/** Opts in to a toolset that owns the document; the toolset then releases it on teardown. */
	readonly own?: boolean
}
