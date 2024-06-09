// Gets the next available interviewers for a given time.
function getInterviewers(course, courseMap, startTime, interviewMap) {
  if (startTime in courseMap) {
    var allInterviewers = courseMap[startTime];
    var idx = interviewMap[startTime] || 1; // numInterviews scheduled at startTime
    interviewMap[startTime] += 1;
    return allInterviewers[idx-1];
  }
}

// Creates a set of all eventIds of already scheduled interviews.
function getEventIds() {
  var eventIds = new Set();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Interviews');
  var lastSourceRow = sheet.getLastRow();
  var sourceData = sheet.getRange(2, 6, lastSourceRow, 6).getValues();
  
  for (var i = 0; i < lastSourceRow; i++) {
    var eventId = sourceData[i][0];
    if (eventId) {
      eventIds.add(eventId);
    }
  }
  return eventIds;
}

// Creates a mapping of each course to all available interview slots
function createMapping(courses) {
  var map = new Map();
  var numCourses = courses.length;

  var matchSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Matches');
  var lastSourceRow = matchSheet.getLastRow();
  var matchData = matchSheet.getRange(3, 1, lastSourceRow, 3 * numCourses).getValues(); // getRange is 1 indexed
  
  for (var i = 0; i < numCourses; i++) {
    var course = courses[i];
    map[course] = new Map();
    for (var j = 0; j < lastSourceRow; j++) {
      var p1 = matchData[j][3*i + 0]; // Arrays are 0 indexed
      var p2 = matchData[j][3*i + 1];
      var time = matchData[j][3*i + 2];
      if (map[courses[i]] && p1) {
        var date = new Date(time);
        for (var k = 0; k < 4; k++) { // 4 slots per hour
          var intTime = new Date(date.getTime() + 15 * 60 * 1000 * k); // 15 min * 60 seconds * 1000 milliseconds
          var val = map[course][intTime];
          if (val) {
            map[course][intTime].push([p1, p2]);
          } else {
            map[course][intTime] = [[p1, p2]];
          }
        }
      }
    }
  }
  return map;
}

// Creates a map counting all current interviews that are already scheduled.
function createInterviewMap(courses) {
  var map = new Map();
  var numCourses = courses.length;
  
  for (var i = 0; i < courses.length; i++) {
    map[courses[i]] = new Map();
  }

  var interviewSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Interviews');
  var lastSourceRow = interviewSheet.getLastRow();
  var interviewData = interviewSheet.getRange(2, 2, lastSourceRow, 3).getValues();
  
  for (var i = 0; i < lastSourceRow; i++) {
    var time = interviewData[i][0];
    var course = interviewData[i][1];
    if (course) {
      map[course][time] = (map[course][time] || 0) + 1; // Counts how many interviews are in a given time
    }
  }
  
  return map;
}

// Writes an interview record to the sheet Interviews
function writeEntry(interviewee, time, course, interviewers, eventId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Interviews');
  var lastSourceRow = sheet.getLastRow();
 
  sheet.getRange(lastSourceRow+1, 1).setValue(interviewee);
  sheet.getRange(lastSourceRow+1, 2).setValue(time);
  sheet.getRange(lastSourceRow+1, 3).setValue(course);
  sheet.getRange(lastSourceRow+1, 4).setValue(interviewers[0]);
  sheet.getRange(lastSourceRow+1, 5).setValue(interviewers[1] || null);
  sheet.getRange(lastSourceRow+1, 6).setValue(eventId);
}
