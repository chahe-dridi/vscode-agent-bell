```typescript
import * as vscode from 'vscode';
import { AlertHistory } from '../models/alertHistory';

export function buildItems(alertHistory: AlertHistory[]): vscode.QuickPickItem[] {
  const rows: vscode.QuickPickItem[] = alertHistory.map(r => ({
    label: `[${new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ${r.type} — ${r.source} — ${r.detail}`,
    description: r.type
  }));

  rows.push(
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(copy) Copy all to clipboard", description: `${alertHistory.length} alerts` },
    { label: "$(trash) Clear history", description: "Remove all alerts" }
  );

  return rows;
}

export async function handlePick(pick: vscode.QuickPickItem, alertHistory: AlertHistory[]) {
  if (pick.label.includes("Copy all")) {
    const text = alertHistory.map(r => {
      const t = new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `[${t}] ${r.type} — ${r.source} — ${r.detail}`;
    }).join("\n");
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`Notification Bell: ${alertHistory.length} alerts copied.`);
    return;
  } else if (pick.label.includes("Clear history")) {
    alertHistory.splice(0, alertHistory.length);
    vscode.window.showInformationMessage("Notification Bell: Alert history cleared.");
    return;
  }
}