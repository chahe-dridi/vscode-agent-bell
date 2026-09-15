import * as vscode from 'vscode';

class StatusBarService {
    private statusBar: vscode.StatusBarItem;
    private alertHistory: { source: string; timestamp: number }[] = [];

    constructor() {
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBar.tooltip = 'Notification Bell';
        this.statusBar.command = 'extension.showAlertHistory';
        vscode.window.onDidChangeTextDocument(this.onTextDocumentChanged, this);
        this.updateStatusBar();
    }

    private onTextDocumentChanged(e: vscode.TextDocumentChangeEvent) {
        // Example logic to detect alerts
        if (e.document.getText().includes('claude')) {
            this.alertHistory.push({ source: 'Pattern match', timestamp: Date.now() });
            this.updateStatusBar();
        }
    }

    private updateStatusBar() {
        const alertCount = this.alertHistory.length;
        if (alertCount > 0) {
            const lastAlert = this.alertHistory[0];
            const lastAlertText = `Last: ${lastAlert.source} · "${lastAlert.source}" · ${this.timeAgo(lastAlert.timestamp)}`;
            this.statusBar.tooltip = `Notification Bell — ${alertCount} alerts this session\n${lastAlertText}`;
        } else {
            this.statusBar.tooltip = 'Notification Bell';
        }
        this.statusBar.text = `bell ${alertCount}`;
        this.statusBar.show();
    }

    private timeAgo(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }
}

export default StatusBarService;