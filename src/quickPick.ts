import * as vscode from 'vscode';

export function buildItems(alertHistory: any[]): vscode.QuickPickItem[] {
  const rows = alertHistory.map(r => ({
    label: `[${new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ${r.type} — ${r.source} — ${r.detail}`,
    kind: vscode.QuickPickItemKind.Default,
  }));

  rows.push(
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(copy) Copy all to clipboard", description: `${alertHistory.length} alerts` },
    { label: "$(trash) Clear history", kind: vscode.QuickPickItemKind.Default }
  );

  return rows;
}

export async function handlePick(pick: vscode.QuickPickItem, alertHistory: any[]): Promise<void> {
  if (pick.label.includes("Copy all")) {
    const text = alertHistory.map(r => {
      const t = new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `[${t}] ${r.type} — ${r.source} — ${r.detail}`;
    }).join("\n");
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`Notification Bell: ${alertHistory.length} alerts copied.`);
  } else if (pick.label.includes("Clear history")) {
    alertHistory.length = 0;
    vscode.window.showInformationMessage("Alert history cleared.");
  }
}