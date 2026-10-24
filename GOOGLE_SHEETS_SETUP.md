# Saving results to Google Sheets

The full study (`index.html`) submits one JSON payload per participant when they reach the debrief screen. By default that payload only lives in the participant's own browser (and, in `debug=1` mode, on `window.__studyDebug.state.finalPayload`) — nothing is saved anywhere durable until you connect a `dataEndpoint`.

The simplest durable backend for this is a Google Apps Script "Web App" that appends each payload as a row in a Google Sheet. This avoids needing any server of your own, and keeps the data inside your own Google account.

## 1. Create the Sheet + Apps Script

1. Create a new Google Sheet (e.g. "SIT Experiment Results"). Add a header row to the first sheet (tab name `Responses`) with these columns, in this order — they match the flattening logic in step 2:

   `timestamp | pid | condition | conditionName | group | participantLabel | rosterTotal | rosterInGroup | rosterOutGroup | consentAgreedAt | eligibilityAdult | eligibilityUsResident | gender | age | education | party | allocationMode | allocationTotal | identification | ingroupAffect | outgroupAffect | comp_q5_answer | comp_q5_correct | comp_q6_answer | comp_q6_correct | comp_q7_answer | comp_q7_correct | comp_q8_answer | comp_q8_correct | mathOwnCorrect | mathTeamTotal | mathOtherTeamTotal | diffPairsCompleted | diffTeamTotal | diffOtherTeamTotal | linkBoardsCompleted | linkTeamTotal | linkOtherTeamTotal | overallOwnTeamTotal | overallOtherTeamTotal | overallOutcome | totalHelpsGiven | totalHelpsReceived | allocationJson | fullPayloadJson`

   The `allocationJson` and `fullPayloadJson` columns hold the complete per-participant allocation table and the entire raw payload as JSON text, so nothing is lost even though the row above only flattens the headline numbers — you can always re-derive anything from `fullPayloadJson` later.

2. In the Sheet, open **Extensions → Apps Script**, delete the placeholder code, and paste:

   ```javascript
   function doPost(e) {
     var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Responses');
     var data = JSON.parse(e.postData.contents);
     var comp = data.comprehension || {};
     var g = data.game || {};
     function c(id, field) { return comp[id] ? comp[id][field] : ''; }

     sheet.appendRow([
       new Date(),
       data.pid, data.condition, data.conditionName, data.group, data.participantLabel,
       data.rosterSize && data.rosterSize.total, data.rosterSize && data.rosterSize.inGroup, data.rosterSize && data.rosterSize.outGroup,
       data.consentAgreedAt,
       data.eligibility && data.eligibility.adult, data.eligibility && data.eligibility.usResident,
       data.demographics && data.demographics.gender, data.demographics && data.demographics.age,
       data.demographics && data.demographics.education, data.demographics && data.demographics.party,
       data.allocationMode, data.allocation && data.allocation.total,
       data.identification, data.ingroupAffect, data.outgroupAffect,
       c('q5', 'answer'), c('q5', 'correct'), c('q6', 'answer'), c('q6', 'correct'),
       c('q7', 'answer'), c('q7', 'correct'), c('q8', 'answer'), c('q8', 'correct'),
       g.mathOwnCorrect, g.mathTeamTotal, g.mathOtherTeamTotal,
       g.diffPairsCompleted, g.diffTeamTotal, g.diffOtherTeamTotal,
       g.linkBoardsCompleted, g.linkTeamTotal, g.linkOtherTeamTotal,
       g.overallOwnTeamTotal, g.overallOtherTeamTotal, g.overallOutcome,
       g.totalHelpsGiven, g.totalHelpsReceived,
       JSON.stringify(data.allocation), JSON.stringify(data)
     ]);

     return ContentService.createTextOutput('ok');
   }
   ```

3. Click **Deploy → New deployment**, select type **Web app**, set "Execute as" to **Me**, and "Who has access" to **Anyone**. Deploy, and copy the Web App URL it gives you (ends in `/exec`).

   Note: "Anyone" here means anyone who has the URL can POST a row — it does not expose your Sheet for reading or editing, only this one write path. If you want tighter control, you can add a shared-secret query parameter check at the top of `doPost` and only accept requests that include it.

## 2. Point the site at it

Add `?dataEndpoint=<your Web App URL, URL-encoded>` to your study link, e.g.:

```
https://jingranyang.github.io/sit-experiment2/?dataEndpoint=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2FAKfycb.../exec
```

Every participant who reaches the debrief screen will then have their results POSTed as a new row.

## 3. Test it

Open the study link above (adding `&condition=1&debug=1` to force a fast path through Condition 1) and click through to the debrief screen. A new row should appear in your Sheet within a few seconds. If it doesn't:
- Re-check the deployment is "Anyone" access (not "Anyone with a Google account" — that would reject anonymous POSTs from participants' browsers).
- Open the Sheet's Apps Script **Executions** log (left sidebar) to see any errors from `doPost`.
- The POST is sent with `mode: 'no-cors'`, so the browser will never show you a readable response or a clear network error either way — the Sheet (or the Executions log) is the source of truth for whether it arrived.

## Not using Google Sheets yet?

That's fine — leave `dataEndpoint` unset. The study still runs end-to-end; results just aren't saved anywhere durable. In `?debug=1` mode you can inspect the final payload in the browser console via `window.__studyDebug.state.finalPayload`, or `JSON.stringify` it to copy out manually, while you decide on a backend.
