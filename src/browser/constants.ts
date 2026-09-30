// === Browser document

/**
 * Sets the default `wait` deadline for DOM waits in a browser document toolset, `5_000`
 * milliseconds.
 */
export const BROWSER_DOCUMENT_TIMEOUT_MS = 5_000

/**
 * Maps an HTML element to the ARIA role the HTML Accessibility API Mappings specification gives
 * it when it carries no `role` attribute.
 *
 * @remarks
 * A key is a lowercase element name, or `input:` followed by the input's `type` state. An element
 * whose mapping depends on more than its name — `a` and `area` without `href`, `select` with
 * `multiple` or a `size` above 1, an `img` with an empty `alt`, a scoped `header` or `footer`, a
 * `section` or `form` without an accessible name, and a text input with a `list` — is resolved
 * by `computeBrowserRole` before this table is read. An element or input state the mapping gives
 * no role has no entry.
 */
export const BROWSER_IMPLICIT_ROLES: ReadonlyMap<string, string> = Object.freeze(
	new Map([
		['a', 'link'],
		['area', 'link'],
		['article', 'article'],
		['aside', 'complementary'],
		['blockquote', 'blockquote'],
		['button', 'button'],
		['caption', 'caption'],
		['code', 'code'],
		['datalist', 'listbox'],
		['dd', 'definition'],
		['del', 'deletion'],
		['details', 'group'],
		['dfn', 'term'],
		['dialog', 'dialog'],
		['dt', 'term'],
		['em', 'emphasis'],
		['fieldset', 'group'],
		['figure', 'figure'],
		['footer', 'contentinfo'],
		['form', 'form'],
		['h1', 'heading'],
		['h2', 'heading'],
		['h3', 'heading'],
		['h4', 'heading'],
		['h5', 'heading'],
		['h6', 'heading'],
		['header', 'banner'],
		['hr', 'separator'],
		['html', 'document'],
		['img', 'img'],
		['ins', 'insertion'],
		['li', 'listitem'],
		['main', 'main'],
		['math', 'math'],
		['menu', 'list'],
		['meter', 'meter'],
		['nav', 'navigation'],
		['ol', 'list'],
		['optgroup', 'group'],
		['option', 'option'],
		['output', 'status'],
		['p', 'paragraph'],
		['progress', 'progressbar'],
		['search', 'search'],
		['section', 'region'],
		['select', 'combobox'],
		['strong', 'strong'],
		['sub', 'subscript'],
		['sup', 'superscript'],
		['table', 'table'],
		['tbody', 'rowgroup'],
		['td', 'cell'],
		['textarea', 'textbox'],
		['tfoot', 'rowgroup'],
		['th', 'columnheader'],
		['thead', 'rowgroup'],
		['time', 'time'],
		['tr', 'row'],
		['ul', 'list'],
		['input:button', 'button'],
		['input:checkbox', 'checkbox'],
		['input:email', 'textbox'],
		['input:image', 'button'],
		['input:number', 'spinbutton'],
		['input:password', 'textbox'],
		['input:radio', 'radio'],
		['input:range', 'slider'],
		['input:reset', 'button'],
		['input:search', 'searchbox'],
		['input:submit', 'button'],
		['input:tel', 'textbox'],
		['input:text', 'textbox'],
		['input:url', 'textbox'],
	]),
)

/**
 * Names the ARIA roles whose accessible name the accessible-name computation takes from the
 * element's content when no attribute or label names it.
 */
export const BROWSER_CONTENT_NAMED_ROLES: ReadonlySet<string> = Object.freeze(
	new Set([
		'button',
		'cell',
		'checkbox',
		'columnheader',
		'gridcell',
		'heading',
		'link',
		'menuitem',
		'menuitemcheckbox',
		'menuitemradio',
		'option',
		'radio',
		'row',
		'rowheader',
		'switch',
		'tab',
		'tooltip',
		'treeitem',
	]),
)

/**
 * Names the link and form targets that navigate the current browsing context or one of its
 * ancestors. `_blank` opens another browsing context, and any other name targets the browsing
 * context carrying that name, which `matchesBrowserPopup` resolves.
 */
export const BROWSER_CONTEXT_TARGETS: ReadonlySet<string> = Object.freeze(
	new Set(['', '_self', '_parent', '_top']),
)

/** Names the `input` type states whose value an untrusted `fill` sets as typed text. */
export const BROWSER_TYPED_INPUTS: ReadonlySet<string> = Object.freeze(
	new Set([
		'date',
		'datetime-local',
		'email',
		'month',
		'number',
		'password',
		'search',
		'tel',
		'text',
		'time',
		'url',
		'week',
	]),
)
