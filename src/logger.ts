import * as vscode from 'vscode';

let _channel: vscode.OutputChannel;

export function initLogger(channel: vscode.OutputChannel) {
  _channel = channel;
}

export function log(msg: string) {
  _channel.appendLine(msg);
}

export function getChannel(): vscode.OutputChannel {
  return _channel;
}
