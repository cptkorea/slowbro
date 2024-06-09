function aggregate() {
  var count = {};
  var ta1 = "sheetId"; // Each TAs individual attendance sheetID
  var ta2 = "sheetId";
  var ta3 = "sheetId";
  var ta4 = "sheetId";
  var ta5 = "sheetId";
  var tas = [ta1, ta2, ta3, ta4, ta5];
  idx = 1;
  for (var i = 0; i < tas.length; i++) {
    count = collect_data(tas[i], count); 
  }
  write_data(count, 2);
}

function collect_data(id, count) {
  var week = SpreadsheetApp.openById(id).getSheetByName('week2');
  var lastSourceRow = week.getLastRow();
  var sourceData = week.getRange(1, 1, lastSourceRow, 3).getValues();

  for (var i = 1; i < lastSourceRow; i++) {
    var email = sourceData[i][2];
    if (email)
      count[email] = (count[email] || 0) + sourceData[i][1];
  }
  return count;
}

function write_data(count, week) {
  var keys = Object.keys(count);
  var len = keys.length;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master');
  var lastSourceRow = sheet.getLastRow();
  
  for (var i = 1; i <= len; i++) {
    var email = keys[i-1];
    var row = find_student(email);
    if (row == -1) {
      sheet.getRange(lastSourceRow + 1, 2).setValue(email);
      sheet.getRange(lastSourceRow + 1, 3 + week).setValue(count[email]);
    } else {
      sheet.getRange(row+1, 3+week).setValue(count[email]); 
    }
  }
}

function fill_emails(count) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var roster = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Roster');
  var lastSourceRow = roster.getLastRow();
  var rosterData = roster.getRange(4, 1, lastSourceRow, 3).getValues();  
  
  var keys = Object.keys(count);
  var len = keys.length;
  for (var i = 1; i < len; i++) {
   sheet.getRange(i+1, 3).setValue(1); 
  }
}

function find_student(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Master');
  var lastSourceRow = sheet.getLastRow();
  var rosterData = sheet.getRange(1, 2, lastSourceRow, 2).getValues();  
  
  for (var i = 0; i < lastSourceRow; i++) {
    if (rosterData[i][0] == email) {
      return i;
    }
  }
  return -1;
}

