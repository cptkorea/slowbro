// Main function that notifies interviewers
function notify() {
  var idMap = {'pos1': 'calId1@group.calendar.google.com',
               'pos2': 'calId2@group.calendar.google.com',
               'pos3': 'calId3@group.calendar.google.com',
               'pos4': 'calId4@group.calendar.google.com'};
  var courses = ['pos1', 'pos2', 'pos3', 'pos4'];
  var slotsMap = createMapping(courses);
  var interviewMap = createInterviewMap(courses);
  for (var i = 0; i < courses.length; i++) {
    var course = courses[i];
    sendInvites(course, idMap[course], slotsMap[course], interviewMap[course]);
  }
}

// Helper function that notifies each interviewer per position
function sendInvites(course, calendarId, courseMap, interviewMap) {
  var start = new Date('August 11, 2020');
  var end = new Date('August 14, 2020');
  var eventIds = getEventIds();
  
  var calendar = CalendarApp.getCalendarById(calendarId);
  var events = calendar.getEvents(start, end);
  if (events.length > 0) {
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var eventId = event.getId().split("@")[0].toString();
      var interviewee = event.getGuestList()[0].getEmail();
      if (!(eventIds.has(eventId))) {
        //Logger.log('%s: (%s) %s', interviewee, event.getStartTime(), eventId);
        var interviewers = getInterviewers(course, courseMap, event.getStartTime(), interviewMap);
        Logger.log(interviewers);
        for (var j = 0; j < interviewers.length; j++) {
          if (interviewers[j]) {
            addGuestAndSendEmail(calendarId, eventId, interviewers[j]);
          }
        }
        writeEntry(interviewee, event.getStartTime(), course, interviewers, eventId);
      }
    }
  } else {
    Logger.log('No upcoming events found.');
  }
}

// From https://stackoverflow.com/questions/53992955/how-do-i-send-the-standard-invitation-email-when-calling-addguest-on-a-calendare    
function addGuestAndSendEmail(calendarId, eventId, newGuest) {
  var event = Calendar.Events.get(calendarId, eventId);
  var attendees = event.attendees;
  attendees.push({email: newGuest});

  var resource = { attendees: attendees };
  var args = { sendUpdates: "all" };

  Calendar.Events.patch(resource, calendarId, eventId, args);
}