/** Observes whether one form submission dispatches its submit event. */
export class BrowserDOMSubmission implements EventListenerObject {
	#submitted = false

	get submitted(): boolean {
		return this.#submitted
	}

	handleEvent(): void {
		this.#submitted = true
	}
}
