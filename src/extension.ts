import * as vscode from 'vscode';
import * as playwright from 'playwright';
import * as fs from 'fs';

type BindingSource = { frame: playwright.Frame, page: playwright.Page };
type PageEvent = { type: string, target?: string, key?: string, inputValue?: string };

// The TextDocument where the current recording is outputting code.
let generatedFile: vscode.TextDocument|null = null;

// The refresh loop used to generate code in the file, while a recording is ongoing.
let generatedFileRefreshLoop: NodeJS.Timeout|null = null;

// The current playwright browserContext
let browserContext: playwright.BrowserContext|null = null;

// The code template.
let codeTemplate: string|null = null;

let pageEventsRecorderInstance: PageEventsRecorder|null = null;

/**
 * Records all raw page events received via playwright
 */
class PageEventsRecorder {
	private rawEvents: PageEvent[] = [];

	recordEvent(event: PageEvent) {
		this.rawEvents.push(event);
	}

	/**
	 * Given a start index in the list of events, check that a sequence of down/up/click starts at this position, on the
	 * same target. If so, return the number of events that consistute the sequence. Otherwise return -1.
	 */
	private lookAheadForClickSequence(startIndex: number): number {
		const first = this.rawEvents[startIndex];
		const second = this.rawEvents[startIndex + 1];
		const third = this.rawEvents[startIndex + 2];

		const startsWithMouseDown = first && first.type === 'mousedown';
		if (!startsWithMouseDown) {
			return -1;
		}
		const target = first.target;

		const continuesWithMouseUp = second && second.type === 'mouseup' && second.target === target;
		if (!continuesWithMouseUp) {
			return -1;
		}

		const finishesWithClick = third && third.type === 'click' && third.target === target;
		if (!finishesWithClick) {
			return -1;
		}

		return 3;
	}

	/**
	 * Given a start index in the list of events, check that a sequence of keypresses starts at this position, on the
	 * same target. If so, return the number of events that consistute the sequence. Otherwise return -1.
	 */

	private lookAheadForFillSequence(startIndex: number): number {
		const first = this.rawEvents[startIndex];
		if (!first || first.type !== 'keypress' || first.key?.length !== 1) {
			return -1;
		}
		const target = first.target;

		let length = 1;
		while (this.rawEvents[startIndex + length] && this.rawEvents[startIndex + length].type === 'keypress' && this.rawEvents[startIndex + length].target === target) {
			length ++;
		}

		return length;
	}

	/**
	 * Create a new PageEvent array based on the raw one, but removing subsequent key presses, turning them into fill
	 * events, and removing down/up mouse events, turning them into clicks.
	 */
	getProcessedEvents(): PageEvent[] {
		const processedEvents: PageEvent[] = [];

		for (let i = 0; i < this.rawEvents.length; i++) {
			const clickSequenceLength = this.lookAheadForClickSequence(i);
			if (clickSequenceLength > -1) {
				processedEvents.push({
					type: 'click',
					target: this.rawEvents[i].target
				});
				i += clickSequenceLength - 1;
				continue;
			}

			const fillSequenceLength = this.lookAheadForFillSequence(i);
			if (fillSequenceLength > -1) {
				processedEvents.push({
					type: 'fill',
					target: this.rawEvents[i].target,
					inputValue: this.rawEvents[i + fillSequenceLength - 1].inputValue
				});
				i += fillSequenceLength - 1;
				continue;
			}

			processedEvents.push(this.rawEvents[i]);
		}
		
		return processedEvents;
	}

	getCode(): string[] {
		const generator = new PageEventsToCodeGenerator(this);
		return generator.getCode();
	}
}

class PageEventsToCodeGenerator {
	private recorder: PageEventsRecorder;

	constructor(recorder: PageEventsRecorder) {
		this.recorder = recorder;
	}

	getCode(): string[] {
		return this.recorder.getProcessedEvents().map(event => {
			switch (event.type) {
				case 'click':
					return this.generateCodeForClickEvent(event);
				case 'mousedown':
					return this.generateCodeForMouseDownEvent(event);
				case 'mouseup':
					return this.generateCodeForMouseUpEvent(event);
				case 'keypress':
					return this.generateCodeForKeyboardEvent(event);
				case 'fill':
					return this.generateCodeForFillEvent(event);
				case 'pageload':
					return this.generateCodeForPageLoadEvent(event);
			}
	
			return '';
		});
	}

	private generateCodeForClickEvent(event: PageEvent): string {
		return `await page.click('${event.target}');`;
	}

	private generateCodeForMouseDownEvent(event: PageEvent): string {
		return `await page.mouse.down('${event.target}');`;
	}

	private generateCodeForMouseUpEvent(event: PageEvent): string {
		return `await page.mouse.up('${event.target}');`;
	}

	private generateCodeForKeyboardEvent(event: PageEvent): string {
		return `await page.press('${event.target}', '${event.key}');`;
	}

	private generateCodeForFillEvent(event: PageEvent): string {
		return `await page.fill('${event.target}', '${event.inputValue}');`;
	}

	private generateCodeForPageLoadEvent(event: PageEvent): string {
		return `await page.waitForLoadState();`;
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('playwright-recorder.start', async () => {
		if (browserContext) {
			vscode.window.showErrorMessage('Recording already in progress, end it first');
			return;
		}

		const url = await vscode.window.showInputBox({
			placeHolder: 'Page URL',
			value: 'https://wikipedia.org/'
		});
		if (!url) {
			vscode.window.showErrorMessage('Please provide a page URL to start recording');
			return;
		}

		vscode.window.showInformationMessage('Starting to record');

		// Create an instance of the PageEventsRecorder to start the page events.
		pageEventsRecorderInstance = new PageEventsRecorder();

		// Get the template.
		codeTemplate = getFileContent(context, 'src', 'recording-template.js');

		// Create the new file
		await createRecordingFile();

		// Launch the browser.
		const browser = await playwright.chromium.launch({headless: false});
		browserContext = await browser.newContext();

		// Create a binding to receive actions from the page.
		await browserContext.exposeBinding('playwrightRecorderActionTracker', onPageActionFromInjectedScript);

		// Load the page.
		const page = await browserContext.newPage();
		await page.goto(url);

		// Inject the script that detects actions and highlights elements.
		const injectedScript = getFileContent(context, 'src', 'injected-script.js');
		await page.addScriptTag({content: injectedScript});
		await page.addInitScript({content: injectedScript});

		// Also detect page loads.
		page.on('load', onPageLoad);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('playwright-recorder.stop', async () => {
		if (!browserContext) {
			vscode.window.showErrorMessage('No recording in progress to stop');
			return;
		}

		vscode.window.showInformationMessage('Stopping to record');

		await browserContext.close();
		await browserContext.browser()?.close();
		browserContext = null;

		generatedFile = null;

		endRecordingFile();
	}));
}

export function deactivate() {}

/**
 * Called by playwright when the page finished loading (including after subsequent navigations).
 */
function onPageLoad() {
	pageEventsRecorderInstance?.recordEvent({type: 'pageload'});
}

/**
 * Called when an event was detected by the injected script on the page.
 * @param source 
 * @param PageEvent 
 */
function onPageActionFromInjectedScript(source: BindingSource, pageEvent: PageEvent) {
	pageEventsRecorderInstance?.recordEvent(pageEvent);
}

async function createRecordingFile() {
  generatedFile = await vscode.workspace.openTextDocument({
    language: 'javascript',
    content: ''
  });

	vscode.window.showTextDocument(generatedFile);

	// Start running a refresh loop in which we re-generate the recording code.
	generateCode();
	generatedFileRefreshLoop = setInterval(generateCode, 500);
}

function endRecordingFile() {
	generatedFileRefreshLoop && clearInterval(generatedFileRefreshLoop);
	generateCode();
}

function generateCode() {
	if (!codeTemplate || !generatedFile || !pageEventsRecorderInstance) {
		return;
	}

	const linesOfCode = pageEventsRecorderInstance.getCode().map(line => '    ' + line);

	const content = codeTemplate.replace('    // <<CONTENT>>', linesOfCode.join('\n\n'));
	if (generatedFile.getText() === content) {
		return;
	}

	const edit = new vscode.WorkspaceEdit();
	edit.replace(generatedFile.uri, new vscode.Range(0, 0, generatedFile.lineCount, Number.MAX_SAFE_INTEGER), content);
	vscode.workspace.applyEdit(edit);
}

function getFileContent(context: vscode.ExtensionContext, ...relativePath: string[]): string {
	const path = vscode.Uri.joinPath(context.extensionUri, ...relativePath).fsPath;
	return fs.readFileSync(path, 'utf-8');
}
