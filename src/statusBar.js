```javascript
import { getAlertHistory } from '../alertHistory';

export function updateStatusBar() {
    const alertHistory = getAlertHistory();
    const alertCount = alertHistory.length;
    let tooltip = `Notification Bell — ${alertCount} alerts this session`;

    if (alertCount > 0) {
        const lastAlert = alertHistory[0];
        const lastAlertSource = lastAlert.source;
        const lastAlertTime = lastAlert.timestamp.toLocaleString();
        tooltip += `\nLast: ${lastAlertSource} · "${lastAlert.message}" · ${lastAlertTime}`;
    }

    // Assuming there's a function to update the status bar tooltip
    updateStatusBarTooltip(tooltip);
}

function updateStatusBarTooltip(tooltip) {
    // Implementation to update the status bar tooltip
    console.log('Updating status bar tooltip:', tooltip);
}
```