import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TextAreaComponent,
	MarkdownView,
} from "obsidian";

export default class TextSnippets extends Plugin {
	settings: TextSnippetsSettings;
	private cmEditors: CodeMirror.Editor[];

	onInit() {}

	async onload() {
		console.log("Loading snippets plugin");
		await this.loadSettings();

		this.addCommand({
			id: "text-snippets",
			name: "Run snippet replacement",
			callback: () => this.SnippetOnTrigger(),
			hotkeys: [{
				modifiers: ["Mod"],
				key: "tab"
			}],
		});

		this.cmEditors = [];
		this.registerCodeMirror((cm) => {
			this.cmEditors.push(cm);
			// the callback has to be called through another function in order for 'this' to work
			cm.on('keydown', (cm, event) => this.handleKeyDown(cm, event));
		});

		this.addSettingTab(new TextSnippetsSettingsTab(this.app, this));
	}

	onunload() {
		console.log("Unloading text snippet plugin");

		this.cmEditors = [];
		this.registerCodeMirror((cm) => {
			this.cmEditors.push(cm);
			// the callback has to be called through another function in order for 'this' to work
			cm.off('keydown', (cm, event) => this.handleKeyDown(cm, event));
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	UpdateSplit(newlineSymbol: string) {
		var nlSymb = newlineSymbol;
		var nlSymb = nlSymb.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
		var rg = '(?<!' + nlSymb +')\\n';
		const regex = new RegExp(rg);
		var splited = this.settings.snippets_file.split(regex);
		splited = splited.filter(item => item);
		this.settings.snippets = splited;
	}

	getSelectedText(editor: CodeMirror.Editor) {
		if (editor.somethingSelected()) {
			return editor.getSelection();
		} else {
			var wordBoundaries = this.getWordBoundaries(editor);
			editor.getDoc().setSelection(wordBoundaries.start, wordBoundaries.end);
			return editor.getSelection();
		}
	}

	getWordBoundaries(editor: CodeMirror.Editor) {
		var cursor = editor.getCursor();
		var line = cursor.line;
		var word = editor.findWordAt({
			line: line,
			ch: cursor.ch
		});
		var wordStart = word.anchor.ch;
		var wordEnd = word.head.ch;

		return {
			start: {
				line: line,
				ch: wordStart
			},
			end: {
				line: line,
				ch: wordEnd
			},
		};
	}

	findSnippet(editor : CodeMirror.Editor, cursorOrig : CodeMirror.Position, cursor : CodeMirror.Position) : string {
		var selectedText = this.getSelectedText(editor);
		var wordDelimiters = Array.from(this.settings.wordDelimiters);
		var selectedWoSpaces = selectedText.split(' ').join('');
		var newStr = "";

		if (selectedWoSpaces == '' || wordDelimiters.indexOf(selectedWoSpaces[0]) >= 0 && cursorOrig.ch == cursor.ch) {
			editor.execCommand('goWordLeft');
			editor.execCommand('goWordLeft');
			selectedText = this.getSelectedText(editor);
			var cursor = editor.getCursor('from');
		}

		var i;
		var snippets =  this.settings.snippets;
		for (i in snippets){
			var snippet = snippets[i].split(' : ');

			if (selectedText == snippet[0]) {
				newStr = snippet[1];
			}
		}
		return newStr;
	}

	calculateCursorEndPos(nStr : string, cursor : CodeMirror.Position, endPosition : any): string {
		var nlSymb = this.settings.newlineSymbol;
		var endSymbol = this.settings.endSymbol;
		var stopSymbol = this.settings.stopSymbol;
		var newStr = nStr.split('\n').join('');

		if (newStr.indexOf(stopSymbol) == -1) {
			var rawEnd = newStr.indexOf(endSymbol);
			if (rawEnd == -1)	rawEnd = newStr.length;
			
			var lastNl = newStr.substring(0, rawEnd).lastIndexOf(nlSymb);
			if (lastNl != -1)	var endPosIndex = rawEnd - lastNl - nlSymb.length - cursor.ch;
			else 				var endPosIndex = rawEnd;
		} else {
			var endPosIndex = 0;
		}


		nlSymb = nlSymb.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');	//no special symbols in nlSymb
		var rg = nlSymb + '\\n' + '|' + nlSymb;
		const regex = new RegExp(rg);
		const regexF = new RegExp(rg, 'g');
		var nlinesCount = (newStr.substring(0, rawEnd).match(regexF) || []).length;

		endPosition.nlinesCount = nlinesCount;
		endPosition.position = endPosIndex;

		newStr = newStr.split(regex).join('\n');
		newStr = newStr.replace(endSymbol,'');
		return newStr;
	}


	insertSnippet(key : string = '', snippetStartpos : CodeMirror.Position = {ch:-1, line:-1}): boolean {
		let activeLeaf: any = this.app.workspace.activeLeaf;
		let editor = activeLeaf.view.sourceMode.cmEditor;
		var cursorOrig = editor.getCursor();
		var wasSelection = editor.somethingSelected();
		var cursor = editor.getCursor('from');
		var wordBoundaries = this.getWordBoundaries(editor);
		var stopSymbol = this.settings.stopSymbol;
		var pasteSymbol = this.settings.pasteSymbol;
		var stopFound = false;
		var newStr = "";

		newStr = this.findSnippet(editor, cursorOrig, cursor);
		cursor = editor.getCursor('from');

		//proceed Tab and Spacebar
		var endCursor = editor.getCursor('to');
		if (newStr == "" || 
			(key == 'Space' && (cursorOrig.ch != endCursor.ch || cursorOrig.line != endCursor.line)) )  {
			if (wasSelection == false) {
				editor.getDoc().setSelection(cursorOrig, cursorOrig);
			}
			if (key == 'Space')	return false;
			if (newStr == "") {
				editor.setCursor(cursorOrig);
				return this.nextStop();
			}	
		}

		//find end position
		var endPosition = {nlinesCount: 0, position: 0};
		newStr = this.calculateCursorEndPos(newStr, cursor, endPosition);
		if (newStr.indexOf(stopSymbol) != -1)	stopFound = true;
		if (newStr.indexOf(pasteSymbol) != -1)	snippetStartpos = cursor;

		editor.replaceSelection(newStr);

		if (stopFound) {
			editor.setCursor({
				line: cursor.line,
				ch: cursor.ch
			});

			return this.nextStop();
		} else {
			editor.setCursor({
				line: cursor.line + endPosition.nlinesCount,
				ch: cursor.ch + endPosition.position
			});
		}

		editor.focus();
		return true;
	}

	adjustCursor(editor: CodeMirror.Editor, cursor: CodeMirror.Position, newStr: string, oldStr: string) {
		var cursorOffset = newStr.length - oldStr.length;
		this.adjustCursorOffset(editor, cursor, cursorOffset);
	}

	adjustCursorOffset(editor: CodeMirror.Editor, cursor: CodeMirror.Position, cursorOffset: any) {
		editor.setCursor({
			line: cursor.line,
			ch: cursor.ch + cursorOffset
		});
	}

	handleKeyDown (cm: CodeMirror.Editor, event: KeyboardEvent): void { 
		if ((event.key == 'Tab' && this.settings.useTab) || (event.code == 'Space' && this.settings.useSpace)) {
			this.SnippetOnTrigger(event.code, true);
		}
	}

	SnippetOnTrigger(key : string = '', preventDef: boolean=false) {
		let activeLeaf: any = this.app.workspace.activeLeaf;
		let cm = activeLeaf.view.sourceMode.cmEditor;
		var cursorSt = cm.getCursor();
		if (this.insertSnippet(key, cursorSt)) {
			if (preventDef)		event.preventDefault();

			if (cursorSt.ch >=0 && cursorSt.line >= 0) {		//paste text from clipboard
				var cursorOrig = cm.getCursor();
				navigator.clipboard.readText().then(
					(clipText) => {
						var search = cm.getSearchCursor(this.settings.pasteSymbol, cursorSt);
						if (search.findNext()) {
							search.replace(clipText);
						}
					});
			}
		}
	}

	nextStop(): boolean {
		let activeLeaf: any = this.app.workspace.activeLeaf;
		let cm = activeLeaf.view.sourceMode.cmEditor;
		var search = cm.getSearchCursor(this.settings.stopSymbol, cm.getCursor());
		if (search.findNext()) {
			search.replace("");
			cm.setCursor(search.from());
			return true;
		} else if (this.settings.useTab) {
			return false;
		}
		return false;
	}
}

interface TextSnippetsSettings {
	snippets_file: string;
	snippets: string[];
	endSymbol: string;
	newlineSymbol: string;
	stopSymbol: string;
	pasteSymbol: string;
	useTab: boolean;
	useSpace: boolean;
	wordDelimiters: string;

}

const DEFAULT_SETTINGS: TextSnippetsSettings = {
	snippets_file: "snippets : It is an obsidian plugin, that replaces your selected text.",
	snippets : ["snippets : It is an obsidian plugin, that replaces your selected text."],
	endSymbol: '$end$',
	newlineSymbol: '$nl$',
	stopSymbol: "$tb$",
	pasteSymbol: "$pst$",
	useTab: true,
	useSpace: false,
	wordDelimiters: "$()[]{}<>,.!?;:\'\"\\/",
}

class TextSnippetsSettingsTab extends PluginSettingTab {
	plugin: TextSnippets;

	constructor(app: App, plugin: TextSnippets) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let {
			containerEl
		} = this;

		containerEl.empty();
		containerEl.createEl('h2', {text: 'Text Snippets - Settings'});

		new Setting(containerEl)
		.setName("Snippets")
		.setDesc("Type here your snippets in format 'snippet : result', one per line. Empty lines will be ignored. Ctrl+Tab to replace (hotkey can be changed).")
		.setClass("text-snippets-class")
		.addTextArea((text) =>
			text
			.setPlaceholder("before : after")
			.setValue(this.plugin.settings.snippets_file)
			.onChange(async (value) => {
				this.plugin.settings.snippets_file = value;
				this.plugin.UpdateSplit(this.plugin.settings.newlineSymbol);
				await this.plugin.saveSettings();
			})
		);
		new Setting(containerEl)
		.setName("Cursor end position mark")
		.setDesc("Places the cursor to the mark position after inserting a snippet (default: $end$).\nMark does not appear anywhere within the snippet. Do not use together with Stop Symbol.")
		.setClass("text-snippets-cursor")
		.addTextArea((text) =>
			text
			.setPlaceholder("$end$")
			.setValue(this.plugin.settings.endSymbol)
			.onChange(async (value) => {
				if (value == '') {
					value = '$end$';
				}
				this.plugin.settings.endSymbol = value;
				await this.plugin.saveSettings();
			})
		);
		new Setting(containerEl)
		.setName("Newline mark")
		.setDesc("Ignores newline after mark, replace it with a newline character after expanding (default: $nl$).\nNecessary to write before every line break in multiline snippets.")
		.setClass("text-snippets-newline")
		.addTextArea((text) =>
			text
			.setPlaceholder("$nl$")
			.setValue(this.plugin.settings.newlineSymbol)
			.onChange(async (value) => {
				if (value == '') {
					value = '$nl$';
				}
				this.plugin.settings.newlineSymbol = value;
				this.plugin.UpdateSplit(value);
				await this.plugin.saveSettings();
			})
		);
		new Setting(containerEl)
		.setName('Stop Symbol')
		.setDesc('Symbol to jump to when command is called.')
		.setClass("text-snippets-tabstops")
		.addTextArea((text) => text
			.setPlaceholder('')
			.setValue(this.plugin.settings.stopSymbol)
			.onChange(async (value) => {
				if (value =='') {
					value = '$tb$';
				}
				this.plugin.settings.stopSymbol = value;
				await this.plugin.saveSettings();
			})
			);


		new Setting(containerEl)
		.setName('Clipboard paste Symbol')
		.setDesc('Symbol to be replaced with clipboard content.')
		.setClass("text-snippets-tabstops")
		.addTextArea((text) => text
			.setPlaceholder('')
			.setValue(this.plugin.settings.pasteSymbol)
			.onChange(async (value) => {
				if (value =='') {
					value = '$pst$';
				}
				this.plugin.settings.pasteSymbol = value;
				await this.plugin.saveSettings();
			})
			);

		new Setting(containerEl)
		.setName("Expand on Tab")
		.setDesc("Use the Tab key as the trigger.")
		.addToggle(toggle =>
			toggle.setValue(this.plugin.settings.useTab)
			.onChange(async (value) => {
				this.plugin.settings.useTab = !this.plugin.settings.useTab;
				await this.plugin.saveSettings();
			})
			);
		new Setting(containerEl)
		.setName("Expand on Space")
		.setDesc("Use the Space bar button as the trigger.")
		.addToggle(toggle =>
			toggle.setValue(this.plugin.settings.useSpace)
			.onChange(async (value) => {
				this.plugin.settings.useSpace = !this.plugin.settings.useSpace;
				await this.plugin.saveSettings();
			})
			);

		new Setting(containerEl)
		.setName('Word delimiters')
		.setDesc('Сharacters for specifying the boundary between separate words.')
		.setClass("text-snippets-delimiter")
		.addTextArea((text) => text
			.setPlaceholder('')
			.setValue(this.plugin.settings.wordDelimiters)
			.onChange(async (value) => {
				this.plugin.settings.wordDelimiters = value;
				await this.plugin.saveSettings();
			})
			);

	}
}
