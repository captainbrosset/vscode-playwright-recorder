# playwright-recorder

playwright-recorder is a VS Code extension that helps create E2E javascript test files based on Playwright.

## Features

The extension exposes 2 commands:

* `playwright-recorder.start`: Record a new playwright test.
* `playwright-recorder.stop`: Stop the current new playwright test.

Use these commands to start and stop the recording.

When the recording start, you will be asked to enter a URL. Once submitted, a browser window will open. At this point, you can click links, buttons, type text, etc. and the extension will generate the corresponding code in a new text editor.
