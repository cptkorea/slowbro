// Calculates the individual attendance counts per week
function calc(week) {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var map = new Map();
  var k = 3;
  
  // Assumes each week has 4 days First k sheets are collecting weekly attendance
  for (var i = (week - 1) * 4 + k + 1; i < (week) * 4 + k + 1; i++) {
    var sheet = sheets[i];
    if (SpreadsheetApp.getActiveSheet() != sheet) {
      var map = calcDay(sheet, map);
    }
  }
  
  var keys = Object.keys(map);
  var len = keys.length;
  
  sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange("A2:B").clearContent();
  
  for (var i = 1; i <= len; i++) {
    name = keys[i-1];
    sheet.getRange(i+1, 1).setValue(name);
    sheet.getRange(i+1, 2).setValue(map[name]);
  }
}

// Calculates the individual attendance count per day
function calcDay(sheet, map) {
  var lastSourceRow = sheet.getLastRow();
  var lastSourceCol = sheet.getLastColumn();
  var unique = new Set();
  
  if (lastSourceRow > 2 && lastSourceCol > 2) {
    var sourceRange = sheet.getRange(1, 1, lastSourceRow, lastSourceCol);
    var sourceData = sourceRange.getValues();

    for (row in sourceData) {
      var name = sourceData[row][0];
      if (!unique.has(name) && name) {
        unique.add(name);
      }
    }
    
    for (var name of unique) {
      map[name] = get(map, name, 0) + 1;
    }
    Logger.log(map);
    return map;
  }
}

// map.getOrDefault()
function get(map, key, def) {
  if (key in map)
    return map[key];
   return def;
}

function doGet() {
 calc(); 
}
